import { describe, expect, it } from 'vitest';

import { sha256 } from '../src/canonical.js';
import {
  validateContextIntegrity,
  type IntegrityResult,
} from '../src/context-integrity.js';
import { createContextInputFixture } from './context-fixture.js';

function stoppedReason(result: IntegrityResult): string {
  expect(result.status).toBe('STOP');
  return result.status === 'STOP' ? result.reason_code : 'NOT_STOPPED';
}

describe('context integrity', () => {
  it('accepts a valid minimized Internal context', () => {
    const result = validateContextIntegrity(createContextInputFixture());

    expect(result.status).toBe('VALID');
  });

  it('always rejects Secret routing or excerpt data', () => {
    const routingSecret = createContextInputFixture();
    routingSecret.routing.data_class = 'secret';
    const excerptSecret = createContextInputFixture();
    excerptSecret.excerpts[0]!.data_class = 'secret';

    expect(stoppedReason(validateContextIntegrity(routingSecret))).toBe(
      'SECRET_CONTEXT_DENIED',
    );
    expect(stoppedReason(validateContextIntegrity(excerptSecret))).toBe(
      'SECRET_CONTEXT_DENIED',
    );
  });

  it('rejects a content hash mismatch without echoing content', () => {
    const input = createContextInputFixture();
    input.excerpts[0]!.content = 'do-not-echo-this-content';

    const result = validateContextIntegrity(input);

    expect(stoppedReason(result)).toBe('CONTENT_HASH_MISMATCH');
    expect(JSON.stringify(result)).not.toContain('do-not-echo-this-content');
  });

  it('rejects an excerpt outside its Serena selection scope', () => {
    const input = createContextInputFixture();
    input.excerpts[0]!.path = 'apps/web/app/page.tsx';
    input.excerpts[0]!.content_hash = sha256(input.excerpts[0]!.content);

    expect(stoppedReason(validateContextIntegrity(input))).toBe(
      'PROVENANCE_INVALID',
    );
  });

  it('rejects traversal and absolute paths', () => {
    const traversal = createContextInputFixture();
    traversal.excerpts[0]!.path = '../outside.ts';
    traversal.selection_scope.relevant_paths = ['../outside.ts'];
    const absolute = createContextInputFixture();
    absolute.excerpts[0]!.path = 'C:/outside.ts';
    absolute.selection_scope.relevant_paths = ['C:/outside.ts'];

    expect(stoppedReason(validateContextIntegrity(traversal))).toBe(
      'PATH_INVALID',
    );
    expect(stoppedReason(validateContextIntegrity(absolute))).toBe(
      'PATH_INVALID',
    );
  });

  it('rejects forbidden Sensitive content', () => {
    const input = createContextInputFixture();
    input.routing.data_class = 'sensitive';
    input.excerpts[0]!.data_class = 'sensitive';
    input.excerpts[0]!.redaction = {
      status: 'redacted',
      evidence_hash: sha256('redaction'),
    };

    expect(stoppedReason(validateContextIntegrity(input))).toBe(
      'SENSITIVE_CONTEXT_DENIED',
    );
  });

  it('accepts Sensitive content only with matching route, scope and redaction evidence', () => {
    const input = createContextInputFixture();
    input.routing.data_class = 'sensitive';
    input.excerpts[0]!.data_class = 'sensitive';
    input.excerpts[0]!.redaction = {
      status: 'redacted',
      evidence_hash: sha256('redaction'),
    };
    input.context_policy.sensitive_context = {
      allowed: true,
      route: input.routing.route,
      provider: input.routing.provider,
      approval_evidence_hash: sha256('approval'),
      data_scope_hash: sha256('scope'),
    };

    expect(stoppedReason(validateContextIntegrity(input))).toBe(
      'SENSITIVE_CONTEXT_DENIED',
    );

    input.context_policy.sensitive_context.data_scope_hash =
      input.selection_scope.selection_hash;
    expect(validateContextIntegrity(input).status).toBe('VALID');
  });

  it('does not let Sensitive approval override Secret data', () => {
    const input = createContextInputFixture();
    input.routing.data_class = 'secret';
    input.context_policy.sensitive_context = {
      allowed: true,
      route: input.routing.route,
      provider: input.routing.provider,
      approval_evidence_hash: sha256('approval'),
      data_scope_hash: sha256('scope'),
    };

    expect(stoppedReason(validateContextIntegrity(input))).toBe(
      'SECRET_CONTEXT_DENIED',
    );
  });

  it('rejects reserved prompt boundary content', () => {
    const input = createContextInputFixture();
    input.excerpts[0]!.content = 'UNTRUSTED_CONTEXT_BEGIN';
    input.excerpts[0]!.content_hash = sha256(input.excerpts[0]!.content);

    expect(stoppedReason(validateContextIntegrity(input))).toBe(
      'BOUNDARY_MARKER_DENIED',
    );
  });

  it('rejects obvious raw secret or PII indicators', () => {
    const secret = createContextInputFixture();
    secret.excerpts[0]!.content = 'api_key=sk-live-value';
    secret.excerpts[0]!.content_hash = sha256(secret.excerpts[0]!.content);
    const pii = createContextInputFixture();
    pii.excerpts[0]!.content = 'owner@example.com';
    pii.excerpts[0]!.content_hash = sha256(pii.excerpts[0]!.content);

    expect(stoppedReason(validateContextIntegrity(secret))).toBe(
      'SECRET_OR_PII_INDICATOR',
    );
    expect(stoppedReason(validateContextIntegrity(pii))).toBe(
      'SECRET_OR_PII_INDICATOR',
    );
  });
});
