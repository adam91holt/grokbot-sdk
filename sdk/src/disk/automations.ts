import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentAutomationsDir, agentsDir, isSafeFolderId, isValidSandAgentId } from "../paths.js";
import type { AutomationProvenance, DiskAutomation } from "../types.js";
import { clampLine } from "./memory.js";

export const AUTOMATION_CONFIG_FILENAME = "automation.json";
export const AUTOMATION_MAX_NAME_LENGTH = 80;
/** Host SAND_ROUTINE_NOTICES — only id the serializer will persist. */
export const ROUTINE_NOTICE_IDS = ["github-listener-scope"] as const;
export const KNOWN_TRIGGER_TYPES = [
  "cron",
  "slack",
  "github",
  "microsoftTeams",
  "linear",
  "sentry",
  "pagerduty",
] as const;

function normalizeSchedule(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isKnownTriggerMember(value: unknown): boolean {
  if (!isUnknownRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "cron") {
    return typeof value.schedule === "string" && normalizeSchedule(value.schedule).length > 0;
  }
  return (KNOWN_TRIGGER_TYPES as readonly string[]).includes(value.type);
}

/** Host parseStoredTrigger — accept known member / group / list shapes. */
export function parseStoredTrigger(value: unknown): unknown | null {
  if (Array.isArray(value)) {
    const members = value.filter(isKnownTriggerMember);
    if (members.length === 0) return null;
    if (members.length === 1) return members[0];
    return { type: "group", listeners: members };
  }
  if (!isUnknownRecord(value)) return null;
  if (value.type === "group") {
    const listeners = Array.isArray(value.listeners) ? value.listeners.filter(isKnownTriggerMember) : [];
    if (listeners.length === 0) return null;
    if (listeners.length === 1) return listeners[0];
    return { type: "group", listeners };
  }
  return isKnownTriggerMember(value) ? value : null;
}

function parseStoredConfigTrigger(parsed: Record<string, unknown>): unknown | null {
  if (parsed.trigger != null) {
    const trigger = parseStoredTrigger(parsed.trigger);
    if (trigger != null) return trigger;
  }
  const schedule = typeof parsed.schedule === "string" ? normalizeSchedule(parsed.schedule) : "";
  return schedule.length > 0 ? { type: "cron", schedule } : null;
}

function parseRaisedNotices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length === 0 || ids.includes(id)) continue;
    if (!(ROUTINE_NOTICE_IDS as readonly string[]).includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

function triggerSchedule(trigger: unknown): string | undefined {
  if (!isUnknownRecord(trigger)) return undefined;
  if (trigger.type === "cron" && typeof trigger.schedule === "string") {
    const schedule = normalizeSchedule(trigger.schedule);
    return schedule.length > 0 ? schedule : undefined;
  }
  if (trigger.type === "group" && Array.isArray(trigger.listeners)) {
    for (const listener of trigger.listeners) {
      if (
        isUnknownRecord(listener) &&
        listener.type === "cron" &&
        typeof listener.schedule === "string"
      ) {
        const schedule = normalizeSchedule(listener.schedule);
        if (schedule.length > 0) return schedule;
      }
    }
  }
  return undefined;
}

export type ParsedAutomationConfig = {
  name: string;
  prompt: string;
  trigger: unknown;
  enabled: boolean;
  provenance: AutomationProvenance;
  createdAt: number;
  lastRunAt: number | null;
  raisedNotices: string[];
};

/**
 * Host parseStoredConfig. `fallbackCreatedAt` is file birthtime/mtime when
 * reading from disk; tests may pass a fixed clock.
 */
export function parseStoredAutomationConfig(
  raw: string,
  fallbackCreatedAt: number,
): ParsedAutomationConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  const name = typeof rec.name === "string" ? clampLine(rec.name, AUTOMATION_MAX_NAME_LENGTH) : "";
  const prompt = typeof rec.prompt === "string" ? rec.prompt.trim() : "";
  const trigger = parseStoredConfigTrigger(rec);
  if (name.length === 0 || prompt.length === 0 || trigger == null) {
    return null;
  }
  const authoredCreatedAt =
    typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt)
      ? rec.createdAt
      : fallbackCreatedAt;
  const createdAt = Math.min(authoredCreatedAt, fallbackCreatedAt);
  const lastRunAt =
    typeof rec.lastRunAt === "number" && Number.isFinite(rec.lastRunAt) ? rec.lastRunAt : null;
  return {
    name,
    prompt,
    trigger,
    enabled: rec.enabled !== false,
    provenance: rec.provenance === "untrusted" ? "untrusted" : "user",
    createdAt,
    lastRunAt,
    raisedNotices: parseRaisedNotices(rec.raisedNotices),
  };
}

function readAutomationFile(agentId: string, id: string, sandRoot?: string): DiskAutomation | null {
  const path = join(agentAutomationsDir(agentId, sandRoot), id, AUTOMATION_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let fallbackCreatedAt = Date.now();
  try {
    const stats = statSync(path);
    fallbackCreatedAt = Math.floor(stats.birthtimeMs || stats.mtimeMs);
  } catch {
    // keep Date.now()
  }
  const config = parseStoredAutomationConfig(raw, fallbackCreatedAt);
  if (config == null) return null;
  const schedule = triggerSchedule(config.trigger);
  return {
    id,
    agentId,
    name: config.name,
    prompt: config.prompt,
    ...(schedule != null ? { schedule } : {}),
    ...(!isUnknownRecord(config.trigger) || config.trigger.type === "cron"
      ? {}
      : { trigger: config.trigger }),
    enabled: config.enabled,
    provenance: config.provenance,
    createdAt: config.createdAt,
    lastRunAt: config.lastRunAt,
    ...(config.raisedNotices.length > 0 ? { raisedNotices: config.raisedNotices } : {}),
  };
}

export function listAgentAutomations(agentId: string, sandRoot?: string): DiskAutomation[] {
  if (!isValidSandAgentId(agentId)) return [];
  const dir = agentAutomationsDir(agentId, sandRoot);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: DiskAutomation[] = [];
  for (const id of names) {
    if (!isSafeFolderId(id)) continue;
    try {
      if (!statSync(join(dir, id)).isDirectory()) continue;
    } catch {
      continue;
    }
    const automation = readAutomationFile(agentId, id, sandRoot);
    if (automation != null) out.push(automation);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllDiskAutomations(sandRoot?: string): DiskAutomation[] {
  const root = agentsDir(sandRoot);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: DiskAutomation[] = [];
  for (const agentId of names) {
    if (!isSafeFolderId(agentId)) continue;
    try {
      if (!statSync(join(root, agentId)).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push(...listAgentAutomations(agentId, sandRoot));
  }
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.name.localeCompare(b.name));
}
