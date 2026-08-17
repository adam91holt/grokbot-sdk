/**
 * Agent / user-memory files — exact host format from host-main.cjs
 * (src/host/extensions/memory/memory-service.ts, src/host/runner/sand-memory.ts).
 *
 * Disk writes (`writeMemoryFact` / `forgetMemoryFact`) are a fallback for when
 * the host is down. Prefer gateway `getAgentMemories` and the host
 * `update_state` tool (target "memory") when the host is running — the host
 * owns watchers, dreaming metadata, and cross-shard merge.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  agentMemoryDir,
  isValidSandAgentId,
  userMemoryShardDir,
} from "../paths.js";
import type { MemoryFact, MemoryKind, MemoryScope, MemoryTier } from "../types.js";

export const MEMORY_MAX_CONTENT_LENGTH = 500;
export const MEMORY_NOTE_PREFIX = "[note] ";
export const MEMORY_EPISODE_PREFIX = "[episode] ";
export const PROFILE_FILENAME = "profile.md";
export const LOG_DIRNAME = "log";

export const PROFILE_HEADER = [
  "# About the user",
  "",
  "<!-- Enduring facts: who the user is, how to address them, lasting preferences.",
  "     Kept in mind every turn. Safe to read, grep, and edit.",
  '     One fact per line, as "- (YYYY-MM-DD) <fact>". -->',
  "",
].join("\n");

export const LOG_HEADER = [
  "# Memory log",
  "",
  '<!-- Dated facts, one per line as "- (YYYY-MM-DD) <fact>". Safe to read, grep, and edit. -->',
  "",
].join("\n");

/** Host FACT_LINE. */
export const FACT_LINE = /^-\s+\((\d{4}-\d{2}-\d{2})\)\s+(.+?)\s*$/;

export function clampLine(raw: string, maxLength: number): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeMemoryContent(raw: string): string {
  return clampLine(raw, MEMORY_MAX_CONTENT_LENGTH);
}

export function memoryDedupeKey(content: string): string {
  return normalizeMemoryContent(content).toLowerCase();
}

export function memoryIdFor(content: string): string {
  return createHash("sha1").update(memoryDedupeKey(content)).digest("hex").slice(0, 16);
}

export function formatMemoryDate(createdAtMs: number): string {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return "unknown date";
  return new Date(createdAtMs).toISOString().slice(0, 10);
}

export function serializeFactLine(content: string, createdAt: number): string {
  return `- (${formatMemoryDate(createdAt)}) ${content}`;
}

export function parseFacts(raw: string, kind: MemoryKind, base: number, path: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  let order = base;
  for (const [lineIndex, line] of raw.split("\n").entries()) {
    const match = FACT_LINE.exec(line);
    if (match == null) continue;
    const content = normalizeMemoryContent(match[2] ?? "");
    if (content.length === 0) continue;
    const createdAt = Date.parse(`${match[1]}T00:00:00Z`);
    facts.push({
      id: memoryIdFor(content),
      content,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      kind,
      order: order++,
      origin: "legacy",
      path,
      firstLine: lineIndex,
      lastLine: lineIndex,
    } as MemoryFact & { firstLine: number; lastLine: number });
  }
  return facts;
}

type LocatedFact = MemoryFact & { firstLine: number; lastLine: number };

function parseLocatedFacts(raw: string, kind: MemoryKind, base: number, path: string): LocatedFact[] {
  const facts: LocatedFact[] = [];
  let order = base;
  for (const [lineIndex, line] of raw.split("\n").entries()) {
    const match = FACT_LINE.exec(line);
    if (match == null) continue;
    const content = normalizeMemoryContent(match[2] ?? "");
    if (content.length === 0) continue;
    const createdAt = Date.parse(`${match[1]}T00:00:00Z`);
    facts.push({
      id: memoryIdFor(content),
      content,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      kind,
      order: order++,
      origin: "legacy",
      path,
      firstLine: lineIndex,
      lastLine: lineIndex,
    });
  }
  return facts;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
}

function logFiles(logDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(logDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(logDir, name));
}

function logFileForDate(logDir: string, createdAt: number): string {
  const bucket = formatMemoryDate(createdAt).slice(0, 7);
  return join(logDir, `${bucket}.md`);
}

export function memoryDirFor(agentId: string, scope: MemoryScope, sandRoot?: string): string {
  return scope === "user" ? userMemoryShardDir(agentId, sandRoot) : agentMemoryDir(agentId, sandRoot);
}

export function listMemoryFacts(
  agentId: string,
  options: { scope?: MemoryScope; sandRoot?: string } = {},
): MemoryFact[] {
  if (!isValidSandAgentId(agentId)) return [];
  const scope = options.scope ?? "agent";
  const dir = memoryDirFor(agentId, scope, options.sandRoot);
  const profileFile = join(dir, PROFILE_FILENAME);
  const logDir = join(dir, LOG_DIRNAME);
  const profile = parseFacts(readText(profileFile), "profile", 0, profileFile);
  // Host FileMemoryStore.logFacts() starts order at 0 independently of profile.
  const logs: MemoryFact[] = [];
  for (const file of logFiles(logDir)) {
    logs.push(...parseFacts(readText(file), "log", logs.length, file));
  }
  return [...profile, ...logs];
}

export type WriteMemoryInput = {
  agentId: string;
  content: string;
  tier?: MemoryTier;
  scope?: MemoryScope;
  createdAt?: number;
  sandRoot?: string;
};

/**
 * Disk fallback for host `rememberFact` → `FileMemoryStore.addMemory`.
 * Prefer gateway / update_state when the host is up.
 *
 * Appends one fact line (rewrite the whole file with previous + new line).
 * Notes get MEMORY_NOTE_PREFIX before normalize. Dedupes on normalize +
 * toLowerCase. Returns null if empty or already present.
 */
export function writeMemoryFact(input: WriteMemoryInput): MemoryFact | null {
  if (!isValidSandAgentId(input.agentId)) return null;
  const tier = input.tier ?? "log";
  const scope = input.scope ?? "agent";
  const createdAt = input.createdAt ?? Date.now();
  const prefixed =
    tier === "note" ? `${MEMORY_NOTE_PREFIX}${input.content.trim()}` : input.content;
  const normalized = normalizeMemoryContent(prefixed);
  if (normalized.length === 0) return null;

  const key = memoryDedupeKey(normalized);
  const existing = listMemoryFacts(input.agentId, { scope, sandRoot: input.sandRoot });
  if (existing.some((fact) => memoryDedupeKey(fact.content) === key)) return null;

  const dir = memoryDirFor(input.agentId, scope, input.sandRoot);
  const kind: MemoryKind = tier === "profile" ? "profile" : "log";
  const path =
    kind === "profile" ? join(dir, PROFILE_FILENAME) : logFileForDate(join(dir, LOG_DIRNAME), createdAt);
  const header = kind === "profile" ? PROFILE_HEADER : LOG_HEADER;
  const raw = readText(path);
  const base = raw.length === 0 ? header : raw;
  const separator = base.endsWith("\n") || base.length === 0 ? "" : "\n";
  writeAtomic(path, `${base}${separator}${serializeFactLine(normalized, createdAt)}\n`);
  return {
    id: memoryIdFor(normalized),
    content: normalized,
    createdAt,
    kind,
    order: existing.length,
    path,
  };
}

export type ForgetMemoryInput = {
  agentId: string;
  content: string;
  scope?: MemoryScope;
  sandRoot?: string;
};

/**
 * Disk fallback for host `forgetFact` → `removeMemoryByContent`.
 * Prefer gateway / update_state when the host is up.
 *
 * Forget by exact recorded text (after host normalize), including any
 * `[note] ` / `[episode] ` prefix. Matches host
 * removeMemoryByContent → memoryIdFor(normalized).
 */
export function forgetMemoryFact(input: ForgetMemoryInput): boolean {
  if (!isValidSandAgentId(input.agentId)) return false;
  const normalized = normalizeMemoryContent(input.content);
  if (normalized.length === 0) return false;
  const id = memoryIdFor(normalized);
  const scope = input.scope ?? "agent";
  const dir = memoryDirFor(input.agentId, scope, input.sandRoot);
  const profileFile = join(dir, PROFILE_FILENAME);
  const files = [profileFile, ...logFiles(join(dir, LOG_DIRNAME))];
  for (const path of files) {
    const raw = readText(path);
    if (raw.length === 0) continue;
    const kind: MemoryKind = path === profileFile ? "profile" : "log";
    const fact = parseLocatedFacts(raw, kind, 0, path).find((memory) => memory.id === id);
    if (fact == null) continue;
    const lines = raw.split("\n");
    lines.splice(fact.firstLine, fact.lastLine - fact.firstLine + 1);
    writeAtomic(path, lines.join("\n"));
    return true;
  }
  return false;
}
