// SQLite connection + migration runner - parity with the Windows
// DatabaseInitializer (spec 4.1/4.3):
//
//  - the local file is diettracker.db inside the app-private sandbox
//    (Android files dir / iOS Documents - spec 4.6)
//  - the identical 12 migrations run in order, tracked via PRAGMA user_version
//  - before any migration is applied to an existing database a safety copy is
//    written with VACUUM INTO (one generation kept - Windows behavior)
//  - foreign keys are ON (the schema relies on ON DELETE CASCADE)
//
// A fresh database runs ALL migrations (0001..0012) exactly like Windows, so a
// file copied between Windows / Android / iOS opens without repair.

import { open, type DB, type QueryResult, type Scalar } from './sqlite';
import RNFS from '../platform/fs';

import { MIGRATIONS } from './sql/migrations.generated';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const DB_FILE_NAME = 'diettracker.db';
export const SAFETY_FILE_NAME = 'diettracker.safety.db';

let dbPromise: Promise<DB> | null = null;
let directoryReady: Promise<string> | null = null;

/** App-private data root (mirrors %LOCALAPPDATA%\DietTracker on Windows). */
export function dataRoot(): string {
  return RNFS.DocumentDirectoryPath;
}

/** database/ + photos/ + backups/ + logs/ + secure/ folders - spec 4.6. */
async function ensureDatabaseDir(): Promise<string> {
  if (directoryReady === null) {
    directoryReady = (async () => {
      const dir = `${dataRoot()}/database`;
      if (!(await RNFS.exists(dir))) {
        await RNFS.mkdir(dir);
      }
      for (const sub of ['photos', 'backups', 'logs', 'secure']) {
        const path = `${dataRoot()}/${sub}`;
        if (!(await RNFS.exists(path))) {
          await RNFS.mkdir(path);
        }
      }
      return dir;
    })();
  }
  return directoryReady;
}

/** Opens (and migrates) the single local database. Safe to call repeatedly. */
export async function getDb(): Promise<DB> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      const dir = await ensureDatabaseDir();
      const db = open({ name: DB_FILE_NAME, location: dir });
      db.execute('PRAGMA foreign_keys = ON;');
      await runMigrations(db);
      return db;
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Absolute path of the database file (shown selectable in Settings - 8.8). */
export async function databasePath(): Promise<string> {
  const dir = await ensureDatabaseDir();
  return `${dir}/${DB_FILE_NAME}`;
}

/**
 * Applies pending migrations in order. Each migration runs inside its own
 * transaction and bumps PRAGMA user_version, mirroring the Windows runner:
 * fresh database = all 12, upgrade = only the missing ones.
 */
export async function runMigrations(db: DB): Promise<void> {
  const current = userVersion(db);
  const target = MIGRATIONS[MIGRATIONS.length - 1].version;
  if (current === target) {
    return;
  }
  if (current > 0) {
    // Existing database: safety copy BEFORE touching it (spec 4.3/12.5).
    await writeSafetyCopy(db);
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.execute(migration.sql);
      await tx.execute(`PRAGMA user_version = ${migration.version};`);
    });
  }
  if (userVersion(db) !== target) {
    throw new Error(
      `Database migration failed: expected user_version ${target}, got ${userVersion(db)}.`,
    );
  }
}

function userVersion(db: DB): number {
  const result = db.executeSync('PRAGMA user_version;');
  const row = result.rows[0] as Record<string, Scalar> | undefined;
  const value = row ? Object.values(row)[0] : 0;
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/** Writes database/diettracker.safety.db (keeps one generation). */
export async function writeSafetyCopy(db: DB): Promise<void> {
  const dir = await ensureDatabaseDir();
  const target = `${dir}/${SAFETY_FILE_NAME}`;
  try {
    if (await RNFS.exists(target)) {
      await RNFS.unlink(target);
    }
    // VACUUM INTO refuses to overwrite; the file is gone at this point.
    db.executeSync(`VACUUM INTO '${target.replace(/'/g, "''")}';`);
  } catch (error) {
    // A failed safety copy must not block the app - Windows logs and continues.
    console.warn('[database] safety copy failed', error);
  }
}
// --- query helpers ----------------------------------------------------------

/** Runs a statement, returning all rows mapped through 'map'. */
export async function queryAll<T>(
  sql: string,
  params: Scalar[] = [],
  map: (row: Record<string, Scalar>) => T,
): Promise<T[]> {
  const db = await getDb();
  const result: QueryResult = await db.execute(sql, params);
  return result.rows.map(map);
}

/** Runs a statement, returning the first row or null. */
export async function queryOne<T>(
  sql: string,
  params: Scalar[] = [],
  map: (row: Record<string, Scalar>) => T,
): Promise<T | null> {
  const rows = await queryAll(sql, params, map);
  return rows.length > 0 ? rows[0] : null;
}

/** Runs several statements inside one transaction. */
export async function runInTransaction(
  statements: Array<{ sql: string; params?: Scalar[] }>,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const statement of statements) {
      await tx.execute(statement.sql, statement.params);
    }
  });
}

/** Executes a single write and returns rows affected. */
export async function execute(sql: string, params: Scalar[] = []): Promise<number> {
  const db = await getDb();
  const result = await db.execute(sql, params);
  return result.rowsAffected;
}

/** Closes the connection (account transitions, tests). */
export async function closeDb(): Promise<void> {
  if (dbPromise !== null) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
    directoryReady = null;
  }
}