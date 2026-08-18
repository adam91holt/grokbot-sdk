import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GrokBot, GrokBotGatewayError, parseSseBlock } from "../src/gateway/client.js";
import {
  GATEWAY_AUTH_SCHEME,
  GATEWAY_REQUEST_ID_HEADER,
  GATEWAY_SLIM_AVATARS_HEADER,
} from "../src/gateway/commands.js";

const MISSING_DISCOVERY = join(tmpdir(), "grokbot-sdk-missing-gateway.json");
const DUMMY_TOKEN = "dummy-test-token";

function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra };
}

function dummyBot(
  fetchImpl: typeof fetch,
  extra: { token?: string; gatewayUrl?: string; allowUnsafeCommands?: boolean } = {},
): GrokBot {
  return new GrokBot({
    gatewayUrl: extra.gatewayUrl ?? "http://127.0.0.1:1340",
    token: extra.token ?? DUMMY_TOKEN,
    env: isolatedEnv(),
    discoveryPath: MISSING_DISCOVERY,
    sandRoot: join(tmpdir(), "grokbot-sdk-missing-sand"),
    fetch: fetchImpl,
    ...(extra.allowUnsafeCommands === true ? { allowUnsafeCommands: true } : {}),
  });
}

test("health is unauthenticated; commands send Bearer and slim-avatars", async () => {
  const seen: Array<{ path: string; authorization: string | null; slim: string | null }> = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({
      path: url.pathname,
      authorization: headers.get("authorization"),
      slim: headers.get(GATEWAY_SLIM_AVATARS_HEADER),
    });
    assert.ok(headers.get(GATEWAY_REQUEST_ID_HEADER));
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          pid: 1,
          isBusy: false,
          activeAgentId: null,
          startedAt: 1,
          lastBusyAtMs: null,
        }),
        { status: 200 },
      );
    }
    return new Response("[]", { status: 200 });
  });

  await bot.health();
  await bot.listAgents();

  assert.equal(seen[0]?.path, "/health");
  assert.equal(seen[0]?.authorization, null);
  assert.equal(seen[1]?.path, "/api/listAgents");
  assert.equal(seen[1]?.authorization, `${GATEWAY_AUTH_SCHEME} ${DUMMY_TOKEN}`);
  assert.equal(seen[1]?.slim, "1");
  assert.equal(JSON.stringify(bot.discovery()).includes(DUMMY_TOKEN), false);
});

test("gateway errors never include the dummy token", async () => {
  const bot = dummyBot(async () => {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  });
  await assert.rejects(
    async () => bot.listAgents(),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.status, 401);
      assert.equal(error.command, "listAgents");
      assert.equal(error.message, "unauthorized");
      assert.equal(error.message.includes(DUMMY_TOKEN), false);
      assert.equal(JSON.stringify(error).includes(DUMMY_TOKEN), false);
      return true;
    },
  );
});

test("sugared agent commands send { id }, not agentId (createHostGatewayApi)", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    const name = url.pathname.slice("/api/".length);
    bodies.push({ name, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("null", { status: 200 });
  });

  await bot.getForeverBoxStatus({ id: "00000000-0000-4000-8000-0000000000aa" });
  await bot.kickstartAgent({ id: "00000000-0000-4000-8000-0000000000aa" });
  await bot.getAgentMemories({ id: "00000000-0000-4000-8000-0000000000aa" });
  await bot.getAgentChannels({ id: "00000000-0000-4000-8000-0000000000aa" });

  assert.deepEqual(
    bodies.map((row) => row.name),
    ["getForeverBoxStatus", "kickstartAgent", "getAgentMemories", "getAgentChannels"],
  );
  for (const row of bodies) {
    assert.deepEqual(row.body, { id: "00000000-0000-4000-8000-0000000000aa" });
    assert.equal(Object.hasOwn(row.body as object, "agentId"), false);
  }
});

test("status and import wrappers send host field names", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    const name = url.pathname.slice("/api/".length);
    bodies.push({ name, body: JSON.parse(String(init?.body ?? "{}")) });
    if (name === "isEgressTunnelAvailable") return new Response("false", { status: 200 });
    if (name === "listBoxMcpServers") return new Response(JSON.stringify({ servers: [] }), { status: 200 });
    if (name === "getPluginSyncStatus") {
      return new Response(JSON.stringify({ authBlocked: [] }), { status: 200 });
    }
    if (name === "getListenerIntegrations") {
      return new Response(JSON.stringify({ integrations: [] }), { status: 200 });
    }
    if (name === "getListenerConnectUrl") {
      return new Response(JSON.stringify({ url: "https://example.invalid/integrations" }), { status: 200 });
    }
    if (name === "getBoxStoreStatus") {
      return new Response(
        JSON.stringify({
          durable: false,
          fullyHydrated: undefined,
          entryCount: 0,
          storeDbEntries: 0,
          agentDirEntries: 0,
          totalBytes: 0,
          lastSnapshotAtMs: 0,
        }),
        { status: 200 },
      );
    }
    if (name === "requestDiskSaverAudit") {
      return new Response(JSON.stringify({ isAuditInFlight: false }), { status: 200 });
    }
    if (name === "openAgentWindowed" || name === "openAgentTail") {
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }
    if (
      name === "importAgentWorkflowText" ||
      name === "importAgentWorkflowUrl" ||
      name === "portAgentLocalSkills"
    ) {
      return new Response(
        JSON.stringify({ workflows: [], result: { imported: [], skipped: [] } }),
        { status: 200 },
      );
    }
    return new Response("null", { status: 200 });
  });

  const agentId = "00000000-0000-4000-8000-0000000000aa";
  assert.equal(await bot.isEgressTunnelAvailable(), false);
  assert.deepEqual(await bot.listBoxMcpServers(), { servers: [] });
  assert.deepEqual(await bot.listBoxMcpServers({}), { servers: [] });
  assert.deepEqual(await bot.listBoxMcpServers({ serverIdentifiers: ["cursor-ide-browser"] }), {
    servers: [],
  });
  assert.deepEqual(await bot.getPluginSyncStatus(), { authBlocked: [] });
  assert.deepEqual(await bot.getListenerIntegrations(), { integrations: [] });
  assert.deepEqual(await bot.getListenerConnectUrl({ platform: "slack" }), {
    url: "https://example.invalid/integrations",
  });
  const store = await bot.getBoxStoreStatus();
  assert.equal(store.durable, false);
  assert.equal(store.entryCount, 0);
  assert.deepEqual(await bot.requestDiskSaverAudit({ id: agentId }), { isAuditInFlight: false });
  assert.deepEqual(await bot.openAgentWindowed({ id: agentId, limit: 40 }), { entries: [] });
  assert.deepEqual(await bot.openAgentTail({ id: agentId, limit: 80 }), { entries: [] });
  assert.deepEqual(await bot.importAgentWorkflowText({ id: agentId, markdown: "# dummy", name: "dummy" }), {
    workflows: [],
    result: { imported: [], skipped: [] },
  });
  assert.deepEqual(await bot.importAgentWorkflowUrl({ id: agentId, url: "https://example.invalid/skill.md" }), {
    workflows: [],
    result: { imported: [], skipped: [] },
  });
  assert.deepEqual(await bot.portAgentLocalSkills({ id: agentId }), {
    workflows: [],
    result: { imported: [], skipped: [] },
  });

  const byName = Object.fromEntries(bodies.map((row) => [row.name, row.body]));
  assert.deepEqual(byName.isEgressTunnelAvailable, {});
  const mcpBodies = bodies.filter((row) => row.name === "listBoxMcpServers").map((row) => row.body);
  assert.deepEqual(mcpBodies, [
    { serverIdentifiers: [] },
    { serverIdentifiers: [] },
    { serverIdentifiers: ["cursor-ide-browser"] },
  ]);
  assert.deepEqual(byName.getListenerConnectUrl, { platform: "slack" });
  assert.deepEqual(byName.requestDiskSaverAudit, { id: agentId });
  assert.deepEqual(byName.openAgentWindowed, { id: agentId, limit: 40 });
  assert.deepEqual(byName.openAgentTail, { id: agentId, limit: 80 });
  assert.deepEqual(byName.importAgentWorkflowText, { id: agentId, markdown: "# dummy", name: "dummy" });
  assert.deepEqual(byName.importAgentWorkflowUrl, {
    id: agentId,
    url: "https://example.invalid/skill.md",
  });
  assert.deepEqual(byName.portAgentLocalSkills, { id: agentId });
  assert.equal(Object.hasOwn(byName.requestDiskSaverAudit as object, "agentId"), false);
});

test("createAgentAutomation / updateAgentAutomation translate once to dated cron and refuse group once", async () => {
  const seen: unknown[] = [];
  const bot = dummyBot(async (_input, init) => {
    seen.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response("[]", { status: 200 });
  });
  const agentId = "00000000-0000-4000-8000-0000000000aa";
  const onceSpec = {
    name: "dummy once",
    prompt: "ping",
    trigger: { type: "once" as const, at: "2026-08-18T18:43:00+12:00" },
  };
  await bot.createAgentAutomation({
    id: agentId,
    spec: onceSpec,
  });
  await bot.updateAgentAutomation({
    id: agentId,
    automationId: "dummy-auto",
    spec: onceSpec,
  });
  const created = seen[0] as { spec?: { trigger?: unknown } };
  const updated = seen[1] as { spec?: { trigger?: unknown } };
  assert.deepEqual(created.spec?.trigger, { type: "cron", schedule: "43 18 18 8 *" });
  assert.deepEqual(updated.spec?.trigger, { type: "cron", schedule: "43 18 18 8 *" });
  await assert.rejects(
    async () =>
      await bot.createAgentAutomation({
        id: agentId,
        spec: {
          name: "dummy",
          prompt: "ping",
          trigger: [{ type: "once", at: "2026-08-18T18:43:00.000Z" }, { type: "slack" }],
        } as never,
      }),
    /group\/list member/,
  );
});

test("searchMedia request matches host searchMedia(args.query, args.limit)", async () => {
  let body: unknown;
  const bot = dummyBot(async (_input, init) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return new Response("[]", { status: 200 });
  });
  const rows = await bot.searchMedia({ query: "dummy-media", limit: 3 });
  assert.deepEqual(body, { query: "dummy-media", limit: 3 });
  assert.deepEqual(rows, []);
});

test("parseSseBlock matches host openSseStream data frames and ignores keepalives", () => {
  assert.equal(parseSseBlock("retry: 1000"), null);
  assert.equal(parseSseBlock(":ping"), null);
  assert.deepEqual(parseSseBlock('data: {"channel":"agents","payload":{"ok":true}}'), {
    channel: "agents",
    payload: { ok: true },
  });
  // WHATWG CRLF — leftover \\r must not break JSON.parse.
  assert.deepEqual(parseSseBlock('data: {"channel":"transcript","payload":1}\r'), {
    channel: "transcript",
    payload: 1,
  });
});

test("events() parses host-shaped SSE and filters via ?channels=", async () => {
  const frames = [
    "retry: 1000\n\n",
    ":ping\n\n",
    'data: {"channel":"agents","payload":{"agents":[]}}\n\n',
    'data: {"channel":"transcript","payload":{"n":1}}\r\n\r\n',
  ].join("");
  let requested: string | undefined;
  const bot = dummyBot(async (input) => {
    requested = String(input);
    return new Response(frames, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });

  const events = [];
  for await (const event of bot.events(["agents", "transcript"])) {
    events.push(event);
  }
  assert.equal(
    requested,
    "http://127.0.0.1:1340/events?channels=agents%2Ctranscript",
  );
  assert.deepEqual(events, [
    { channel: "agents", payload: { agents: [] } },
    { channel: "transcript", payload: { n: 1 } },
  ]);
});

test("setAgentNotificationsEnabled is distinct from setAgentNotifyOnUpdates", async () => {
  const seen: Array<{ name: string; body: unknown }> = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    seen.push({
      name: url.pathname.slice("/api/".length),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response("null", { status: 200 });
  });
  const id = "00000000-0000-4000-8000-0000000000aa";
  assert.equal(await bot.setAgentNotificationsEnabled({ id, isEnabled: true }), null);
  assert.equal(await bot.setAgentNotifyOnUpdates({ id, isEnabled: false }), null);
  assert.deepEqual(seen, [
    { name: "setAgentNotificationsEnabled", body: { id, isEnabled: true } },
    { name: "setAgentNotifyOnUpdates", body: { id, isEnabled: false } },
  ]);
});

test("typed methods resolve a roster name and still POST { id }", async () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  const seen: Array<{ name: string; body: unknown }> = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    const name = url.pathname.slice("/api/".length);
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ name, body });
    if (name === "listAgents") {
      return new Response(
        JSON.stringify([{ id, name: "Dummy Agent" }]),
        { status: 200 },
      );
    }
    if (name === "getAgentMemories") return new Response("[]", { status: 200 });
    if (name === "sendPrompt") return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    if (name === "getConversationOutline") {
      return new Response(
        JSON.stringify([
          { kind: "thinking", id: "t1", text: "secret-thought", durationMs: 12 },
          { kind: "thinking", id: "t2", text: "ignored", durationMs: 0 },
        ]),
        { status: 200 },
      );
    }
    return new Response("null", { status: 200 });
  });

  assert.deepEqual(await bot.getAgentMemories({ id: "Dummy Agent" }), []);
  const sent = await bot.sendPrompt({ agentId: "Dummy Agent", prompt: "status only" });
  assert.deepEqual(sent, { accepted: true });
  const outline = await bot.getConversationOutline({ id: "Dummy Agent" });
  assert.deepEqual(outline, [
    { kind: "thinking", id: "t1", text: "secret-thought", durationMs: 12 },
    { kind: "thinking", id: "t2", text: "ignored" },
  ]);

  const memories = seen.find((row) => row.name === "getAgentMemories");
  const prompt = seen.find((row) => row.name === "sendPrompt");
  const outlineReq = seen.find((row) => row.name === "getConversationOutline");
  assert.deepEqual(memories?.body, { id });
  assert.equal(Object.hasOwn(memories?.body as object, "agentId"), false);
  assert.deepEqual(prompt?.body, { agentId: id, prompt: "status only" });
  assert.deepEqual(outlineReq?.body, { id });
});

test("command() omits JSON when body is undefined instead of sending {}", async () => {
  let seen: { body: unknown; contentType: string | null } | undefined;
  const bot = dummyBot(async (_input, init) => {
    const headers = new Headers(init?.headers);
    seen = { body: init?.body, contentType: headers.get("content-type") };
    return new Response("null", { status: 200 });
  });
  await bot.command("listAgents");
  assert.equal(seen?.body, undefined);
  assert.equal(seen?.contentType, null);
});

test("command() sends a real caller object when one is passed", async () => {
  let body: unknown;
  const bot = dummyBot(async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response("null", { status: 200 });
  });
  await bot.command("listAgents", {});
  assert.deepEqual(body, {});
});

test("command() denies unsafe names by default and allows with opt-in", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    return new Response("null", { status: 200 });
  };
  const denied = dummyBot(fetchImpl);
  await assert.rejects(
    () => denied.command("resetForeverBox", { id: "dummy" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /resetForeverBox/);
      assert.match(error.message, /allowUnsafeCommands|commandUnsafe/);
      return true;
    },
  );
  await assert.rejects(
    () => denied.command("connectChannel", { id: "dummy" }),
    /connectChannel/,
  );
  assert.deepEqual(seen, []);

  const allowed = dummyBot(fetchImpl, { allowUnsafeCommands: true });
  await allowed.command("resetForeverBox", { id: "dummy" });
  assert.deepEqual(seen, ["/api/resetForeverBox"]);

  const viaUnsafe = dummyBot(fetchImpl);
  await viaUnsafe.commandUnsafe("clearBoxStoreNow");
  assert.deepEqual(seen, ["/api/resetForeverBox", "/api/clearBoxStoreNow"]);
});

test("command() allows unknown non-unsafe names without the unsafe flag", async () => {
  let path: string | undefined;
  const bot = dummyBot(async (input) => {
    path = new URL(String(input)).pathname;
    return new Response("null", { status: 200 });
  });
  await bot.command("futureHostCommand", { foo: 1 });
  assert.equal(path, "/api/futureHostCommand");
});

test("UUID agent refs skip listAgents", async () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  const names: string[] = [];
  const bot = dummyBot(async (input, init) => {
    const url = new URL(String(input));
    const name = url.pathname.slice("/api/".length);
    names.push(name);
    void init;
    return new Response("[]", { status: 200 });
  });
  await bot.getAgentMemories({ id });
  assert.deepEqual(names, ["getAgentMemories"]);
});
