import { z } from 'zod';

import { canonicalize, sha256 } from './canonical.js';
import { ConfigValidationError } from './errors.js';
import { assertNoSecretLikeValues } from './json.js';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const safeNonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger);
const utcTimestamp = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith('Z');
}, 'timestamp must use UTC');

const verificationStageSchema = z
  .object({
    stage_id: identifier,
    command_id: identifier,
    exit_code: safeNonNegativeInteger,
    evidence_hash: sha256Hex,
    tool_version: z.string().min(1).max(256),
    duration_ms: safeNonNegativeInteger,
  })
  .strict();

export const verificationEvidenceSchema = z
  .object({
    schema_version: z.literal(1),
    required_stages: z.array(identifier).min(1).max(64),
    completed_stages: z.array(identifier).min(1).max(64),
    stages: z.array(verificationStageSchema).min(1).max(64),
    authority_id: identifier,
    authority_version: z.string().min(1).max(256),
    verification_profile_hash: sha256Hex,
    verified_at: utcTimestamp,
  })
  .strict();

export type VerificationEvidenceInput = z.input<
  typeof verificationEvidenceSchema
>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;

export class VerificationEvidenceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VerificationEvidenceError';
  }
}

export function parseVerificationEvidence(
  value: unknown,
): VerificationEvidence {
  try {
    assertNoSecretLikeValues(value, 'verification evidence');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new VerificationEvidenceError(
        'Verification evidence contains prohibited data',
        { cause: error },
      );
    }
    throw error;
  }
  const parsed = verificationEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new VerificationEvidenceError(
      'Verification evidence failed strict validation',
    );
  }
  assertUnique(parsed.data.required_stages, 'required stage');
  assertUnique(parsed.data.completed_stages, 'completed stage');
  assertUnique(
    parsed.data.stages.map((stage) => stage.stage_id),
    'stage evidence',
  );

  return deepFreeze({
    ...parsed.data,
    required_stages: [...parsed.data.required_stages].sort(),
    completed_stages: [...parsed.data.completed_stages].sort(),
    stages: [...parsed.data.stages].sort((left, right) =>
      left.stage_id.localeCompare(right.stage_id),
    ),
  });
}

export function validateVerificationEvidence(
  value: unknown,
  context: Readonly<{
    allowedCommandIds: readonly string[];
    expectedProfileHash: string;
    authorityId: string;
    authorityVersion: string;
  }>,
): VerificationEvidence {
  const evidence = parseVerificationEvidence(value);
  const allowedCommands = new Set(context.allowedCommandIds);
  if (
    evidence.verification_profile_hash !== context.expectedProfileHash ||
    evidence.authority_id !== context.authorityId ||
    evidence.authority_version !== context.authorityVersion
  ) {
    throw new VerificationEvidenceError(
      'Verification evidence authority or profile is incompatible',
    );
  }

  if (!sameMembers(evidence.required_stages, evidence.completed_stages)) {
    throw new VerificationEvidenceError(
      'Verification evidence did not complete every required stage',
    );
  }
  const stageIds = evidence.stages.map((stage) => stage.stage_id);
  if (!sameMembers(evidence.completed_stages, stageIds)) {
    throw new VerificationEvidenceError(
      'Verification evidence stage metadata is incomplete',
    );
  }
  for (const stage of evidence.stages) {
    if (!allowedCommands.has(stage.command_id)) {
      throw new VerificationEvidenceError(
        'Verification evidence contains a non-allowlisted command',
      );
    }
    if (stage.exit_code !== 0) {
      throw new VerificationEvidenceError(
        'Verification evidence contains a failed stage',
      );
    }
  }
  return evidence;
}

export function hashVerificationEvidence(
  evidence: VerificationEvidence,
): string {
  return sha256(canonicalize(parseVerificationEvidence(evidence)));
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new VerificationEvidenceError(
      `Verification evidence contains duplicate ${label}`,
    );
  }
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightMembers = new Set(right);
  return left.every((value) => rightMembers.has(value));
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
