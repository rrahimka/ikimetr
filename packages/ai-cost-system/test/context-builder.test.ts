import { describe, expect, it } from 'vitest';

import { sha256 } from '../src/canonical.js';
import { ContextBuilder } from '../src/context-builder.js';
import type { ContextBuildInput } from '../src/context-contracts.js';
import { createContextInputFixture } from './context-fixture.js';

function build(input: unknown) {
  return new ContextBuilder().build(input);
}

function addNonCriticalDuplicate(input: ContextBuildInput): void {
  const original = input.excerpts[0]!;
  input.excerpts.push({
    ...structuredClone(original),
    excerpt_id: 'excerpt-file-range-duplicate',
    kind: 'file-range',
    symbol: null,
    critical: false,
    priority: 100,
  });
}

describe('ContextBuilder', () => {
  it('rejects filesystem or repository reader injection', () => {
    const input = {
      ...createContextInputFixture(),
      filesystem_reader: { read: 'all' },
    };

    expect(build(input)).toMatchObject({
      status: 'STOP',
      reason_code: 'CONTEXT_INPUT_INVALID',
    });
    expect(Object.getOwnPropertyNames(new ContextBuilder())).toEqual([]);
  });

  it('prefers a symbol excerpt over equivalent file-range content', () => {
    const input = createContextInputFixture();
    addNonCriticalDuplicate(input);

    const result = build(input);

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(
        result.manifest.selected_symbols.map((item) => item.excerpt_id),
      ).toEqual(['excerpt-build-value']);
      expect(result.manifest.selected_files).toEqual([]);
      expect(result.manifest.compaction.deduplicated_excerpt_ids).toEqual([
        'excerpt-file-range-duplicate',
      ]);
    }
  });

  it('compacts and prunes non-critical context before overflow', () => {
    const input = createContextInputFixture();
    const content = `non-critical:${'x'.repeat(12_000)}`;
    input.excerpts.push({
      ...structuredClone(input.excerpts[0]!),
      excerpt_id: 'excerpt-large-non-critical',
      symbol: 'largeNonCritical',
      content,
      content_hash: sha256(content),
      range: { start_line: 10, end_line: 10 },
      critical: false,
      priority: 100,
    });
    input.selection_scope.relevant_symbols.push('largeNonCritical');
    input.context_policy.max_prompt_bytes = 8_000;
    input.context_policy.max_excerpt_bytes = 4_000;

    const result = build(input);

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.manifest.compaction.pruned_non_critical_ids).toContain(
        'excerpt-large-non-critical',
      );
      expect(result.prompt).not.toContain('non-critical:');
    }
  });

  it.each([
    [
      'approval_required',
      'APPROVAL_REQUIRED',
      'CONTEXT_BUDGET_APPROVAL_REQUIRED',
    ],
    ['stop', 'STOP', 'CONTEXT_BUDGET_EXCEEDED'],
  ] as const)(
    'maps residual critical overflow using %s',
    (overflowAction, status, reasonCode) => {
      const input = createContextInputFixture();
      const criticalContent = `critical:${'y'.repeat(10_000)}`;
      input.excerpts[0]!.content = criticalContent;
      input.excerpts[0]!.content_hash = sha256(criticalContent);
      input.excerpts[0]!.range = { start_line: 1, end_line: 1 };
      input.context_policy.max_prompt_bytes = 500;
      input.context_policy.max_excerpt_bytes = 500;
      input.context_policy.overflow_action = overflowAction;

      const result = build(input);

      expect(result).toMatchObject({ status, reason_code: reasonCode });
      expect('prompt' in result).toBe(false);
      expect(input.excerpts[0]!.content).toBe(criticalContent);
    },
  );

  it('fails closed for missing or invalid overflow_action', () => {
    const missing = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    delete (missing['context_policy'] as Record<string, unknown>)[
      'overflow_action'
    ];
    const invalid = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    (invalid['context_policy'] as Record<string, unknown>)['overflow_action'] =
      'truncate';

    expect(build(missing)).toMatchObject({
      status: 'STOP',
      reason_code: 'CONTEXT_INPUT_INVALID',
    });
    expect(build(invalid)).toMatchObject({
      status: 'STOP',
      reason_code: 'CONTEXT_INPUT_INVALID',
    });
  });

  it.each([
    'secret',
    'forbidden-sensitive',
    'provenance-mismatch',
    'content-hash-mismatch',
  ] as const)('returns unconditional STOP for %s', (scenario) => {
    const input = createContextInputFixture();
    input.context_policy.overflow_action = 'approval_required';
    if (scenario === 'secret') {
      input.routing.data_class = 'secret';
    } else if (scenario === 'forbidden-sensitive') {
      input.routing.data_class = 'sensitive';
      input.excerpts[0]!.data_class = 'sensitive';
      input.excerpts[0]!.redaction = {
        status: 'redacted',
        evidence_hash: sha256('redaction'),
      };
    } else if (scenario === 'provenance-mismatch') {
      input.excerpts[0]!.path = 'apps/api/src/app.ts';
    } else {
      input.excerpts[0]!.content = 'changed without hash';
    }

    expect(build(input).status).toBe('STOP');
  });

  it('rejects raw previous output and full policy fields', () => {
    const rawPrevious = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    (rawPrevious['previous_attempt_summary'] as Record<string, unknown>)[
      'raw_prompt'
    ] = 'old prompt';
    const fullPolicy = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    (fullPolicy['policy'] as Record<string, unknown>)['full_policy_text'] =
      'entire AGENTS.md';

    expect(build(rawPrevious).status).toBe('STOP');
    expect(build(fullPolicy).status).toBe('STOP');
  });

  it('produces identical hashes for identical valid input', () => {
    const input = createContextInputFixture();
    const first = build(input);
    const second = build(structuredClone(input));

    expect(first.status).toBe('READY');
    expect(second.status).toBe('READY');
    if (first.status === 'READY' && second.status === 'READY') {
      expect(first.manifest.context_hash).toBe(second.manifest.context_hash);
      expect(first.prompt_hash).toBe(second.prompt_hash);
    }
  });

  it('changes hashes when task, context, diff, error, policy, config or prompt version changes', () => {
    const baseResult = build(createContextInputFixture());
    expect(baseResult.status).toBe('READY');
    if (baseResult.status !== 'READY') return;

    const mutations: Array<
      readonly [string, (input: ContextBuildInput) => void]
    > = [
      [
        'task',
        (input) => {
          input.task.brief.goal = 'Changed goal.';
          input.task.task_spec_hash = sha256('changed-task');
        },
      ],
      [
        'context',
        (input) => {
          input.excerpts[0]!.content = 'export const changed = true;';
          input.excerpts[0]!.content_hash = sha256(input.excerpts[0]!.content);
          input.excerpts[0]!.range = { start_line: 1, end_line: 1 };
        },
      ],
      [
        'diff',
        (input) => {
          input.diff_hunks[0]!.patch = '@@ -1,1 +1,1 @@\n-old\n+changed';
          input.diff_hunks[0]!.patch_hash = sha256(input.diff_hunks[0]!.patch);
        },
      ],
      [
        'error',
        (input) => {
          input.diagnostics[0]!.message = 'A different typecheck error.';
        },
      ],
      [
        'policy',
        (input) => {
          input.policy.policy_version = 'policy-v2';
          input.policy.policy_hash = sha256('policy-v2');
        },
      ],
      [
        'config',
        (input) => {
          input.routing.config_hash = sha256('config-v2');
        },
      ],
      [
        'prompt-version',
        (input) => {
          input.task.prompt_version = 'prompt-v2';
        },
      ],
    ];

    for (const [name, mutate] of mutations) {
      const input = createContextInputFixture();
      mutate(input);
      const result = build(input);
      expect(result.status, name).toBe('READY');
      if (result.status === 'READY') {
        expect(result.manifest.context_hash).not.toBe(
          baseResult.manifest.context_hash,
        );
        expect(result.prompt_hash).not.toBe(baseResult.prompt_hash);
      }
    }
  });

  it('deep-freezes the successful manifest and outcome', () => {
    const result = build(createContextInputFixture());

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.manifest)).toBe(true);
      expect(Object.isFrozen(result.manifest.selected_symbols)).toBe(true);
      expect(Object.isFrozen(result.manifest.selected_symbols[0])).toBe(true);
      expect(Object.isFrozen(result.manifest.task_brief.requirements)).toBe(
        true,
      );
    }
  });
});
