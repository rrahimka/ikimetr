import { resolve } from 'node:path';

import { ConfigValidationError, loadConfigSnapshot } from './index.js';

const configDirectory = resolve(process.argv[2] ?? 'config/ai-cost');

try {
  const snapshot = await loadConfigSnapshot(configDirectory);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'valid',
        schemaVersion: snapshot.schemaVersion,
        configVersion: snapshot.configVersion,
        configHash: snapshot.configHash,
        sourceFileHashes: snapshot.sourceFileHashes,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message =
    error instanceof ConfigValidationError
      ? error.message
      : 'Unexpected configuration validation failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
