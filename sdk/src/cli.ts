#!/home/box/.local/bin/node
/**
 * Thin CLI over the live gateway + disk readers.
 * Never prints gateway tokens. Transcript bodies only with --raw (and warns).
 */
import { readFile } from "node:fs/promises";
import { GrokBot, GrokBotGatewayError, discoveryFailureHint } from "./gateway/client.js";
import { formatCompatVerdict } from "./gateway/compat.js";
import { formatDiscussReceipt, formatOneShotReceipt, formatSendAsAgentReceipt } from "./gateway/oneshot.js";
import { formatDiscoveryOutput, formatHealthOutput, redactSecret } from "./gateway/discovery.js";
import { collectDigest, formatDigest } from "./digest.js";
import { formatJobList, formatJobRecord, getJob, listJobs, submitJob } from "./job/index.js";
import { GrokBotDisk } from "./disk/index.js";
import { summarizeContent } from "./disk/transcripts.js";
import { cliUsage, parseCliArgs } from "./cli-parse.js";
import { ENV_SAND_GATEWAY_TOKEN, resolveJobsDir } from "./paths.js";
import type { AgentSummary, DiskAutomation, DiskWorkflow, MemoryRecord } from "./types.js";

function printAgents(rows: Array<{ id: string; name: string }>): void {
  const width = rows.reduce((max, row) => Math.max(max, row.name.length), 4);
  for (const row of rows) {
    console.log(`${row.name.padEnd(width)}  ${row.id}`);
  }
}

async function cmdStatus(bot: GrokBot): Promise<void> {
  try {
    const health = await bot.health();
    const host = await bot.getHostStatus();
    const egressTunnel = await bot.isEgressTunnelAvailable();
    console.log(
      JSON.stringify(
        {
          baseUrl: bot.discovery().baseUrl,
          ok: health.ok,
          busy: health.isBusy,
          activeAgentId: health.activeAgentId,
          hostVersion: host.hostVersion,
          hostUpdateAvailable: host.hostUpdateAvailable,
          capabilities: host.capabilities,
          egressTunnel,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof GrokBotGatewayError && error.command === "discover") {
      console.error(error.message);
      console.error(error.hint ?? discoveryFailureHint());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function cmdTasks(bot: GrokBot, rest: string[]): Promise<void> {
  const agentRef = rest[0];
  if (agentRef == null) throw new Error("tasks requires <agentIdOrName>");
  const agentId = await bot.resolveAgent(agentRef);
  const [tasks, subagents] = await Promise.all([
    bot.getAsyncTasks({ id: agentId }),
    bot.getSubagents({ id: agentId }),
  ]);
  console.log(`# ${tasks.length} async tasks, ${subagents.length} subagents`);
  for (const task of tasks) {
    console.log(`${task.kind.padEnd(12)}  ${task.status.padEnd(8)}  ${task.id}`);
  }
  for (const sub of subagents) {
    console.log(
      `${"subagent".padEnd(12)}  ${sub.status.padEnd(8)}  ${sub.subagentId}  ${sub.subagentType}`,
    );
  }
}

async function cmdInterrupt(bot: GrokBot, rest: string[]): Promise<void> {
  const agentRef = rest[0];
  if (agentRef == null) throw new Error("interrupt requires <agentIdOrName>");
  const agentId = await bot.resolveAgent(agentRef);
  const result = await bot.interruptAgentRun({ id: agentId });
  console.log(JSON.stringify({ agentId, hadActiveRun: result.hadActiveRun }));
}

async function cmdMcp(bot: GrokBot): Promise<void> {
  const { servers } = await bot.listBoxMcpServers();
  console.log(`# ${servers.length} box MCP servers`);
  for (const server of servers) {
    console.log(`${server.status.padEnd(12)}  tools=${server.toolCount}  ${server.serverIdentifier}`);
  }
}

async function cmdListeners(bot: GrokBot): Promise<void> {
  const { integrations } = await bot.getListenerIntegrations();
  console.log(`# ${integrations.length} listener integrations`);
  for (const row of integrations) {
    const linked = row.isConnected ? "connected" : "disconnected";
    console.log(
      `${row.platform.padEnd(8)}  ${linked.padEnd(12)}  ${row.state.padEnd(10)}  neededBy=${row.neededByCount}`,
    );
  }
}

async function cmdCompat(bot: GrokBot): Promise<void> {
  try {
    const verdict = await bot.compat();
    process.stdout.write(formatCompatVerdict(verdict));
  } catch (error) {
    if (error instanceof GrokBotGatewayError && error.command === "discover") {
      console.error(error.message);
      console.error(error.hint ?? discoveryFailureHint());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function cmdHealth(bot: GrokBot): Promise<void> {
  try {
    const health = await bot.health();
    console.log(formatHealthOutput(bot.discovery().baseUrl, health));
  } catch (error) {
    if (error instanceof GrokBotGatewayError && error.command === "discover") {
      console.error(error.message);
      console.error(error.hint ?? discoveryFailureHint());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function cmdDiscovery(bot: GrokBot): void {
  try {
    console.log(formatDiscoveryOutput(bot.discovery()));
  } catch (error) {
    if (error instanceof GrokBotGatewayError && error.command === "discover") {
      console.error(error.message);
      console.error(error.hint ?? discoveryFailureHint());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function cmdAgents(bot: GrokBot, disk: GrokBotDisk): Promise<void> {
  try {
    const agents = await bot.listAgents();
    printAgents(agents.map((agent: AgentSummary) => ({ id: agent.id, name: agent.name })));
  } catch (error) {
    if (!(error instanceof GrokBotGatewayError)) throw error;
    console.error(`gateway listAgents failed (${error.status}); falling back to disk`);
    const agents = disk.listAgents();
    printAgents(
      agents.map((agent) => ({
        id: agent.id,
        name: agent.profile?.name.trim() || agent.id,
      })),
    );
  }
}

async function cmdSend(bot: GrokBot, rest: string[]): Promise<void> {
  const agentRef = rest[0];
  const prompt = rest.slice(1).join(" ").trim();
  if (agentRef == null || prompt.length === 0) {
    throw new Error("send requires <agentIdOrName> <prompt...>");
  }
  const agentId = await bot.resolveAgent(agentRef);
  const result = await bot.sendPrompt({ prompt, agentId });
  console.log(JSON.stringify({ agentId, accepted: result.accepted }));
}

async function cmdRunOnce(
  bot: GrokBot,
  rest: string[],
  flags: {
    from: string | null;
    name: string | null;
    purpose: string | null;
    timeoutMs: number | null;
    keepOnFailure: boolean;
    noReply: boolean;
  },
): Promise<void> {
  const prompt = rest.join(" ").trim();
  if (prompt.length === 0) {
    throw new Error("run-once requires <prompt...>");
  }
  const timeoutMs = flags.timeoutMs ?? undefined;
  const includeReply = flags.noReply ? false : undefined;
  const receipt =
    flags.from != null
      ? await bot.runOnceFrom({
          id: flags.from,
          prompt,
          timeoutMs,
          keepOnFailure: flags.keepOnFailure,
          ...(includeReply === false ? { includeReply: false } : {}),
        })
      : await bot.runOnce({
          prompt,
          timeoutMs,
          keepOnFailure: flags.keepOnFailure,
          ...(flags.name != null ? { name: flags.name } : {}),
          ...(flags.purpose != null ? { purpose: flags.purpose } : {}),
          ...(includeReply === false ? { includeReply: false } : {}),
        });
  process.stdout.write(formatOneShotReceipt(receipt));
}

async function cmdSendAs(
  bot: GrokBot,
  rest: string[],
  flags: {
    to: string | null;
    from: string | null;
    bus: string | null;
    name: string | null;
    timeoutMs: number | null;
    keepBus: boolean;
    noReply: boolean;
  },
): Promise<void> {
  const message = rest.join(" ").trim();
  if (flags.to == null || flags.to.trim().length === 0 || message.length === 0) {
    throw new Error("send-as requires --to <name-or-id> <message...>");
  }
  const receipt = await bot.sendAsAgent({
    to: flags.to,
    message,
    timeoutMs: flags.timeoutMs ?? undefined,
    keepBus: flags.keepBus,
    ...(flags.bus != null ? { bus: flags.bus } : {}),
    ...(flags.from != null ? { from: flags.from } : {}),
    ...(flags.name != null ? { name: flags.name } : {}),
    ...(flags.noReply ? { includeReply: false } : {}),
  });
  process.stdout.write(formatSendAsAgentReceipt(receipt));
}

async function cmdDiscuss(
  bot: GrokBot,
  rest: string[],
  flags: {
    froms: string[];
    name: string | null;
    timeoutMs: number | null;
    keepOnFailure: boolean;
    noReply: boolean;
  },
): Promise<void> {
  const prompt = rest.join(" ").trim();
  if (flags.froms.length === 0 || prompt.length === 0) {
    throw new Error("discuss requires --from <idOrName> (repeatable) <prompt...>");
  }
  const receipt = await bot.discussOnce({
    agents: flags.froms,
    prompt,
    timeoutMs: flags.timeoutMs ?? undefined,
    keepOnFailure: flags.keepOnFailure,
    ...(flags.name != null ? { name: flags.name } : {}),
    ...(flags.noReply ? { includeReply: false } : {}),
  });
  process.stdout.write(formatDiscussReceipt(receipt));
}

async function cmdMemories(bot: GrokBot, disk: GrokBotDisk, rest: string[]): Promise<void> {
  const agentRef = rest[0];
  if (agentRef == null) throw new Error("memories requires <agentIdOrName>");
  const agentId = await bot.resolveAgent(agentRef);
  let records: Array<Pick<MemoryRecord, "id" | "content" | "createdAt" | "kind">>;
  let source = "gateway";
  try {
    records = await bot.getAgentMemories({ id: agentId });
  } catch {
    source = "disk";
    records = disk.listMemories(agentId);
  }
  console.log(`# ${records.length} memories for ${agentId} via ${source}`);
  for (const memory of records) {
    const day = new Date(memory.createdAt).toISOString().slice(0, 10);
    console.log(`- [${memory.kind}] (${day}) ${memory.content}`);
  }
}

async function cmdTranscript(
  bot: GrokBot,
  disk: GrokBotDisk,
  rest: string[],
  tail: number | null,
  raw: boolean,
): Promise<void> {
  const agentRef = rest[0];
  if (agentRef == null) throw new Error("transcript requires <agentIdOrName>");
  const agentId = await bot.resolveAgent(agentRef);
  const lines = await disk.readTranscript(agentId, { tail: tail ?? 20, skipSubagents: true });
  if (raw) {
    console.error("warning: --raw prints transcript bodies (sensitive). do not paste into chat.");
  }
  console.log(`# ${lines.length} jsonl lines for ${agentId}${tail != null ? ` (tail ${tail})` : ""}`);
  for (const [i, line] of lines.entries()) {
    const content = Array.isArray(line.message.content) ? line.message.content : [];
    const summary = summarizeContent(content);
    if (raw) {
      console.log(JSON.stringify({ i, role: line.role, message: line.message }));
    } else {
      console.log(
        `${String(i).padStart(3)}  ${line.role.padEnd(9)}  text=${summary.texts} tools=${summary.toolUses.join(",") || "-"} results=${summary.toolResults.join(",") || "-"}`,
      );
    }
  }
  void bot;
}

function printAutomationWhen(row: DiskAutomation): string {
  if (row.schedule != null && row.schedule.length > 0) return row.schedule;
  const trigger = row.trigger;
  if (
    trigger != null &&
    typeof trigger === "object" &&
    !Array.isArray(trigger) &&
    "type" in trigger &&
    trigger.type === "once" &&
    "at" in trigger
  ) {
    return `once ${String((trigger as { at: unknown }).at)}`;
  }
  return trigger != null ? "trigger" : "-";
}

function printAutomation(row: DiskAutomation, raw: boolean): void {
  const when = printAutomationWhen(row);
  console.log(
    `${row.enabled ? "on " : "off"}  ${row.agentId}  ${row.id}  ${row.name}  ${when}`,
  );
  if (raw) {
    console.error("warning: --raw prints automation prompts (sensitive).");
    console.log(`       prompt: ${row.prompt}`);
  }
}

async function cmdAutomations(disk: GrokBotDisk, all: boolean, raw: boolean): Promise<void> {
  const rows = all
    ? disk.listAllAutomations()
    : (() => {
        const active = disk.getActiveAgentId();
        return active != null ? disk.listAutomations(active) : disk.listAllAutomations();
      })();
  console.log(`# ${rows.length} automations`);
  for (const row of rows) printAutomation(row, raw);
}

function printWorkflow(row: DiskWorkflow): void {
  console.log(`${row.slug}  ${row.name}  ${row.description || "-"}`);
}

function cmdWorkflows(disk: GrokBotDisk): void {
  const rows = disk.listWorkflows();
  console.log(`# ${rows.length} workflows`);
  for (const row of rows) printWorkflow(row);
}

async function cmdJob(bot: GrokBot, rest: string[], noReply: boolean): Promise<void> {
  const action = rest[0];
  const jobsDir = resolveJobsDir();
  if (action === "submit") {
    const file = rest[1];
    if (file == null || file.length === 0) {
      throw new Error("job submit requires <file.json>");
    }
    const raw = await readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`job file is not valid JSON: ${file}`);
    }
    const record = await submitJob(bot, parsed, { jobsDir });
    process.stdout.write(formatJobRecord(record, { noReply }));
    return;
  }
  if (action === "show") {
    const jobId = rest[1];
    if (jobId == null || jobId.length === 0) {
      throw new Error("job show requires <job_id>");
    }
    const record = await getJob(jobId, jobsDir);
    process.stdout.write(formatJobRecord(record, { noReply }));
    return;
  }
  if (action === "list") {
    const records = await listJobs(jobsDir);
    process.stdout.write(formatJobList(records));
    return;
  }
  throw new Error(`job requires submit <file.json> | show <job_id> | list\n${cliUsage()}`);
}

async function cmdDigest(bot: GrokBot, disk: GrokBotDisk): Promise<void> {
  try {
    const view = await collectDigest(bot, disk);
    process.stdout.write(formatDigest(view));
  } catch (error) {
    if (error instanceof GrokBotGatewayError && error.command === "discover") {
      console.error(error.message);
      console.error(error.hint ?? discoveryFailureHint());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === "help" || args.command === "") {
    process.stdout.write(cliUsage());
    return;
  }
  const bot = new GrokBot();
  const disk = new GrokBotDisk();
  switch (args.command) {
    case "health":
      await cmdHealth(bot);
      break;
    case "discovery":
      cmdDiscovery(bot);
      break;
    case "status":
      await cmdStatus(bot);
      break;
    case "compat":
      await cmdCompat(bot);
      break;
    case "agents":
      await cmdAgents(bot, disk);
      break;
    case "workflows":
      cmdWorkflows(disk);
      break;
    case "send":
      await cmdSend(bot, args.rest);
      break;
    case "run-once":
      await cmdRunOnce(bot, args.rest, {
        from: args.from,
        name: args.name,
        purpose: args.purpose,
        timeoutMs: args.timeoutMs,
        keepOnFailure: args.keepOnFailure,
        noReply: args.noReply,
      });
      break;
    case "discuss":
      await cmdDiscuss(bot, args.rest, {
        froms: args.froms,
        name: args.name,
        timeoutMs: args.timeoutMs,
        keepOnFailure: args.keepOnFailure,
        noReply: args.noReply,
      });
      break;
    case "send-as":
      await cmdSendAs(bot, args.rest, {
        to: args.to,
        from: args.from,
        bus: args.bus,
        name: args.name,
        timeoutMs: args.timeoutMs,
        keepBus: args.keepBus,
        noReply: args.noReply,
      });
      break;
    case "memories":
      await cmdMemories(bot, disk, args.rest);
      break;
    case "transcript":
      await cmdTranscript(bot, disk, args.rest, args.tail, args.raw);
      break;
    case "automations":
      await cmdAutomations(disk, args.all, args.raw);
      break;
    case "tasks":
      await cmdTasks(bot, args.rest);
      break;
    case "interrupt":
      await cmdInterrupt(bot, args.rest);
      break;
    case "mcp":
      await cmdMcp(bot);
      break;
    case "listeners":
      await cmdListeners(bot);
      break;
    case "digest":
      await cmdDigest(bot, disk);
      break;
    case "job":
      await cmdJob(bot, args.rest, args.noReply);
      break;
    default:
      throw new Error(`unknown command: ${args.command}\n${cliUsage()}`);
  }
}

main().catch((error: unknown) => {
  const token = process.env[ENV_SAND_GATEWAY_TOKEN];
  if (error instanceof GrokBotGatewayError) {
    const extra =
      error.requestId.length > 0
        ? ` (${error.command} status=${error.status} requestId=${error.requestId})`
        : "";
    console.error(redactSecret(`${error.message}${extra}`, token));
    if (error.hint != null) console.error(redactSecret(error.hint, token));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecret(message, token));
  }
  process.exitCode = 1;
});
