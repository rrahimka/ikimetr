import { z } from 'zod';

import { canonicalize, sha256 } from './canonical.js';
import {
  compactErrorSchema,
  diagnosticCandidateSchema,
  type CompactError,
} from './context-contracts.js';

const commandId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
const errorCompactionInputSchema = z
  .object({
    diagnostics: z.array(diagnosticCandidateSchema),
    allowed_command_ids: z.array(commandId),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.allowed_command_ids).size !==
      input.allowed_command_ids.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'allowed_command_ids must be unique',
      });
    }
  });

export type ErrorCompactionResult =
  | {
      readonly status: 'COMPACTED';
      readonly diagnostics: readonly CompactError[];
      readonly normalization_reason_codes: readonly string[];
      readonly aggregate_hash: string;
    }
  | {
      readonly status: 'STOP';
      readonly reason_code:
        | 'DIAGNOSTIC_INTEGRITY_INVALID'
        | 'SECRET_CONTEXT_DENIED'
        | 'SENSITIVE_CONTEXT_DENIED';
    };

interface NormalizedText {
  readonly value: string;
  readonly reasonCodes: readonly string[];
}

const ansiPattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'gu',
);
const timestampPattern = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu;
const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const unixTempRootPattern = /\/(?:var\/)?tmp\/[^/\s():]+/gu;
const windowsTempRootPattern =
  /[A-Za-z]:\\(?:Users\\[^\\\s]+\\AppData\\Local\\Temp|Windows\\Temp)\\[^\\\s():]+/giu;

function normalizeText(value: string): NormalizedText {
  const reasons = new Set<string>();
  let normalized = value;
  const transforms: readonly [RegExp, string, string][] = [
    [ansiPattern, '', 'ANSI_REMOVED'],
    [timestampPattern, '<timestamp>', 'TIMESTAMP_NORMALIZED'],
    [uuidPattern, '<id>', 'RANDOM_ID_NORMALIZED'],
    [unixTempRootPattern, '<tmp>', 'TEMP_PATH_NORMALIZED'],
    [windowsTempRootPattern, '<tmp>', 'TEMP_PATH_NORMALIZED'],
  ];
  for (const [pattern, replacement, reason] of transforms) {
    const next = normalized.replace(pattern, replacement);
    if (next !== normalized) {
      reasons.add(reason);
      normalized = next;
    }
  }
  normalized = normalized.replace(/[\t ]+/gu, ' ').trim();
  return { value: normalized, reasonCodes: [...reasons].sort() };
}

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
  reasonCode: Extract<ErrorCompactionResult, { status: 'STOP' }>['reason_code'],
): ErrorCompactionResult {
  return Object.freeze({ status: 'STOP', reason_code: reasonCode });
}

export function compactErrors(input: unknown): ErrorCompactionResult {
  const parsed = errorCompactionInputSchema.safeParse(input);
  if (!parsed.success) {
    return stop('DIAGNOSTIC_INTEGRITY_INVALID');
  }
  if (parsed.data.diagnostics.some((item) => item.data_class === 'secret')) {
    return stop('SECRET_CONTEXT_DENIED');
  }
  if (
    parsed.data.diagnostics.some(
      (item) =>
        item.data_class === 'sensitive' && item.redaction.status !== 'redacted',
    )
  ) {
    return stop('SENSITIVE_CONTEXT_DENIED');
  }
  const allowedCommands = new Set(parsed.data.allowed_command_ids);
  if (
    parsed.data.diagnostics.some(
      (item) => !allowedCommands.has(item.command_id),
    )
  ) {
    return stop('DIAGNOSTIC_INTEGRITY_INVALID');
  }

  const allReasons = new Set<string>();
  const diagnostics = parsed.data.diagnostics.map((candidate): CompactError => {
    const message = normalizeText(candidate.message);
    message.reasonCodes.forEach((reason) => allReasons.add(reason));
    const frames: string[] = [];
    const seenFrames = new Set<string>();
    for (const rawFrame of candidate.stack_frames) {
      const frame = normalizeText(rawFrame);
      frame.reasonCodes.forEach((reason) => allReasons.add(reason));
      if (frame.value.length > 0 && !seenFrames.has(frame.value)) {
        seenFrames.add(frame.value);
        frames.push(frame.value);
      } else if (frame.value.length > 0) {
        allReasons.add('DUPLICATE_FRAME_REMOVED');
      }
    }
    const fingerprint = sha256(
      canonicalize({
        stage: candidate.stage,
        command_id: candidate.command_id,
        exit_code: candidate.exit_code,
        diagnostic_code: candidate.diagnostic_code,
        path: candidate.path,
        symbol: candidate.symbol,
        normalized_message: message.value,
        stack_frames: frames,
      }),
    );
    return compactErrorSchema.parse({
      diagnostic_id: candidate.diagnostic_id,
      stage: candidate.stage,
      command_id: candidate.command_id,
      exit_code: candidate.exit_code,
      diagnostic_code: candidate.diagnostic_code,
      path: candidate.path,
      symbol: candidate.symbol,
      normalized_message: message.value,
      stack_frames: frames,
      error_fingerprint: fingerprint,
      critical: candidate.critical,
      priority: candidate.priority,
    });
  });

  diagnostics.sort((left, right) =>
    compareCodeUnits(
      canonicalize({
        stage: left.stage,
        command_id: left.command_id,
        path: left.path,
        diagnostic_code: left.diagnostic_code,
        error_fingerprint: left.error_fingerprint,
        diagnostic_id: left.diagnostic_id,
      }),
      canonicalize({
        stage: right.stage,
        command_id: right.command_id,
        path: right.path,
        diagnostic_code: right.diagnostic_code,
        error_fingerprint: right.error_fingerprint,
        diagnostic_id: right.diagnostic_id,
      }),
    ),
  );
  const frozenDiagnostics = deepFreeze(diagnostics);
  return deepFreeze({
    status: 'COMPACTED',
    diagnostics: frozenDiagnostics,
    normalization_reason_codes: [...allReasons].sort(),
    aggregate_hash: sha256(canonicalize(frozenDiagnostics)),
  });
}
