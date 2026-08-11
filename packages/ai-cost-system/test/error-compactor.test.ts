import { describe, expect, it } from 'vitest';

import {
  compactErrors,
  type ErrorCompactionResult,
} from '../src/error-compactor.js';
import type { DiagnosticCandidate } from '../src/context-contracts.js';
import { createContextInputFixture } from './context-fixture.js';

function diagnostic(): DiagnosticCandidate {
  return structuredClone(createContextInputFixture().diagnostics[0]!);
}

function stoppedReason(result: ErrorCompactionResult): string {
  expect(result.status).toBe('STOP');
  return result.status === 'STOP' ? result.reason_code : 'NOT_STOPPED';
}

describe('error compactor', () => {
  it('removes ANSI, timestamps, random IDs, temporary roots and duplicate frames', () => {
    const candidate = diagnostic();
    candidate.message =
      '\u001B[31m2026-08-09T12:34:56.789Z Error request 123e4567-e89b-12d3-a456-426614174000 at /tmp/build-a/file.ts\u001B[0m';
    candidate.stack_frames = [
      'at build (/tmp/build-a/file.ts:1:2)',
      'at build (/tmp/build-a/file.ts:1:2)',
      'at run (/var/tmp/random/run.ts:4:5)',
    ];

    const result = compactErrors({
      diagnostics: [candidate],
      allowed_command_ids: ['typecheck'],
    });

    expect(result.status).toBe('COMPACTED');
    if (result.status === 'COMPACTED') {
      expect(result.diagnostics[0]!.normalized_message).toBe(
        '<timestamp> Error request <id> at <tmp>/file.ts',
      );
      expect(result.diagnostics[0]!.stack_frames).toEqual([
        'at build (<tmp>/file.ts:1:2)',
        'at run (<tmp>/run.ts:4:5)',
      ]);
      expect(JSON.stringify(result)).not.toContain(String.fromCharCode(27));
      expect(JSON.stringify(result)).not.toMatch(
        /2026-08-09|123e4567|build-a|random/u,
      );
    }
  });

  it('produces the same fingerprint for equivalent noise', () => {
    const first = diagnostic();
    first.message =
      '2026-08-09T12:34:56Z failed 123e4567-e89b-12d3-a456-426614174000 at /tmp/one/file.ts';
    const second = diagnostic();
    second.diagnostic_id = 'diagnostic-second';
    second.message =
      '2026-08-10T01:02:03Z failed aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee at /tmp/two/file.ts';

    const firstResult = compactErrors({
      diagnostics: [first],
      allowed_command_ids: ['typecheck'],
    });
    const secondResult = compactErrors({
      diagnostics: [second],
      allowed_command_ids: ['typecheck'],
    });

    expect(firstResult.status).toBe('COMPACTED');
    expect(secondResult.status).toBe('COMPACTED');
    if (
      firstResult.status === 'COMPACTED' &&
      secondResult.status === 'COMPACTED'
    ) {
      expect(firstResult.diagnostics[0]!.error_fingerprint).toBe(
        secondResult.diagnostics[0]!.error_fingerprint,
      );
    }
  });

  it('rejects a command ID outside the trusted allowlist', () => {
    expect(
      stoppedReason(
        compactErrors({
          diagnostics: [diagnostic()],
          allowed_command_ids: ['lint'],
        }),
      ),
    ).toBe('DIAGNOSTIC_INTEGRITY_INVALID');
  });

  it('rejects an unknown raw log field', () => {
    expect(
      stoppedReason(
        compactErrors({
          diagnostics: [{ ...diagnostic(), raw_log: 'entire process output' }],
          allowed_command_ids: ['typecheck'],
        }),
      ),
    ).toBe('DIAGNOSTIC_INTEGRITY_INVALID');
  });

  it('always rejects Secret diagnostics', () => {
    const candidate = diagnostic();
    candidate.data_class = 'secret';

    expect(
      stoppedReason(
        compactErrors({
          diagnostics: [candidate],
          allowed_command_ids: ['typecheck'],
        }),
      ),
    ).toBe('SECRET_CONTEXT_DENIED');
  });

  it('rejects unredacted Sensitive diagnostics', () => {
    const candidate = diagnostic();
    candidate.data_class = 'sensitive';

    expect(
      stoppedReason(
        compactErrors({
          diagnostics: [candidate],
          allowed_command_ids: ['typecheck'],
        }),
      ),
    ).toBe('SENSITIVE_CONTEXT_DENIED');
  });
});
