/**
 * RosterProjection.getConversationOutline items.
 * stepToOutlineItem / live outline updates in host-main.cjs.
 * Thinking durationMs is omitted by the host when missing or ≤ 0 —
 * do not invent a latency.
 */
import type { ConversationOutlineItem, OutlineThinkingStep } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asPositiveMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseConversationOutline(value: unknown): ConversationOutlineItem[] {
  if (!Array.isArray(value)) return [];
  const items: ConversationOutlineItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const kind = asNonEmptyString(item.kind);
    if (kind == null) continue;
    const id = asNonEmptyString(item.id);
    const text = typeof item.text === "string" ? item.text : undefined;
    if (kind === "thinking") {
      const durationMs = asPositiveMs(item.durationMs);
      items.push({
        kind: "thinking",
        ...(id != null ? { id } : {}),
        ...(text != null ? { text } : {}),
        ...(durationMs != null ? { durationMs } : {}),
      });
      continue;
    }
    if (kind === "user") {
      items.push({
        kind: "user",
        ...(id != null ? { id } : {}),
        ...(text != null ? { text } : {}),
        ...(item.hidden === true ? { hidden: true } : {}),
      });
      continue;
    }
    if (kind === "assistant-text") {
      items.push({
        kind: "assistant-text",
        ...(id != null ? { id } : {}),
        ...(text != null ? { text } : {}),
      });
      continue;
    }
    if (kind === "tool-call") {
      const name = asNonEmptyString(item.name);
      const status = asNonEmptyString(item.status);
      const summary = typeof item.summary === "string" ? item.summary : undefined;
      items.push({
        kind: "tool-call",
        ...(id != null ? { id } : {}),
        ...(name != null ? { name } : {}),
        ...(status != null ? { status } : {}),
        ...(summary != null ? { summary } : {}),
      });
      continue;
    }
    if (kind === "send-message") {
      const timestampMs = asPositiveMs(item.timestampMs);
      items.push({
        kind: "send-message",
        ...(id != null ? { id } : {}),
        ...("message" in item ? { message: item.message } : {}),
        ...(timestampMs != null ? { timestampMs } : {}),
      });
      continue;
    }
    items.push({ kind, ...(id != null ? { id } : {}) });
  }
  return items;
}

/** Thinking steps that still have a host-provided positive durationMs. */
export function outlineThinkingSteps(items: unknown): OutlineThinkingStep[] {
  const source: unknown[] = Array.isArray(items) ? items : parseConversationOutline(items);
  const steps: OutlineThinkingStep[] = [];
  for (const item of source) {
    if (!isRecord(item) || item.kind !== "thinking") continue;
    const durationMs = asPositiveMs(item.durationMs);
    if (durationMs == null) continue;
    const id = asNonEmptyString(item.id);
    steps.push({
      ...(id != null ? { id } : {}),
      durationMs,
    });
  }
  return steps;
}
