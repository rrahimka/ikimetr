import { sha256 } from '../src/canonical.js';
import { canonicalize } from '../src/canonical.js';
import type {
  ContextBuildInput,
  ContextManifest,
} from '../src/context-contracts.js';

const hash = (value: string): string => sha256(value);

export function createContextInputFixture(): ContextBuildInput {
  const symbolContent =
    "export function buildValue(): string {\n  return 'ok';\n}";
  const patch = '@@ -1,1 +1,1 @@\n-old\n+new';

  return {
    schema_version: 1,
    task: {
      task_id: 'phase-3e-test',
      prompt_version: 'prompt-v1',
      task_spec_hash: hash('task-spec'),
      brief: {
        goal: 'Build deterministic context.',
        requirements: ['Use only selected Serena excerpts.'],
        acceptance_criteria: ['The prompt hash is stable.'],
      },
    },
    routing: {
      request_hash: hash('routing-request'),
      decision_hash: hash('routing-decision'),
      config_hash: hash('config'),
      route: 'local',
      provider: 'local-ai',
      provider_role: 'local-first-pass',
      data_class: 'internal',
    },
    policy: {
      policy_version: 'policy-v1',
      policy_hash: hash('policy'),
      agents_version: 'agents-v1',
      agents_hash: hash('agents'),
      applicable_invariants: [
        {
          invariant_id: 'deterministic-first',
          source: 'AGENTS',
          source_hash: hash('agents'),
          text: 'Prefer deterministic rules before AI.',
          critical: true,
        },
      ],
    },
    selection_scope: {
      selection_hash: hash('selection'),
      relevant_paths: ['packages/ai-cost-system/src/context-builder.ts'],
      relevant_symbols: ['buildValue'],
    },
    context_policy: {
      max_prompt_bytes: 32_000,
      max_excerpt_bytes: 4_000,
      max_diff_bytes: 4_000,
      max_error_bytes: 2_000,
      max_items: 32,
      max_invariants: 8,
      overflow_action: 'stop',
      allowed_verification_command_ids: ['lint', 'typecheck'],
      sensitive_context: null,
    },
    excerpts: [
      {
        excerpt_id: 'excerpt-build-value',
        kind: 'implementation',
        path: 'packages/ai-cost-system/src/context-builder.ts',
        range: { start_line: 1, end_line: 3 },
        symbol: 'buildValue',
        content: symbolContent,
        content_hash: hash(symbolContent),
        provenance: {
          source: 'serena',
          operation: 'find_symbol',
          query_hash: hash('find buildValue'),
        },
        data_class: 'internal',
        critical: true,
        priority: 0,
        redaction: { status: 'not-required', evidence_hash: null },
      },
    ],
    diff_hunks: [
      {
        hunk_id: 'hunk-context-builder',
        path: 'packages/ai-cost-system/src/context-builder.ts',
        old_range: { start_line: 1, line_count: 1 },
        new_range: { start_line: 1, line_count: 1 },
        patch,
        patch_hash: hash(patch),
        data_class: 'internal',
        critical: false,
        priority: 10,
        redaction: { status: 'not-required', evidence_hash: null },
      },
    ],
    diagnostics: [
      {
        diagnostic_id: 'diagnostic-typecheck',
        stage: 'typecheck',
        command_id: 'typecheck',
        exit_code: 1,
        diagnostic_code: 'TS2322',
        path: 'packages/ai-cost-system/src/context-builder.ts',
        symbol: 'buildValue',
        message: "Type 'number' is not assignable to type 'string'.",
        stack_frames: [],
        data_class: 'internal',
        critical: true,
        priority: 0,
        redaction: { status: 'not-required', evidence_hash: null },
      },
    ],
    previous_attempt_summary: {
      attempt_id: 'attempt-1',
      patch_hash: hash('previous-patch'),
      error_fingerprint: hash('previous-error'),
      result_status: 'failed',
      verification_result: 'fail',
      reason_code: 'TYPECHECK_FAILED',
    },
    verification_evidence: {
      schema_version: 1,
      authority_id: 'verification-runner',
      authority_version: '1',
      verification_profile_hash: hash('verification-profile'),
      required_stages: ['lint'],
      completed_stages: ['lint'],
      stages: [
        {
          stage_id: 'lint',
          command_id: 'lint',
          exit_code: 0,
          duration_ms: 10,
          tool_version: 'eslint-10',
          evidence_hash: hash('lint-evidence'),
        },
      ],
      verified_at: '2026-08-09T00:00:00.000Z',
    },
    remaining_budget: {
      status: 'configured',
      remaining_input_tokens: 4_000,
      remaining_output_tokens: 2_000,
      remaining_calls: 1,
      remaining_cost: { amountMicros: 1_000, currency: 'USD' },
      context_bytes: 32_000,
    },
    prohibited_scope: ['apps/**', 'database', 'migrations'],
  };
}

export function createContextManifestFixture(): ContextManifest {
  const input = createContextInputFixture();
  const manifestWithoutHash: Omit<ContextManifest, 'context_hash'> = {
    schema_version: 1,
    task_id: input.task.task_id,
    prompt_version: input.task.prompt_version,
    route: input.routing.route,
    provider: input.routing.provider,
    provider_role: input.routing.provider_role,
    task_spec_hash: input.task.task_spec_hash,
    task_brief: input.task.brief,
    routing_evidence: input.routing,
    policy_evidence: input.policy,
    selection_hash: input.selection_scope.selection_hash,
    selected_symbols: input.excerpts,
    selected_files: [],
    selected_diff_hunks: input.diff_hunks,
    error_context: [
      {
        diagnostic_id: input.diagnostics[0]!.diagnostic_id,
        stage: input.diagnostics[0]!.stage,
        command_id: input.diagnostics[0]!.command_id,
        exit_code: input.diagnostics[0]!.exit_code,
        diagnostic_code: input.diagnostics[0]!.diagnostic_code,
        path: input.diagnostics[0]!.path,
        symbol: input.diagnostics[0]!.symbol,
        normalized_message: input.diagnostics[0]!.message,
        stack_frames: [],
        error_fingerprint: hash('current-error'),
        critical: input.diagnostics[0]!.critical,
        priority: input.diagnostics[0]!.priority,
      },
    ],
    previous_attempt_summary: input.previous_attempt_summary,
    verification_evidence: input.verification_evidence,
    remaining_budget: input.remaining_budget,
    prohibited_scope: input.prohibited_scope,
    context_policy: input.context_policy,
    compaction: {
      deduplicated_excerpt_ids: [],
      excluded_diff_hunk_ids: [],
      deduplicated_diff_hunk_ids: [],
      pruned_non_critical_ids: [],
      normalization_reason_codes: [],
      original_prompt_bytes: 0,
      final_prompt_bytes: 0,
    },
  };
  return {
    ...manifestWithoutHash,
    context_hash: sha256(canonicalize(manifestWithoutHash)),
  };
}
