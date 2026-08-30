import { beforeEach, describe, expect, it, vi } from 'vitest';

const pg = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class {
    connect = pg.connect;
    end = pg.end;
    query = pg.poolQuery;
  },
}));

import { createDatabaseConnection } from '../src/index.js';

const emptyResult = {
  command: '',
  fields: [],
  oid: 0,
  rowCount: 0,
  rows: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  pg.clientQuery.mockResolvedValue(emptyResult);
  pg.connect.mockResolvedValue({
    query: pg.clientQuery,
    release: pg.release,
  });
  pg.end.mockResolvedValue(undefined);
  pg.poolQuery.mockResolvedValue(emptyResult);
});

describe('DatabaseConnection transaction', () => {
  it('commits once and returns the callback value', async () => {
    pg.clientQuery.mockImplementation(async (text: string) =>
      text === 'SELECT 42'
        ? { ...emptyResult, rowCount: 1, rows: [{ answer: 42 }] }
        : emptyResult,
    );
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    const answer = await database.transaction(async (transaction) => {
      const result = await transaction.query<{ answer: number }>(
        'SELECT 42',
        [42],
      );
      return result.rows[0]?.answer;
    });

    expect(answer).toBe(42);
    expect(pg.clientQuery.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT 42', [42]],
      ['COMMIT'],
    ]);
    expect(pg.connect).toHaveBeenCalledTimes(1);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back a callback failure and preserves the original error', async () => {
    const originalError = new Error('callback failed');
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    const result = database.transaction(async () => {
      throw originalError;
    });

    await expect(result).rejects.toBe(originalError);
    expect(pg.clientQuery.mock.calls).toEqual([['BEGIN'], ['ROLLBACK']]);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back a commit failure and preserves the commit error', async () => {
    const commitError = new Error('commit failed');
    pg.clientQuery.mockImplementation(async (text: string) => {
      if (text === 'COMMIT') {
        throw commitError;
      }
      return emptyResult;
    });
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    const result = database.transaction(async () => 'value');

    await expect(result).rejects.toBe(commitError);
    expect(pg.clientQuery.mock.calls).toEqual([
      ['BEGIN'],
      ['COMMIT'],
      ['ROLLBACK'],
    ]);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('does not replace the original error when rollback also fails', async () => {
    const originalError = new Error('callback failed');
    pg.clientQuery.mockImplementation(async (text: string) => {
      if (text === 'ROLLBACK') {
        throw new Error('rollback failed');
      }
      return emptyResult;
    });
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    const result = database.transaction(async () => {
      throw originalError;
    });

    await expect(result).rejects.toBe(originalError);
    expect(pg.clientQuery.mock.calls).toEqual([['BEGIN'], ['ROLLBACK']]);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('releases without rollback when BEGIN fails', async () => {
    const beginError = new Error('begin failed');
    pg.clientQuery.mockRejectedValueOnce(beginError);
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    const result = database.transaction(async () => 'unreachable');

    await expect(result).rejects.toBe(beginError);
    expect(pg.clientQuery.mock.calls).toEqual([['BEGIN']]);
    expect(pg.connect).toHaveBeenCalledTimes(1);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('does not retry callback or connection failures', async () => {
    const callback = vi.fn(async () => {
      throw new Error('do not retry');
    });
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    await expect(database.transaction(callback)).rejects.toThrow(
      'do not retry',
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(pg.connect).toHaveBeenCalledTimes(1);
    expect(pg.release).toHaveBeenCalledTimes(1);
  });

  it('closes once and rejects all future work before touching the pool', async () => {
    const database = createDatabaseConnection('postgresql://test.invalid/db');

    await database.close();
    await database.close();

    await expect(database.check()).rejects.toThrow(
      'Database connection is closed',
    );
    await expect(
      database.transaction(async () => 'unreachable'),
    ).rejects.toThrow('Database connection is closed');
    expect(pg.end).toHaveBeenCalledTimes(1);
    expect(pg.poolQuery).not.toHaveBeenCalled();
    expect(pg.connect).not.toHaveBeenCalled();
    expect(pg.release).not.toHaveBeenCalled();
  });
});
