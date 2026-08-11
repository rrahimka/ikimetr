import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  loadConfigSnapshot,
} from '../src/index.js';

const configurationFileNames = [
  'router.json',
  'providers.json',
  'budgets.json',
  'pricing.json',
  'verification.json',
] as const;

type ConfigurationFileName = (typeof configurationFileNames)[number];
type JsonObject = Record<string, unknown>;

const repositoryRoot = fileURLToPath(
  new URL('../../../', import.meta.url),
);
const bootstrapConfigDirectory = join(repositoryRoot, 'config', 'ai-cost');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

async function createConfigCopy(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ikimetr-ai-cost-config-'));
  temporaryDirectories.push(directory);

  await Promise.all(
    configurationFileNames.map(async (fileName) => {
      await copyFile(
        join(bootstrapConfigDirectory, fileName),
        join(directory, fileName),
      );
    }),
  );

  return directory;
}

async function readJsonObject(
  directory: string,
  fileName: ConfigurationFileName,
): Promise<JsonObject> {
  const value: unknown = JSON.parse(
    await readFile(join(directory, fileName), 'utf8'),
  );

  return asObject(value, fileName);
}

async function writeJsonObject(
  directory: string,
  fileName: ConfigurationFileName,
  value: JsonObject,
): Promise<void> {
  await writeFile(
    join(directory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object in this test fixture`);
  }

  return value as JsonObject;
}

function nestedObject(parent: JsonObject, key: string): JsonObject {
  return asObject(parent[key], key);
}

describe('AI Cost System configuration foundation', () => {
  it('loads the valid bootstrap configuration', async () => {
    const snapshot = await loadConfigSnapshot(bootstrapConfigDirectory);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.configVersion).toBe('1.0.0');
    expect(snapshot.configHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(snapshot.sourceFileHashes).sort()).toEqual(
      [...configurationFileNames].sort(),
    );
    expect(snapshot.sourceFileHashes['router.json']).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it('rejects an unknown field', async () => {
    const directory = await createConfigCopy();
    const router = await readJsonObject(directory, 'router.json');
    router['unexpected'] = true;
    await writeJsonObject(directory, 'router.json', router);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects a duplicate JSON key', async () => {
    const directory = await createConfigCopy();
    const path = join(directory, 'router.json');
    const original = await readFile(path, 'utf8');
    const duplicate = original.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    expect(duplicate).not.toBe(original);
    await writeFile(path, duplicate, 'utf8');

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      /Duplicate JSON key/u,
    );
  });

  it('rejects a missing required field', async () => {
    const directory = await createConfigCopy();
    const router = await readJsonObject(directory, 'router.json');
    delete router['policyVersion'];
    await writeJsonObject(directory, 'router.json', router);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an invalid type', async () => {
    const directory = await createConfigCopy();
    const router = await readJsonObject(directory, 'router.json');
    router['schemaVersion'] = '1';
    await writeJsonObject(directory, 'router.json', router);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an invalid enum value', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    const endpoint = nestedObject(localProvider, 'endpoint');
    endpoint['type'] = 'unsupported';
    await writeJsonObject(directory, 'providers.json', providersConfig);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('requires provider risk and capability allowlists', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    delete localProvider['allowedRiskClasses'];
    delete localProvider['allowedCapabilities'];
    await writeJsonObject(directory, 'providers.json', providersConfig);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects unknown provider risk classes and capabilities', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    localProvider['allowedRiskClasses'] = ['unknown-risk'];
    localProvider['allowedCapabilities'] = ['unknown-capability'];
    await writeJsonObject(directory, 'providers.json', providersConfig);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects duplicate provider risk classes and capabilities', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    localProvider['allowedRiskClasses'] = ['low', 'low'];
    localProvider['allowedCapabilities'] = [
      'routine-analysis',
      'routine-analysis',
    ];
    await writeJsonObject(directory, 'providers.json', providersConfig);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an enabled provider without configured limits', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    localProvider['enabled'] = true;
    localProvider['model'] = 'local-test-model';
    await writeJsonObject(directory, 'providers.json', providersConfig);

    await expect(loadConfigSnapshot(directory)).rejects.toThrow(
      /enabled provider is not fully configured/u,
    );
  });

  it('rejects a secret-like value without exposing it in the error', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    const secretValue = 'sk-live-secret-value-1234567890';
    localProvider['model'] = secretValue;
    await writeJsonObject(directory, 'providers.json', providersConfig);

    let caught: unknown;
    try {
      await loadConfigSnapshot(directory);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect(String(caught)).toContain('secret-like value');
    expect(String(caught)).not.toContain(secretValue);
  });

  it('produces a stable config hash for reordered equivalent JSON', async () => {
    const directory = await createConfigCopy();
    const router = await readJsonObject(directory, 'router.json');
    const reorderedRouter = Object.fromEntries(
      Object.entries(router).reverse(),
    );
    await writeFile(
      join(directory, 'router.json'),
      `${JSON.stringify(reorderedRouter, null, 4)}\n`,
      'utf8',
    );

    const originalSnapshot = await loadConfigSnapshot(
      bootstrapConfigDirectory,
    );
    const reorderedSnapshot = await loadConfigSnapshot(directory);

    expect(reorderedSnapshot.configHash).toBe(originalSnapshot.configHash);
    expect(reorderedSnapshot.sourceFileHashes['router.json']).not.toBe(
      originalSnapshot.sourceFileHashes['router.json'],
    );
  });

  it('changes the config hash after a meaningful configuration change', async () => {
    const directory = await createConfigCopy();
    const router = await readJsonObject(directory, 'router.json');
    const routes = nestedObject(router, 'routes');
    const localRoute = nestedObject(routes, 'local');
    localRoute['approvalRequired'] = true;
    await writeJsonObject(directory, 'router.json', router);

    const originalSnapshot = await loadConfigSnapshot(
      bootstrapConfigDirectory,
    );
    const changedSnapshot = await loadConfigSnapshot(directory);

    expect(changedSnapshot.configHash).not.toBe(originalSnapshot.configHash);
  });

  it('changes the config hash after an allowlist change', async () => {
    const directory = await createConfigCopy();
    const providersConfig = await readJsonObject(directory, 'providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const localProvider = nestedObject(providers, 'local-ai');
    localProvider['allowedRiskClasses'] = ['low', 'standard'];
    await writeJsonObject(directory, 'providers.json', providersConfig);

    const originalSnapshot = await loadConfigSnapshot(
      bootstrapConfigDirectory,
    );
    const changedSnapshot = await loadConfigSnapshot(directory);

    expect(changedSnapshot.configHash).not.toBe(originalSnapshot.configHash);
  });

  it('preserves null limits as not configured instead of unlimited', async () => {
    const snapshot = await loadConfigSnapshot(bootstrapConfigDirectory);
    const localProvider =
      snapshot.configuration.providers.providers['local-ai'];

    expect(localProvider.maxInputTokens).toBeNull();
    expect(
      snapshot.configuration.budgets.limits.perTask.maxInputTokens,
    ).toBeNull();
  });

  it('deep-freezes the in-memory snapshot', async () => {
    const snapshot = await loadConfigSnapshot(bootstrapConfigDirectory);
    const localProvider =
      snapshot.configuration.providers.providers['local-ai'];
    const allowedDataClasses = localProvider.allowedDataClasses;

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.configuration)).toBe(true);
    expect(Object.isFrozen(localProvider)).toBe(true);
    expect(Object.isFrozen(allowedDataClasses)).toBe(true);
    expect(Object.isFrozen(snapshot.sourceFileHashes)).toBe(true);
    expect(Reflect.set(localProvider, 'enabled', true)).toBe(false);
    expect(Reflect.set(allowedDataClasses, '0', 'sensitive')).toBe(false);
    expect(localProvider.enabled).toBe(false);
  });
});
