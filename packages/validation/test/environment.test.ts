import { describe, expect, it } from 'vitest';

import {
  EnvironmentValidationError,
  connectionUrlSchema,
  validateEnvironment,
  z,
} from '../src/index.js';

describe('validateEnvironment', () => {
  it('returns parsed configuration', () => {
    const schema = z.object({ PORT: z.coerce.number().int() });

    expect(validateEnvironment(schema, { PORT: '3001' })).toEqual({
      PORT: 3001,
    });
  });

  it('reports variable names without exposing their values', () => {
    const secretValue = 'mysql://user:do-not-print@example.invalid/db';
    const schema = z.object({
      DATABASE_URL: connectionUrlSchema(['postgresql']),
    });

    expect(() =>
      validateEnvironment(schema, { DATABASE_URL: secretValue }),
    ).toThrowError(EnvironmentValidationError);

    try {
      validateEnvironment(schema, { DATABASE_URL: secretValue });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain(secretValue);
    }
  });
});
