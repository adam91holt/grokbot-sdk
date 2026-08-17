import assert from "node:assert/strict";
import { test } from "node:test";
import { cliUsage, parseCliArgs } from "../src/cli-parse.js";

const emptyFlags = {
  from: null,
  froms: [] as string[],
  to: null,
  bus: null,
  name: null,
  purpose: null,
  timeoutMs: null,
  keepOnFailure: false,
  keepBus: false,
  noReply: false,
} as const;

test("parseCliArgs defaults to help and reads flags", () => {
  assert.deepEqual(parseCliArgs([]), {
    command: "help",
    rest: [],
    raw: false,
    all: false,
    tail: null,
    ...emptyFlags,
  });
  assert.equal(parseCliArgs(["-h"]).command, "help");
  assert.deepEqual(parseCliArgs(["status"]), {
    command: "status",
    rest: [],
    raw: false,
    all: false,
    tail: null,
    ...emptyFlags,
  });
  assert.deepEqual(parseCliArgs(["tasks", "dummy-agent"]), {
    command: "tasks",
    rest: ["dummy-agent"],
    raw: false,
    all: false,
    tail: null,
    ...emptyFlags,
  });
  assert.deepEqual(parseCliArgs(["transcript", "dummy-agent", "--tail", "12"]), {
    command: "transcript",
    rest: ["dummy-agent"],
    raw: false,
    all: false,
    tail: 12,
    ...emptyFlags,
  });
  assert.equal(parseCliArgs(["automations", "--all", "--raw"]).all, true);
  assert.equal(parseCliArgs(["automations", "--all", "--raw"]).raw, true);
});

test("parseCliArgs reads run-once flags", () => {
  assert.deepEqual(parseCliArgs(["run-once", "--from", "Ada", "--timeout-ms", "5000", "hello"]), {
    command: "run-once",
    rest: ["hello"],
    raw: false,
    all: false,
    tail: null,
    from: "Ada",
    froms: ["Ada"],
    to: null,
    bus: null,
    name: null,
    purpose: null,
    timeoutMs: 5000,
    keepOnFailure: false,
    keepBus: false,
    noReply: false,
  });
  const kept = parseCliArgs(["run-once", "--keep-on-failure", "--name", "tmp", "status only"]);
  assert.equal(kept.keepOnFailure, true);
  assert.equal(kept.name, "tmp");
  assert.deepEqual(kept.rest, ["status only"]);
  const hidden = parseCliArgs(["run-once", "--no-reply", "hello"]);
  assert.equal(hidden.noReply, true);
});

test("parseCliArgs reads send-as flags", () => {
  const parsed = parseCliArgs([
    "send-as",
    "--to",
    "Peer",
    "--bus",
    "relay",
    "--keep-bus",
    "hello there",
  ]);
  assert.equal(parsed.command, "send-as");
  assert.equal(parsed.to, "Peer");
  assert.equal(parsed.bus, "relay");
  assert.equal(parsed.keepBus, true);
  assert.deepEqual(parsed.rest, ["hello there"]);
  const fromAlias = parseCliArgs(["send-as", "--to=Peer", "--from", "relay", "ping"]);
  assert.equal(fromAlias.to, "Peer");
  assert.equal(fromAlias.from, "relay");
  assert.deepEqual(fromAlias.rest, ["ping"]);
});

test("parseCliArgs collects repeated --from for discuss", () => {
  const parsed = parseCliArgs([
    "discuss",
    "--from",
    "Elon",
    "--from",
    "Chief of Staff",
    "status only",
  ]);
  assert.equal(parsed.command, "discuss");
  assert.deepEqual(parsed.froms, ["Elon", "Chief of Staff"]);
  assert.equal(parsed.from, "Chief of Staff");
  assert.deepEqual(parsed.rest, ["status only"]);
});

test("parseCliArgs rejects --tail without a number", () => {
  assert.throws(() => parseCliArgs(["transcript", "x", "--tail"]), /--tail requires a value/);
});

test("cliUsage lists the remote-operator commands", () => {
  const text = cliUsage();
  for (const name of ["discovery", "status", "compat", "workflows", "tasks", "interrupt", "mcp", "listeners", "digest", "run-once", "discuss", "send-as", "job submit", "job show", "job list"]) {
    assert.match(text, new RegExp(`grokbot ${name}`));
  }
  assert.equal(text.includes("SAND_GATEWAY_TOKEN="), false);
  assert.match(text, /metadata only/);
});
