// SQLite driver shim - the small @op-engineering/op-sqlite API surface this
// codebase was written against, implemented with expo-sqlite (bundled inside
// Expo Go). Keeping the surface identical means database.ts / repositories.ts
// only changed their import line.
//
//  - open({name, location})        -> openDatabaseSync(name, undefined, dir)
//  - db.execute(sql, params)       -> getAllAsync + SELECT changes() bookkeeping
//  - db.executeSync(sql)           -> getAllSync   (PRAGMA user_version, VACUUM INTO)
//  - multi-statement scripts       -> execAsync/execSync (the 12 migration files)
//  - db.transaction(fn)            -> withTransactionAsync (BEGIN/COMMIT/ROLLBACK)

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

export type Scalar = string | number | boolean | null | Uint8Array;

export interface QueryResult {
  rows: Array<Record<string, Scalar>>;
  rowsAffected: number;
  insertId?: number;
}

export interface Tx {
  execute(sql: string, params?: Scalar[]): Promise<QueryResult>;
}

export interface DB {
  execute(sql: string, params?: Scalar[]): Promise<QueryResult>;
  executeSync(sql: string, params?: Scalar[]): QueryResult;
  transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
  close(): void;
}

export interface OpenOptions {
  name: string;
  location?: string;
}

/**
 * True when the statement contains a ';' outside quotes/comments with real
 * content after it - i.e. a script of several statements (migration files).
 * A trailing semicolon alone is still a single statement.
 */
function isMultiStatement(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (c === "'") {
        if (next === "'") {
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        if (next === '"') {
          i += 1;
        } else {
          inDouble = false;
        }
      }
      continue;
    }
    if (c === '-' && next === '-') {
      inLine = true;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === ';') {
      return /\S/.test(sql.slice(i + 1));
    }
  }
  return false;
}

/** rowsAffected of the statement that just ran (empty SELECTs report 0). */
function changes(db: SQLiteDatabase): number {
  try {
    const rows = db.getAllSync<Record<string, number>>('SELECT changes() AS changes;');
    return rows[0]?.changes ?? 0;
  } catch {
    return 0;
  }
}

class ExpoDatabase implements DB {
  constructor(private readonly db: SQLiteDatabase) {}

  async execute(sql: string, params: Scalar[] = []): Promise<QueryResult> {
    if (params.length === 0 && isMultiStatement(sql)) {
      await this.db.execAsync(sql);
      return { rows: [], rowsAffected: 0 };
    }
    const rows = await this.db.getAllAsync<Record<string, Scalar>>(sql, params);
    if (rows.length > 0) {
      return { rows, rowsAffected: 0 };
    }
    return { rows, rowsAffected: changes(this.db) };
  }

  executeSync(sql: string, params: Scalar[] = []): QueryResult {
    if (params.length === 0 && isMultiStatement(sql)) {
      this.db.execSync(sql);
      return { rows: [], rowsAffected: 0 };
    }
    const rows = this.db.getAllSync<Record<string, Scalar>>(sql, params);
    if (rows.length > 0) {
      return { rows, rowsAffected: 0 };
    }
    return { rows, rowsAffected: changes(this.db) };
  }

  async transaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
    await this.db.withTransactionAsync(() =>
      fn({ execute: (sql, params) => this.execute(sql, params) }),
    );
  }

  close(): void {
    this.db.closeSync();
  }
}

/** Opens (does not migrate) - the caller runs PRAGMA + migrations. */
export function open(options: OpenOptions): DB {
  const db = openDatabaseSync(options.name, undefined, options.location);
  return new ExpoDatabase(db);
}