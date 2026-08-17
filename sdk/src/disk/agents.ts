import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  activeAgentPath,
  agentDir,
  agentGroupPath,
  agentProfilePath,
  agentSettingsPath,
  agentsDir,
  isSafeFolderId,
  isValidSandAgentId,
} from "../paths.js";
import type {
  ActiveAgentFile,
  AgentGroup,
  AgentProfile,
  AgentSettings,
  GroupRemoteMember,
} from "../types.js";

export type DiskAgent = {
  id: string;
  dir: string;
  profile: AgentProfile | null;
  settings: AgentSettings | null;
  group: AgentGroup | null;
  isGroup: boolean;
};

/** Host DEFAULT_NOTIFY_ON_AGENT_UPDATES / DEFAULT_HIDDEN_FROM_SIDEBAR. */
export const DEFAULT_NOTIFY_ON_AGENT_UPDATES = true;
export const DEFAULT_HIDDEN_FROM_SIDEBAR = false;
/** Host GROUP_CONFIG_VERSION / GROUP_MAX_MEMBERS. */
export const GROUP_CONFIG_VERSION = 1;
export const GROUP_MAX_MEMBERS = 6;

const DEFAULT_NOTIFY = DEFAULT_NOTIFY_ON_AGENT_UPDATES;
const DEFAULT_HIDDEN = DEFAULT_HIDDEN_FROM_SIDEBAR;

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Host readSandProfileFile — keys from writeSandProfileFile only. */
export function parseSandProfile(parsed: unknown): AgentProfile | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  return {
    name: typeof rec.name === "string" ? rec.name : "",
    description: typeof rec.description === "string" ? rec.description : "",
    title: typeof rec.title === "string" ? rec.title.trim() : "",
    avatarShape: typeof rec.avatarShape === "string" ? rec.avatarShape.trim() : "",
    avatarColor: typeof rec.avatarColor === "string" ? rec.avatarColor.trim() : "",
  };
}

export function readProfile(agentId: string, sandRoot?: string): AgentProfile | null {
  return parseSandProfile(readJson(agentProfilePath(agentId, sandRoot)));
}

/** Host readSandSettingsFile — only notifyOnAgentUpdates + hiddenFromSidebar. */
export function parseSandSettings(parsed: unknown): AgentSettings {
  const rec = parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    notifyOnAgentUpdates:
      typeof rec.notifyOnAgentUpdates === "boolean" ? rec.notifyOnAgentUpdates : DEFAULT_NOTIFY,
    hiddenFromSidebar:
      typeof rec.hiddenFromSidebar === "boolean" ? rec.hiddenFromSidebar : DEFAULT_HIDDEN,
  };
}

export function readSettings(agentId: string, sandRoot?: string): AgentSettings {
  return parseSandSettings(readJson(agentSettingsPath(agentId, sandRoot)));
}

/** Host normalizeMemberIds. */
export function normalizeMemberIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (seen.size >= GROUP_MAX_MEMBERS) break;
  }
  return [...seen];
}

/** Host normalizeRemoteMembers. */
export function normalizeRemoteMembers(raw: unknown): GroupRemoteMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const members: GroupRemoteMember[] = [];
  for (const value of raw) {
    if (value == null || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.ownerAuthId !== "string" || typeof candidate.agentId !== "string") {
      continue;
    }
    const ownerAuthId = candidate.ownerAuthId.trim();
    const agentId = candidate.agentId.trim();
    if (ownerAuthId.length === 0 || agentId.length === 0) continue;
    const key = `${ownerAuthId}\0${agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    members.push({
      ownerAuthId,
      agentId,
      name:
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name.trim()
          : "Agent",
      ...(typeof candidate.avatarDataUrl === "string" && candidate.avatarDataUrl.length > 0
        ? { avatarDataUrl: candidate.avatarDataUrl }
        : {}),
    });
    if (members.length >= GROUP_MAX_MEMBERS) break;
  }
  return members;
}

/** Host readSandGroupConfig — keys from writeSandGroupConfig only. */
export function parseSandGroup(parsed: unknown): AgentGroup | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  const memberIds = normalizeMemberIds(rec.memberIds);
  const remoteMembers = normalizeRemoteMembers(rec.remoteMembers);
  const sharedRoomId =
    typeof rec.sharedRoomId === "string" && rec.sharedRoomId.length > 0
      ? rec.sharedRoomId
      : undefined;
  if (memberIds.length === 0 && remoteMembers.length === 0 && sharedRoomId === undefined) {
    return null;
  }
  return {
    version: typeof rec.version === "number" ? rec.version : GROUP_CONFIG_VERSION,
    memberIds,
    ...(remoteMembers.length > 0 ? { remoteMembers } : {}),
    ...(sharedRoomId !== undefined ? { sharedRoomId } : {}),
  };
}

export function readGroup(agentId: string, sandRoot?: string): AgentGroup | null {
  return parseSandGroup(readJson(agentGroupPath(agentId, sandRoot)));
}

export function readActiveAgentId(sandRoot?: string): string | null {
  const parsed = readJson(activeAgentPath(sandRoot));
  if (parsed == null || typeof parsed !== "object") return null;
  const id = (parsed as ActiveAgentFile).activeAgentId;
  // Host resolveSandAgentDir / isSafeFolderId — refuse traversal ids.
  return typeof id === "string" && isValidSandAgentId(id) ? id : null;
}

export function listDiskAgents(sandRoot?: string): DiskAgent[] {
  const root = agentsDir(sandRoot);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const agents: DiskAgent[] = [];
  for (const id of names) {
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!isValidSandAgentId(id)) continue;
    const profile = readProfile(id, sandRoot);
    const settings = readSettings(id, sandRoot);
    const group = readGroup(id, sandRoot);
    agents.push({
      id,
      dir: agentDir(id, sandRoot),
      profile,
      settings,
      group,
      isGroup: group != null,
    });
  }
  return agents.sort((a, b) => (a.profile?.name ?? a.id).localeCompare(b.profile?.name ?? b.id));
}

export function getDiskAgent(agentId: string, sandRoot?: string): DiskAgent | null {
  // Host synthesisTargetForAgent / storeForAgent: unsafe ids never resolve.
  if (!isValidSandAgentId(agentId)) return null;
  const dir = agentDir(agentId, sandRoot);
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const group = readGroup(agentId, sandRoot);
  return {
    id: agentId,
    dir,
    profile: readProfile(agentId, sandRoot),
    settings: readSettings(agentId, sandRoot),
    group,
    isGroup: group != null,
  };
}

export function resolveDiskAgent(idOrName: string, sandRoot?: string): DiskAgent | null {
  const needle = idOrName.trim();
  if (needle.length === 0) return null;
  const direct = getDiskAgent(needle, sandRoot);
  if (direct != null) return direct;
  const lower = needle.toLowerCase();
  const matches = listDiskAgents(sandRoot).filter(
    (agent) => agent.profile?.name.trim().toLowerCase() === lower,
  );
  return matches[0] ?? null;
}
