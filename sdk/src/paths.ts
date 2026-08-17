import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Default sand-data root. Alias: /home/box/agent-data. */
export const DEFAULT_SAND_ROOT = "/home/box/sand-data";
export const AGENT_DATA_ALIAS = "/home/box/agent-data";
export const SAND_DATA_DIRNAME = "sand-data";

export const ENV_SAND_DATA_ROOT = "SAND_DATA_ROOT";
export const ENV_SAND_USER_DATA_DIR = "SAND_USER_DATA_DIR";
export const ENV_SAND_GATEWAY_TOKEN = "SAND_GATEWAY_TOKEN";
export const ENV_SAND_HOST_PORT = "SAND_HOST_PORT";
export const ENV_SAND_GATEWAY_BIND_HOST = "SAND_GATEWAY_BIND_HOST";
/** Full gateway origin, e.g. http://127.0.0.1:1340 or http://your-host:1340. */
export const ENV_GROKBOT_GATEWAY_URL = "GROKBOT_GATEWAY_URL";
/** Alias for GROKBOT_GATEWAY_URL. */
export const ENV_SAND_GATEWAY_URL = "SAND_GATEWAY_URL";
/** Set to `1` to run the opt-in live gateway smoke (sdk/test/live-gateway.test.ts). */
export const ENV_GROKBOT_LIVE = "GROKBOT_LIVE";
/**
 * Directory for job JSON files (`<job_id>.json`). Sandbox-friendly default is
 * `$TMPDIR/grokbot-jobs`. Never writes into sand-data agent folders.
 */
export const ENV_GROKBOT_JOBS_DIR = "GROKBOT_JOBS_DIR";

export type SandPaths = {
  sandRoot: string;
  agentsDir: string;
  userMemoryDir: string;
  userMemoryShardsDir: string;
  transcriptsDir: string;
  workflowsDir: string;
  searchIndexPath: string;
  activeAgentPath: string;
  gatewayDiscoveryPath: string;
};

/** Job JSON store. Default: `join(tmpdir(), "grokbot-jobs")`. */
export function resolveJobsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_GROKBOT_JOBS_DIR]?.trim();
  if (override && override.length > 0) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return join(tmpdir(), "grokbot-jobs");
}

export function resolveSandRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dataRoot = env[ENV_SAND_DATA_ROOT]?.trim();
  if (dataRoot && isAbsolute(dataRoot)) return dataRoot;

  const userData = env[ENV_SAND_USER_DATA_DIR]?.trim();
  if (userData && userData.length > 0) {
    const base = isAbsolute(userData) ? userData : resolve(userData);
    return join(base, SAND_DATA_DIRNAME);
  }

  return DEFAULT_SAND_ROOT;
}

export function sandPaths(sandRoot: string = resolveSandRoot()): SandPaths {
  return {
    sandRoot,
    agentsDir: join(sandRoot, "agents"),
    userMemoryDir: join(sandRoot, "user-memory"),
    userMemoryShardsDir: join(sandRoot, "user-memory", "by-agent"),
    transcriptsDir: join(sandRoot, "agent-transcripts"),
    workflowsDir: join(sandRoot, "workflows"),
    searchIndexPath: join(sandRoot, "search-index.db"),
    activeAgentPath: join(sandRoot, "agents", "active-agent.json"),
    gatewayDiscoveryPath: join(sandRoot, "gateway.json"),
  };
}

export function gatewayDiscoveryPath(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).gatewayDiscoveryPath;
}

export function agentsDir(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).agentsDir;
}

/** Host `isSafeFolderId` — agent / automation / project folder names. */
export function isSafeFolderId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("\0") &&
    id !== "." &&
    id !== ".."
  );
}

/** Host `SandInvalidAgentIdError`. */
export class SandInvalidAgentIdError extends Error {
  constructor(agentId: string) {
    super(`Invalid Sand agent id: ${agentId}`);
    this.name = "SandInvalidAgentIdError";
  }
}

/**
 * Host `assertValidSandAgentId` — `isSafeFolderId` plus no surrounding
 * whitespace (`agentId !== agentId.trim()`).
 */
export function isValidSandAgentId(agentId: string): boolean {
  return isSafeFolderId(agentId) && agentId === agentId.trim();
}

/** Host `assertValidSandAgentId`. */
export function assertValidSandAgentId(agentId: string): void {
  if (!isValidSandAgentId(agentId)) {
    throw new SandInvalidAgentIdError(agentId);
  }
}

/**
 * Host `resolveSandAgentDir` containment check: `join(parent, id)` must
 * stay a single direct child of `parent`.
 */
export function resolveSafeChildDir(parent: string, id: string): string {
  const child = join(parent, id);
  const rel = relative(parent, child);
  if (
    rel.length === 0 ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel.includes(sep)
  ) {
    throw new SandInvalidAgentIdError(id);
  }
  return child;
}

export function agentDir(agentId: string, sandRoot?: string): string {
  assertValidSandAgentId(agentId);
  return resolveSafeChildDir(agentsDir(sandRoot), agentId);
}

export function agentProfilePath(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "profile.json");
}

export function agentSettingsPath(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "settings.json");
}

export function agentGroupPath(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "group.json");
}

export function agentMemoryDir(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "memory");
}

export function agentAutomationsDir(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "automations");
}

export function storeDbPath(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "store.db");
}

export function conversationBlobsPath(agentId: string, sandRoot?: string): string {
  return join(agentDir(agentId, sandRoot), "conversation-blobs.db");
}

export function userMemoryDir(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).userMemoryDir;
}

export function userMemoryShardDir(agentId: string, sandRoot?: string): string {
  assertValidSandAgentId(agentId);
  return resolveSafeChildDir(
    sandPaths(sandRoot ?? resolveSandRoot()).userMemoryShardsDir,
    agentId,
  );
}

export function transcriptPath(agentId: string, sandRoot?: string): string {
  assertValidSandAgentId(agentId);
  const dir = resolveSafeChildDir(
    sandPaths(sandRoot ?? resolveSandRoot()).transcriptsDir,
    agentId,
  );
  return join(dir, `${agentId}.jsonl`);
}

export function transcriptsDir(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).transcriptsDir;
}

export function workflowsDir(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).workflowsDir;
}

export function workflowSkillPath(slug: string, sandRoot?: string): string {
  if (!isSafeFolderId(slug)) {
    throw new SandInvalidAgentIdError(slug);
  }
  return join(resolveSafeChildDir(workflowsDir(sandRoot), slug), "SKILL.md");
}

export function searchIndexPath(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).searchIndexPath;
}

export function activeAgentPath(sandRoot?: string): string {
  return sandPaths(sandRoot ?? resolveSandRoot()).activeAgentPath;
}

/** @deprecated unused helper kept for callers that want a home-relative fallback */
export function homeSandRoot(home: string = homedir()): string {
  return join(home, SAND_DATA_DIRNAME);
}
