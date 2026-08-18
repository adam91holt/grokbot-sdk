/**
 * Lazy node:sqlite open. The package index re-exports disk helpers, so a
 * static DatabaseSync import from the node sqlite builtin would run on
 * `import { GrokBot }` and crash Bun 1.3.14 (no that builtin).
 * Load the constructor only when a store / search-index file is opened.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

export type SqliteDatabase = {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

type DatabaseSyncCtor = new (
  path: string,
  options?: { readOnly?: boolean },
) => SqliteDatabase;

let databaseSync: DatabaseSyncCtor | undefined;

function loadDatabaseSync(): DatabaseSyncCtor {
  if (databaseSync != null) return databaseSync;
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    databaseSync = sqlite.DatabaseSync;
    return databaseSync;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite disk helpers need Node's node:sqlite builtin (Node 22+). ${message}`,
      { cause: error },
    );
  }
}

/**
 * Open an existing SQLite file read-only. Does not create a missing db.
 * Host agent-store-worker opens with `{ readOnly: true }`; node:sqlite
 * rejects file: URIs (sqliteRoUri is the documented SQLite form only).
 */
export function openReadonlySqlite(filePath: string): SqliteDatabase {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`SQLite database not found: ${absolute}`);
  }
  return new (loadDatabaseSync())(absolute, { readOnly: true });
}
