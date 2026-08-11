import { z } from 'zod';

import { verificationEvidenceSchema } from './verification-evidence.js';

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
const reasonCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();
const contextDataClasses = [
  'public',
  'internal',
  'sensitive',
  'secret',
] as const;
const promptRoutes = ['local', 'cheap-cloud', 'strong'] as const;
const promptProviderIds = [
  'local-ai',
  'deepseek',
  'qwen',
  'codex',
  'claude',
] as const;

export const promptBoundaryMarkers = [
  'UNTRUSTED_CONTEXT_BEGIN',
  'UNTRUSTED_CONTEXT_END',
] as const;

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  context: z.RefinementCtx,
  message: string,
): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', message });
  }
}

function uniqueStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string,
): void {
  uniqueBy(values, (value) => value, context, message);
}

const projectPath = z.string().min(1);
const nullableIdentifier = identifier.nullable();

export const contextRangeSchema = z
  .object({
    start_line: safePositiveInteger,
    end_line: safePositiveInteger,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.end_line < range.start_line) {
      context.addIssue({
        code: 'custom',
        message: 'end_line must be greater than or equal to start_line',
      });
    }
  });

const diffRangeSchema = z
  .object({
    start_line: safeNonNegativeInteger,
    line_count: safeNonNegativeInteger,
  })
  .strict();

const redactionSchema = z
  .object({
    status: z.enum(['not-required', 'redacted']),
    evidence_hash: sha256Hex.nullable(),
  })
  .strict()
  .superRefine((redaction, context) => {
    if (redaction.status === 'redacted' && redaction.evidence_hash === null) {
      context.addIssue({
        code: 'custom',
        message: 'redacted content requires evidence_hash',
      });
    }
    if (
      redaction.status === 'not-required' &&
      redaction.evidence_hash !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'not-required redaction cannot carry evidence_hash',
      });
    }
  });

export const serenaExcerptSchema = z
  .object({
    excerpt_id: identifier,
    kind: z.enum([
      'signature',
      'implementation',
      'reference',
      'targeted-test',
      'file-range',
    ]),
    path: projectPath,
    range: contextRangeSchema,
    symbol: nullableIdentifier,
    content: z.string().min(1),
    content_hash: sha256Hex,
    provenance: z
      .object({
        source: z.literal('serena'),
        operation: z.enum([
          'find_symbol',
          'find_referencing_symbols',
          'find_implementations',
          'get_symbols_overview',
          'search_for_pattern',
        ]),
        query_hash: sha256Hex,
      })
      .strict(),
    data_class: z.enum(contextDataClasses),
    critical: z.boolean(),
    priority: safeNonNegativeInteger,
    redaction: redactionSchema,
  })
  .strict()
  .superRefine((excerpt, context) => {
    if (excerpt.kind !== 'file-range' && excerpt.symbol === null) {
      context.addIssue({
        code: 'custom',
        message: 'symbol excerpt requires symbol metadata',
      });
    }
  });

export const diffHunkCandidateSchema = z
  .object({
    hunk_id: identifier,
    path: projectPath,
    old_range: diffRangeSchema,
    new_range: diffRangeSchema,
    patch: z.string().min(1),
    patch_hash: sha256Hex,
    data_class: z.enum(contextDataClasses),
    critical: z.boolean(),
    priority: safeNonNegativeInteger,
    redaction: redactionSchema.default({
      status: 'not-required',
      evidence_hash: null,
    }),
  })
  .strict();

export const diagnosticCandidateSchema = z
  .object({
    diagnostic_id: identifier,
    stage: identifier,
    command_id: identifier,
    exit_code: z.number().int().safe(),
    diagnostic_code: nullableIdentifier,
    path: projectPath.nullable(),
    symbol: nullableIdentifier,
    message: z.string().min(1),
    stack_frames: z.array(z.string().min(1)),
    data_class: z.enum(contextDataClasses),
    critical: z.boolean(),
    priority: safeNonNegativeInteger,
    redaction: redactionSchema,
  })
  .strict();

export const compactErrorSchema = z
  .object({
    diagnostic_id: identifier,
    stage: identifier,
    command_id: identifier,
    exit_code: z.number().int().safe(),
    diagnostic_code: nullableIdentifier,
    path: projectPath.nullable(),
    symbol: nullableIdentifier,
    normalized_message: z.string().min(1),
    stack_frames: z.array(z.string().min(1)),
    error_fingerprint: sha256Hex,
    critical: z.boolean(),
    priority: safeNonNegativeInteger,
  })
  .strict()
  .superRefine((diagnostic, context) => {
    uniqueStrings(
      diagnostic.stack_frames,
      context,
      'stack_frames must be unique',
    );
  });

const minimizedTaskBriefSchema = z
  .object({
    goal: z.string().min(1),
    requirements: z.array(z.string().min(1)).min(1),
    acceptance_criteria: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((brief, context) => {
    uniqueStrings(brief.requirements, context, 'requirements must be unique');
    uniqueStrings(
      brief.acceptance_criteria,
      context,
      'acceptance_criteria must be unique',
    );
  });

const routingEvidenceSchema = z
  .object({
    request_hash: sha256Hex,
    decision_hash: sha256Hex,
    config_hash: sha256Hex,
    route: z.enum(promptRoutes),
    provider: z.enum(promptProviderIds),
    provider_role: identifier,
    data_class: z.enum(contextDataClasses),
  })
  .strict();

const policyInvariantSchema = z
  .object({
    invariant_id: identifier,
    source: z.enum(['AGENTS', 'AI_COST_ROUTING_POLICY']),
    source_hash: sha256Hex,
    text: z.string().min(1),
    critical: z.boolean(),
  })
  .strict();

const policyEvidenceSchema = z
  .object({
    policy_version: identifier,
    policy_hash: sha256Hex,
    agents_version: identifier,
    agents_hash: sha256Hex,
    applicable_invariants: z.array(policyInvariantSchema),
  })
  .strict()
  .superRefine((policy, context) => {
    uniqueBy(
      policy.applicable_invariants,
      (invariant) => invariant.invariant_id,
      context,
      'applicable_invariants must have unique invariant_id values',
    );
  });

const sensitiveContextAuthorizationSchema = z
  .object({
    allowed: z.literal(true),
    route: z.enum(promptRoutes),
    provider: z.enum(promptProviderIds),
    approval_evidence_hash: sha256Hex,
    data_scope_hash: sha256Hex,
  })
  .strict();

export const contextPolicySchema = z
  .object({
    max_prompt_bytes: safePositiveInteger,
    max_excerpt_bytes: safePositiveInteger,
    max_diff_bytes: safePositiveInteger,
    max_error_bytes: safePositiveInteger,
    max_items: safePositiveInteger,
    max_invariants: safePositiveInteger,
    overflow_action: z.enum(['approval_required', 'stop']),
    allowed_verification_command_ids: z.array(identifier),
    sensitive_context: sensitiveContextAuthorizationSchema.nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    uniqueStrings(
      policy.allowed_verification_command_ids,
      context,
      'allowed_verification_command_ids must be unique',
    );
  });

const previousAttemptSummarySchema = z
  .object({
    attempt_id: identifier,
    patch_hash: sha256Hex.nullable(),
    error_fingerprint: sha256Hex.nullable(),
    result_status: z.enum(['succeeded', 'failed', 'blocked']),
    verification_result: z.enum(['pass', 'fail', 'not-run']),
    reason_code: reasonCode,
  })
  .strict();

const remainingBudgetSchema = z
  .object({
    status: z.enum(['configured', 'exhausted', 'not-configured']),
    remaining_input_tokens: safeNonNegativeInteger.nullable(),
    remaining_output_tokens: safeNonNegativeInteger.nullable(),
    remaining_calls: safeNonNegativeInteger.nullable(),
    remaining_cost: z
      .object({
        amountMicros: safeNonNegativeInteger,
        currency: z.string().regex(/^[A-Z]{3}$/u),
      })
      .strict()
      .nullable(),
    context_bytes: safePositiveInteger,
  })
  .strict();

const selectionScopeSchema = z
  .object({
    selection_hash: sha256Hex,
    relevant_paths: z.array(projectPath).min(1),
    relevant_symbols: z.array(identifier),
  })
  .strict()
  .superRefine((scope, context) => {
    uniqueStrings(
      scope.relevant_paths,
      context,
      'relevant_paths must be unique',
    );
    uniqueStrings(
      scope.relevant_symbols,
      context,
      'relevant_symbols must be unique',
    );
  });

export const contextBuildInputSchema = z
  .object({
    schema_version: z.literal(1),
    task: z
      .object({
        task_id: identifier,
        prompt_version: identifier,
        task_spec_hash: sha256Hex,
        brief: minimizedTaskBriefSchema,
      })
      .strict(),
    routing: routingEvidenceSchema,
    policy: policyEvidenceSchema,
    selection_scope: selectionScopeSchema,
    context_policy: contextPolicySchema,
    excerpts: z.array(serenaExcerptSchema),
    diff_hunks: z.array(diffHunkCandidateSchema),
    diagnostics: z.array(diagnosticCandidateSchema),
    previous_attempt_summary: previousAttemptSummarySchema.nullable(),
    verification_evidence: verificationEvidenceSchema,
    remaining_budget: remainingBudgetSchema,
    prohibited_scope: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((input, context) => {
    uniqueBy(
      input.excerpts,
      (excerpt) => excerpt.excerpt_id,
      context,
      'excerpts must have unique excerpt_id values',
    );
    uniqueBy(
      input.diff_hunks,
      (hunk) => hunk.hunk_id,
      context,
      'diff_hunks must have unique hunk_id values',
    );
    uniqueBy(
      input.diagnostics,
      (diagnostic) => diagnostic.diagnostic_id,
      context,
      'diagnostics must have unique diagnostic_id values',
    );
    uniqueStrings(
      input.prohibited_scope,
      context,
      'prohibited_scope must be unique',
    );
  });

export const compactionReportSchema = z
  .object({
    deduplicated_excerpt_ids: z.array(identifier),
    excluded_diff_hunk_ids: z.array(identifier),
    deduplicated_diff_hunk_ids: z.array(identifier),
    pruned_non_critical_ids: z.array(identifier),
    normalization_reason_codes: z.array(reasonCode),
    original_prompt_bytes: safeNonNegativeInteger,
    final_prompt_bytes: safeNonNegativeInteger,
  })
  .strict();

export const contextManifestSchema = z
  .object({
    schema_version: z.literal(1),
    task_id: identifier,
    prompt_version: identifier,
    route: z.enum(promptRoutes),
    provider: z.enum(promptProviderIds),
    provider_role: identifier,
    task_spec_hash: sha256Hex,
    task_brief: minimizedTaskBriefSchema,
    routing_evidence: routingEvidenceSchema,
    policy_evidence: policyEvidenceSchema,
    selection_hash: sha256Hex,
    selected_symbols: z.array(serenaExcerptSchema),
    selected_files: z.array(serenaExcerptSchema),
    selected_diff_hunks: z.array(diffHunkCandidateSchema),
    error_context: z.array(compactErrorSchema),
    previous_attempt_summary: previousAttemptSummarySchema.nullable(),
    verification_evidence: verificationEvidenceSchema,
    remaining_budget: remainingBudgetSchema,
    prohibited_scope: z.array(z.string().min(1)),
    context_policy: contextPolicySchema,
    compaction: compactionReportSchema,
    context_hash: sha256Hex,
  })
  .strict();

export const contextReasonCodes = [
  'CONTEXT_READY',
  'CONTEXT_INPUT_INVALID',
  'SECRET_CONTEXT_DENIED',
  'SENSITIVE_CONTEXT_DENIED',
  'PROVENANCE_INVALID',
  'CONTENT_HASH_MISMATCH',
  'PATH_INVALID',
  'RANGE_INVALID',
  'BOUNDARY_MARKER_DENIED',
  'SECRET_OR_PII_INDICATOR',
  'DIFF_INTEGRITY_INVALID',
  'DIAGNOSTIC_INTEGRITY_INVALID',
  'CONTEXT_BUDGET_EXCEEDED',
  'CONTEXT_BUDGET_APPROVAL_REQUIRED',
] as const;

const blockedContextFields = {
  context_hash: sha256Hex.nullable(),
  required_prompt_bytes: safeNonNegativeInteger.nullable(),
  prompt_limit_bytes: safeNonNegativeInteger.nullable(),
  compaction: compactionReportSchema.nullable(),
};

export const contextBuildOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('READY'),
      reason_code: z.literal('CONTEXT_READY'),
      manifest: contextManifestSchema,
      prompt: z.string().min(1),
      prompt_hash: sha256Hex,
      prompt_bytes: safePositiveInteger,
    })
    .strict(),
  z
    .object({
      status: z.literal('APPROVAL_REQUIRED'),
      reason_code: z.literal('CONTEXT_BUDGET_APPROVAL_REQUIRED'),
      context_hash: sha256Hex,
      required_prompt_bytes: safePositiveInteger,
      prompt_limit_bytes: safePositiveInteger,
      compaction: compactionReportSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('STOP'),
      reason_code: z.enum(contextReasonCodes),
      ...blockedContextFields,
    })
    .strict(),
]);

export function createModelOutputSchema(
  allowedVerificationCommandIds: readonly string[],
) {
  const allowed = new Set(allowedVerificationCommandIds);
  const verificationIds = z
    .array(
      identifier.refine(
        (value) => allowed.has(value),
        'command ID is not allowed',
      ),
    )
    .superRefine((values, context) => {
      uniqueStrings(values, context, 'verification_requested must be unique');
    });

  return z
    .object({
      status: z.enum(['proposed', 'needs-context', 'blocked']),
      summary: z.string().min(1),
      proposed_patch: z
        .object({
          format: z.literal('unified-diff'),
          content: z.string().min(1),
        })
        .strict()
        .nullable(),
      reason_codes: z.array(reasonCode),
      assumptions: z.array(z.string().min(1)),
      verification_requested: verificationIds,
    })
    .strict()
    .superRefine((output, context) => {
      uniqueStrings(
        output.reason_codes,
        context,
        'reason_codes must be unique',
      );
      uniqueStrings(output.assumptions, context, 'assumptions must be unique');
      if (output.status === 'proposed' && output.proposed_patch === null) {
        context.addIssue({
          code: 'custom',
          message: 'proposed status requires proposed_patch',
        });
      }
      if (output.status !== 'proposed' && output.proposed_patch !== null) {
        context.addIssue({
          code: 'custom',
          message: 'only proposed status may include proposed_patch',
        });
      }
    });
}

export type ContextBuildInput = z.infer<typeof contextBuildInputSchema>;
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
export type SerenaExcerpt = z.infer<typeof serenaExcerptSchema>;
export type DiffHunkCandidate = z.infer<typeof diffHunkCandidateSchema>;
export type DiagnosticCandidate = z.infer<typeof diagnosticCandidateSchema>;
export type CompactError = z.infer<typeof compactErrorSchema>;
export type CompactionReport = z.infer<typeof compactionReportSchema>;
export type ContextManifest = z.infer<typeof contextManifestSchema>;
export type ContextBuildOutcome = z.infer<typeof contextBuildOutcomeSchema>;
export type ContextReasonCode = (typeof contextReasonCodes)[number];
