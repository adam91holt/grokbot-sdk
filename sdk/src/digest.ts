/**
 * Read-only fleet digest over real SDK methods. Formatter never prints
 * tokens, gateway.json secrets, chat bodies, lastMessagePreview, or
 * memory / automation prompt dumps.
 */
import type { GrokBot } from "./gateway/client.js";
import { parseHostModelSelection } from "./gateway/host-model.js";
import { outlineThinkingSteps } from "./gateway/outline.js";
import type { GrokBotDisk } from "./disk/index.js";

export const TOKEN_USAGE_NOTE = "Token usage is not exposed by the host API.";

export type DigestRosterRow = {
  id: string;
  name: string;
  isActive: boolean;
  isRunning: boolean;
  unreadCount: number;
  isGroup: boolean;
  memoryCount?: number;
  storeEntries?: number;
  transcriptBytes?: number;
};

export type DigestAutomationRow = {
  agentId: string;
  name: string;
  schedule: string;
  lastRunAt: number | null;
  isEnabled: boolean;
};

export type DigestListenerRow = {
  platform: string;
  isConnected: boolean;
  state: string;
  neededByCount: number;
};

export type DigestThinkingRow = {
  agentId: string;
  durationMs: number;
};

export type DigestView = {
  baseUrl: string;
  health?: {
    ok: boolean;
    isBusy: boolean;
    activeAgentId: string | null;
  };
  host?: {
    hostVersion: string | null;
    hostUpdateAvailable: boolean | null;
    isBusy: boolean;
    capabilities: string[];
  };
  agentDefaultModelId?: string;
  computerUseModelId?: string;
  roster: DigestRosterRow[];
  automations: DigestAutomationRow[];
  listeners: DigestListenerRow[];
  boxStore?: {
    durable: boolean;
    entryCount: number;
    storeDbEntries: number;
    totalBytes: number;
  };
  thinking: DigestThinkingRow[];
};

function isoOrDash(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "-";
  return new Date(value).toISOString();
}

export function formatDigest(data: DigestView): string {
  const lines: string[] = [];
  lines.push("Grok Bot digest");
  lines.push(`gateway  ${data.baseUrl}`);
  if (data.health != null) {
    lines.push(
      `health   ok=${data.health.ok} busy=${data.health.isBusy} active=${data.health.activeAgentId ?? "-"}`,
    );
  }
  if (data.host != null) {
    lines.push(
      `host     version=${data.host.hostVersion ?? "-"} update=${data.host.hostUpdateAvailable ?? "-"} busy=${data.host.isBusy}`,
    );
    if (data.host.capabilities.length > 0) {
      lines.push(`         capabilities=${data.host.capabilities.join(",")}`);
    }
  }
  if (data.agentDefaultModelId != null) {
    lines.push(`model    agentDefaultModel=${data.agentDefaultModelId}`);
  }
  if (data.computerUseModelId != null) {
    lines.push(`model    computerUseModel=${data.computerUseModelId}`);
  }

  lines.push(`roster   ${data.roster.length} agents`);
  const nameWidth = data.roster.reduce((max, row) => Math.max(max, row.name.length), 4);
  for (const row of data.roster) {
    const flags = [
      row.isActive ? "active" : "idle",
      row.isRunning ? "running" : "stopped",
      row.isGroup ? "group" : "agent",
      `unread=${row.unreadCount}`,
    ];
    if (row.memoryCount != null) flags.push(`memories=${row.memoryCount}`);
    if (row.storeEntries != null) flags.push(`store=${row.storeEntries}`);
    if (row.transcriptBytes != null) flags.push(`transcriptBytes=${row.transcriptBytes}`);
    lines.push(`  ${row.name.padEnd(nameWidth)}  ${row.id}  ${flags.join("  ")}`);
  }

  lines.push(`automations  ${data.automations.length}`);
  for (const row of data.automations) {
    const state = row.isEnabled ? "on" : "off";
    lines.push(
      `  ${state}  ${row.agentId}  ${row.name}  ${row.schedule || "-"}  lastRun=${isoOrDash(row.lastRunAt)}`,
    );
  }

  lines.push(`listeners  ${data.listeners.length}`);
  for (const row of data.listeners) {
    const linked = row.isConnected ? "connected" : "disconnected";
    lines.push(
      `  ${row.platform.padEnd(8)}  ${linked.padEnd(12)}  ${row.state.padEnd(10)}  neededBy=${row.neededByCount}`,
    );
  }

  if (data.boxStore != null) {
    lines.push(
      `boxStore durable=${data.boxStore.durable} entries=${data.boxStore.entryCount} storeDb=${data.boxStore.storeDbEntries} bytes=${data.boxStore.totalBytes}`,
    );
  }

  if (data.thinking.length > 0) {
    lines.push(`thinking  ${data.thinking.length} steps with durationMs`);
    for (const row of data.thinking) {
      lines.push(`  ${row.agentId}  durationMs=${row.durationMs}`);
    }
  }

  lines.push(TOKEN_USAGE_NOTE);
  return `${lines.join("\n")}\n`;
}

export async function collectDigest(bot: GrokBot, disk: GrokBotDisk): Promise<DigestView> {
  const health = await bot.health();
  const host = await bot.getHostStatus();
  const settings = await bot.getHostSettings();
  const agents = await bot.listAgents();
  const automations = await bot.listAllAutomations();
  const listeners = await bot.getListenerIntegrations();
  const boxStore = await bot.getBoxStoreStatus();

  const agentDefaultModel = parseHostModelSelection(settings.agentDefaultModel);
  const computerUseModel = parseHostModelSelection(settings.computerUseModel);

  const transcriptBytes = new Map(
    disk.listTranscripts({ skipSubagents: true }).map((row) => [row.agentId, row.bytes]),
  );

  const roster: DigestRosterRow[] = [];
  const thinking: DigestThinkingRow[] = [];

  for (const agent of agents) {
    let memoryCount: number | undefined;
    try {
      memoryCount = (await bot.getAgentMemories({ id: agent.id })).length;
    } catch {
      memoryCount = disk.listMemories(agent.id).length;
    }

    let storeEntries: number | undefined;
    try {
      const store = disk.openStore(agent.id);
      try {
        storeEntries = store.countEntries();
      } finally {
        store.close();
      }
    } catch {
      // store.db is optional
    }

    try {
      const outline = await bot.getConversationOutline({ id: agent.id });
      for (const step of outlineThinkingSteps(outline)) {
        thinking.push({ agentId: agent.id, durationMs: step.durationMs });
      }
    } catch {
      // outline is optional
    }

    roster.push({
      id: agent.id,
      name: agent.name,
      isActive: agent.isActive,
      isRunning: agent.isRunning,
      unreadCount: agent.unreadCount,
      isGroup: agent.isGroup,
      ...(memoryCount != null ? { memoryCount } : {}),
      ...(storeEntries != null ? { storeEntries } : {}),
      ...(transcriptBytes.has(agent.id) ? { transcriptBytes: transcriptBytes.get(agent.id) } : {}),
    });
  }

  return {
    baseUrl: bot.discovery().baseUrl,
    health: {
      ok: health.ok,
      isBusy: health.isBusy,
      activeAgentId: health.activeAgentId,
    },
    host: {
      hostVersion: host.hostVersion,
      hostUpdateAvailable: host.hostUpdateAvailable,
      isBusy: host.isBusy,
      capabilities: host.capabilities,
    },
    ...(agentDefaultModel != null ? { agentDefaultModelId: agentDefaultModel.modelId } : {}),
    ...(computerUseModel != null ? { computerUseModelId: computerUseModel.modelId } : {}),
    roster,
    automations: automations.map((row) => ({
      agentId: row.agentId,
      name: row.automation.name,
      schedule: row.automation.schedule,
      lastRunAt: row.automation.lastRunAt,
      isEnabled: row.automation.isEnabled,
    })),
    listeners: listeners.integrations.map((row) => ({
      platform: row.platform,
      isConnected: row.isConnected,
      state: row.state,
      neededByCount: row.neededByCount,
    })),
    boxStore: {
      durable: boxStore.durable,
      entryCount: boxStore.entryCount,
      storeDbEntries: boxStore.storeDbEntries,
      totalBytes: boxStore.totalBytes,
    },
    thinking,
  };
}
