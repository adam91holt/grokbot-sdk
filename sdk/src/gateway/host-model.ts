/**
 * sandAgentDefaultModelSchema / sandComputerUseModelSchema:
 * `{ modelId, maxMode, parameters: [{ id, value }] }`.
 * Do not invent a model id when the host omitted the selection.
 */
import type { HostModelParameter, HostModelSelection } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseHostModelSelection(value: unknown): HostModelSelection | undefined {
  if (!isRecord(value)) return undefined;
  const modelId = asNonEmptyString(value.modelId);
  if (modelId == null) return undefined;

  const parameters: HostModelParameter[] = [];
  if (Array.isArray(value.parameters)) {
    for (const row of value.parameters) {
      if (!isRecord(row)) continue;
      const id = asNonEmptyString(row.id);
      if (id == null || typeof row.value !== "string") continue;
      parameters.push({ id, value: row.value });
    }
  }

  return {
    modelId,
    ...(typeof value.maxMode === "boolean" ? { maxMode: value.maxMode } : {}),
    parameters,
  };
}
