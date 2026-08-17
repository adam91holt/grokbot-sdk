/**
 * JSONL transcripts at <sandRoot>/agent-transcripts/<id>/<id>.jsonl
 *
 * Host journal (`formatSingleMessageJsonl`) writes the legacy envelope
 * `{ role, message: { content } }` where `content` is an array of parts
 * (`{type:"text",text}` / `{type:"tool_use",name,input}`). Metadata and
 * turn_ended marker lines are not messages. Treat bodies as sensitive.
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { isSafeFolderId, isValidSandAgentId, transcriptPath, transcriptsDir } from "../paths.js";
import type { TranscriptContentItem, TranscriptLine } from "../types.js";

export const SUBAGENT_PREFIX = "sand-subagent-";

/** Host prependOverviewMetadataLine / getTranscriptTerminalMarkers. */
export const TRANSCRIPT_NON_MESSAGE_TYPES = ["metadata", "turn_ended"] as const;

export type ReadTranscriptOptions = {
  sandRoot?: string;
  /** Skip sand-subagent-* folders. Default true. */
  skipSubagents?: boolean;
  /** Keep only the last N parsed lines. */
  tail?: number;
  /**
   * Called per line. Return false to stop.
   * Do not log `line.message` bodies.
   */
  onLine?: (line: TranscriptLine, index: number) => boolean | void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

export function isTranscriptNonMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return (TRANSCRIPT_NON_MESSAGE_TYPES as readonly string[]).includes(value.type);
}

/**
 * Host journal envelope: `{ role, message: { content } }`.
 * `content` is an array on disk; a string is accepted and normalized.
 */
export function isLegacyTranscriptEnvelope(value: unknown): value is {
  role: string;
  message: { content: unknown; [key: string]: unknown };
} {
  if (!isRecord(value) || typeof value.role !== "string") return false;
  if (isTranscriptNonMessage(value)) return false;
  if (!isRecord(value.message)) return false;
  return "content" in value.message;
}

function normalizeContent(content: unknown): TranscriptContentItem[] | null {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return null;
  return content as TranscriptContentItem[];
}

export function parseLegacyTranscriptLine(value: unknown): TranscriptLine | null {
  if (!isLegacyTranscriptEnvelope(value)) return null;
  const content = normalizeContent(value.message.content);
  if (content == null) return null;
  return {
    role: value.role,
    message: { ...value.message, content },
  };
}

/** Host formatSingleMessageJsonl serialize shape. */
export function formatLegacyTranscriptLine(
  role: string,
  content: TranscriptContentItem[],
): string {
  return JSON.stringify({ role, message: { content } });
}

export async function readTranscript(
  agentId: string,
  options: ReadTranscriptOptions = {},
): Promise<TranscriptLine[]> {
  if (!isValidSandAgentId(agentId)) return [];
  const path = transcriptPath(agentId, options.sandRoot);
  const lines: TranscriptLine[] = [];
  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
  } catch {
    return [];
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const raw of rl) {
      if (raw.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (isTranscriptNonMessage(parsed)) continue;
      const line = parseLegacyTranscriptLine(parsed);
      if (line == null) continue;
      const keep = options.onLine?.(line, index);
      index += 1;
      if (keep === false) break;
      lines.push(line);
      if (options.tail != null && options.tail > 0 && lines.length > options.tail) {
        lines.shift();
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
  return lines;
}

export type TranscriptIndexEntry = {
  agentId: string;
  path: string;
  bytes: number;
  isSubagent: boolean;
};

export function listTranscriptFiles(
  sandRoot?: string,
  options: { skipSubagents?: boolean } = {},
): TranscriptIndexEntry[] {
  const root = transcriptsDir(sandRoot);
  const skip = options.skipSubagents !== false;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: TranscriptIndexEntry[] = [];
  for (const agentId of names) {
    if (!isSafeFolderId(agentId)) continue;
    const isSubagent = agentId.startsWith(SUBAGENT_PREFIX);
    if (skip && isSubagent) continue;
    const path = join(root, agentId, `${agentId}.jsonl`);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      out.push({ agentId, path, bytes: st.size, isSubagent });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function summarizeContent(content: TranscriptContentItem[]): {
  texts: number;
  toolUses: string[];
  toolResults: string[];
  other: number;
} {
  const toolUses: string[] = [];
  const toolResults: string[] = [];
  let texts = 0;
  let other = 0;
  for (const item of content) {
    if (item.type === "text") texts += 1;
    else if (item.type === "tool_use" && "name" in item && typeof item.name === "string") {
      toolUses.push(item.name);
    } else if (item.type === "tool_result" && "name" in item && typeof item.name === "string") {
      toolResults.push(item.name);
    } else other += 1;
  }
  return { texts, toolUses, toolResults, other };
}
