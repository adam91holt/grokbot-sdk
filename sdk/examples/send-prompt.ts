import { GrokBot } from "../src/index.js";

const agentRef = process.argv[2];
const prompt = process.argv.slice(3).join(" ").trim();
if (agentRef == null || prompt.length === 0) {
  console.error("usage: send-prompt.ts <agentIdOrName> <prompt...>");
  process.exit(1);
}

const bot = new GrokBot();
const agentId = await bot.resolveAgent(agentRef);
const result = await bot.sendPrompt({ agentId, prompt });
console.log(JSON.stringify({ agentId, accepted: result.accepted }));
