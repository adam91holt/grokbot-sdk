import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { GrokBot } from "../src/gateway/client.js";
import {
  CREATE_AGENT_DEFAULT_NAME_PREFIX,
  DISCUSS_ONCE_DEFAULT_NAME_PREFIX,
  SEND_AS_AGENT_DEFAULT_NAME_PREFIX,
  entriesFromTranscriptPayload,
  formatDiscussReceipt,
  formatOneShotReceipt,
  formatSendAsAgentReceipt,
  lastAssistantTextFromEntries,
  resolveCreateAgentDescription,
  resolveCreateAgentName,
  resolveDiscussOnceName,
  resolveSendAsAgentName,
  sendAsAgentPrompt,
  toHostCreateAgentBody,
  toHostSendPromptBody,
  turnsFromTranscriptEntries,
} from "../src/gateway/oneshot.js";
import { HOST_ACCOUNT_SLOT, type AgentSummary } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOST_MAIN = join(here, "..", "..", "host", "host-main.cjs");
const HAS_HOST_SNAPSHOT = existsSync(HOST_MAIN);
const MISSING_DISCOVERY = join(tmpdir(), "grokbot-sdk-missing-gateway.json");
const DUMMY_TOKEN = "dummy-test-token";
const AGENT_ID = "00000000-0000-4000-8000-0000000000aa";
const CLONE_ID = "00000000-0000-4000-8000-0000000000bb";
const SOURCE_ID = "00000000-0000-4000-8000-0000000000cc";
const SOURCE_B_ID = "00000000-0000-4000-8000-0000000000dd";
const CLONE_B_ID = "00000000-0000-4000-8000-0000000000ee";
const GROUP_ID = "00000000-0000-4000-8000-0000000000ff";
const EXISTING_GROUP_ID = "00000000-0000-4000-8000-000000000011";
const BUS_ID = "00000000-0000-4000-8000-000000000022";
const TARGET_ID = "00000000-0000-4000-8000-000000000033";
const REPLY_TEXT = "the actual last assistant reply";
const MEMBER_A_TEXT = "first member line from Elon copy";
const MEMBER_B_TEXT = "second member line from Chief of Staff copy";

const FAKE_TAIL = {
  entries: [
    { kind: "message", role: "user", content: "status only" },
    { kind: "tool-call", name: "shell", status: "done" },
    { kind: "send-message", message: { type: "widget", widget: { prompt: "ask" } } },
    { kind: "send-message", message: { type: "text", content: REPLY_TEXT } },
    { kind: "notice", text: "ignored" },
    null,
    "junk",
    { kind: "unknown-kind" },
  ],
};

function dummyAgent(overrides: Partial<AgentSummary> & { id: string }): AgentSummary {
  return {
    name: "Dummy",
    description: "",
    title: "",
    avatarDataUrl: null,
    avatarVersion: null,
    avatarShape: null,
    avatarColor: null,
    createdAt: 1,
    updatedAt: 1,
    path: "/tmp/dummy",
    isActive: false,
    isRunning: false,
    isComposingMessage: false,
    lastEntry: null,
    lastMessageId: null,
    lastMessagePreview: null,
    lastMessageAuthorId: null,
    newestEntryId: null,
    hasUnread: false,
    unreadCount: 0,
    awaitingUserResponse: null,
    notificationsEnabled: false,
    notifyOnUpdatesEnabled: true,
    isHiddenFromSidebar: false,
    origin: "user",
    isGroup: false,
    memberIds: [],
    conversationPartnerIds: [],
    ...overrides,
  };
}

type Handler = (body: unknown, n: number) => unknown;

function fixtureBot(handlers: Record<string, Handler>): { bot: GrokBot; calls: string[] } {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    token: DUMMY_TOKEN,
    env: {},
    discoveryPath: MISSING_DISCOVERY,
    sandRoot: join(tmpdir(), "grokbot-sdk-missing-sand"),
    fetch: async (input, init) => {
      const name = new URL(String(input)).pathname.slice("/api/".length);
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      calls.push(name);
      const body = init?.body != null ? JSON.parse(String(init.body)) : undefined;
      const handler = handlers[name];
      if (handler == null) {
        return new Response(JSON.stringify({ error: `unexpected ${name}` }), { status: 500 });
      }
      return new Response(JSON.stringify(handler(body, n)), { status: 200 });
    },
  });
  return { bot, calls };
}

test("HOST_ACCOUNT_SLOT matches host-main.cjs", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const source = readFileSync(HOST_MAIN, "utf8");
  assert.match(source, /var HOST_ACCOUNT_SLOT = "host"/);
  assert.equal(HOST_ACCOUNT_SLOT, "host");
});

test("host cloneAgent copies store/automations and leaves memory/ behind", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const source = readFileSync(HOST_MAIN, "utf8");
  const start = source.indexOf("function cloneAgentDir(");
  const rewrite = source.indexOf("function rewriteClonedAgentIdentity(");
  const cloneAgent = source.indexOf("async cloneAgent(sourceId)");
  assert.ok(start > 0 && rewrite > 0 && cloneAgent > 0);
  const cloneDir = source.slice(start, start + 1800);
  assert.match(cloneDir, /cloneStoreDb/);
  assert.match(cloneDir, /writeClonedProfile/);
  assert.match(cloneDir, /hiddenFromSidebar: false/);
  assert.match(cloneDir, /cloneAvatarFiles/);
  assert.match(cloneDir, /cloneAutomations/);
  assert.match(cloneDir, /rewriteClonedAgentIdentity\(targetDir, newAgentId, false\)/);
  assert.equal(cloneDir.includes("getAgentMemoryDir"), false);
  assert.equal(cloneDir.includes("MEMORY_DIRNAME"), false);
  assert.match(source.slice(rewrite, rewrite + 800), /if \(!includesChatHistory\) db\.clearConversation\(\)/);
  assert.match(source.slice(cloneAgent, cloneAgent + 1600), /Groups can't be duplicated yet/);
  assert.match(source.slice(cloneAgent - 600, cloneAgent + 200), /NO chat history or/);
  assert.match(source.slice(cloneAgent - 600, cloneAgent + 400), /attachments are deliberately left behind/);
});

test("waitForIdle becomes idle after running and composing clear", async () => {
  const { bot } = fixtureBot({
    listAgents: (_body, n) => [
      dummyAgent({
        id: AGENT_ID,
        isRunning: n < 3,
        isComposingMessage: n === 1,
      }),
    ],
    getAsyncTasks: () => [],
    getSubagents: () => [],
  });
  const result = await bot.waitForIdle({ id: AGENT_ID, intervalMs: 1, timeoutMs: 2_000 });
  assert.equal(result.status, "idle");
  assert.equal(result.id, AGENT_ID);
  assert.equal(result.isRunning, false);
  assert.equal(result.isComposingMessage, false);
  assert.equal(result.asyncTaskCount, 0);
  assert.equal(result.runningSubagentCount, 0);
  assert.ok(result.elapsedMs >= 0);
  assert.equal(Object.hasOwn(result, "lastMessagePreview"), false);
});

test("waitForIdle returns awaiting-user instead of idle", async () => {
  const { bot } = fixtureBot({
    listAgents: () => [
      dummyAgent({
        id: AGENT_ID,
        awaitingUserResponse: { tabId: "widget", reason: "ask", since: 1 },
      }),
    ],
    getAsyncTasks: () => [],
    getSubagents: () => [],
  });
  const result = await bot.waitForIdle({ id: AGENT_ID, intervalMs: 1, timeoutMs: 500 });
  assert.equal(result.status, "awaiting-user");
  assert.deepEqual(result.awaitingUserResponse, { tabId: "widget", reason: "ask", since: 1 });
});

test("waitForIdle stays busy while async tasks or running subagents exist", async () => {
  const { bot } = fixtureBot({
    listAgents: () => [dummyAgent({ id: AGENT_ID })],
    getAsyncTasks: (_body, n) =>
      n < 2 ? [{ kind: "shell", id: "t1", label: "sh", status: "running", startedAtMs: 1 }] : [],
    getSubagents: (_body, n) =>
      n < 3
        ? [{ subagentId: "s1", subagentType: "explore", title: "x", status: "running", startedAtMs: 1 }]
        : [{ subagentId: "s1", subagentType: "explore", title: "x", status: "done", startedAtMs: 1 }],
  });
  const result = await bot.waitForIdle({ id: AGENT_ID, intervalMs: 1, timeoutMs: 2_000 });
  assert.equal(result.status, "idle");
  assert.equal(result.runningSubagentCount, 0);
});

test("waitForIdle timeout is typed unless throwOnTimeout", async () => {
  const { bot } = fixtureBot({
    listAgents: () => [dummyAgent({ id: AGENT_ID, isRunning: true })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
  });
  const timed = await bot.waitForIdle({ id: AGENT_ID, intervalMs: 1, timeoutMs: 20 });
  assert.equal(timed.status, "timeout");
  assert.equal(timed.isRunning, true);
  await assert.rejects(
    () => bot.waitForIdle({ id: AGENT_ID, intervalMs: 1, timeoutMs: 20, throwOnTimeout: true }),
    /timed out after 20ms/,
  );
});

test("waitForIdle uses HOST_ACCOUNT_SLOT when a nonce is passed", async () => {
  const seen: unknown[] = [];
  const { bot } = fixtureBot({
    listAgents: (_body, n) => [dummyAgent({ id: AGENT_ID, isRunning: n < 2 })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: (body) => {
      seen.push(body);
      return {
        outcome: "found",
        record: {
          accountSlot: HOST_ACCOUNT_SLOT,
          clientNonce: "nonce-1",
          inputDigest: "d",
          status: "accepted",
          acceptedAtMs: 1,
          agentId: AGENT_ID,
          echoEntryId: null,
          rejectionCode: null,
        },
      };
    },
  });
  const result = await bot.waitForIdle({
    id: AGENT_ID,
    clientNonce: "nonce-1",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(result.status, "idle");
  assert.deepEqual(seen[0], { accountSlot: HOST_ACCOUNT_SLOT, clientNonce: "nonce-1" });
});

test("runOnce create → send with nonce → wait → deleteAgent", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    createAgent: (body) => {
      bodies.push({ name: "createAgent", body });
      return { agent: dummyAgent({ id: AGENT_ID, name: "tmp" }) };
    },
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    listAgents: (_body, n) => [
      dummyAgent({ id: AGENT_ID, isRunning: n < 2, lastMessagePreview: "roster snippet…" }),
    ],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: (body) => {
      bodies.push({ name: "getAgentTranscriptTail", body });
      return FAKE_TAIL;
    },
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
  });
  const receipt = await bot.runOnce({
    prompt: "status only",
    name: "tmp",
    purpose: "disk-saver",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.id, AGENT_ID);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.status, "idle");
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.reply, REPLY_TEXT);
  assert.equal(Object.hasOwn(receipt, "lastMessagePreview"), false);
  assert.ok(receipt.elapsedMs >= 0);
  assert.equal(calls.includes("deleteAgents"), false);
  assert.equal(calls.includes("sendPrompt"), true);
  assert.equal(calls.includes("getAgentTranscriptTail"), true);
  const tailBeforeDelete =
    calls.lastIndexOf("getAgentTranscriptTail") < calls.lastIndexOf("deleteAgent");
  assert.equal(tailBeforeDelete, true);
  const created = bodies.find((row) => row.name === "createAgent")?.body as {
    isIntroductionSuppressed?: boolean;
    name?: string;
    description?: string;
    purpose?: string;
  };
  assert.equal(created.isIntroductionSuppressed, true);
  assert.equal(created.name, "tmp");
  assert.equal(created.description, "");
  assert.equal(created.purpose, "disk-saver");
  const sent = bodies.find((row) => row.name === "sendPrompt")?.body as {
    agentId: string;
    prompt: string;
    clientNonce?: string;
  };
  assert.equal(sent.agentId, AGENT_ID);
  assert.equal(sent.prompt, "status only");
  assert.equal(typeof sent.clientNonce, "string");
  assert.ok((sent.clientNonce ?? "").length > 0);
  assert.deepEqual(bodies.find((row) => row.name === "deleteAgent")?.body, { id: AGENT_ID });
  const printed = formatOneShotReceipt(receipt);
  assert.equal(printed.includes("lastMessagePreview"), false);
  assert.equal(printed.includes("roster snippet"), false);
  assert.equal(printed.includes("token"), false);
  assert.equal(printed.includes("status only"), false);
  assert.equal(printed.includes(REPLY_TEXT), true);
  assert.deepEqual(bodies.find((row) => row.name === "getAgentTranscriptTail")?.body, {
    id: AGENT_ID,
    limit: 50,
  });
});

test("runOnce with only a prompt mints name and defaults description", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot } = fixtureBot({
    createAgent: (body) => {
      bodies.push({ name: "createAgent", body });
      return { agent: dummyAgent({ id: AGENT_ID }) };
    },
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [dummyAgent({ id: AGENT_ID })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => FAKE_TAIL,
    deleteAgent: () => ({ transcript: [] }),
  });
  const receipt = await bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.status, "idle");
  const created = bodies.find((row) => row.name === "createAgent")?.body as {
    isIntroductionSuppressed?: boolean;
    name?: string;
    description?: string;
  };
  assert.equal(created.isIntroductionSuppressed, true);
  assert.equal(typeof created.name, "string");
  assert.ok((created.name ?? "").startsWith(CREATE_AGENT_DEFAULT_NAME_PREFIX));
  assert.ok((created.name ?? "").trim().length > CREATE_AGENT_DEFAULT_NAME_PREFIX.length);
  assert.equal(created.description, "");
});

test("createAgent name-only fills description so host mint does not trim undefined", async () => {
  const bodies: unknown[] = [];
  const { bot } = fixtureBot({
    createAgent: (body) => {
      bodies.push(body);
      return { agent: dummyAgent({ id: AGENT_ID, name: "ping-probe" }) };
    },
  });
  await bot.createAgent({ isIntroductionSuppressed: true, name: "ping-probe" });
  assert.deepEqual(bodies[0], {
    isIntroductionSuppressed: true,
    name: "ping-probe",
    description: "",
  });
  await bot.createAgent({
    isIntroductionSuppressed: true,
    name: "ping-probe-2",
    description: "temp ping",
  });
  assert.deepEqual(bodies[1], {
    isIntroductionSuppressed: true,
    name: "ping-probe-2",
    description: "temp ping",
  });
});

test("runOnce deletes on timeout unless keepOnFailure", async () => {
  const deleted: string[] = [];
  const runningHandlers = {
    createAgent: () => ({ agent: dummyAgent({ id: AGENT_ID }) }),
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [dummyAgent({ id: AGENT_ID, isRunning: true })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({ outcome: "not-found" }),
    deleteAgent: (body: unknown) => {
      deleted.push((body as { id: string }).id);
      return { transcript: [] };
    },
  };
  const first = fixtureBot(runningHandlers);
  const timed = await first.bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 25,
    includeReply: false,
  });
  assert.equal(timed.status, "timeout");
  assert.equal(timed.deleted, true);
  assert.deepEqual(deleted, [AGENT_ID]);

  deleted.length = 0;
  const second = fixtureBot(runningHandlers);
  const kept = await second.bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 25,
    keepOnFailure: true,
    includeReply: false,
  });
  assert.equal(kept.status, "timeout");
  assert.equal(kept.deleted, false);
  assert.deepEqual(deleted, []);
});

test("runOnceFrom duplicates, rejects groups, and deleteAgent the clone", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Ada", isRunning: false }),
      dummyAgent({ id: CLONE_ID, name: "Ada copy", isRunning: false }),
    ],
    duplicateAgent: (body) => {
      bodies.push({ name: "duplicateAgent", body });
      return { agent: dummyAgent({ id: CLONE_ID, name: "Ada copy" }) };
    },
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: CLONE_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: (body) => {
      bodies.push({ name: "getAgentTranscriptTail", body });
      return FAKE_TAIL;
    },
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
  });
  const receipt = await bot.runOnceFrom({
    id: SOURCE_ID,
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.sourceId, SOURCE_ID);
  assert.equal(receipt.cloneId, CLONE_ID);
  assert.equal(receipt.id, CLONE_ID);
  assert.equal(receipt.inheritance, "host-clone");
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.status, "idle");
  assert.equal(receipt.reply, REPLY_TEXT);
  assert.equal(Object.hasOwn(receipt, "lastMessagePreview"), false);
  assert.deepEqual(bodies.find((row) => row.name === "getAgentTranscriptTail")?.body, {
    id: CLONE_ID,
    limit: 50,
  });
  assert.deepEqual(bodies.find((row) => row.name === "duplicateAgent")?.body, { id: SOURCE_ID });
  assert.deepEqual(bodies.find((row) => row.name === "deleteAgent")?.body, { id: CLONE_ID });
  assert.equal(calls.includes("deleteAgents"), false);
  assert.equal(calls.includes("createAgent"), false);

  const groupBot = fixtureBot({
    listAgents: () => [dummyAgent({ id: SOURCE_ID, name: "Room", isGroup: true })],
  });
  const rejected = await groupBot.bot.runOnceFrom({ id: SOURCE_ID, prompt: "x", timeoutMs: 50 });
  assert.equal(rejected.status, "error");
  assert.equal(rejected.error, "Groups can't be duplicated yet.");
  assert.equal(rejected.deleted, false);
  assert.equal(groupBot.calls.includes("duplicateAgent"), false);
});

test("runOnceLike is profile-only createAgent, not duplicateAgent", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({
        id: SOURCE_ID,
        name: "Ada",
        description: "helper",
        title: "Ops",
        purpose: "disk-saver",
      }),
      dummyAgent({ id: AGENT_ID, name: "Ada" }),
    ],
    createAgent: (body) => {
      bodies.push({ name: "createAgent", body });
      return { agent: dummyAgent({ id: AGENT_ID, name: "Ada" }) };
    },
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => FAKE_TAIL,
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
  });
  const receipt = await bot.runOnceLike({
    id: SOURCE_ID,
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.inheritance, "profile-only");
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.reply, REPLY_TEXT);
  assert.equal(calls.includes("duplicateAgent"), false);
  assert.deepEqual(bodies.find((row) => row.name === "createAgent")?.body, {
    isIntroductionSuppressed: true,
    name: "Ada",
    description: "helper",
    title: "Ops",
    purpose: "disk-saver",
  });
});

test("includeReply false / includeTranscript false skip the host tail", async () => {
  const { bot, calls } = fixtureBot({
    createAgent: () => ({ agent: dummyAgent({ id: AGENT_ID }) }),
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [dummyAgent({ id: AGENT_ID })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => FAKE_TAIL,
    deleteAgent: () => ({ transcript: [] }),
  });
  const hidden = await bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
    includeReply: false,
  });
  assert.equal(hidden.reply, undefined);
  assert.equal(calls.includes("getAgentTranscriptTail"), false);
  assert.equal(formatOneShotReceipt(hidden).includes(REPLY_TEXT), false);

  const alias = await bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
    includeTranscript: false,
  });
  assert.equal(alias.reply, undefined);
});

test("empty tail falls back to getAgentTranscript assistant text", async () => {
  const { bot, calls } = fixtureBot({
    createAgent: () => ({ agent: dummyAgent({ id: AGENT_ID }) }),
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [dummyAgent({ id: AGENT_ID })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => ({ entries: [{ kind: "notice", text: "nope" }] }),
    getAgentTranscript: () => [
      { kind: "message", role: "user", content: "hi" },
      { kind: "message", role: "assistant", content: "from full transcript" },
    ],
    deleteAgent: () => ({ transcript: [] }),
  });
  const receipt = await bot.runOnce({
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.reply, "from full transcript");
  assert.equal(calls.includes("getAgentTranscriptTail"), true);
  assert.equal(calls.includes("getAgentTranscript"), true);
});

test("lastAssistantTextFromEntries parses unknown[] send-message and assistant rows", () => {
  assert.equal(entriesFromTranscriptPayload(FAKE_TAIL).length, FAKE_TAIL.entries.length);
  assert.deepEqual(entriesFromTranscriptPayload({ entries: [1, 2] }), [1, 2]);
  assert.deepEqual(entriesFromTranscriptPayload(["raw"]), ["raw"]);
  assert.deepEqual(entriesFromTranscriptPayload({}), []);
  assert.equal(lastAssistantTextFromEntries(FAKE_TAIL.entries), REPLY_TEXT);
  assert.equal(
    lastAssistantTextFromEntries([
      { kind: "message", role: "user", content: "prompt" },
      { kind: "message", role: "assistant", content: "assistant body" },
    ]),
    "assistant body",
  );
  assert.equal(
    lastAssistantTextFromEntries([
      { entry: { kind: "send-message", message: { type: "text", content: "wrapped" } } },
    ]),
    "wrapped",
  );
  assert.equal(
    lastAssistantTextFromEntries([
      { kind: "send-message", message: { type: "attachment", url: "x" } },
      { kind: "send-message", message: { type: "text", content: "" } },
      null,
      12,
    ]),
    undefined,
  );
});

const FAKE_GROUP_TRANSCRIPT = [
  { kind: "message", role: "user", content: "status only", timestampMs: 10 },
  {
    kind: "send-message",
    message: { type: "text", content: MEMBER_A_TEXT },
    author: { id: CLONE_ID, name: "Elon copy" },
    timestampMs: 20,
  },
  {
    kind: "message",
    role: "user",
    content: "peer line in the room",
    fromAgent: { id: CLONE_B_ID, name: "Chief of Staff copy" },
    timestampMs: 30,
  },
  {
    kind: "send-message",
    message: { type: "text", content: MEMBER_B_TEXT },
    author: { id: CLONE_B_ID, name: "Chief of Staff copy" },
    timestampMs: 40,
  },
  { kind: "tool-call", name: "shell", status: "done" },
  { kind: "send-message", message: { type: "widget", widget: { prompt: "ask" } } },
  { kind: "notice", text: "ignored" },
  { kind: "send-message", message: { type: "text", content: "streaming preview" }, author: { id: CLONE_ID, name: "Elon copy" }, streaming: true },
  null,
  "junk",
];

test("turnsFromTranscriptEntries keeps every member line, not the last only", () => {
  const turns = turnsFromTranscriptEntries(FAKE_GROUP_TRANSCRIPT);
  assert.deepEqual(
    turns.map((row) => ({ speaker: row.speaker, text: row.text, kind: row.kind })),
    [
      { speaker: "user", text: "status only", kind: "message" },
      { speaker: "Elon copy", text: MEMBER_A_TEXT, kind: "send-message" },
      { speaker: "Chief of Staff copy", text: "peer line in the room", kind: "message" },
      { speaker: "Chief of Staff copy", text: MEMBER_B_TEXT, kind: "send-message" },
    ],
  );
  assert.equal(turns[1]?.agentId, CLONE_ID);
  assert.equal(turns[2]?.agentId, CLONE_B_ID);
  assert.equal(lastAssistantTextFromEntries(FAKE_GROUP_TRANSCRIPT), MEMBER_B_TEXT);
});

test("host createGroup reuses the same member set and groups cannot be duplicated", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const source = readFileSync(HOST_MAIN, "utf8");
  assert.match(source, /var GROUP_MAX_MEMBERS = 6/);
  assert.match(source, /var MAX_AGENTS_PER_USER = 50/);
  assert.match(source, /sending to it runs the group orchestrator instead of a single runner/);
  const createGroup = source.indexOf("async createGroup(args)");
  assert.ok(createGroup > 0);
  const block = source.slice(createGroup, createGroup + 2200);
  assert.match(block, /isSameMemberSet\(agent\.memberIds, memberIds\)/);
  assert.match(block, /name: args\.name/);
  assert.match(source, /Groups can't be duplicated yet/);
  assert.match(source, /const trimmedName = profile\?\.name\.trim\(\)/);
});

test("host createAgent mint forwards name/description without defaulting", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const source = readFileSync(HOST_MAIN, "utf8");
  const mintAgent = source.indexOf("const mintAgent = async (args) => {");
  assert.ok(mintAgent > 0);
  const block = source.slice(mintAgent, mintAgent + 800);
  assert.match(block, /name: args\.name,/);
  assert.match(block, /description: args\.description,/);
  assert.equal(block.includes("description: args.description ??"), false);
  assert.match(source, /const trimmedName = profile\?\.name\.trim\(\)/);
  assert.match(source, /description: profile\?\.description\.trim\(\)/);
});

test("resolveDiscussOnceName keeps a provided name and mints when omitted", () => {
  assert.equal(resolveDiscussOnceName("Throwaway discussion"), "Throwaway discussion");
  assert.equal(resolveDiscussOnceName("  kept  "), "kept");
  const minted = resolveDiscussOnceName();
  assert.equal(minted.startsWith(DISCUSS_ONCE_DEFAULT_NAME_PREFIX), true);
  assert.ok(minted.trim().length > DISCUSS_ONCE_DEFAULT_NAME_PREFIX.length);
  assert.notEqual(resolveDiscussOnceName(""), minted);
  assert.notEqual(resolveDiscussOnceName("   "), resolveDiscussOnceName(undefined));
});

test("resolveCreateAgentName keeps a provided name and mints when omitted", () => {
  assert.equal(resolveCreateAgentName("ping-probe"), "ping-probe");
  assert.equal(resolveCreateAgentName("  kept  "), "kept");
  const minted = resolveCreateAgentName();
  assert.equal(minted.startsWith(CREATE_AGENT_DEFAULT_NAME_PREFIX), true);
  assert.ok(minted.trim().length > CREATE_AGENT_DEFAULT_NAME_PREFIX.length);
  assert.notEqual(resolveCreateAgentName(""), minted);
  assert.notEqual(resolveCreateAgentName("   "), resolveCreateAgentName(undefined));
  assert.equal(resolveCreateAgentDescription(), "");
  assert.equal(resolveCreateAgentDescription("temp ping"), "temp ping");
  assert.equal(resolveCreateAgentDescription(""), "");
  const filled = toHostCreateAgentBody({ isIntroductionSuppressed: true, name: "x" });
  assert.equal(filled.name, "x");
  assert.equal(filled.description, "");
  assert.equal(filled.isIntroductionSuppressed, true);
  const both = toHostCreateAgentBody({ name: "Ada", description: "helper" });
  assert.deepEqual({ name: both.name, description: both.description }, { name: "Ada", description: "helper" });
  const omitted = toHostCreateAgentBody({});
  assert.equal(typeof omitted.name, "string");
  assert.ok((omitted.name ?? "").startsWith(CREATE_AGENT_DEFAULT_NAME_PREFIX));
  assert.equal(omitted.description, "");
});

test("discussOnce clones, groups, prompts the room, returns every turn, deletes group then clones", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  let groupCreated = false;
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon" }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff" }),
      dummyAgent({ id: CLONE_ID, name: "Elon copy" }),
      dummyAgent({ id: CLONE_B_ID, name: "Chief of Staff copy" }),
      ...(groupCreated
        ? [
            dummyAgent({
              id: GROUP_ID,
              name: "Throwaway discussion",
              isGroup: true,
              memberIds: [CLONE_ID, CLONE_B_ID],
            }),
          ]
        : []),
    ],
    duplicateAgent: (body) => {
      bodies.push({ name: "duplicateAgent", body });
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      const name = id === CLONE_ID ? "Elon copy" : "Chief of Staff copy";
      return { agent: dummyAgent({ id, name }) };
    },
    createGroup: (body) => {
      bodies.push({ name: "createGroup", body });
      groupCreated = true;
      return {
        agent: dummyAgent({
          id: GROUP_ID,
          name: "Throwaway discussion",
          isGroup: true,
          memberIds: [CLONE_ID, CLONE_B_ID],
        }),
      };
    },
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: GROUP_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscript: (body) => {
      bodies.push({ name: "getAgentTranscript", body });
      return FAKE_GROUP_TRANSCRIPT;
    },
    getAgentTranscriptTail: (body) => {
      bodies.push({ name: "getAgentTranscriptTail", body });
      return { entries: FAKE_GROUP_TRANSCRIPT, tailCount: 5 };
    },
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
  });
  const receipt = await bot.discussOnce({
    agents: ["Elon", "Chief of Staff"],
    prompt: "status only",
    name: "Throwaway discussion",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.id, GROUP_ID);
  assert.equal(receipt.groupId, GROUP_ID);
  assert.deepEqual(receipt.sourceIds, [SOURCE_ID, SOURCE_B_ID]);
  assert.deepEqual(receipt.cloneIds, [CLONE_ID, CLONE_B_ID]);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.status, "idle");
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.reply, MEMBER_B_TEXT);
  assert.equal(receipt.turns?.length, 4);
  assert.deepEqual(receipt.transcript, receipt.turns);
  assert.equal(receipt.turns?.[1]?.text, MEMBER_A_TEXT);
  assert.equal(receipt.turns?.[3]?.text, MEMBER_B_TEXT);
  assert.equal(Object.hasOwn(receipt, "lastMessagePreview"), false);
  assert.deepEqual(bodies.find((row) => row.name === "createGroup")?.body, {
    name: "Throwaway discussion",
    memberAgentIds: [CLONE_ID, CLONE_B_ID],
  });
  const sent = bodies.find((row) => row.name === "sendPrompt")?.body as {
    agentId: string;
    prompt: string;
    clientNonce?: string;
  };
  assert.equal(sent.agentId, GROUP_ID);
  assert.equal(sent.prompt, "status only");
  assert.equal(typeof sent.clientNonce, "string");
  assert.equal(Object.hasOwn(sent, "wait"), false);
  const deletedIds = bodies.filter((row) => row.name === "deleteAgent").map((row) => (row.body as { id: string }).id);
  assert.deepEqual(deletedIds, [GROUP_ID, CLONE_ID, CLONE_B_ID]);
  assert.equal(calls.includes("deleteAgents"), false);
  assert.equal(calls.includes("broadcastToAgents"), false);
  assert.equal(
    bodies.some((row) => row.name === "sendPrompt" && (row.body as { agentId: string }).agentId === SOURCE_ID),
    false,
  );
  const transcriptBeforeDelete =
    calls.lastIndexOf("getAgentTranscript") < calls.lastIndexOf("deleteAgent");
  assert.equal(transcriptBeforeDelete, true);
  const printed = formatDiscussReceipt(receipt);
  assert.equal(printed.includes(MEMBER_A_TEXT), true);
  assert.equal(printed.includes(MEMBER_B_TEXT), true);
  assert.equal(printed.includes("Elon copy:"), true);
  assert.equal(printed.includes("token"), false);
  assert.equal(printed.includes("lastMessagePreview"), false);
});

test("discussOnce mints a non-empty group name when the caller omits name", async () => {
  let createBody: { name?: string; memberAgentIds?: string[] } | undefined;
  let groupCreated = false;
  const { bot } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon" }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff" }),
      dummyAgent({ id: CLONE_ID, name: "Elon copy" }),
      dummyAgent({ id: CLONE_B_ID, name: "Chief of Staff copy" }),
      ...(groupCreated ? [dummyAgent({ id: GROUP_ID, name: "Room", isGroup: true })] : []),
    ],
    duplicateAgent: (body) => {
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      return { agent: dummyAgent({ id }) };
    },
    createGroup: (body) => {
      createBody = body as { name?: string; memberAgentIds?: string[] };
      groupCreated = true;
      return { agent: dummyAgent({ id: GROUP_ID, isGroup: true }) };
    },
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: GROUP_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscript: () => FAKE_GROUP_TRANSCRIPT,
    deleteAgent: () => ({ transcript: [] }),
  });
  const receipt = await bot.discussOnce({
    agents: ["Elon", "Chief of Staff"],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.status, "idle");
  assert.equal(typeof createBody?.name, "string");
  assert.ok((createBody?.name ?? "").trim().length > 0);
  assert.equal(createBody?.name?.startsWith(DISCUSS_ONCE_DEFAULT_NAME_PREFIX), true);
  assert.deepEqual(createBody?.memberAgentIds, [CLONE_ID, CLONE_B_ID]);
  assert.equal(Object.hasOwn(createBody ?? {}, "description"), false);
});

test("discussOnce rejects groups as members and more than GROUP_MAX_MEMBERS", async () => {
  const groupBot = fixtureBot({
    listAgents: () => [dummyAgent({ id: SOURCE_ID, name: "Room", isGroup: true })],
  });
  const rejected = await groupBot.bot.discussOnce({
    agents: ["Room"],
    prompt: "status only",
    timeoutMs: 50,
  });
  assert.equal(rejected.status, "error");
  assert.match(rejected.error ?? "", /individual agents/);
  assert.equal(groupBot.calls.includes("duplicateAgent"), false);
  assert.equal(groupBot.calls.includes("createGroup"), false);
  assert.equal(groupBot.calls.includes("sendPrompt"), false);

  const tooMany = await fixtureBot({
    listAgents: () => [],
  }).bot.discussOnce({
    agents: ["a", "b", "c", "d", "e", "f", "g"],
    prompt: "status only",
    timeoutMs: 50,
  });
  assert.equal(tooMany.status, "error");
  assert.match(tooMany.error ?? "", /at most 6/);
});

test("discussOnce errors when createGroup reuses an existing room and still deletes clones", async () => {
  const deleted: string[] = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon" }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff" }),
      dummyAgent({
        id: EXISTING_GROUP_ID,
        name: "Old room",
        isGroup: true,
        memberIds: [CLONE_ID, CLONE_B_ID],
      }),
    ],
    duplicateAgent: (body) => {
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      return { agent: dummyAgent({ id }) };
    },
    createGroup: () => ({
      agent: dummyAgent({
        id: EXISTING_GROUP_ID,
        name: "Old room",
        isGroup: true,
        memberIds: [CLONE_ID, CLONE_B_ID],
      }),
    }),
    deleteAgent: (body) => {
      deleted.push((body as { id: string }).id);
      return { transcript: [] };
    },
  });
  const receipt = await bot.discussOnce({
    agents: [SOURCE_ID, SOURCE_B_ID],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 500,
  });
  assert.equal(receipt.status, "error");
  assert.match(receipt.error ?? "", /reused an existing group/);
  assert.equal(receipt.accepted, false);
  assert.deepEqual(deleted, [CLONE_ID, CLONE_B_ID]);
  assert.equal(deleted.includes(EXISTING_GROUP_ID), false);
  assert.equal(calls.includes("sendPrompt"), false);
  assert.equal(calls.includes("deleteAgents"), false);
});

test("discussOnce snapshots then keeps the room on awaiting-user", async () => {
  const deleted: string[] = [];
  let groupCreated = false;
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon" }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff" }),
      dummyAgent({ id: CLONE_ID, name: "Elon copy" }),
      dummyAgent({ id: CLONE_B_ID, name: "Chief of Staff copy" }),
      ...(groupCreated
        ? [
            dummyAgent({
              id: GROUP_ID,
              name: "Room",
              isGroup: true,
              awaitingUserResponse: { tabId: "widget", reason: "ask", since: 1 },
            }),
          ]
        : []),
    ],
    duplicateAgent: (body) => {
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      return { agent: dummyAgent({ id }) };
    },
    createGroup: () => {
      groupCreated = true;
      return { agent: dummyAgent({ id: GROUP_ID, isGroup: true }) };
    },
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: GROUP_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscript: () => FAKE_GROUP_TRANSCRIPT,
    deleteAgent: (body) => {
      deleted.push((body as { id: string }).id);
      return { transcript: [] };
    },
  });
  const receipt = await bot.discussOnce({
    agents: [SOURCE_ID, SOURCE_B_ID],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.status, "awaiting-user");
  assert.equal(receipt.deleted, false);
  assert.equal(receipt.turns?.length, 4);
  assert.equal(receipt.reply, MEMBER_B_TEXT);
  assert.deepEqual(deleted, []);
  assert.equal(calls.includes("getAgentTranscript"), true);
});

test("discussOnce deletes on timeout unless keepOnFailure, after snapshot", async () => {
  const deleted: string[] = [];
  let groupCreated = false;
  const runningHandlers = {
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon", isRunning: true }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff", isRunning: true }),
      dummyAgent({ id: CLONE_ID, name: "Elon copy", isRunning: true }),
      dummyAgent({ id: CLONE_B_ID, name: "Chief of Staff copy", isRunning: true }),
      ...(groupCreated
        ? [dummyAgent({ id: GROUP_ID, name: "Room", isGroup: true, isRunning: true })]
        : []),
    ],
    duplicateAgent: (body: unknown) => {
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      return { agent: dummyAgent({ id }) };
    },
    createGroup: () => {
      groupCreated = true;
      return { agent: dummyAgent({ id: GROUP_ID, isGroup: true }) };
    },
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({ outcome: "not-found" }),
    getAgentTranscript: () => FAKE_GROUP_TRANSCRIPT,
    deleteAgent: (body: unknown) => {
      deleted.push((body as { id: string }).id);
      return { transcript: [] };
    },
  };
  const first = fixtureBot(runningHandlers);
  const timed = await first.bot.discussOnce({
    agents: [SOURCE_ID, SOURCE_B_ID],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 25,
  });
  assert.equal(timed.status, "timeout");
  assert.equal(timed.deleted, true);
  assert.equal(timed.turns?.length, 4);
  assert.deepEqual(deleted, [GROUP_ID, CLONE_ID, CLONE_B_ID]);
  assert.equal(first.calls.includes("deleteAgents"), false);

  deleted.length = 0;
  groupCreated = false;
  const second = fixtureBot(runningHandlers);
  const kept = await second.bot.discussOnce({
    agents: [SOURCE_ID, SOURCE_B_ID],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 25,
    keepOnFailure: true,
  });
  assert.equal(kept.status, "timeout");
  assert.equal(kept.deleted, false);
  assert.deepEqual(deleted, []);
});

test("discussOnce includeReply false skips the host transcript", async () => {
  let groupCreated = false;
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: SOURCE_ID, name: "Elon" }),
      dummyAgent({ id: SOURCE_B_ID, name: "Chief of Staff" }),
      dummyAgent({ id: CLONE_ID }),
      dummyAgent({ id: CLONE_B_ID }),
      ...(groupCreated ? [dummyAgent({ id: GROUP_ID, isGroup: true })] : []),
    ],
    duplicateAgent: (body) => {
      const id = (body as { id: string }).id === SOURCE_ID ? CLONE_ID : CLONE_B_ID;
      return { agent: dummyAgent({ id }) };
    },
    createGroup: () => {
      groupCreated = true;
      return { agent: dummyAgent({ id: GROUP_ID, isGroup: true }) };
    },
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    getAgentTranscript: () => FAKE_GROUP_TRANSCRIPT,
    getAgentTranscriptTail: () => ({ entries: FAKE_GROUP_TRANSCRIPT }),
    deleteAgent: () => ({ transcript: [] }),
  });
  const hidden = await bot.discussOnce({
    agents: [SOURCE_ID, SOURCE_B_ID],
    prompt: "status only",
    intervalMs: 1,
    timeoutMs: 2_000,
    includeReply: false,
  });
  assert.equal(hidden.reply, undefined);
  assert.equal(hidden.turns, undefined);
  assert.equal(hidden.transcript, undefined);
  assert.equal(calls.includes("getAgentTranscript"), false);
  assert.equal(calls.includes("getAgentTranscriptTail"), false);
  assert.equal(formatDiscussReceipt(hidden).includes(MEMBER_A_TEXT), false);
});

test("toHostSendPromptBody strips SDK wait keys", () => {
  assert.deepEqual(
    toHostSendPromptBody({
      prompt: "status only",
      agentId: AGENT_ID,
      clientNonce: "n1",
      wait: true,
      timeoutMs: 5_000,
      intervalMs: 1,
      includeReply: false,
      includeTranscript: false,
    }),
    { prompt: "status only", agentId: AGENT_ID, clientNonce: "n1" },
  );
});

test("sendPrompt default stays { accepted: true } and does not wait", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
  });
  const result = await bot.sendPrompt({
    agentId: AGENT_ID,
    prompt: "status only",
    wait: false,
    timeoutMs: 5_000,
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(Object.hasOwn(result, "reply"), false);
  assert.equal(Object.hasOwn(result, "status"), false);
  assert.deepEqual(bodies[0]?.body, { agentId: AGENT_ID, prompt: "status only" });
  assert.equal(calls.includes("listAgents"), false);
  assert.equal(calls.includes("getAgentTranscriptTail"), false);
});

test("sendPrompt wait:true polls idle then returns tail reply", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    listAgents: (_body, n) => [dummyAgent({ id: AGENT_ID, isRunning: n < 2 })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "n1",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: AGENT_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: (body) => {
      bodies.push({ name: "getAgentTranscriptTail", body });
      return FAKE_TAIL;
    },
  });
  const result = await bot.sendPrompt({
    agentId: AGENT_ID,
    prompt: "status only",
    clientNonce: "n1",
    wait: true,
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "idle");
  assert.equal(result.reply, REPLY_TEXT);
  assert.ok(result.elapsedMs >= 0);
  assert.deepEqual(bodies[0]?.body, {
    agentId: AGENT_ID,
    prompt: "status only",
    clientNonce: "n1",
  });
  assert.equal(Object.hasOwn(bodies[0]?.body as object, "wait"), false);
  assert.equal(Object.hasOwn(bodies[0]?.body as object, "timeoutMs"), false);
  assert.equal(calls.includes("getAgentTranscriptTail"), true);
  assert.equal(calls.includes("deleteAgent"), false);
});

test("sendPrompt wait:true returns awaiting-user as a status", async () => {
  const { bot } = fixtureBot({
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [
      dummyAgent({
        id: AGENT_ID,
        awaitingUserResponse: { tabId: "widget", reason: "ask", since: 1 },
      }),
    ],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    getAgentTranscriptTail: () => FAKE_TAIL,
  });
  const result = await bot.sendPrompt({
    agentId: AGENT_ID,
    prompt: "status only",
    wait: true,
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "awaiting-user");
  assert.equal(result.reply, REPLY_TEXT);
});

test("sendPrompt wait:true requires agentId", async () => {
  const { bot, calls } = fixtureBot({
    sendPrompt: () => ({ accepted: true }),
  });
  await assert.rejects(
    () => bot.sendPrompt({ prompt: "status only", wait: true, timeoutMs: 50 }),
    /wait: true requires agentId/,
  );
  assert.equal(calls.includes("sendPrompt"), false);
});

test("resolveSendAsAgentName keeps a provided name and mints bus- when omitted", () => {
  assert.equal(resolveSendAsAgentName("relay"), "relay");
  assert.equal(resolveSendAsAgentName("  kept  "), "kept");
  const minted = resolveSendAsAgentName();
  assert.equal(minted.startsWith(SEND_AS_AGENT_DEFAULT_NAME_PREFIX), true);
  assert.ok(minted.trim().length > SEND_AS_AGENT_DEFAULT_NAME_PREFIX.length);
  assert.notEqual(resolveSendAsAgentName(""), minted);
  assert.notEqual(resolveSendAsAgentName("   "), resolveSendAsAgentName(undefined));
  const prompt = sendAsAgentPrompt(TARGET_ID, "hello from the bus");
  assert.match(prompt, /Call SendToAgent exactly once/);
  assert.match(prompt, new RegExp(`target_id: ${TARGET_ID}`));
  assert.match(prompt, /hello from the bus/);
  assert.equal(prompt.includes("targets"), false);
  assert.equal(prompt.includes('"all"'), false);
});

test("sendAsAgent mints a bus, prompts SendToAgent, then deleteAgent", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: TARGET_ID, name: "Peer" }),
      dummyAgent({ id: BUS_ID, name: "bus-tmp" }),
    ],
    createAgent: (body) => {
      bodies.push({ name: "createAgent", body });
      return { agent: dummyAgent({ id: BUS_ID, name: "bus-tmp" }) };
    },
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: BUS_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: (body) => {
      bodies.push({ name: "getAgentTranscriptTail", body });
      return FAKE_TAIL;
    },
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
  });
  const receipt = await bot.sendAsAgent({
    to: "Peer",
    message: "hello from the bus",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.id, BUS_ID);
  assert.equal(receipt.busId, BUS_ID);
  assert.equal(receipt.targetId, TARGET_ID);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.status, "idle");
  assert.equal(receipt.deleted, true);
  assert.equal(receipt.reply, REPLY_TEXT);
  assert.equal(Object.hasOwn(receipt, "lastMessagePreview"), false);
  assert.ok(receipt.elapsedMs >= 0);
  const created = bodies.find((row) => row.name === "createAgent")?.body as {
    isIntroductionSuppressed?: boolean;
    name?: string;
    description?: string;
  };
  assert.equal(created.isIntroductionSuppressed, true);
  assert.equal(typeof created.name, "string");
  assert.ok((created.name ?? "").startsWith(SEND_AS_AGENT_DEFAULT_NAME_PREFIX));
  assert.ok((created.name ?? "").trim().length > SEND_AS_AGENT_DEFAULT_NAME_PREFIX.length);
  assert.equal(created.description, "");
  const sent = bodies.find((row) => row.name === "sendPrompt")?.body as {
    agentId: string;
    prompt: string;
    clientNonce?: string;
  };
  assert.equal(sent.agentId, BUS_ID);
  assert.equal(sent.prompt, sendAsAgentPrompt(TARGET_ID, "hello from the bus"));
  assert.equal(typeof sent.clientNonce, "string");
  assert.ok((sent.clientNonce ?? "").length > 0);
  assert.equal(Object.hasOwn(sent, "wait"), false);
  assert.deepEqual(bodies.find((row) => row.name === "deleteAgent")?.body, { id: BUS_ID });
  assert.equal(calls.includes("deleteAgents"), false);
  assert.equal(calls.includes("broadcastToAgents"), false);
  assert.equal(calls.includes("sendToAgent"), false);
  assert.equal(
    bodies.some((row) => row.name === "sendPrompt" && (row.body as { agentId: string }).agentId === TARGET_ID),
    false,
  );
  const printed = formatSendAsAgentReceipt(receipt);
  assert.equal(printed.includes("lastMessagePreview"), false);
  assert.equal(printed.includes("token"), false);
  assert.equal(printed.includes(REPLY_TEXT), true);
  assert.equal(printed.includes(TARGET_ID), true);
});

test("sendAsAgent reuse path prompts the existing bus and does not delete", async () => {
  const bodies: Array<{ name: string; body: unknown }> = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: TARGET_ID, name: "Peer" }),
      dummyAgent({ id: BUS_ID, name: "relay" }),
    ],
    sendPrompt: (body) => {
      bodies.push({ name: "sendPrompt", body });
      return { accepted: true };
    },
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: BUS_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => FAKE_TAIL,
    deleteAgent: (body) => {
      bodies.push({ name: "deleteAgent", body });
      return { transcript: [] };
    },
    createAgent: (body) => {
      bodies.push({ name: "createAgent", body });
      return { agent: dummyAgent({ id: AGENT_ID }) };
    },
  });
  const receipt = await bot.sendAsAgent({
    to: TARGET_ID,
    message: "reuse ping",
    bus: "relay",
    intervalMs: 1,
    timeoutMs: 2_000,
  });
  assert.equal(receipt.busId, BUS_ID);
  assert.equal(receipt.targetId, TARGET_ID);
  assert.equal(receipt.deleted, false);
  assert.equal(receipt.status, "idle");
  assert.equal(receipt.reply, REPLY_TEXT);
  assert.equal(calls.includes("createAgent"), false);
  assert.equal(calls.includes("deleteAgent"), false);
  assert.equal(calls.includes("broadcastToAgents"), false);
  assert.equal(calls.includes("sendToAgent"), false);
  const sent = bodies.find((row) => row.name === "sendPrompt")?.body as { agentId: string; prompt: string };
  assert.equal(sent.agentId, BUS_ID);
  assert.equal(sent.prompt, sendAsAgentPrompt(TARGET_ID, "reuse ping"));

  const fromAlias = await bot.sendAsAgent({
    to: "Peer",
    message: "from alias",
    from: BUS_ID,
    intervalMs: 1,
    timeoutMs: 2_000,
    includeReply: false,
  });
  assert.equal(fromAlias.busId, BUS_ID);
  assert.equal(fromAlias.deleted, false);
  assert.equal(fromAlias.reply, undefined);
});

test("sendAsAgent keepBus keeps a minted seat; to=all is refused", async () => {
  const deleted: string[] = [];
  const { bot, calls } = fixtureBot({
    listAgents: () => [
      dummyAgent({ id: TARGET_ID, name: "Peer" }),
      dummyAgent({ id: BUS_ID, name: "bus-tmp" }),
    ],
    createAgent: () => ({ agent: dummyAgent({ id: BUS_ID }) }),
    sendPrompt: () => ({ accepted: true }),
    getAsyncTasks: () => [],
    getSubagents: () => [],
    promptAcceptanceStatus: () => ({
      outcome: "found",
      record: {
        accountSlot: HOST_ACCOUNT_SLOT,
        clientNonce: "x",
        inputDigest: "d",
        status: "accepted",
        acceptedAtMs: 1,
        agentId: BUS_ID,
        echoEntryId: null,
        rejectionCode: null,
      },
    }),
    getAgentTranscriptTail: () => FAKE_TAIL,
    deleteAgent: (body) => {
      deleted.push((body as { id: string }).id);
      return { transcript: [] };
    },
  });
  const kept = await bot.sendAsAgent({
    to: "Peer",
    message: "keep this bus",
    keepBus: true,
    intervalMs: 1,
    timeoutMs: 2_000,
    includeReply: false,
  });
  assert.equal(kept.status, "idle");
  assert.equal(kept.deleted, false);
  assert.deepEqual(deleted, []);
  assert.equal(calls.includes("createAgent"), true);

  const refused = await bot.sendAsAgent({
    to: "all",
    message: "nope",
    timeoutMs: 50,
  });
  assert.equal(refused.status, "error");
  assert.match(refused.error ?? "", /all/);
  assert.equal(refused.deleted, false);
  assert.equal(refused.accepted, false);
});

test("sendPrompt wait:true timeout is typed and still reads the tail", async () => {
  const { bot } = fixtureBot({
    sendPrompt: () => ({ accepted: true }),
    listAgents: () => [dummyAgent({ id: AGENT_ID, isRunning: true })],
    getAsyncTasks: () => [],
    getSubagents: () => [],
    getAgentTranscriptTail: () => FAKE_TAIL,
  });
  const result = await bot.sendPrompt({
    agentId: AGENT_ID,
    prompt: "status only",
    wait: true,
    intervalMs: 1,
    timeoutMs: 25,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "timeout");
  assert.equal(result.reply, REPLY_TEXT);
});
