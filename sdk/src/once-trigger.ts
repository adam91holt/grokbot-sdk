/**
 * SDK helper for a calendar one-shot. Not a host trigger type.
 *
 * Live host parseStoredTrigger / KNOWN_TRIGGER_TYPES is still cron + event
 * listeners + group. `{ type: "once", at }` is not in that allowlist — the
 * host would drop it (or drop it from a group and keep slack/etc.).
 *
 * createAgentAutomation / updateAgentAutomation translate a standalone once
 * to a dated cron (`M H D M *`) in the host cron zone so something still fires,
 * and append a prompt footer telling the agent to delete the routine after it
 * executes. Live host cron is user-local Pacific/Auckland (unless the host
 * process has CRON_TZ=). This helper emits those clock fields — it does not
 * prefix `CRON_TZ=` on the schedule; SDK normalizeSchedule only trims, and
 * nothing extracted from FileAutomationStore says the host keeps that prefix.
 * Dated cron annual-repeats; the host has no disable-after-fire contract.
 * Unrelated to gateway/oneshot.ts throwaway runs.
 */

/** Live host cron zone when CRON_TZ is unset. */
export const HOST_CRON_TIME_ZONE = "Pacific/Auckland";
import { parseStoredTrigger } from "./disk/automations.js";
import type { AutomationTrigger, CronTrigger, OnceTrigger } from "./types.js";

/** Epoch ms must be strictly after 2001-09-09T01:46:40.000Z. Rejects 0, negatives, seconds. */
export const ONCE_AT_MIN_MS = 1e12;

/**
 * Appended to `prompt` only when create/update translate standalone
 * `{ type: "once", at }` to dated cron. Cron-only and event-listener specs
 * are left unchanged. The host has no disable-after-fire contract, so the
 * agent must delete the routine after it executes.
 */
export const ONCE_DATED_CRON_DELETE_INSTRUCTION =
  "This is a one-time dated cron. Delete this routine after it executes; it would otherwise annual-repeat next year.";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isOnceAtMs(ms: number): boolean {
  return Number.isFinite(ms) && ms > ONCE_AT_MIN_MS;
}

function isOnceRecord(value: unknown): value is Record<string, unknown> & { type: "once" } {
  return isUnknownRecord(value) && value.type === "once";
}

const ISO_TZ_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parse `at` to epoch ms.
 * Prefer ISO-8601 with a time and timezone (`Z` or offset). Also accepts
 * epoch milliseconds (number or digit string) strictly greater than 1e12.
 *
 * Rejects: whitespace-only, date-only (`2026-08-18`), missing timezone,
 * epoch seconds, 0, negatives, NaN. Date-only is ambiguous (local vs UTC
 * midnight) so it is not treated as 00:00Z.
 */
export function parseOnceAtMs(value: unknown): number | null {
  if (typeof value === "number") {
    return isOnceAtMs(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return isOnceAtMs(n) ? n : null;
  }
  if (!trimmed.includes("T") || !ISO_TZ_SUFFIX.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return isOnceAtMs(ms) ? ms : null;
}

export function isValidOnceAt(value: unknown): value is string | number {
  return parseOnceAtMs(value) != null;
}

/** Trim + UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`). */
export function normalizeOnceAt(value: unknown): string | null {
  const ms = parseOnceAtMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

export function parseOnceTrigger(value: unknown): OnceTrigger | null {
  if (!isOnceRecord(value)) return null;
  if (typeof value.schedule === "string" && value.schedule.trim().length > 0) return null;
  const at = normalizeOnceAt(value.at);
  return at == null ? null : { type: "once", at };
}

const ONCE_AT_ERROR =
  "once.at must be ISO-8601 with a time and timezone (Z or offset), or epoch milliseconds > 1e12. " +
  "Date-only and epoch seconds are rejected.";

const ONCE_GROUP_ERROR =
  "once cannot be a group/list member until the host allowlist includes it; " +
  "the host would drop it and keep slack/etc. Translate with onceToDatedCron and pass that cron member.";

function zonedClockFields(
  ms: number,
  timeZone: string,
): { minute: number; hour: number; day: number; month: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
  } catch {
    throw new Error(`unknown host cron time zone ${timeZone}`);
  }
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value;
    const n = raw == null ? Number.NaN : Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`could not read ${type} in ${timeZone}`);
    }
    return n;
  };
  return {
    minute: read("minute"),
    hour: read("hour"),
    day: read("day"),
    month: read("month"),
  };
}

/**
 * Live host path for a calendar fire: dated cron (`M H D M *`) in host-local
 * fields (default Pacific/Auckland). Pass `timeZone` when the host has CRON_TZ=.
 * Minute resolution — seconds are dropped. Annual-repeats; a past `at` still
 * becomes that month/day/time and fires on the next matching calendar date.
 * There is no host contract to disable or delete the routine after it fires;
 * `toHostAutomationSpec` appends ONCE_DATED_CRON_DELETE_INSTRUCTION instead.
 */
export function onceToDatedCron(
  at: string | number,
  timeZone: string = HOST_CRON_TIME_ZONE,
): CronTrigger {
  const ms = parseOnceAtMs(at);
  if (ms == null) {
    throw new Error(ONCE_AT_ERROR);
  }
  const zone = timeZone.trim();
  if (zone.length === 0) {
    throw new Error("onceToDatedCron timeZone must be a non-empty IANA name");
  }
  const clock = zonedClockFields(ms, zone);
  const schedule = `${clock.minute} ${clock.hour} ${clock.day} ${clock.month} *`;
  return { type: "cron", schedule };
}

function hostTriggerOrThrow(value: unknown): AutomationTrigger {
  const parsed = parseStoredTrigger(value);
  if (parsed == null) {
    throw new Error("trigger is not a host cron/event/group shape");
  }
  return parsed;
}

function assertNoOnceMembers(members: unknown[], label: string): void {
  if (members.some(isOnceRecord)) {
    throw new Error(label);
  }
}

/**
 * Fail closed toward the host: never emit `{ type: "once" }`.
 * Standalone once → dated cron (still fires). once in a group/list → throw.
 */
export function toHostAutomationTrigger(value: unknown): AutomationTrigger {
  if (isOnceRecord(value)) {
    if (typeof value.schedule === "string" && value.schedule.trim().length > 0) {
      throw new Error(
        "once cannot be combined with a cron schedule; use onceToDatedCron(at) or a cron trigger",
      );
    }
    if (value.at == null || (typeof value.at !== "string" && typeof value.at !== "number")) {
      throw new Error(ONCE_AT_ERROR);
    }
    return onceToDatedCron(value.at);
  }
  if (Array.isArray(value)) {
    assertNoOnceMembers(value, ONCE_GROUP_ERROR);
    return hostTriggerOrThrow(value);
  }
  if (isUnknownRecord(value) && value.type === "group") {
    const listeners = Array.isArray(value.listeners) ? value.listeners : [];
    assertNoOnceMembers(listeners, ONCE_GROUP_ERROR);
    return hostTriggerOrThrow(value);
  }
  return hostTriggerOrThrow(value);
}

function appendOnceDatedCronDeleteInstruction(prompt: unknown): string {
  const base = typeof prompt === "string" ? prompt : "";
  if (base.includes(ONCE_DATED_CRON_DELETE_INSTRUCTION)) {
    return base;
  }
  return base.length === 0
    ? ONCE_DATED_CRON_DELETE_INSTRUCTION
    : `${base}\n\n${ONCE_DATED_CRON_DELETE_INSTRUCTION}`;
}

export function toHostAutomationSpec<T extends { trigger: unknown }>(
  spec: T,
): T & { trigger: AutomationTrigger } {
  const translatedOnce = isOnceRecord(spec.trigger);
  const trigger = toHostAutomationTrigger(spec.trigger);
  if (!translatedOnce) {
    return { ...spec, trigger };
  }
  return {
    ...spec,
    trigger,
    prompt: appendOnceDatedCronDeleteInstruction(
      "prompt" in spec ? spec.prompt : undefined,
    ),
  };
}
