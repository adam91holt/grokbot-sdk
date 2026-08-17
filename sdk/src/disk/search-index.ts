/**
 * Read-only <sandRoot>/search-index.db (meta, agents, messages, media).
 * FTS may be absent — helpers use ordinary SELECT / LIKE.
 * Message bodies are sensitive; do not log them.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { searchIndexPath } from "../paths.js";
import type { SearchMediaRow, SearchMessageRow } from "../types.js";

function openRo(filePath: string): DatabaseSync {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`SQLite database not found: ${absolute}`);
  }
  return new DatabaseSync(absolute, { readOnly: true });
}

export type SearchMessageQuery = {
  agentId?: string;
  role?: string;
  contains?: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
};

export type SearchMediaQuery = {
  agentId?: string;
  kind?: string;
  ext?: string;
  limit?: number;
};

export class SearchIndex {
  readonly path: string;
  #db: DatabaseSync;

  constructor(sandRoot?: string) {
    this.path = searchIndexPath(sandRoot);
    this.#db = openRo(this.path);
  }

  getMeta(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  listIndexedAgents(): Array<{ agentId: string; fingerprint: string }> {
    const rows = this.#db.prepare("SELECT agent_id, fingerprint FROM agents").all() as Array<{
      agent_id: string;
      fingerprint: string;
    }>;
    return rows.map((row) => ({ agentId: row.agent_id, fingerprint: row.fingerprint }));
  }

  queryMessages(query: SearchMessageQuery = {}): SearchMessageRow[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];
    if (query.agentId != null) {
      clauses.push("agent_id = ?");
      params.push(query.agentId);
    }
    if (query.role != null) {
      clauses.push("role = ?");
      params.push(query.role);
    }
    if (query.contains != null && query.contains.length > 0) {
      clauses.push("body LIKE ?");
      params.push(`%${query.contains}%`);
    }
    if (query.sinceMs != null) {
      clauses.push("timestamp_ms >= ?");
      params.push(query.sinceMs);
    }
    if (query.untilMs != null) {
      clauses.push("timestamp_ms <= ?");
      params.push(query.untilMs);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = query.limit != null && query.limit > 0 ? query.limit : 50;
    params.push(limit);
    const sql = `SELECT id, agent_id, entry_id, role, timestamp_ms, body
      FROM messages ${where} ORDER BY timestamp_ms DESC LIMIT ?`;
    const rows = this.#db.prepare(sql).all(...params) as Array<{
      id: number;
      agent_id: string;
      entry_id: string;
      role: string;
      timestamp_ms: number;
      body: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      entryId: row.entry_id,
      role: row.role,
      timestampMs: row.timestamp_ms,
      body: row.body,
    }));
  }

  queryMedia(query: SearchMediaQuery = {}): SearchMediaRow[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];
    if (query.agentId != null) {
      clauses.push("agent_id = ?");
      params.push(query.agentId);
    }
    if (query.kind != null) {
      clauses.push("kind = ?");
      params.push(query.kind);
    }
    if (query.ext != null) {
      clauses.push("ext = ?");
      params.push(query.ext);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = query.limit != null && query.limit > 0 ? query.limit : 50;
    params.push(limit);
    const sql = `SELECT id, agent_id, entry_id, file_name, ext, mime, kind, timestamp_ms, width, height
      FROM media ${where} ORDER BY timestamp_ms DESC LIMIT ?`;
    const rows = this.#db.prepare(sql).all(...params) as Array<{
      id: number;
      agent_id: string;
      entry_id: string;
      file_name: string;
      ext: string;
      mime: string | null;
      kind: string;
      timestamp_ms: number;
      width: number | null;
      height: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      entryId: row.entry_id,
      fileName: row.file_name,
      ext: row.ext,
      mime: row.mime,
      kind: row.kind,
      timestampMs: row.timestamp_ms,
      width: row.width,
      height: row.height,
    }));
  }

  close(): void {
    this.#db.close();
  }
}

export function openSearchIndex(sandRoot?: string): SearchIndex {
  return new SearchIndex(sandRoot);
}
