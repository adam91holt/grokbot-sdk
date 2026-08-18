import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  AUTOMATION_MAX_NAME_LENGTH,
  CONVERSATION_BLOB_SCHEMA,
  DEFAULT_HIDDEN_FROM_SIDEBAR,
  DEFAULT_NOTIFY_ON_AGENT_UPDATES,
  GROUP_CONFIG_VERSION,
  GROUP_MAX_MEMBERS,
  STORE_ENTRY_KINDS,
  STORE_KV_KEYS,
  STORE_SCHEMA,
  WINDOW_ENTRY_FILTER_SQL,
  sqliteRoUri,
  formatLegacyTranscriptLine,
  isLegacyTranscriptEnvelope,
  KNOWN_TRIGGER_TYPES,
  isValidOnceAt,
  listAgentAutomations,
  listGlobalWorkflows,
  parseStoredTrigger,
  openAgentStore,
  parseLegacyTranscriptLine,
  parseSandGroup,
  parseSandProfile,
  parseSandSettings,
  parseStoredAutomationConfig,
  readGroup,
  readProfile,
  readSettings,
  readTranscript,
} from "../src/disk/index.js";
import { isSafeFolderId } from "../src/paths.js";

const DUMMY_AGENT = "00000000-0000-4000-8000-0000000000aa";

test("parseSandProfile reads only host writeSandProfileFile keys", () => {
  const profile = parseSandProfile({
    name: "Dummy Agent",
    description: "fixture",
    title: "  helper  ",
    avatarShape: " blob ",
    avatarColor: " teal ",
    status: "invented",
    extra: true,
  });
  assert.deepEqual(profile, {
    name: "Dummy Agent",
    description: "fixture",
    title: "helper",
    avatarShape: "blob",
    avatarColor: "teal",
  });
  assert.equal(parseSandProfile(null), null);
  assert.equal(parseSandProfile("nope"), null);
});

test("parseSandSettings uses host defaults and known keys only", () => {
  assert.deepEqual(parseSandSettings(null), {
    notifyOnAgentUpdates: DEFAULT_NOTIFY_ON_AGENT_UPDATES,
    hiddenFromSidebar: DEFAULT_HIDDEN_FROM_SIDEBAR,
  });
  assert.deepEqual(parseSandSettings({ hiddenFromSidebar: true, prLinkStyle: "full" }), {
    notifyOnAgentUpdates: true,
    hiddenFromSidebar: true,
  });
  assert.deepEqual(parseSandSettings({ notifyOnAgentUpdates: false }), {
    notifyOnAgentUpdates: false,
    hiddenFromSidebar: false,
  });
});

test("parseSandGroup trims, dedupes, caps members, and shapes remoteMembers", () => {
  const group = parseSandGroup({
    version: 2,
    memberIds: ["  a  ", "a", "", "b", 3, "c", "d", "e", "f", "g"],
    remoteMembers: [
      { ownerAuthId: " owner-1 ", agentId: " remote-1 ", name: "  " },
      { ownerAuthId: "owner-1", agentId: "remote-1", name: "dup" },
      { ownerAuthId: "", agentId: "x" },
      { agentId: "missing-owner" },
    ],
    sharedRoomId: "room-dummy",
  });
  assert.ok(group);
  assert.equal(group?.version, 2);
  assert.equal(group?.memberIds.length, GROUP_MAX_MEMBERS);
  assert.deepEqual(group?.memberIds, ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(group?.remoteMembers, [
    { ownerAuthId: "owner-1", agentId: "remote-1", name: "Agent" },
  ]);
  assert.equal(group?.sharedRoomId, "room-dummy");
  assert.equal(parseSandGroup({ memberIds: [] }), null);
  assert.equal(parseSandGroup({ version: GROUP_CONFIG_VERSION }), null);
});

test("profile / settings / group disk readers match host files", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-disk-json-"));
  const dir = join(root, "agents", DUMMY_AGENT);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "profile.json"),
      `${JSON.stringify(
        {
          name: "Dummy",
          description: "fixture profile",
          title: "bot",
          avatarShape: "orb",
          avatarColor: "gray",
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, "settings.json"),
      `${JSON.stringify({ notifyOnAgentUpdates: false, hiddenFromSidebar: true }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, "group.json"),
      `${JSON.stringify({ version: 1, memberIds: ["m1", "m2"] }, null, 2)}\n`,
    );
    assert.equal(readProfile(DUMMY_AGENT, root)?.name, "Dummy");
    assert.equal(readSettings(DUMMY_AGENT, root).notifyOnAgentUpdates, false);
    assert.deepEqual(readGroup(DUMMY_AGENT, root)?.memberIds, ["m1", "m2"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseStoredAutomationConfig matches host serialize keys", () => {
  const now = Date.parse("2026-08-16T00:00:00Z");
  const cron = parseStoredAutomationConfig(
    JSON.stringify({
      name: "  dummy daily  ",
      prompt: "  list dummy status  ",
      schedule: "0 9 * * *",
      enabled: true,
      provenance: "user",
      createdAt: now,
      lastRunAt: null,
    }),
    now + 1000,
  );
  assert.ok(cron);
  assert.equal(cron?.name, "dummy daily");
  assert.equal(cron?.prompt, "list dummy status");
  assert.equal(cron?.enabled, true);
  assert.equal(cron?.provenance, "user");
  assert.deepEqual(cron?.trigger, { type: "cron", schedule: "0 9 * * *" });
  assert.equal(cron?.createdAt, now);

  const missingEnabled = parseStoredAutomationConfig(
    JSON.stringify({
      name: "dummy",
      prompt: "ping",
      schedule: "@hourly",
      createdAt: now,
    }),
    now,
  );
  assert.equal(missingEnabled?.enabled, true);

  const untrusted = parseStoredAutomationConfig(
    JSON.stringify({
      name: "dummy",
      prompt: "ping",
      schedule: "0 * * * *",
      enabled: false,
      provenance: "untrusted",
      createdAt: now,
      raisedNotices: ["github-listener-scope", "invented-notice", ""],
    }),
    now,
  );
  assert.equal(untrusted?.enabled, false);
  assert.equal(untrusted?.provenance, "untrusted");
  assert.deepEqual(untrusted?.raisedNotices, ["github-listener-scope"]);

  assert.equal(
    parseStoredAutomationConfig(JSON.stringify({ name: "dummy", prompt: "ping" }), now),
    null,
  );
  const longName = parseStoredAutomationConfig(
    JSON.stringify({
      name: "x".repeat(AUTOMATION_MAX_NAME_LENGTH + 20),
      prompt: "ping",
      schedule: "0 0 * * *",
      createdAt: now,
    }),
    now,
  );
  assert.equal(longName?.name.length, AUTOMATION_MAX_NAME_LENGTH);
});

test("parseStoredTrigger accepts once at ISO-8601 or epoch ms", () => {
  assert.ok(KNOWN_TRIGGER_TYPES.includes("once"));
  assert.equal(isValidOnceAt("2026-08-18T18:43:00.000Z"), true);
  assert.equal(isValidOnceAt(Date.parse("2026-08-18T18:43:00.000Z")), true);
  assert.equal(isValidOnceAt(""), false);
  assert.equal(isValidOnceAt("not-a-date"), false);
  assert.equal(isValidOnceAt(Number.NaN), false);

  const iso = { type: "once", at: "2026-08-18T18:43:00.000Z" };
  const epoch = { type: "once", at: Date.parse("2026-08-18T18:43:00.000Z") };
  assert.deepEqual(parseStoredTrigger(iso), iso);
  assert.deepEqual(parseStoredTrigger(epoch), epoch);
  assert.deepEqual(parseStoredTrigger({ type: "once", at: "  2026-08-18T18:43:00+12:00  " }), {
    type: "once",
    at: "  2026-08-18T18:43:00+12:00  ",
  });
});

test("parseStoredTrigger rejects missing / invalid once and once+cron mix", () => {
  assert.equal(parseStoredTrigger({ type: "once" }), null);
  assert.equal(parseStoredTrigger({ type: "once", at: "" }), null);
  assert.equal(parseStoredTrigger({ type: "once", at: "   " }), null);
  assert.equal(parseStoredTrigger({ type: "once", at: "not-a-date" }), null);
  assert.equal(parseStoredTrigger({ type: "once", at: Number.NaN }), null);
  assert.equal(parseStoredTrigger({ type: "once", at: { iso: "2026-08-18T18:43:00.000Z" } }), null);
  assert.equal(parseStoredTrigger({ type: "oneshot", at: "2026-08-18T18:43:00.000Z" }), null);
  assert.equal(
    parseStoredTrigger({
      type: "once",
      at: "2026-08-18T18:43:00.000Z",
      schedule: "43 18 18 8 *",
    }),
    null,
  );
  assert.equal(parseStoredTrigger({ type: "cron", at: "2026-08-18T18:43:00.000Z" }), null);
});

test("parseStoredTrigger keeps once in a group and drops invalid once members", () => {
  const once = { type: "once", at: "2026-08-18T18:43:00.000Z" };
  const slack = { type: "slack" };
  const cron = { type: "cron", schedule: "0 9 * * *" };
  assert.deepEqual(parseStoredTrigger([once, slack]), {
    type: "group",
    listeners: [once, slack],
  });
  assert.deepEqual(parseStoredTrigger({ type: "group", listeners: [once, cron] }), {
    type: "group",
    listeners: [once, cron],
  });
  assert.deepEqual(parseStoredTrigger([{ type: "once" }, cron]), cron);
  assert.equal(parseStoredTrigger([{ type: "once" }, { type: "oneshot", at: 1 }]), null);
});

test("parseStoredAutomationConfig reads once trigger and falls back invalid once to schedule", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");
  const once = parseStoredAutomationConfig(
    JSON.stringify({
      name: "dummy once",
      prompt: "ping at 18:43",
      trigger: { type: "once", at: "2026-08-18T18:43:00.000Z" },
      enabled: true,
      provenance: "user",
      createdAt: now,
    }),
    now,
  );
  assert.ok(once);
  assert.deepEqual(once?.trigger, { type: "once", at: "2026-08-18T18:43:00.000Z" });

  const fallback = parseStoredAutomationConfig(
    JSON.stringify({
      name: "dummy",
      prompt: "ping",
      trigger: { type: "once" },
      schedule: "43 18 18 8 *",
      createdAt: now,
    }),
    now,
  );
  assert.deepEqual(fallback?.trigger, { type: "cron", schedule: "43 18 18 8 *" });

  assert.equal(
    parseStoredAutomationConfig(
      JSON.stringify({
        name: "dummy",
        prompt: "ping",
        trigger: { type: "once" },
        createdAt: now,
      }),
      now,
    ),
    null,
  );
});

test("listAgentAutomations skips configs the host would reject", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-automations-"));
  const autoDir = join(root, "agents", DUMMY_AGENT, "automations", "dummy-daily");
  try {
    mkdirSync(autoDir, { recursive: true });
    writeFileSync(
      join(autoDir, "automation.json"),
      `${JSON.stringify(
        {
          name: "dummy daily",
          prompt: "report dummy health",
          schedule: "0 8 * * *",
          enabled: true,
          provenance: "user",
          createdAt: 1,
          lastRunAt: null,
        },
        null,
        2,
      )}\n`,
    );
    const listed = listAgentAutomations(DUMMY_AGENT, root);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.schedule, "0 8 * * *");
    assert.equal(listed[0]?.enabled, true);
    assert.equal("trigger" in (listed[0] ?? {}), false);

    const onceDir = join(root, "agents", DUMMY_AGENT, "automations", "dummy-once");
    mkdirSync(onceDir, { recursive: true });
    writeFileSync(
      join(onceDir, "automation.json"),
      `${JSON.stringify(
        {
          name: "dummy once",
          prompt: "ping at 18:43",
          trigger: { type: "once", at: "2026-08-18T18:43:00.000Z" },
          enabled: true,
          provenance: "user",
          createdAt: 1,
          lastRunAt: null,
        },
        null,
        2,
      )}\n`,
    );
    const listedOnce = listAgentAutomations(DUMMY_AGENT, root);
    assert.equal(listedOnce.length, 2);
    const onceRow = listedOnce.find((row) => row.id === "dummy-once");
    assert.equal("schedule" in (onceRow ?? {}), false);
    assert.deepEqual(onceRow?.trigger, { type: "once", at: "2026-08-18T18:43:00.000Z" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listGlobalWorkflows reads SKILL.md frontmatter and skips non-skill entries", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-workflows-"));
  try {
    const safe = join(root, "workflows", "dummy-status");
    mkdirSync(safe, { recursive: true });
    writeFileSync(
      join(safe, "SKILL.md"),
      [
        "---",
        "name: Dummy Status",
        "description: report dummy host health",
        "---",
        "",
        "Do not invent a gateway endpoint.",
        "",
      ].join("\n"),
    );
    mkdirSync(join(root, "workflows", "..-traversal"), { recursive: true });
    writeFileSync(join(root, "workflows", "not-a-dir.md"), "name: skip\n");
    const listed = listGlobalWorkflows(root);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.slug, "dummy-status");
    assert.equal(listed[0]?.name, "Dummy Status");
    assert.equal(listed[0]?.description, "report dummy host health");
    assert.match(listed[0]?.path ?? "", /SKILL\.md$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy transcript envelope is {role, message:{content}}", async () => {
  const line = formatLegacyTranscriptLine("user", [{ type: "text", text: "dummy ping" }]);
  assert.equal(line, JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "dummy ping" }] } }));
  const parsed = JSON.parse(line) as unknown;
  assert.equal(isLegacyTranscriptEnvelope(parsed), true);
  assert.deepEqual(parseLegacyTranscriptLine(parsed)?.message.content, [
    { type: "text", text: "dummy ping" },
  ]);
  assert.equal(isLegacyTranscriptEnvelope({ type: "metadata", metadata: { overview: "x" } }), false);
  assert.equal(isLegacyTranscriptEnvelope({ type: "turn_ended", status: "success" }), false);
  assert.equal(isLegacyTranscriptEnvelope({ role: "user", message: "flat" }), false);
  assert.deepEqual(
    parseLegacyTranscriptLine({ role: "assistant", message: { content: "dummy reply" } })
      ?.message.content,
    [{ type: "text", text: "dummy reply" }],
  );

  const root = mkdtempSync(join(tmpdir(), "grokbot-transcript-"));
  const dir = join(root, "agent-transcripts", DUMMY_AGENT);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${DUMMY_AGENT}.jsonl`),
      [
        JSON.stringify({ type: "metadata", metadata: { overview: "dummy" } }),
        formatLegacyTranscriptLine("user", [{ type: "text", text: "dummy ask" }]),
        formatLegacyTranscriptLine("assistant", [
          { type: "text", text: "dummy answer" },
          { type: "tool_use", name: "dummy_tool", input: { n: 1 } },
        ]),
        JSON.stringify({ type: "turn_ended", status: "success" }),
        "",
      ].join("\n"),
    );
    const lines = await readTranscript(DUMMY_AGENT, { sandRoot: root });
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.role, "user");
    assert.equal(lines[1]?.role, "assistant");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("store schema constants match host kv / transcript_entries / blobs", () => {
  assert.match(STORE_SCHEMA, /CREATE TABLE IF NOT EXISTS kv/);
  assert.match(STORE_SCHEMA, /key TEXT PRIMARY KEY/);
  assert.match(STORE_SCHEMA, /value TEXT NOT NULL/);
  assert.match(STORE_SCHEMA, /CREATE TABLE IF NOT EXISTS transcript_entries/);
  assert.match(STORE_SCHEMA, /seq INTEGER PRIMARY KEY/);
  assert.match(STORE_SCHEMA, /id TEXT NOT NULL UNIQUE/);
  assert.match(STORE_SCHEMA, /entry TEXT NOT NULL/);
  assert.match(STORE_SCHEMA, /CREATE TABLE IF NOT EXISTS blobs/);
  assert.match(STORE_SCHEMA, /data BLOB NOT NULL/);
  assert.match(CONVERSATION_BLOB_SCHEMA, /CREATE TABLE IF NOT EXISTS blobs/);
  assert.match(WINDOW_ENTRY_FILTER_SQL, /json_extract\(entry, '\$\.kind'\) != 'tool-call'/);
  assert.equal(STORE_KV_KEYS.metadata, "metadata");
  assert.equal(STORE_KV_KEYS.sandProfile, "sandProfile");
  assert.equal(STORE_KV_KEYS.unreadState, "unreadState");
  assert.equal(STORE_KV_KEYS.legacyStoreBlobRetirementVersion, "legacyStoreBlobRetirementVersion");
  assert.ok(STORE_ENTRY_KINDS.includes("message"));
  assert.ok(STORE_ENTRY_KINDS.includes("send-message"));
  assert.equal(isSafeFolderId(DUMMY_AGENT), true);
  assert.equal(isSafeFolderId(".."), false);
  assert.match(sqliteRoUri("/tmp/dummy-store.db"), /^file:\/\/\/tmp\/dummy-store\.db\?mode=ro$/);
});

test("AgentStore reads dummy kv / entries / blobs read-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-store-"));
  const agentDir = join(root, "agents", DUMMY_AGENT);
  try {
    mkdirSync(agentDir, { recursive: true });
    const storePath = join(agentDir, "store.db");
    const blobsPath = join(agentDir, "conversation-blobs.db");
    const storeDb = new DatabaseSync(storePath);
    storeDb.exec(STORE_SCHEMA);
    storeDb.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(STORE_KV_KEYS.origin, "user");
    storeDb
      .prepare("INSERT INTO transcript_entries (seq, id, entry) VALUES (?, ?, ?)")
      .run(1, "e1", JSON.stringify({ kind: "notice", text: "dummy notice" }));
    storeDb
      .prepare("INSERT INTO blobs (id, data) VALUES (?, ?)")
      .run("legacy-blob", Buffer.from("legacy-bytes"));
    storeDb.close();

    const blobDb = new DatabaseSync(blobsPath);
    blobDb.exec(CONVERSATION_BLOB_SCHEMA);
    blobDb.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run("cur-blob", Buffer.from("cur"));
    blobDb.close();

    const store = openAgentStore(DUMMY_AGENT, root);
    try {
      assert.equal(store.getKv(STORE_KV_KEYS.origin), "user");
      assert.deepEqual(store.listKvKeys(), [STORE_KV_KEYS.origin]);
      assert.equal(store.countEntries(), 1);
      const entries = store.listEntries();
      assert.equal(entries[0]?.kind, "notice");
      assert.deepEqual(Array.from(store.getBlob("cur-blob") ?? []), Array.from(Buffer.from("cur")));
      assert.deepEqual(
        Array.from(store.getBlob("legacy-blob") ?? []),
        Array.from(Buffer.from("legacy-bytes")),
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
