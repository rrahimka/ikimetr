import { canonicalize, sha256 } from './canonical.js';
import type { DiffHunkCandidate } from './context-contracts.js';
import {
  isNormalizedProjectPath,
  normalizeContextContent,
} from './context-integrity.js';

export type DiffCompactionResult =
  | {
      readonly status: 'COMPACTED';
      readonly selected_hunks: readonly DiffHunkCandidate[];
      readonly excluded_hunk_ids: readonly string[];
      readonly deduplicated_hunk_ids: readonly string[];
      readonly aggregate_hash: string;
    }
  | {
      readonly status: 'STOP';
      readonly reason_code: 'DIFF_INTEGRITY_INVALID';
    };

interface DiffCompactionInput {
  readonly hunks: readonly DiffHunkCandidate[];
  readonly relevant_paths: readonly string[];
}

interface ParsedHeader {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly headerLength: number;
}

function parseHeader(patch: string): ParsedHeader | null {
  const match =
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*(?:\n|$)/u.exec(patch);
  if (match === null) {
    return null;
  }
  const values = [match[1], match[2] ?? '1', match[3], match[4] ?? '1'].map(
    Number,
  );
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  return {
    oldStart: values[0]!,
    oldCount: values[1]!,
    newStart: values[2]!,
    newCount: values[3]!,
    headerLength: match[0].length,
  };
}

function bodyCounts(
  patch: string,
  headerLength: number,
): {
  oldCount: number;
  newCount: number;
} | null {
  const body = patch.slice(headerLength);
  if (/^@@ /mu.test(body)) {
    return null;
  }
  let oldCount = 0;
  let newCount = 0;
  for (const line of body.split('\n')) {
    if (line.length === 0 || line.startsWith('\\ No newline')) {
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('-')) {
      oldCount += 1;
    }
    if (line.startsWith(' ') || line.startsWith('+')) {
      newCount += 1;
    }
    if (![' ', '-', '+'].includes(line[0]!)) {
      return null;
    }
  }
  return { oldCount, newCount };
}

function isValidHunk(hunk: DiffHunkCandidate): boolean {
  if (!isNormalizedProjectPath(hunk.path)) {
    return false;
  }
  const patch = normalizeContextContent(hunk.patch);
  if (patch !== hunk.patch || sha256(patch) !== hunk.patch_hash) {
    return false;
  }
  const header = parseHeader(patch);
  if (
    header === null ||
    header.oldStart !== hunk.old_range.start_line ||
    header.oldCount !== hunk.old_range.line_count ||
    header.newStart !== hunk.new_range.start_line ||
    header.newCount !== hunk.new_range.line_count
  ) {
    return false;
  }
  const counts = bodyCounts(patch, header.headerLength);
  return (
    counts !== null &&
    counts.oldCount === header.oldCount &&
    counts.newCount === header.newCount
  );
}

function compareHunks(
  left: DiffHunkCandidate,
  right: DiffHunkCandidate,
): number {
  return (
    compareCodeUnits(left.path, right.path) ||
    left.old_range.start_line - right.old_range.start_line ||
    left.old_range.line_count - right.old_range.line_count ||
    left.new_range.start_line - right.new_range.start_line ||
    left.new_range.line_count - right.new_range.line_count ||
    compareCodeUnits(left.patch_hash, right.patch_hash) ||
    compareCodeUnits(left.hunk_id, right.hunk_id)
  );
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function coordinateKey(hunk: DiffHunkCandidate): string {
  return canonicalize({
    path: hunk.path,
    old_range: hunk.old_range,
    new_range: hunk.new_range,
  });
}

function duplicateKey(hunk: DiffHunkCandidate): string {
  return `${coordinateKey(hunk)}:${hunk.patch_hash}`;
}

function stop(): DiffCompactionResult {
  return Object.freeze({
    status: 'STOP',
    reason_code: 'DIFF_INTEGRITY_INVALID',
  });
}

export function compactDiffHunks(
  input: DiffCompactionInput,
): DiffCompactionResult {
  if (
    input.relevant_paths.some((path) => !isNormalizedProjectPath(path)) ||
    input.hunks.some((hunk) => !isValidHunk(hunk))
  ) {
    return stop();
  }

  const sorted = [...input.hunks].sort(compareHunks);
  const coordinateHashes = new Map<string, string>();
  for (const hunk of sorted) {
    const coordinate = coordinateKey(hunk);
    const existing = coordinateHashes.get(coordinate);
    if (existing !== undefined && existing !== hunk.patch_hash) {
      return stop();
    }
    coordinateHashes.set(coordinate, hunk.patch_hash);
  }

  const relevant = new Set(input.relevant_paths);
  const excludedHunkIds: string[] = [];
  const deduplicatedHunkIds: string[] = [];
  const selected: DiffHunkCandidate[] = [];
  const selectedKeys = new Set<string>();

  for (const hunk of sorted) {
    if (!relevant.has(hunk.path)) {
      excludedHunkIds.push(hunk.hunk_id);
      continue;
    }
    const key = duplicateKey(hunk);
    if (selectedKeys.has(key)) {
      deduplicatedHunkIds.push(hunk.hunk_id);
      continue;
    }
    selectedKeys.add(key);
    selected.push(hunk);
  }

  const selectedHunks = Object.freeze([...selected]);
  return Object.freeze({
    status: 'COMPACTED',
    selected_hunks: selectedHunks,
    excluded_hunk_ids: Object.freeze(excludedHunkIds.sort()),
    deduplicated_hunk_ids: Object.freeze(deduplicatedHunkIds.sort()),
    aggregate_hash: sha256(canonicalize(selectedHunks)),
  });
}
