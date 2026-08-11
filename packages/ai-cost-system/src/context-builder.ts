import { canonicalize } from './canonical.js';
import {
  contextBuildInputSchema,
  contextBuildOutcomeSchema,
  contextManifestSchema,
  type CompactError,
  type CompactionReport,
  type ContextBuildInput,
  type ContextBuildOutcome,
  type ContextManifest,
  type ContextReasonCode,
  type DiffHunkCandidate,
  type SerenaExcerpt,
} from './context-contracts.js';
import { validateContextIntegrity } from './context-integrity.js';
import { compactDiffHunks } from './diff-compactor.js';
import { compactErrors } from './error-compactor.js';
import {
  calculateContextHash,
  PromptBuildError,
  renderPrompt,
} from './prompt-builder.js';

type PolicyInvariant =
  ContextBuildInput['policy']['applicable_invariants'][number];

interface SelectionState {
  excerpts: SerenaExcerpt[];
  diffHunks: DiffHunkCandidate[];
  errors: CompactError[];
  invariants: PolicyInvariant[];
  readonly deduplicatedExcerptIds: string[];
  readonly excludedDiffHunkIds: string[];
  readonly deduplicatedDiffHunkIds: string[];
  readonly prunedNonCriticalIds: string[];
  readonly normalizationReasonCodes: string[];
}

type CandidateCategory = 'excerpt' | 'diff' | 'error' | 'invariant';

interface PruneCandidate {
  readonly category: CandidateCategory;
  readonly id: string;
  readonly critical: boolean;
  readonly priority: number;
  readonly kindRank: number;
}

interface LimitState {
  readonly categories: ReadonlySet<CandidateCategory>;
  readonly global: boolean;
}

const excerptKindRank: Readonly<Record<SerenaExcerpt['kind'], number>> = {
  signature: 0,
  implementation: 1,
  'targeted-test': 2,
  reference: 3,
  'file-range': 4,
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function stop(
  reasonCode: ContextReasonCode,
  details?: {
    contextHash: string;
    requiredPromptBytes: number;
    promptLimitBytes: number;
    compaction: CompactionReport;
  },
): ContextBuildOutcome {
  return deepFreeze(
    contextBuildOutcomeSchema.parse({
      status: 'STOP',
      reason_code: reasonCode,
      context_hash: details?.contextHash ?? null,
      required_prompt_bytes: details?.requiredPromptBytes ?? null,
      prompt_limit_bytes: details?.promptLimitBytes ?? null,
      compaction: details?.compaction ?? null,
    }),
  );
}

function deduplicateExcerpts(excerpts: readonly SerenaExcerpt[]): {
  selected: SerenaExcerpt[];
  removedIds: string[];
} {
  const sorted = [...excerpts].sort(
    (left, right) =>
      Number(right.critical) - Number(left.critical) ||
      excerptKindRank[left.kind] - excerptKindRank[right.kind] ||
      left.priority - right.priority ||
      compareCodeUnits(left.path, right.path) ||
      left.range.start_line - right.range.start_line ||
      compareCodeUnits(left.excerpt_id, right.excerpt_id),
  );
  const selected: SerenaExcerpt[] = [];
  const removedIds: string[] = [];
  const seen = new Set<string>();
  for (const excerpt of sorted) {
    const key = canonicalize({
      path: excerpt.path,
      content_hash: excerpt.content_hash,
    });
    if (seen.has(key)) {
      removedIds.push(excerpt.excerpt_id);
    } else {
      seen.add(key);
      selected.push(excerpt);
    }
  }
  selected.sort(
    (left, right) =>
      compareCodeUnits(left.path, right.path) ||
      left.range.start_line - right.range.start_line ||
      left.range.end_line - right.range.end_line ||
      compareCodeUnits(left.excerpt_id, right.excerpt_id),
  );
  return { selected, removedIds: removedIds.sort(compareCodeUnits) };
}

function deduplicateErrors(errors: readonly CompactError[]): CompactError[] {
  const selected: CompactError[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    if (!seen.has(error.error_fingerprint)) {
      seen.add(error.error_fingerprint);
      selected.push(error);
    }
  }
  return selected;
}

function compactionReport(
  state: SelectionState,
  originalPromptBytes: number,
  finalPromptBytes: number,
): CompactionReport {
  return {
    deduplicated_excerpt_ids: [...state.deduplicatedExcerptIds],
    excluded_diff_hunk_ids: [...state.excludedDiffHunkIds],
    deduplicated_diff_hunk_ids: [...state.deduplicatedDiffHunkIds],
    pruned_non_critical_ids: [...state.prunedNonCriticalIds].sort(
      compareCodeUnits,
    ),
    normalization_reason_codes: [...state.normalizationReasonCodes].sort(
      compareCodeUnits,
    ),
    original_prompt_bytes: originalPromptBytes,
    final_prompt_bytes: finalPromptBytes,
  };
}

function createManifest(
  input: ContextBuildInput,
  state: SelectionState,
  report: CompactionReport,
): ContextManifest {
  const policyEvidence = {
    ...input.policy,
    applicable_invariants: [...state.invariants],
  };
  const withoutHash: Omit<ContextManifest, 'context_hash'> = {
    schema_version: 1,
    task_id: input.task.task_id,
    prompt_version: input.task.prompt_version,
    route: input.routing.route,
    provider: input.routing.provider,
    provider_role: input.routing.provider_role,
    task_spec_hash: input.task.task_spec_hash,
    task_brief: input.task.brief,
    routing_evidence: input.routing,
    policy_evidence: policyEvidence,
    selection_hash: input.selection_scope.selection_hash,
    selected_symbols: state.excerpts.filter(
      (item) => item.kind !== 'file-range',
    ),
    selected_files: state.excerpts.filter((item) => item.kind === 'file-range'),
    selected_diff_hunks: [...state.diffHunks],
    error_context: [...state.errors],
    previous_attempt_summary: input.previous_attempt_summary,
    verification_evidence: input.verification_evidence,
    remaining_budget: input.remaining_budget,
    prohibited_scope: input.prohibited_scope,
    context_policy: input.context_policy,
    compaction: report,
  };
  return contextManifestSchema.parse({
    ...withoutHash,
    context_hash: calculateContextHash(withoutHash),
  });
}

function renderCandidate(
  input: ContextBuildInput,
  state: SelectionState,
  originalPromptBytes: number,
  finalPromptBytes: number,
) {
  const report = compactionReport(state, originalPromptBytes, finalPromptBytes);
  const manifest = createManifest(input, state, report);
  const rendered = renderPrompt(
    manifest,
    input.context_policy.allowed_verification_command_ids,
  );
  return { manifest, report, rendered };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(canonicalize(value), 'utf8');
}

function limitState(
  input: ContextBuildInput,
  state: SelectionState,
  promptBytes: number,
): LimitState {
  const categories = new Set<CandidateCategory>();
  if (
    state.excerpts.some(
      (excerpt) =>
        Buffer.byteLength(excerpt.content, 'utf8') >
        input.context_policy.max_excerpt_bytes,
    )
  ) {
    categories.add('excerpt');
  }
  if (byteLength(state.diffHunks) > input.context_policy.max_diff_bytes) {
    categories.add('diff');
  }
  if (byteLength(state.errors) > input.context_policy.max_error_bytes) {
    categories.add('error');
  }
  if (state.invariants.length > input.context_policy.max_invariants) {
    categories.add('invariant');
  }
  const itemCount =
    state.excerpts.length +
    state.diffHunks.length +
    state.errors.length +
    state.invariants.length;
  const effectivePromptLimit = Math.min(
    input.context_policy.max_prompt_bytes,
    input.remaining_budget.context_bytes,
  );
  return {
    categories,
    global:
      itemCount > input.context_policy.max_items ||
      promptBytes > effectivePromptLimit,
  };
}

function pruneCandidates(state: SelectionState): PruneCandidate[] {
  return [
    ...state.excerpts.map((item) => ({
      category: 'excerpt' as const,
      id: item.excerpt_id,
      critical: item.critical,
      priority: item.priority,
      kindRank: excerptKindRank[item.kind],
    })),
    ...state.diffHunks.map((item) => ({
      category: 'diff' as const,
      id: item.hunk_id,
      critical: item.critical,
      priority: item.priority,
      kindRank: 0,
    })),
    ...state.errors.map((item) => ({
      category: 'error' as const,
      id: item.diagnostic_id,
      critical: item.critical,
      priority: item.priority,
      kindRank: 0,
    })),
    ...state.invariants.map((item) => ({
      category: 'invariant' as const,
      id: item.invariant_id,
      critical: item.critical,
      priority: 0,
      kindRank: 0,
    })),
  ];
}

function choosePruneCandidate(
  state: SelectionState,
  limits: LimitState,
): PruneCandidate | null {
  const candidates = pruneCandidates(state)
    .filter(
      (candidate) =>
        !candidate.critical &&
        (limits.global || limits.categories.has(candidate.category)),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.kindRank - left.kindRank ||
        compareCodeUnits(left.category, right.category) ||
        compareCodeUnits(left.id, right.id),
    );
  return candidates[0] ?? null;
}

function prune(state: SelectionState, candidate: PruneCandidate): void {
  if (candidate.category === 'excerpt') {
    state.excerpts = state.excerpts.filter(
      (item) => item.excerpt_id !== candidate.id,
    );
  } else if (candidate.category === 'diff') {
    state.diffHunks = state.diffHunks.filter(
      (item) => item.hunk_id !== candidate.id,
    );
  } else if (candidate.category === 'error') {
    state.errors = state.errors.filter(
      (item) => item.diagnostic_id !== candidate.id,
    );
  } else {
    state.invariants = state.invariants.filter(
      (item) => item.invariant_id !== candidate.id,
    );
  }
  state.prunedNonCriticalIds.push(candidate.id);
}

function budgetIsUsable(input: ContextBuildInput): boolean {
  return (
    input.remaining_budget.status === 'configured' &&
    input.remaining_budget.remaining_calls !== null &&
    input.remaining_budget.remaining_calls > 0 &&
    input.remaining_budget.remaining_input_tokens !== null &&
    input.remaining_budget.remaining_input_tokens > 0 &&
    input.remaining_budget.remaining_output_tokens !== null &&
    input.remaining_budget.remaining_output_tokens > 0
  );
}

export class ContextBuilder {
  public build(inputValue: unknown): ContextBuildOutcome {
    const parsed = contextBuildInputSchema.safeParse(inputValue);
    if (!parsed.success) {
      return stop('CONTEXT_INPUT_INVALID');
    }
    const input = parsed.data;
    if (!budgetIsUsable(input)) {
      return stop('CONTEXT_BUDGET_EXCEEDED');
    }

    const integrity = validateContextIntegrity(input);
    if (integrity.status === 'STOP') {
      return stop(integrity.reason_code);
    }
    const normalizedInput: ContextBuildInput = {
      ...input,
      excerpts: [...integrity.excerpts],
      diff_hunks: [...integrity.diff_hunks],
      diagnostics: [...integrity.diagnostics],
    };
    const diff = compactDiffHunks({
      hunks: normalizedInput.diff_hunks,
      relevant_paths: normalizedInput.selection_scope.relevant_paths,
    });
    if (diff.status === 'STOP') {
      return stop(diff.reason_code);
    }
    const errors = compactErrors({
      diagnostics: normalizedInput.diagnostics,
      allowed_command_ids:
        normalizedInput.context_policy.allowed_verification_command_ids,
    });
    if (errors.status === 'STOP') {
      return stop(errors.reason_code);
    }
    const deduplicated = deduplicateExcerpts(normalizedInput.excerpts);
    const state: SelectionState = {
      excerpts: deduplicated.selected,
      diffHunks: [...diff.selected_hunks],
      errors: deduplicateErrors(errors.diagnostics),
      invariants: [...normalizedInput.policy.applicable_invariants],
      deduplicatedExcerptIds: deduplicated.removedIds,
      excludedDiffHunkIds: [...diff.excluded_hunk_ids],
      deduplicatedDiffHunkIds: [...diff.deduplicated_hunk_ids],
      prunedNonCriticalIds: [],
      normalizationReasonCodes: [...errors.normalization_reason_codes],
    };

    try {
      const provisional = renderCandidate(normalizedInput, state, 0, 0);
      const originalPromptBytes = provisional.rendered.prompt_bytes;
      const maximumIterations = pruneCandidates(state).length + 1;
      for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
        const candidate = renderCandidate(
          normalizedInput,
          state,
          originalPromptBytes,
          0,
        );
        const limits = limitState(
          normalizedInput,
          state,
          candidate.rendered.prompt_bytes,
        );
        if (!limits.global && limits.categories.size === 0) {
          const completed = renderCandidate(
            normalizedInput,
            state,
            originalPromptBytes,
            candidate.rendered.prompt_bytes,
          );
          return deepFreeze(
            contextBuildOutcomeSchema.parse({
              status: 'READY',
              reason_code: 'CONTEXT_READY',
              manifest: completed.manifest,
              prompt: completed.rendered.prompt,
              prompt_hash: completed.rendered.prompt_hash,
              prompt_bytes: completed.rendered.prompt_bytes,
            }),
          );
        }
        const removable = choosePruneCandidate(state, limits);
        if (removable !== null) {
          prune(state, removable);
          continue;
        }
        const completed = renderCandidate(
          normalizedInput,
          state,
          originalPromptBytes,
          candidate.rendered.prompt_bytes,
        );
        const promptLimit = Math.min(
          normalizedInput.context_policy.max_prompt_bytes,
          normalizedInput.remaining_budget.context_bytes,
        );
        if (
          normalizedInput.context_policy.overflow_action === 'approval_required'
        ) {
          return deepFreeze(
            contextBuildOutcomeSchema.parse({
              status: 'APPROVAL_REQUIRED',
              reason_code: 'CONTEXT_BUDGET_APPROVAL_REQUIRED',
              context_hash: completed.manifest.context_hash,
              required_prompt_bytes: completed.rendered.prompt_bytes,
              prompt_limit_bytes: promptLimit,
              compaction: completed.report,
            }),
          );
        }
        return stop('CONTEXT_BUDGET_EXCEEDED', {
          contextHash: completed.manifest.context_hash,
          requiredPromptBytes: completed.rendered.prompt_bytes,
          promptLimitBytes: promptLimit,
          compaction: completed.report,
        });
      }
    } catch (error) {
      if (error instanceof PromptBuildError) {
        return stop(
          error.code === 'BOUNDARY_MARKER_DENIED'
            ? 'BOUNDARY_MARKER_DENIED'
            : 'CONTEXT_INPUT_INVALID',
        );
      }
      return stop('CONTEXT_INPUT_INVALID');
    }
    return stop('CONTEXT_BUDGET_EXCEEDED');
  }
}
