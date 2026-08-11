import { describe, expect, it } from 'vitest';

import { canonicalize, sha256 } from '../src/canonical.js';
import {
  compactDiffHunks,
  type DiffCompactionResult,
} from '../src/diff-compactor.js';
import type { DiffHunkCandidate } from '../src/context-contracts.js';
import { createContextInputFixture } from './context-fixture.js';

function baseHunk(): DiffHunkCandidate {
  return structuredClone(createContextInputFixture().diff_hunks[0]!);
}

function stoppedReason(result: DiffCompactionResult): string {
  expect(result.status).toBe('STOP');
  return result.status === 'STOP' ? result.reason_code : 'NOT_STOPPED';
}

describe('diff compactor', () => {
  it('excludes unrelated paths without returning their patch content', () => {
    const relevant = baseHunk();
    const unrelated = baseHunk();
    unrelated.hunk_id = 'hunk-unrelated';
    unrelated.path = 'apps/web/app/page.tsx';
    unrelated.patch = '@@ -1,1 +1,1 @@\n-secret-old\n+secret-new';
    unrelated.patch_hash = sha256(unrelated.patch);

    const result = compactDiffHunks({
      hunks: [unrelated, relevant],
      relevant_paths: [relevant.path],
    });

    expect(result.status).toBe('COMPACTED');
    if (result.status === 'COMPACTED') {
      expect(result.selected_hunks.map((hunk) => hunk.path)).toEqual([
        relevant.path,
      ]);
      expect(result.excluded_hunk_ids).toEqual(['hunk-unrelated']);
      expect(canonicalize(result)).not.toContain('secret-old');
    }
  });

  it('is stable across candidate ordering', () => {
    const first = baseHunk();
    const second = baseHunk();
    second.hunk_id = 'hunk-second';
    second.old_range = { start_line: 4, line_count: 1 };
    second.new_range = { start_line: 4, line_count: 1 };
    second.patch = '@@ -4,1 +4,1 @@\n-before\n+after';
    second.patch_hash = sha256(second.patch);
    const input = {
      hunks: [first, second],
      relevant_paths: [first.path],
    };

    expect(compactDiffHunks(input)).toEqual(
      compactDiffHunks({ ...input, hunks: [...input.hunks].reverse() }),
    );
  });

  it('rejects a patch hash mismatch', () => {
    const hunk = baseHunk();
    hunk.patch = `${hunk.patch}\n+tampered`;

    expect(
      stoppedReason(
        compactDiffHunks({ hunks: [hunk], relevant_paths: [hunk.path] }),
      ),
    ).toBe('DIFF_INTEGRITY_INVALID');
  });

  it('rejects header and metadata range mismatch', () => {
    const hunk = baseHunk();
    hunk.old_range = { start_line: 8, line_count: 1 };

    expect(
      stoppedReason(
        compactDiffHunks({ hunks: [hunk], relevant_paths: [hunk.path] }),
      ),
    ).toBe('DIFF_INTEGRITY_INVALID');
  });

  it('deduplicates identical hunks deterministically', () => {
    const first = baseHunk();
    const duplicate = baseHunk();
    duplicate.hunk_id = 'hunk-z-duplicate';

    const result = compactDiffHunks({
      hunks: [duplicate, first],
      relevant_paths: [first.path],
    });

    expect(result.status).toBe('COMPACTED');
    if (result.status === 'COMPACTED') {
      expect(result.selected_hunks).toHaveLength(1);
      expect(result.selected_hunks[0]!.hunk_id).toBe(first.hunk_id);
      expect(result.deduplicated_hunk_ids).toEqual(['hunk-z-duplicate']);
    }
  });

  it('rejects conflicting patches at the same coordinates', () => {
    const first = baseHunk();
    const conflict = baseHunk();
    conflict.hunk_id = 'hunk-conflict';
    conflict.patch = '@@ -1,1 +1,1 @@\n-old\n+different';
    conflict.patch_hash = sha256(conflict.patch);

    expect(
      stoppedReason(
        compactDiffHunks({
          hunks: [first, conflict],
          relevant_paths: [first.path],
        }),
      ),
    ).toBe('DIFF_INTEGRITY_INVALID');
  });
});
