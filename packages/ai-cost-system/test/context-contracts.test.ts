import { describe, expect, it } from 'vitest';

import {
  contextBuildInputSchema,
  createModelOutputSchema,
} from '../src/context-contracts.js';
import { createContextInputFixture } from './context-fixture.js';

describe('Phase 3E context contracts', () => {
  it('accepts the minimal strict context input', () => {
    expect(
      contextBuildInputSchema.safeParse(createContextInputFixture()).success,
    ).toBe(true);
  });

  it('rejects missing and unknown overflow actions', () => {
    const missing = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    const missingPolicy = missing['context_policy'] as Record<string, unknown>;
    delete missingPolicy['overflow_action'];

    const invalid = structuredClone(createContextInputFixture()) as Record<
      string,
      unknown
    >;
    const invalidPolicy = invalid['context_policy'] as Record<string, unknown>;
    invalidPolicy['overflow_action'] = 'truncate';

    expect(contextBuildInputSchema.safeParse(missing).success).toBe(false);
    expect(contextBuildInputSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects raw prompt and repository dump fields', () => {
    const rawPrompt = {
      ...createContextInputFixture(),
      raw_prompt: 'previous prompt',
    };
    const repositoryDump = {
      ...createContextInputFixture(),
      repository_dump: 'all source files',
    };

    expect(contextBuildInputSchema.safeParse(rawPrompt).success).toBe(false);
    expect(contextBuildInputSchema.safeParse(repositoryDump).success).toBe(
      false,
    );
  });

  it('rejects duplicate set-like values and unknown nested fields', () => {
    const duplicatePaths = structuredClone(createContextInputFixture());
    duplicatePaths.selection_scope.relevant_paths.push(
      duplicatePaths.selection_scope.relevant_paths[0]!,
    );
    const unknownExcerpt = structuredClone(createContextInputFixture());
    const excerpt = unknownExcerpt
      .excerpts[0] as (typeof unknownExcerpt.excerpts)[0] & {
      repository_reader?: string;
    };
    excerpt.repository_reader = 'read-all';

    expect(contextBuildInputSchema.safeParse(duplicatePaths).success).toBe(
      false,
    );
    expect(contextBuildInputSchema.safeParse(unknownExcerpt).success).toBe(
      false,
    );
  });

  it('limits model output to allowlisted verification IDs', () => {
    const schema = createModelOutputSchema(['lint', 'typecheck']);
    const valid = {
      status: 'proposed',
      summary: 'Apply the minimal patch.',
      proposed_patch: {
        format: 'unified-diff',
        content: '@@ -1,1 +1,1 @@\n-old\n+new',
      },
      reason_codes: ['MINIMAL_FIX'],
      assumptions: [],
      verification_requested: ['lint'],
    };

    expect(schema.safeParse(valid).success).toBe(true);
    expect(
      schema.safeParse({ ...valid, verification_requested: ['shell-anything'] })
        .success,
    ).toBe(false);
  });

  it('has no arbitrary command channel in model output', () => {
    const schema = createModelOutputSchema(['lint']);
    const output = {
      status: 'blocked',
      summary: 'More context is required.',
      proposed_patch: null,
      reason_codes: ['MISSING_CONTEXT'],
      assumptions: [],
      verification_requested: [],
      command: 'rm -rf .',
    };

    expect(schema.safeParse(output).success).toBe(false);
  });
});
