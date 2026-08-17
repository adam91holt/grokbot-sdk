import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tmpdir } from "node:os";
import {
  DESTRUCTIVE_GATEWAY_COMMANDS,
  SAND_GATEWAY_COMMANDS,
} from "../src/gateway/commands.js";
import { GrokBot, GrokBotGatewayError } from "../src/gateway/client.js";
import {
  DEFAULT_GATEWAY_TIMEOUT_MS,
  resolveGatewayTimeoutMs,
} from "../src/gateway/abort.js";
import { extractGatewayCommandNames } from "../scripts/extract-host-manifest.js";
import "../src/gateway/typed-wrappers.js";

const MISSING_DISCOVERY = join(tmpdir(), "grokbot-sdk-missing-gateway.json");
const DUMMY_TOKEN = "dummy-test-token";

const here = dirname(fileURLToPath(import.meta.url));
const HOST_MAIN = join(here, "..", "..", "host", "host-main.cjs");
const HAS_HOST_SNAPSHOT = existsSync(HOST_MAIN);

test("SAND_GATEWAY_COMMANDS matches host-main.cjs table keys", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const source = readFileSync(HOST_MAIN, "utf8");
  const hostNames = extractGatewayCommandNames(source);
  assert.deepEqual([...SAND_GATEWAY_COMMANDS], hostNames);
});

test("destructive commands stay on the table but are not GrokBot methods", () => {
  for (const name of DESTRUCTIVE_GATEWAY_COMMANDS) {
    assert.ok(
      (SAND_GATEWAY_COMMANDS as readonly string[]).includes(name),
      `${name} missing from SAND_GATEWAY_COMMANDS`,
    );
    assert.equal(
      typeof (GrokBot.prototype as unknown as Record<string, unknown>)[name],
      "undefined",
      `${name} must not be a first-class GrokBot method`,
    );
  }
  assert.equal(typeof GrokBot.prototype.command, "function");
  assert.equal(
    (SAND_GATEWAY_COMMANDS as readonly string[]).includes("sendToAgent"),
    false,
    "host has no sendToAgent command; peer send is the SendToAgent tool via sendAsAgent",
  );
});

test("resolveGatewayTimeoutMs defaults unary to 30s and leaves streams open", () => {
  assert.equal(resolveGatewayTimeoutMs(undefined, undefined, true), DEFAULT_GATEWAY_TIMEOUT_MS);
  assert.equal(resolveGatewayTimeoutMs(undefined, undefined, false), undefined);
  assert.equal(resolveGatewayTimeoutMs(0, undefined, true), undefined);
  assert.equal(resolveGatewayTimeoutMs(5_000, 30_000, true), 5_000);
  assert.equal(resolveGatewayTimeoutMs(undefined, 12_000, false), 12_000);
});

test("GrokBotGatewayError from HTTP includes status command and request id", async () => {
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    token: DUMMY_TOKEN,
    discoveryPath: MISSING_DISCOVERY,
    fetch: async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
  });
  await assert.rejects(
    () => bot.command("listAgents", {}),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.status, 401);
      assert.equal(error.command, "listAgents");
      assert.match(error.requestId, /^[0-9a-f-]{36}$/i);
      assert.equal(error.message, "unauthorized");
      assert.equal(error.hint, undefined);
      assert.equal(JSON.stringify(error).includes(DUMMY_TOKEN), false);
      assert.equal(error.message.includes(DUMMY_TOKEN), false);
      return true;
    },
  );
});

test("GrokBot times out a hung host", async () => {
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    discoveryPath: MISSING_DISCOVERY,
    timeoutMs: 25,
    fetch: async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
  });
  await assert.rejects(
    () => bot.health(),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.status, 0);
      assert.equal(error.command, "health");
      assert.match(error.requestId, /^[0-9a-f-]{36}$/i);
      assert.match(error.message, /timed out after 25ms/);
      return true;
    },
  );
});

test("GrokBot times out even when fetch ignores AbortSignal", async () => {
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    discoveryPath: MISSING_DISCOVERY,
    timeoutMs: 25,
    fetch: async () => await new Promise<Response>(() => {}),
  });
  await assert.rejects(
    () => bot.health(),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.command, "health");
      assert.match(error.message, /timed out after 25ms/);
      return true;
    },
  );
});

test("GrokBot honors AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort();
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    discoveryPath: MISSING_DISCOVERY,
    signal: controller.signal,
    timeoutMs: 5_000,
    fetch: async () => {
      throw new Error("fetch should not run after abort");
    },
  });
  await assert.rejects(
    () => bot.listAgents(),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.status, 0);
      assert.equal(error.command, "listAgents");
      assert.match(error.message, /aborted/);
      return true;
    },
  );
});

test("typed wrappers exist for the high-value subset", () => {
  const wrappers = [
    "listAgents",
    "sendPrompt",
    "promptAcceptanceStatus",
    "kickstartAgent",
    "getAgentChannels",
    "getSubagents",
    "getAsyncTasks",
    "isAgentNetworkEnabled",
    "isGlobalSearchEnabled",
    "isEgressTunnelAvailable",
    "getAgentAvatar",
    "getHostStatus",
    "getBoxStoreStatus",
    "listBoxMcpServers",
    "setAgentNotificationsEnabled",
    "setAgentNotifyOnUpdates",
    "getPluginSyncStatus",
    "getListenerIntegrations",
    "getListenerConnectUrl",
    "requestDiskSaverAudit",
    "openAgentWindowed",
    "openAgentTail",
    "importAgentWorkflowText",
    "importAgentWorkflowUrl",
    "portAgentLocalSkills",
    "skillsCatalog",
    "waitForIdle",
    "runOnce",
    "runOnceFrom",
    "runOnceLike",
    "discussOnce",
    "runOnceDiscuss",
    "sendAsAgent",
    "runOnceSendToAgent",
  ] as const;
  for (const name of wrappers) {
    assert.equal(
      typeof (GrokBot.prototype as unknown as Record<string, unknown>)[name],
      "function",
      `${name} should be a first-class wrapper`,
    );
  }
});
