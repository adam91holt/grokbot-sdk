/**
 * Read-only scan of JSONL transcripts for a future dream job.
 * Counts roles and tool names. Does not print message bodies.
 */
import { GrokBotDisk, summarizeContent } from "../src/index.js";

const disk = new GrokBotDisk();
const files = disk.listTranscripts({ skipSubagents: true });

const tools = new Map<string, number>();
let userTurns = 0;
let assistantTurns = 0;
let lines = 0;

for (const file of files) {
  const rows = await disk.readTranscript(file.agentId, { skipSubagents: true });
  for (const row of rows) {
    lines += 1;
    if (row.role === "user") userTurns += 1;
    else if (row.role === "assistant") assistantTurns += 1;
    const summary = summarizeContent(row.message.content);
    for (const name of summary.toolUses) {
      tools.set(name, (tools.get(name) ?? 0) + 1);
    }
  }
}

const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(JSON.stringify({ transcripts: files.length, lines, userTurns, assistantTurns, uniqueTools: tools.size, topTools: Object.fromEntries(topTools) }, null, 2));
