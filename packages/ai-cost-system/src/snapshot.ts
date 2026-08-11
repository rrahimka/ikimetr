import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { canonicalize, sha256 } from './canonical.js';
import { ConfigValidationError } from './errors.js';
import { parseJsonStrict } from './json.js';
import {
  type ConfigurationBundle,
  configurationFileNames,
  validateConfigurationFiles,
} from './schemas.js';

type DeepReadonly<T> = T extends readonly (infer Element)[]
  ? readonly DeepReadonly<Element>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface ConfigSnapshot {
  readonly configuration: DeepReadonly<ConfigurationBundle>;
  readonly configHash: string;
  readonly schemaVersion: 1;
  readonly configVersion: string;
  readonly sourceFileHashes: Readonly<
    Record<(typeof configurationFileNames)[number], string>
  >;
}

export async function loadConfigSnapshot(
  configDirectory: string,
): Promise<ConfigSnapshot> {
  const resolvedDirectory = await resolveConfigDirectory(configDirectory);
  const entries = await Promise.all(
    configurationFileNames.map(async (fileName) => {
      const sourcePath = await resolveConfigFile(resolvedDirectory, fileName);
      const sourceText = await readFile(sourcePath, 'utf8');
      return {
        fileName,
        sourceText,
        value: parseJsonStrict(sourceText, fileName),
      };
    }),
  );

  const rawFiles = Object.fromEntries(
    entries.map(({ fileName, value }) => [fileName, value]),
  ) as Record<(typeof configurationFileNames)[number], unknown>;
  const sourceFileHashes = Object.fromEntries(
    entries.map(({ fileName, sourceText }) => [fileName, sha256(sourceText)]),
  ) as Record<(typeof configurationFileNames)[number], string>;
  const configuration = validateConfigurationFiles(rawFiles);
  const snapshot = {
    configuration,
    configHash: sha256(canonicalize(configuration)),
    schemaVersion: configuration.router.schemaVersion,
    configVersion: configuration.router.configVersion,
    sourceFileHashes,
  };

  return deepFreeze(snapshot);
}

async function resolveConfigDirectory(configDirectory: string): Promise<string> {
  try {
    const resolved = await realpath(configDirectory);
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new ConfigValidationError('Configuration path is not a directory');
    }
    return resolved;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    throw new ConfigValidationError('Configuration directory is unavailable', {
      cause: error,
    });
  }
}

async function resolveConfigFile(
  resolvedDirectory: string,
  fileName: (typeof configurationFileNames)[number],
): Promise<string> {
  try {
    const resolvedFile = await realpath(join(resolvedDirectory, fileName));
    const pathFromDirectory = relative(resolvedDirectory, resolvedFile);
    if (
      pathFromDirectory === '' ||
      pathFromDirectory === '..' ||
      pathFromDirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(pathFromDirectory)
    ) {
      throw new ConfigValidationError(
        `Configuration file escapes its directory: ${fileName}`,
      );
    }

    const metadata = await stat(resolvedFile);
    if (!metadata.isFile()) {
      throw new ConfigValidationError(
        `Configuration source is not a regular file: ${fileName}`,
      );
    }
    return resolvedFile;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    throw new ConfigValidationError(
      `Required configuration file is unavailable: ${fileName}`,
      { cause: error },
    );
  }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}
