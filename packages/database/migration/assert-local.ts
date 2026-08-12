import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertLocalMigrationEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  if (environment['NODE_ENV'] === 'production') {
    throw new Error('Production migration rollback is disabled');
  }
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url) {
  assertLocalMigrationEnvironment(process.env);
}
