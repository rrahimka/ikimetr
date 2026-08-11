import { describe, expect, it } from 'vitest';

import {
  hashVerificationEvidence,
  parseVerificationEvidence,
  validateVerificationEvidence,
  VerificationEvidenceError,
  type VerificationEvidenceInput,
} from '../src/verification-evidence.js';
import { shaD } from './cache-fixture.js';

function validEvidence(
  overrides: Partial<VerificationEvidenceInput> = {},
): VerificationEvidenceInput {
  return {
    schema_version: 1,
    required_stages: ['lint', 'typecheck'],
    completed_stages: ['lint', 'typecheck'],
    stages: [
      {
        stage_id: 'lint',
        command_id: 'lint',
        exit_code: 0,
        evidence_hash: 'a'.repeat(64),
        tool_version: 'eslint-9',
        duration_ms: 10,
      },
      {
        stage_id: 'typecheck',
        command_id: 'typecheck',
        exit_code: 0,
        evidence_hash: 'b'.repeat(64),
        tool_version: 'tsc-5',
        duration_ms: 20,
      },
    ],
    authority_id: 'trusted-test-pipeline',
    authority_version: 'authority-1',
    verification_profile_hash: shaD,
    verified_at: '2026-08-09T10:30:00.000Z',
    ...overrides,
  };
}

describe('verification evidence', () => {
  it('accepts complete allowlisted evidence and hashes it canonically', () => {
    const evidence = validateVerificationEvidence(validEvidence(), {
      allowedCommandIds: ['lint', 'typecheck'],
      expectedProfileHash: shaD,
      authorityId: 'trusted-test-pipeline',
      authorityVersion: 'authority-1',
    });
    const reordered = parseVerificationEvidence({
      ...validEvidence(),
      stages: [...validEvidence().stages].reverse(),
      required_stages: ['typecheck', 'lint'],
      completed_stages: ['typecheck', 'lint'],
    });

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.stages)).toBe(true);
    expect(hashVerificationEvidence(evidence)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashVerificationEvidence(reordered)).toBe(
      hashVerificationEvidence(evidence),
    );
  });

  it.each([
    [
      'missing required stage',
      { completed_stages: ['lint'], stages: [validEvidence().stages[0]!] },
    ],
    ['duplicate stage', { required_stages: ['lint', 'lint'] }],
    [
      'unknown command',
      {
        stages: [
          { ...validEvidence().stages[0]!, command_id: 'arbitrary-shell' },
          validEvidence().stages[1]!,
        ],
      },
    ],
    [
      'nonzero exit',
      {
        stages: [
          { ...validEvidence().stages[0]!, exit_code: 1 },
          validEvidence().stages[1]!,
        ],
      },
    ],
    ['wrong profile', { verification_profile_hash: 'c'.repeat(64) }],
    ['wrong authority', { authority_id: 'provider-self-attestation' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      validateVerificationEvidence(validEvidence(overrides), {
        allowedCommandIds: ['lint', 'typecheck'],
        expectedProfileHash: shaD,
        authorityId: 'trusted-test-pipeline',
        authorityVersion: 'authority-1',
      }),
    ).toThrow(VerificationEvidenceError);
  });

  it('rejects unknown raw fields', () => {
    expect(() =>
      parseVerificationEvidence({
        ...validEvidence(),
        raw_logs: 'not allowed',
      }),
    ).toThrow(VerificationEvidenceError);
  });
});
