/**
 * Resolve an agent name or id to the id the host POST body expects.
 * Host commands still receive `{ id }` (or sendPrompt's `agentId`).
 *
 * UUID and `sand-subagent-*` values are already ids. Otherwise try disk
 * `resolveAgent` (folder id or profile name), then gateway `listAgents`.
 */
import { SUBAGENT_PREFIX } from "../disk/transcripts.js";
import { isValidSandAgentId } from "../paths.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgentNameRow = {
  id: string;
  name: string;
};

export type ResolveAgentOptions = {
  resolveDisk?: (needle: string) => { id: string } | null;
  listAgents?: () => Promise<AgentNameRow[]>;
};

export function isAgentIdRef(value: string): boolean {
  if (UUID_RE.test(value)) return true;
  return value.startsWith(SUBAGENT_PREFIX) && isValidSandAgentId(value);
}

export async function resolveAgentId(
  idOrName: string,
  options: ResolveAgentOptions = {},
): Promise<string> {
  const needle = idOrName.trim();
  if (needle.length === 0) {
    throw new Error("Agent name or id is required");
  }
  if (isAgentIdRef(needle)) return needle;

  const diskHit = options.resolveDisk?.(needle);
  if (diskHit != null) return diskHit.id;

  if (options.listAgents != null) {
    try {
      const agents = await options.listAgents();
      const lower = needle.toLowerCase();
      const byId = agents.find((agent) => agent.id === needle);
      if (byId != null) return byId.id;
      const byName = agents.find((agent) => agent.name.trim().toLowerCase() === lower);
      if (byName != null) return byName.id;
    } catch {
      // fall through to the same not-found error
    }
  }

  throw new Error(`No agent matching ${JSON.stringify(needle)}`);
}
