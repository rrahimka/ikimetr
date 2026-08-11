import { sha256 } from './canonical.js';
import {
  promptBoundaryMarkers,
  type ContextBuildInput,
  type DiagnosticCandidate,
  type DiffHunkCandidate,
  type SerenaExcerpt,
} from './context-contracts.js';

type IntegrityStopReason =
  | 'SECRET_CONTEXT_DENIED'
  | 'SENSITIVE_CONTEXT_DENIED'
  | 'PROVENANCE_INVALID'
  | 'CONTENT_HASH_MISMATCH'
  | 'PATH_INVALID'
  | 'RANGE_INVALID'
  | 'BOUNDARY_MARKER_DENIED'
  | 'SECRET_OR_PII_INDICATOR';

export type IntegrityResult =
  | {
      readonly status: 'VALID';
      readonly excerpts: readonly SerenaExcerpt[];
      readonly diff_hunks: readonly DiffHunkCandidate[];
      readonly diagnostics: readonly DiagnosticCandidate[];
    }
  | {
      readonly status: 'STOP';
      readonly reason_code: IntegrityStopReason;
    };

const secretLikePatterns = [
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*["']?\S+/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/iu,
];
const piiLikePatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:^|\D)\+?[1-9]\d{7,14}(?:\D|$)/u,
];

export function normalizeContextContent(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

export function isNormalizedProjectPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value !== value.normalize('NFC')
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.includes('*'),
  );
}

function containsBoundaryMarker(value: string): boolean {
  return promptBoundaryMarkers.some((marker) => value.includes(marker));
}

function containsSecretOrPiiIndicator(value: string): boolean {
  return [...secretLikePatterns, ...piiLikePatterns].some((pattern) =>
    pattern.test(value),
  );
}

function stop(reasonCode: IntegrityStopReason): IntegrityResult {
  return Object.freeze({ status: 'STOP', reason_code: reasonCode });
}

function redactionAllowed(
  input: ContextBuildInput,
  dataClass: 'public' | 'internal' | 'sensitive' | 'secret',
  redaction: {
    status: 'not-required' | 'redacted';
    evidence_hash: string | null;
  },
): boolean {
  if (dataClass !== 'sensitive') {
    return true;
  }
  const authorization = input.context_policy.sensitive_context;
  return (
    input.routing.data_class === 'sensitive' &&
    authorization !== null &&
    authorization.route === input.routing.route &&
    authorization.provider === input.routing.provider &&
    authorization.data_scope_hash === input.selection_scope.selection_hash &&
    redaction.status === 'redacted' &&
    redaction.evidence_hash !== null
  );
}

function textValues(input: ContextBuildInput): readonly string[] {
  return [
    input.task.brief.goal,
    ...input.task.brief.requirements,
    ...input.task.brief.acceptance_criteria,
    ...input.policy.applicable_invariants.map((invariant) => invariant.text),
    ...input.excerpts.map((excerpt) => excerpt.content),
    ...input.diff_hunks.map((hunk) => hunk.patch),
    ...input.diagnostics.flatMap((diagnostic) => [
      diagnostic.message,
      ...diagnostic.stack_frames,
    ]),
  ];
}

function validatePaths(input: ContextBuildInput): IntegrityResult | null {
  const paths = [
    ...input.selection_scope.relevant_paths,
    ...input.excerpts.map((excerpt) => excerpt.path),
    ...input.diff_hunks.map((hunk) => hunk.path),
    ...input.diagnostics.flatMap((diagnostic) =>
      diagnostic.path === null ? [] : [diagnostic.path],
    ),
  ];
  return paths.every(isNormalizedProjectPath) ? null : stop('PATH_INVALID');
}

function normalizeExcerpts(
  input: ContextBuildInput,
): IntegrityResult | readonly SerenaExcerpt[] {
  const relevantPaths = new Set(input.selection_scope.relevant_paths);
  const relevantSymbols = new Set(input.selection_scope.relevant_symbols);
  const coordinates = new Map<string, string>();
  const normalized: SerenaExcerpt[] = [];

  for (const excerpt of input.excerpts) {
    if (
      !relevantPaths.has(excerpt.path) ||
      (excerpt.symbol !== null && !relevantSymbols.has(excerpt.symbol))
    ) {
      return stop('PROVENANCE_INVALID');
    }
    const content = normalizeContextContent(excerpt.content);
    if (sha256(content) !== excerpt.content_hash) {
      return stop('CONTENT_HASH_MISMATCH');
    }
    const lineCount = content.split('\n').length;
    if (lineCount > excerpt.range.end_line - excerpt.range.start_line + 1) {
      return stop('RANGE_INVALID');
    }
    const coordinate = `${excerpt.path}:${excerpt.range.start_line}:${excerpt.range.end_line}`;
    const existingHash = coordinates.get(coordinate);
    if (existingHash !== undefined && existingHash !== excerpt.content_hash) {
      return stop('CONTENT_HASH_MISMATCH');
    }
    coordinates.set(coordinate, excerpt.content_hash);
    if (!redactionAllowed(input, excerpt.data_class, excerpt.redaction)) {
      return stop('SENSITIVE_CONTEXT_DENIED');
    }
    normalized.push({ ...excerpt, content });
  }
  return normalized;
}

function normalizeDiffs(
  input: ContextBuildInput,
): IntegrityResult | readonly DiffHunkCandidate[] {
  const normalized: DiffHunkCandidate[] = [];
  for (const hunk of input.diff_hunks) {
    const patch = normalizeContextContent(hunk.patch);
    if (sha256(patch) !== hunk.patch_hash) {
      return stop('CONTENT_HASH_MISMATCH');
    }
    if (!redactionAllowed(input, hunk.data_class, hunk.redaction)) {
      return stop('SENSITIVE_CONTEXT_DENIED');
    }
    normalized.push({ ...hunk, patch });
  }
  return normalized;
}

function validateDiagnostics(input: ContextBuildInput): IntegrityResult | null {
  const relevantPaths = new Set(input.selection_scope.relevant_paths);
  for (const diagnostic of input.diagnostics) {
    if (diagnostic.path !== null && !relevantPaths.has(diagnostic.path)) {
      return stop('PROVENANCE_INVALID');
    }
    if (!redactionAllowed(input, diagnostic.data_class, diagnostic.redaction)) {
      return stop('SENSITIVE_CONTEXT_DENIED');
    }
  }
  return null;
}

export function validateContextIntegrity(
  input: ContextBuildInput,
): IntegrityResult {
  const dataClasses = [
    input.routing.data_class,
    ...input.excerpts.map((excerpt) => excerpt.data_class),
    ...input.diff_hunks.map((hunk) => hunk.data_class),
    ...input.diagnostics.map((diagnostic) => diagnostic.data_class),
  ];
  if (dataClasses.includes('secret')) {
    return stop('SECRET_CONTEXT_DENIED');
  }
  if (
    dataClasses.includes('sensitive') &&
    input.context_policy.sensitive_context === null
  ) {
    return stop('SENSITIVE_CONTEXT_DENIED');
  }

  const pathFailure = validatePaths(input);
  if (pathFailure !== null) {
    return pathFailure;
  }
  const excerpts = normalizeExcerpts(input);
  if ('status' in excerpts) {
    return excerpts;
  }
  const diffHunks = normalizeDiffs(input);
  if ('status' in diffHunks) {
    return diffHunks;
  }
  const diagnosticFailure = validateDiagnostics(input);
  if (diagnosticFailure !== null) {
    return diagnosticFailure;
  }

  const values = textValues(input).map(normalizeContextContent);
  if (values.some(containsBoundaryMarker)) {
    return stop('BOUNDARY_MARKER_DENIED');
  }
  if (values.some(containsSecretOrPiiIndicator)) {
    return stop('SECRET_OR_PII_INDICATOR');
  }

  return Object.freeze({
    status: 'VALID',
    excerpts: Object.freeze([...excerpts]),
    diff_hunks: Object.freeze([...diffHunks]),
    diagnostics: Object.freeze([...input.diagnostics]),
  });
}
