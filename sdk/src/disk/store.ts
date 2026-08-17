/**
 * Read-only agent store.db via node:sqlite (file:<path>?mode=ro).
 * conversation-blobs.db: getBlob(id) only — do not dump.
 *
 * Schema matches host `src/host/extensions/session/agent-db-schema.ts` and
 * `src/host/agent-isolation/conversation-blob-db.ts`. Store access stays
 * read-only — never write kv / transcript_entries / blobs from the SDK.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  conversationBlobsPath,
  isValidSandAgentId,
  SandInvalidAgentIdError,
  storeDbPath,
} from "../paths.js";
import type { StoreEntry, StoreEntryKind } from "../types.js";

/** SQLite URI form. node:sqlite DatabaseSync opens the path with `{ readOnly: true }` instead. */
export function sqliteRoUri(filePath: string): string {
  const absolute = resolve(filePath);
  return `file://${absolute}?mode=ro`;
}

function openRo(filePath: string): DatabaseSync {
  const absolute = resolve(filePath);
  // Never create a missing store / blobs db. Host agent-store-worker opens
  // with `{ readOnly: true }`; node:sqlite rejects file: URIs (sqliteRoUri
  // is the documented SQLite form only).
  if (!existsSync(absolute)) {
    throw new Error(`SQLite database not found: ${absolute}`);
  }
  return new DatabaseSync(absolute, { readOnly: true });
}

/** Host WINDOW_ENTRY_FILTER_SQL. */
export const WINDOW_ENTRY_FILTER_SQL = `json_extract(entry, '$.kind') != 'tool-call'
        AND COALESCE(json_extract(entry, '$.branched'), 0) != 1`;

/** Host BRANCHED_ENTRY_FILTER_SQL. */
export const BRANCHED_ENTRY_FILTER_SQL = `COALESCE(json_extract(entry, '$.branched'), 0) = 1`;

/** Host MAIN_TRANSCRIPT_MESSAGE_FILTER_SQL. */
export const MAIN_TRANSCRIPT_MESSAGE_FILTER_SQL = `
        COALESCE(json_extract(entry, '$.branched'), 0) != 1
        AND (
          json_extract(entry, '$.kind') IN ('send-message', 'user-attachment')
          OR (
            json_extract(entry, '$.kind') = 'message'
            AND (
              json_extract(entry, '$.role') = 'user'
              OR json_extract(entry, '$.fromAgent') IS NOT NULL
              OR json_extract(entry, '$.toAgent') IS NOT NULL
            )
          )
        )`;

/**
 * Host store.db SCHEMA. Conversation blobs moved to conversation-blobs.db;
 * the blobs table stays declared so a pre-worker box remains readable.
 */
export const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS transcript_entries (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  entry TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_transcript_window
  ON transcript_entries(seq, entry)
  WHERE ${WINDOW_ENTRY_FILTER_SQL};
CREATE INDEX IF NOT EXISTS idx_transcript_branched
  ON transcript_entries(seq, entry)
  WHERE ${BRANCHED_ENTRY_FILTER_SQL};
`;

/** Host CONVERSATION_BLOB_SCHEMA. */
export const CONVERSATION_BLOB_SCHEMA = `
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL
) STRICT;
`;

/** Host kv key names from agent-db. */
export const STORE_KV_KEYS = {
  metadata: "metadata",
  sandProfile: "sandProfile",
  unreadState: "unreadState",
  awaitingUserResponse: "awaitingUserResponse",
  latestRequestId: "latestRequestId",
  requestIds: "requestIds",
  episodePending: "episodePending",
  memoryPromptSnapshot: "memoryPromptSnapshot",
  agentProfilePromptSnapshot: "agentProfilePromptSnapshot",
  origin: "origin",
  introductionPending: "introductionPending",
  automationSpendGuardState: "automationSpendGuardState",
  automationSpendGuardNudgedAt: "automationSpendGuardNudgedAt",
  conversationPartners: "conversationPartners",
  hiddenEntryRepairVersion: "hiddenEntryRepairVersion",
  staleRootCleanupVersion: "staleRootCleanupVersion",
  purpose: "purpose",
  legacyStoreBlobRetirementVersion: "legacyStoreBlobRetirementVersion",
} as const;

export const STORE_ENTRY_KINDS = [
  "send-message",
  "message",
  "user-attachment",
  "tool-call",
  "notice",
  "event",
  "feedback",
] as const;

export const SQLITE_DB_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

function kindOf(entry: unknown): StoreEntryKind {
  if (entry != null && typeof entry === "object" && "kind" in entry) {
    const kind = (entry as { kind: unknown }).kind;
    if (typeof kind === "string") return kind;
  }
  return "unknown";
}

function blobBytes(data: Uint8Array | Buffer | unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data != null && typeof data === "object" && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  return null;
}

export class AgentStore {
  readonly agentId: string;
  readonly storePath: string;
  readonly blobsPath: string;
  #db: DatabaseSync | null;
  #blobs: DatabaseSync | null = null;

  constructor(agentId: string, sandRoot?: string) {
    if (!isValidSandAgentId(agentId)) {
      throw new SandInvalidAgentIdError(agentId);
    }
    this.agentId = agentId;
    this.storePath = storeDbPath(agentId, sandRoot);
    this.blobsPath = conversationBlobsPath(agentId, sandRoot);
    this.#db = openRo(this.storePath);
  }

  getKv(key: string): string | null {
    const row = this.#db!.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  listKvKeys(): string[] {
    const rows = this.#db!.prepare("SELECT key FROM kv ORDER BY key").all() as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  getKvJson<T = unknown>(key: string): T | null {
    const raw = this.getKv(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  listEntries(options: { limit?: number; kinds?: string[] } = {}): StoreEntry[] {
    const limit = options.limit;
    const sql =
      limit != null && limit > 0
        ? "SELECT seq, id, entry FROM transcript_entries ORDER BY seq DESC LIMIT ?"
        : "SELECT seq, id, entry FROM transcript_entries ORDER BY seq ASC";
    const rows =
      limit != null && limit > 0
        ? (this.#db!.prepare(sql).all(limit) as Array<{ seq: number; id: string; entry: string }>)
        : (this.#db!.prepare(sql).all() as Array<{ seq: number; id: string; entry: string }>);
    const out: StoreEntry[] = [];
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.entry);
      } catch {
        continue;
      }
      const kind = kindOf(parsed);
      if (options.kinds != null && options.kinds.length > 0 && !options.kinds.includes(kind)) {
        continue;
      }
      out.push({ seq: row.seq, id: row.id, kind, entry: parsed });
    }
    if (limit != null && limit > 0) out.reverse();
    return out;
  }

  getEntry(id: string): StoreEntry | null {
    const row = this.#db!.prepare("SELECT seq, id, entry FROM transcript_entries WHERE id = ?").get(
      id,
    ) as { seq: number; id: string; entry: string } | undefined;
    if (row == null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.entry);
    } catch {
      return null;
    }
    return { seq: row.seq, id: row.id, kind: kindOf(parsed), entry: parsed };
  }

  countEntries(): number {
    const row = this.#db!.prepare("SELECT COUNT(*) AS n FROM transcript_entries").get() as {
      n: number;
    };
    return row.n;
  }

  #readBlobRow(db: DatabaseSync, id: string): Uint8Array | null {
    try {
      const row = db.prepare("SELECT data FROM blobs WHERE id = ?").get(id) as
        | { data: Uint8Array | Buffer }
        | undefined;
      if (row == null) return null;
      return blobBytes(row.data);
    } catch {
      return null;
    }
  }

  /**
   * conversation-blobs.db blobs(id, data), then legacy store.db blobs.
   * Do not dump.
   */
  getBlob(id: string): Uint8Array | null {
    if (existsSync(this.blobsPath)) {
      if (this.#blobs == null) this.#blobs = openRo(this.blobsPath);
      const current = this.#readBlobRow(this.#blobs, id);
      if (current != null) return current;
    }
    if (this.#db == null) return null;
    return this.#readBlobRow(this.#db, id);
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
    this.#blobs?.close();
    this.#blobs = null;
  }
}

export function openAgentStore(agentId: string, sandRoot?: string): AgentStore {
  return new AgentStore(agentId, sandRoot);
}
