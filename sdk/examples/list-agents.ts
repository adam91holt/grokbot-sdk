import { GrokBot, GrokBotDisk } from "../src/index.js";

const bot = new GrokBot();
const disk = new GrokBotDisk();

const health = await bot.health();
console.log(`gateway ok=${health.ok} busy=${health.isBusy} active=${health.activeAgentId ?? "-"}`);

const agents = await bot.listAgents();
for (const agent of agents) {
  console.log(`${agent.name}\t${agent.id}\t${agent.isGroup ? "group" : "agent"}`);
}

console.log(`disk agents: ${disk.listAgents().length}  active=${disk.getActiveAgentId() ?? "-"}`);
