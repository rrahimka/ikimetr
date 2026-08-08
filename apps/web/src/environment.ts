import {
  nodeEnvironmentSchema,
  validateEnvironment,
  z,
} from '@ikimetr/validation';

const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
});

export function validateWebEnvironment(
  environment = process.env,
): z.infer<typeof webEnvironmentSchema> {
  return validateEnvironment(webEnvironmentSchema, environment);
}
