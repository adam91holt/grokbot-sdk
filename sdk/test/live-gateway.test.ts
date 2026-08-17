/**
 * Opt-in live smoke against a real host. Off unless GROKBOT_LIVE=1 so CI
 * stays dummy. Asserts types/counts only — never prints tokens, prompts,
 * transcripts, or agent names.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GrokBot } from "../src/gateway/client.js";
import { ENV_GROKBOT_LIVE } from "../src/paths.js";

const live = process.env[ENV_GROKBOT_LIVE] === "1";

test("live gateway smoke (health + host status + roster count)", { skip: !live }, async () => {
  const bot = new GrokBot();
  const health = await bot.health();
  assert.equal(typeof health.ok, "boolean");
  assert.equal(typeof health.isBusy, "boolean");
  assert.equal(typeof health.pid, "number");
  assert.ok(health.ok);

  const host = await bot.getHostStatus();
  assert.equal(typeof host.isBusy, "boolean");
  assert.ok(Array.isArray(host.capabilities));

  const egress = await bot.isEgressTunnelAvailable();
  assert.equal(typeof egress, "boolean");

  const agents = await bot.listAgents();
  assert.ok(Array.isArray(agents));

  const mcp = await bot.listBoxMcpServers();
  assert.ok(Array.isArray(mcp.servers));

  const listeners = await bot.getListenerIntegrations();
  assert.ok(Array.isArray(listeners.integrations));

  const plugins = await bot.getPluginSyncStatus();
  assert.ok(Array.isArray(plugins.authBlocked));

  const store = await bot.getBoxStoreStatus();
  assert.equal(typeof store.durable, "boolean");
  assert.equal(typeof store.entryCount, "number");

  const first = agents[0];
  if (first != null && typeof first.id === "string" && first.id.length > 0) {
    const tasks = await bot.getAsyncTasks({ id: first.id });
    assert.ok(Array.isArray(tasks));
    const subagents = await bot.getSubagents({ id: first.id });
    assert.ok(Array.isArray(subagents));
    const channels = await bot.getAgentChannels({ id: first.id });
    assert.ok(Array.isArray(channels.manifests));
    assert.ok(Array.isArray(channels.connections));
  }
});
