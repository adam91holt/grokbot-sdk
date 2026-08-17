import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  forgetMemoryFact,
  getDiskAgent,
  listAgentAutomations,
  listMemoryFacts,
  openAgentStore,
  readActiveAgentId,
  readTranscript,
  STORE_SCHEMA,
  summarizeContent,
  writeMemoryFact,
} from "../src/disk/index.js";
import {
  DEFAULT_SAND_ROOT,
  ENV_SAND_DATA_ROOT,
  ENV_SAND_USER_DATA_DIR,
  SAND_DATA_DIRNAME,
  SandInvalidAgentIdError,
  agentDir,
  assertValidSandAgentId,
  isSafeFolderId,
  isValidSandAgentId,
  resolveSandRoot,
  storeDbPath,
  transcriptPath,
  userMemoryShardDir,
} from "../src/paths.js";

const DUMMY_AGENT = "00000000-0000-4000-8000-0000000000bb";

test("isSafeFolderId matches host; assertValidSandAgentId also rejects padding", () => {
  assert.equal(isSafeFolderId(DUMMY_AGENT), true);
  assert.equal(isSafeFolderId(".."), false);
  assert.equal(isSafeFolderId("."), false);
  assert.equal(isSafeFolderId("../user-memory"), false);
  assert.equal(isSafeFolderId("/tmp/evil"), false);
  assert.equal(isSafeFolderId("foo\\bar"), false);
  assert.equal(isSafeFolderId("foo\0bar"), false);
  assert.equal(isSafeFolderId(""), false);
  // Host isSafeFolderId allows surrounding whitespace; assertValidSandAgentId does not.
  assert.equal(isSafeFolderId(" padded "), true);
  assert.equal(isValidSandAgentId(" padded "), false);
  assert.throws(() => assertValidSandAgentId(" padded "), SandInvalidAgentIdError);
  assert.throws(() => assertValidSandAgentId(".."), /Invalid Sand agent id/);
});

test("path builders refuse traversal and absolute agent ids (host resolveSandAgentDir)", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-path-"));
  try {
    assert.throws(() => agentDir("..", root), SandInvalidAgentIdError);
    assert.throws(() => agentDir("../user-memory", root), SandInvalidAgentIdError);
    assert.throws(() => agentDir("/tmp/evil", root), SandInvalidAgentIdError);
    assert.throws(() => userMemoryShardDir("../escape", root), SandInvalidAgentIdError);
    assert.throws(() => transcriptPath("..", root), SandInvalidAgentIdError);
    assert.doesNotThrow(() => agentDir(DUMMY_AGENT, root));
    assert.equal(agentDir(DUMMY_AGENT, root), join(root, "agents", DUMMY_AGENT));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeMemoryFact / forgetMemoryFact cannot escape sand-data", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-mem-trav-"));
  const outside = mkdtempSync(join(tmpdir(), "grokbot-outside-"));
  try {
    assert.equal(
      writeMemoryFact({
        agentId: "..",
        content: "dummy should not persist",
        sandRoot: root,
      }),
      null,
    );
    assert.equal(
      writeMemoryFact({
        agentId: "../user-memory",
        content: "dummy should not persist",
        sandRoot: root,
      }),
      null,
    );
    assert.equal(
      writeMemoryFact({
        agentId: outside,
        content: "dummy should not persist",
        sandRoot: root,
      }),
      null,
    );
    assert.equal(existsSync(join(root, "memory")), false);
    assert.equal(existsSync(join(root, "user-memory", "memory")), false);
    assert.equal(existsSync(join(outside, "memory")), false);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(forgetMemoryFact({ agentId: "..", content: "dummy", sandRoot: root }), false);
    assert.deepEqual(listMemoryFacts("..", { sandRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("getDiskAgent and readActiveAgentId reject host-unsafe ids", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-agent-trav-"));
  try {
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(
      join(root, "agents", "active-agent.json"),
      JSON.stringify({ activeAgentId: "../user-memory" }),
    );
    assert.equal(readActiveAgentId(root), null);
    writeFileSync(
      join(root, "agents", "active-agent.json"),
      JSON.stringify({ activeAgentId: DUMMY_AGENT }),
    );
    assert.equal(readActiveAgentId(root), DUMMY_AGENT);
    assert.equal(getDiskAgent("..", root), null);
    assert.equal(getDiskAgent("../user-memory", root), null);
    assert.equal(getDiskAgent("/tmp/evil", root), null);
    assert.equal(getDiskAgent(" padded ", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readTranscript / listAutomations / openAgentStore reject unsafe ids", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-io-trav-"));
  try {
    assert.deepEqual(await readTranscript("..", { sandRoot: root }), []);
    assert.deepEqual(await readTranscript("../user-memory", { sandRoot: root }), []);
    assert.deepEqual(listAgentAutomations("..", root), []);
    assert.throws(() => openAgentStore("..", root), SandInvalidAgentIdError);
    assert.throws(() => openAgentStore("/tmp/evil", root), SandInvalidAgentIdError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AgentStore stays read-only and does not create a missing store.db", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-store-ro-"));
  const agentDirPath = join(root, "agents", DUMMY_AGENT);
  try {
    mkdirSync(agentDirPath, { recursive: true });
    const missingPath = storeDbPath(DUMMY_AGENT, root);
    assert.equal(existsSync(missingPath), false);
    assert.throws(() => openAgentStore(DUMMY_AGENT, root), /SQLite database not found/);
    assert.equal(existsSync(missingPath), false);

    const storePath = missingPath;
    const db = new DatabaseSync(storePath);
    db.exec(STORE_SCHEMA);
    db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run("origin", "user");
    db.close();

    const store = openAgentStore(DUMMY_AGENT, root);
    try {
      assert.equal(store.getKv("origin"), "user");
      assert.equal(typeof (store as unknown as { exec?: unknown }).exec, "undefined");
    } finally {
      store.close();
    }
    const probe = new DatabaseSync(storePath, { readOnly: true });
    try {
      assert.throws(
        () => probe.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run("x", "y"),
        /readonly|SQLITE_READONLY|ERR_SQLITE/i,
      );
    } finally {
      probe.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summarizeContent never echoes transcript body text", () => {
  const secret = "dummy-secret-transcript-body";
  const summary = summarizeContent([
    { type: "text", text: secret },
    { type: "tool_use", name: "dummy_tool", input: { note: secret } },
  ]);
  assert.equal(summary.texts, 1);
  assert.deepEqual(summary.toolUses, ["dummy_tool"]);
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test("resolveSandRoot matches host resolveSandDataRootOverride / SAND_USER_DATA_DIR", () => {
  assert.equal(resolveSandRoot({}), DEFAULT_SAND_ROOT);
  // Host resolveSandDataRootOverride: relative SAND_DATA_ROOT is ignored.
  assert.equal(
    resolveSandRoot({ [ENV_SAND_DATA_ROOT]: "relative-sand-data" }),
    DEFAULT_SAND_ROOT,
  );
  const abs = "/tmp/dummy-sand-root";
  assert.equal(resolveSandRoot({ [ENV_SAND_DATA_ROOT]: abs }), abs);
  // SAND_DATA_ROOT wins over SAND_USER_DATA_DIR.
  assert.equal(
    resolveSandRoot({
      [ENV_SAND_DATA_ROOT]: abs,
      [ENV_SAND_USER_DATA_DIR]: "/tmp/dummy-user-data",
    }),
    abs,
  );
  // Host resolveSandUserDataDir + join(..., "sand-data").
  assert.equal(
    resolveSandRoot({ [ENV_SAND_USER_DATA_DIR]: "/tmp/dummy-user-data" }),
    join("/tmp/dummy-user-data", SAND_DATA_DIRNAME),
  );
});
