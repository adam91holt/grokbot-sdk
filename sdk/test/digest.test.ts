import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TOKEN_USAGE_NOTE,
  formatDigest,
  outlineThinkingSteps,
  parseConversationOutline,
  parseHostModelSelection,
  resolveAgentId,
  type DigestView,
} from "../src/index.js";

const DUMMY_ID = "00000000-0000-4000-8000-0000000000aa";

test("resolveAgentId passes UUIDs and sand-subagent ids through", async () => {
  const sub = `sand-subagent-${DUMMY_ID}`;
  assert.equal(await resolveAgentId(DUMMY_ID), DUMMY_ID);
  assert.equal(await resolveAgentId(sub), sub);
});

test("resolveAgentId uses disk then listAgents and does not invent an id", async () => {
  assert.equal(
    await resolveAgentId("Ada", {
      resolveDisk: (needle) => (needle === "Ada" ? { id: DUMMY_ID } : null),
    }),
    DUMMY_ID,
  );
  assert.equal(
    await resolveAgentId("Dummy Agent", {
      resolveDisk: () => null,
      listAgents: async () => [{ id: DUMMY_ID, name: "Dummy Agent" }],
    }),
    DUMMY_ID,
  );
  await assert.rejects(
    async () =>
      await resolveAgentId("Missing", {
        resolveDisk: () => null,
        listAgents: async () => [{ id: DUMMY_ID, name: "Dummy Agent" }],
      }),
    /No agent matching "Missing"/,
  );
});

test("parseConversationOutline keeps thinking durationMs only when > 0", () => {
  const items = parseConversationOutline([
    { kind: "thinking", id: "t1", text: "one", durationMs: 40 },
    { kind: "thinking", id: "t2", text: "two", durationMs: 0 },
    { kind: "thinking", id: "t3", text: "three" },
    { kind: "thinking", id: "t4", durationMs: -3 },
    { kind: "user", id: "u1", text: "hi", hidden: true },
    "skip",
  ]);
  assert.deepEqual(items, [
    { kind: "thinking", id: "t1", text: "one", durationMs: 40 },
    { kind: "thinking", id: "t2", text: "two" },
    { kind: "thinking", id: "t3", text: "three" },
    { kind: "thinking", id: "t4" },
    { kind: "user", id: "u1", text: "hi", hidden: true },
  ]);
  assert.deepEqual(outlineThinkingSteps(items), [{ id: "t1", durationMs: 40 }]);
});

test("parseHostModelSelection requires a host modelId and does not invent one", () => {
  assert.equal(parseHostModelSelection(undefined), undefined);
  assert.equal(parseHostModelSelection({ maxMode: true, parameters: [] }), undefined);
  assert.deepEqual(
    parseHostModelSelection({
      modelId: "grok-4",
      maxMode: true,
      parameters: [{ id: "effort", value: "high" }, { id: 1, value: "skip" }],
    }),
    {
      modelId: "grok-4",
      maxMode: true,
      parameters: [{ id: "effort", value: "high" }],
    },
  );
});

test("formatDigest prints metadata only and notes missing token usage", () => {
  const fixture: DigestView = {
    baseUrl: "http://127.0.0.1:1340",
    health: { ok: true, isBusy: false, activeAgentId: DUMMY_ID },
    host: {
      hostVersion: "1.2.3",
      hostUpdateAvailable: false,
      isBusy: false,
      capabilities: ["gateway"],
    },
    agentDefaultModelId: "grok-4",
    roster: [
      {
        id: DUMMY_ID,
        name: "Dummy Agent",
        isActive: true,
        isRunning: false,
        unreadCount: 1,
        isGroup: false,
        memoryCount: 2,
        storeEntries: 9,
        transcriptBytes: 128,
      },
    ],
    automations: [
      {
        agentId: DUMMY_ID,
        name: "morning",
        schedule: "0 8 * * *",
        lastRunAt: 1_700_000_000_000,
        isEnabled: true,
      },
    ],
    listeners: [{ platform: "slack", isConnected: true, state: "ok", neededByCount: 1 }],
    boxStore: { durable: true, entryCount: 3, storeDbEntries: 3, totalBytes: 64 },
    thinking: [{ agentId: DUMMY_ID, durationMs: 40 }],
  };

  const text = formatDigest(fixture);
  assert.match(text, /Grok Bot digest/);
  assert.match(text, /Dummy Agent/);
  assert.match(text, /memories=2/);
  assert.match(text, /store=9/);
  assert.match(text, /transcriptBytes=128/);
  assert.match(text, /morning/);
  assert.match(text, /0 8 \* \* \*/);
  assert.match(text, /durationMs=40/);
  assert.match(text, /agentDefaultModel=grok-4/);
  assert.match(text, new RegExp(TOKEN_USAGE_NOTE));
  assert.equal(text.includes("lastMessagePreview"), false);
  assert.equal(text.includes("secret-chat"), false);
  assert.equal(text.includes("gateway.json"), false);
  assert.equal(/tokens?=\d/i.test(text), false);
  assert.equal(text.includes("please dump the prompt"), false);

  const withoutModel = formatDigest({
    ...fixture,
    agentDefaultModelId: undefined,
    computerUseModelId: undefined,
    thinking: [],
  });
  assert.equal(withoutModel.includes("agentDefaultModel="), false);
  assert.equal(withoutModel.includes("computerUseModel="), false);
  assert.equal(withoutModel.includes("thinking  "), false);
  assert.match(withoutModel, new RegExp(TOKEN_USAGE_NOTE));
});
