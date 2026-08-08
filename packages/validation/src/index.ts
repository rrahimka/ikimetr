import { z } from 'zod';

export { z } from 'zod';

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class EnvironmentValidationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid environment variables: ${variables.join(', ')}`);
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

export const nodeEnvironmentSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const positiveIntegerSchema = z.coerce.number().int().positive();

export function connectionUrlSchema(protocols: readonly string[]) {
  return z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol.slice(0, -1);
        return protocols.includes(protocol);
      },
      { message: 'Unsupported connection URL protocol' },
    );
}

export function validateEnvironment<Output>(
  schema: z.ZodType<Output>,
  environment: EnvironmentSource,
): Output {
  const result = schema.safeParse(environment);

  if (result.success) {
    return result.data;
  }

  const variables = [
    ...new Set(
      result.error.issues.map((issue) =>
        issue.path.length > 0 ? String(issue.path[0]) : 'environment',
      ),
    ),
  ].sort();

  throw new EnvironmentValidationError(variables);
}
