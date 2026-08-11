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

import {
  type ConfigSnapshot,
  loadConfigSnapshot,
} from '../src/index.js';

const configurationFileNames = [
  'router.json',
  'providers.json',
  'budgets.json',
  'pricing.json',
  'verification.json',
] as const;

export type ConfigurationFileName =
  (typeof configurationFileNames)[number];
export type JsonObject = Record<string, unknown>;

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const bootstrapConfigDirectory = join(
  repositoryRoot,
  'config',
  'ai-cost',
);

export interface ConfigFixture {
  readonly directory: string;
  read(fileName: ConfigurationFileName): Promise<JsonObject>;
  write(
    fileName: ConfigurationFileName,
    value: JsonObject,
  ): Promise<void>;
  load(): Promise<ConfigSnapshot>;
  dispose(): Promise<void>;
}

export async function createConfigFixture(): Promise<ConfigFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'ikimetr-ai-cost-config-'));

  await Promise.all(
    configurationFileNames.map(async (fileName) => {
      await copyFile(
        join(bootstrapConfigDirectory, fileName),
        join(directory, fileName),
      );
    }),
  );

  return {
    directory,
    async read(fileName) {
      return asObject(
        JSON.parse(await readFile(join(directory, fileName), 'utf8')),
        fileName,
      );
    },
    async write(fileName, value) {
      await writeFile(
        join(directory, fileName),
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      );
    },
    async load() {
      return loadConfigSnapshot(directory);
    },
    async dispose() {
      await rm(directory, { force: true, recursive: true });
    },
  };
}

export function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object in this test fixture`);
  }

  return value as JsonObject;
}

export function nestedObject(parent: JsonObject, key: string): JsonObject {
  return asObject(parent[key], key);
}
