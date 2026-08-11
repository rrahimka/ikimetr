import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { canonicalize } from './canonical.js';
import { ConfigValidationError } from './errors.js';
import { parseJsonStrict } from './json.js';
import {
  type LedgerEvent,
  LedgerValidationError,
  parseLedgerEvent,
} from './ledger-events.js';

const stateDirectoryName = '.ai-cost';
const ledgerFileName = 'ledger.jsonl';

export class LedgerStorageError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LedgerStorageError';
  }
}

export class AccountingLedger {
  private appendQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly repositoryRoot: string,
    private readonly stateDirectory: string,
    private readonly ledgerPath: string,
  ) {}

  public static async open(repositoryRoot: string): Promise<AccountingLedger> {
    try {
      const resolvedRoot = await realpath(repositoryRoot);
      const rootMetadata = await stat(resolvedRoot);
      if (!rootMetadata.isDirectory()) {
        throw new LedgerStorageError('Repository root is not a directory');
      }

      const stateDirectory = join(resolvedRoot, stateDirectoryName);
      await ensureStateDirectory(resolvedRoot, stateDirectory);
      const ledgerPath = join(stateDirectory, ledgerFileName);
      await verifyLedgerPath(stateDirectory, ledgerPath, true);
      return new AccountingLedger(resolvedRoot, stateDirectory, ledgerPath);
    } catch (error) {
      throw asStorageError(error, 'Unable to open accounting ledger');
    }
  }

  public async append(event: LedgerEvent): Promise<void> {
    const validated = parseLedgerEvent(event);
    const operation = this.appendQueue.then(async () => {
      await this.verifyStorageBoundary();
      const record = Buffer.from(`${canonicalize(validated)}\n`, 'utf8');
      const noFollow = constants.O_NOFOLLOW ?? 0;
      let handle;
      try {
        handle = await open(
          this.ledgerPath,
          constants.O_APPEND |
            constants.O_CREAT |
            constants.O_WRONLY |
            noFollow,
          0o600,
        );
        let offset = 0;
        while (offset < record.byteLength) {
          const { bytesWritten } = await handle.write(
            record,
            offset,
            record.byteLength - offset,
            null,
          );
          if (bytesWritten <= 0) {
            throw new LedgerStorageError('Ledger append made no progress');
          }
          offset += bytesWritten;
        }
        await handle.sync();
      } catch (error) {
        throw asStorageError(error, 'Ledger append failed');
      } finally {
        await handle?.close().catch(() => undefined);
      }
    });

    this.appendQueue = operation.catch(() => undefined);
    return operation;
  }

  public async replay(): Promise<readonly LedgerEvent[]> {
    await this.appendQueue;
    await this.verifyStorageBoundary();

    let source: string;
    try {
      source = await readFile(this.ledgerPath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw asStorageError(error, 'Ledger replay failed');
    }

    if (source.length === 0) {
      return Object.freeze([]);
    }
    if (!source.endsWith('\n')) {
      throw new LedgerValidationError('Ledger contains a partial final record');
    }

    const lines = source.slice(0, -1).split('\n');
    if (lines.some((line) => line.length === 0)) {
      throw new LedgerValidationError('Ledger contains an empty record');
    }

    const events: LedgerEvent[] = [];
    const eventIds = new Set<string>();
    const reservationIds = new Set<string>();
    const settlementIds = new Set<string>();
    const approvalIds = new Set<string>();

    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = parseJsonStrict(line, `ledger record ${index + 1}`);
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          throw new LedgerValidationError('Ledger contains invalid JSON', {
            cause: error,
          });
        }
        throw error;
      }
      const event = parseLedgerEvent(parsed);
      rejectDuplicate(eventIds, event.event_id, 'event');
      if (event.event_type === 'BudgetReservation') {
        rejectDuplicate(reservationIds, event.reservation_id, 'reservation');
      } else if (event.event_type === 'BudgetSettlement') {
        rejectDuplicate(settlementIds, event.settlement_id, 'settlement');
      } else if (event.event_type === 'ApprovalEvent') {
        rejectDuplicate(approvalIds, event.approval_id, 'approval');
      }
      events.push(event);
    }

    return Object.freeze(events);
  }

  private async verifyStorageBoundary(): Promise<void> {
    await ensureStateDirectory(this.repositoryRoot, this.stateDirectory);
    await verifyLedgerPath(this.stateDirectory, this.ledgerPath, true);
  }
}

async function ensureStateDirectory(
  repositoryRoot: string,
  stateDirectory: string,
): Promise<void> {
  try {
    await mkdir(stateDirectory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') {
      throw error;
    }
  }

  const metadata = await lstat(stateDirectory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new LedgerStorageError('AI cost state path must be a real directory');
  }
  const resolvedState = await realpath(stateDirectory);
  assertContained(repositoryRoot, resolvedState, stateDirectoryName);
  if (relative(repositoryRoot, resolvedState) !== stateDirectoryName) {
    throw new LedgerStorageError('AI cost state path is not the fixed directory');
  }
}

async function verifyLedgerPath(
  stateDirectory: string,
  ledgerPath: string,
  allowMissing: boolean,
): Promise<void> {
  try {
    const metadata = await lstat(ledgerPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new LedgerStorageError('Ledger path must be a regular file');
    }
    const resolvedLedger = await realpath(ledgerPath);
    assertContained(stateDirectory, resolvedLedger, ledgerFileName);
    if (relative(stateDirectory, resolvedLedger) !== ledgerFileName) {
      throw new LedgerStorageError('Ledger path is not the fixed ledger file');
    }
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function assertContained(parent: string, child: string, label: string): void {
  const pathFromParent = relative(parent, child);
  if (
    pathFromParent === '' ||
    pathFromParent === '..' ||
    pathFromParent.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(pathFromParent)
  ) {
    throw new LedgerStorageError(`${label} escapes its storage boundary`);
  }
}

function rejectDuplicate(
  seen: Set<string>,
  identifier: string,
  label: string,
): void {
  if (seen.has(identifier)) {
    throw new LedgerValidationError(`Ledger contains a duplicate ${label} id`);
  }
  seen.add(identifier);
}

function asStorageError(error: unknown, message: string): LedgerStorageError {
  if (error instanceof LedgerStorageError) {
    return error;
  }
  return new LedgerStorageError(message, { cause: error });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
