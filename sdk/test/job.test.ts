import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_ACTIONS_FORBIDDEN,
  JOB_JSON_SCHEMA,
  JOB_SCHEMA_VERSION,
  JobValidationError,
  formatJobRecord,
  JOB_DISCUSS_ONCE_DESCRIPTION,
  jobDiscussOnceName,
  jobRecordPath,
  packetMayIncludeApply,
  resolveJobsDir,
  submitJob,
  validateJob,
  type Job,
  type JobClient,
  type JobRecord,
} from "../src/index.js";
import { ENV_GROKBOT_JOBS_DIR } from "../src/paths.js";
import type { DiscussOnceReceipt, OneShotReceipt } from "../src/gateway/oneshot.js";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, "..", "examples", "sample-job.json");
const SCHEMA_FILE = join(here, "..", "src", "job", "job.schema.json");

function baseJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: JOB_SCHEMA_VERSION,
    job_id: "job-dummy",
    idempotency_key: "dummy-key-1",
    goal: "Recommend a next step.",
    done_when: "The packet has a one-sentence recommendation.",
    seats: ["Ada"],
    on_awaiting_user: "stop",
    ...overrides,
  };
}

function fakeReceipt(overrides: Partial<OneShotReceipt> = {}): OneShotReceipt {
  return {
    id: "clone-1",
    accepted: true,
    status: "idle",
    elapsedMs: 4,
    deleted: true,
    sourceId: "source-1",
    cloneId: "clone-1",
    inheritance: "host-clone",
    reply: "Ship the schema first.",
    ...overrides,
  };
}

function fakeDiscuss(overrides: Partial<DiscussOnceReceipt> = {}): DiscussOnceReceipt {
  const turns = [
    { speaker: "user", kind: "message", text: "Recommend a next step." },
    { speaker: "Ada copy", kind: "send-message", text: "Ask Bea." },
    { speaker: "Bea copy", kind: "send-message", text: "Agree: ship the schema." },
  ];
  return {
    id: "group-1",
    groupId: "group-1",
    cloneIds: ["clone-a", "clone-b"],
    sourceIds: ["source-a", "source-b"],
    accepted: true,
    status: "idle",
    elapsedMs: 8,
    deleted: true,
    reply: "Agree: ship the schema.",
    turns,
    transcript: turns,
    ...overrides,
  };
}

function fakeClient(opts: {
  runOnceFrom?: (input: unknown) => Promise<OneShotReceipt>;
  discussOnce?: (input: unknown) => Promise<DiscussOnceReceipt>;
  compat?: JobClient["compat"];
} = {}): { bot: JobClient; calls: string[] } {
  const calls: string[] = [];
  const bot: JobClient = {
    compat: async () => {
      calls.push("compat");
      if (opts.compat != null) return await opts.compat();
      return {
        hostVersion: { pinned: "0.0.0-test", live: "0.0.0-test", status: "match" },
        capabilities: { known: [], live: [], missing: [], extra: [] },
        wrappers: { present: [], missingFromTable: [] },
      };
    },
    runOnceFrom: async (input) => {
      calls.push("runOnceFrom");
      if (opts.runOnceFrom != null) return await opts.runOnceFrom(input);
      return fakeReceipt();
    },
    discussOnce: async (input) => {
      calls.push("discussOnce");
      if (opts.discussOnce != null) return await opts.discussOnce(input);
      return fakeDiscuss();
    },
  };
  return { bot, calls };
}

test("JOB_JSON_SCHEMA matches the checked-in schema file", () => {
  const fromDisk = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(JOB_JSON_SCHEMA)), fromDisk);
});

test("sample job JSON validates", () => {
  const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const job = validateJob(sample);
  assert.equal(job.job_id, "job-recommend-sample");
  assert.equal(job.isolation, "clone");
  assert.equal(job.mode, "recommend");
  assert.deepEqual(job.actions_allowed, []);
  assert.equal(job.actions_forbidden.includes("force-push"), true);
  assert.equal(job.on_awaiting_user, "stop");
  assert.equal(packetMayIncludeApply(job), false);
});

test("validateJob fills defaults and rejects bad contracts", () => {
  const job = validateJob(baseJob());
  assert.equal(job.isolation, "clone");
  assert.equal(job.mode, "recommend");
  assert.equal(job.side_effect, "read");
  assert.deepEqual(job.actions_forbidden, [...DEFAULT_ACTIONS_FORBIDDEN]);

  assert.throws(() => validateJob({}), JobValidationError);
  assert.throws(() => validateJob(baseJob({ schema_version: 2 })), /schema_version/);
  assert.throws(() => validateJob(baseJob({ seats: [] })), /seats/);
  assert.throws(() => validateJob(baseJob({ isolation: "live" })), /isolation/);
  assert.throws(() => validateJob(baseJob({ on_awaiting_user: "continue" })), /on_awaiting_user/);
  assert.throws(() => validateJob(baseJob({ waitForCompletion: true })), /unknown job fields/);
  assert.throws(
    () => validateJob(baseJob({ actions_allowed: ["force-push"] })),
    /forbidden actions/,
  );
  assert.throws(
    () =>
      validateJob(
        baseJob({
          mode: "recommend",
          actions_allowed: [],
          packet: { status: "done", apply: { pr: true } },
        }),
      ),
    /packet.apply is forbidden/,
  );
  const implement = validateJob(
    baseJob({
      mode: "implement",
      actions_allowed: ["open-pr"],
      packet: { status: "done", apply: { note: "later" } },
    }),
  );
  assert.equal(packetMayIncludeApply(implement), true);
  assert.deepEqual(implement.packet?.apply, { note: "later" });
});

test("submitJob single-seat clone uses runOnceFrom and writes a packet", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  const { bot, calls } = fakeClient();
  try {
    const record = await submitJob(bot, baseJob(), { jobsDir: root, intervalMs: 1 });
    assert.equal(record.packet.status, "done");
    assert.equal(record.packet.recommendation, "Ship the schema first.");
    assert.ok(record.packet.turns != null && record.packet.turns.length >= 2);
    assert.equal(record.packet.turns?.at(-1)?.text, "Ship the schema first.");
    assert.equal(record.packet.transcript_ref, "jobs/job-dummy.json");
    assert.equal(Object.hasOwn(record.packet, "apply"), false);
    assert.equal(record.packet.compat?.status, "match");
    assert.deepEqual(calls, ["compat", "runOnceFrom"]);
    const onDisk = JSON.parse(readFileSync(join(root, "job-dummy.json"), "utf8")) as JobRecord;
    assert.equal(onDisk.packet.status, "done");
    const printed = formatJobRecord(record);
    assert.match(printed, /Ada:/);
    assert.match(printed, /Ship the schema first/);
    assert.equal(printed.includes("token"), false);
    assert.equal(printed.includes("SAND_GATEWAY_TOKEN"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitJob multi-seat clone and isolation=room use discussOnce", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  try {
    const multi = fakeClient();
    const room = fakeClient();
    const many = await submitJob(
      multi.bot,
      baseJob({
        job_id: "job-multi",
        idempotency_key: "dummy-key-multi",
        seats: ["Ada", "Bea"],
      }),
      { jobsDir: root },
    );
    assert.equal(many.packet.status, "done");
    assert.equal(many.packet.recommendation, "Agree: ship the schema.");
    assert.equal(many.packet.turns?.length, 3);
    assert.deepEqual(multi.calls, ["compat", "discussOnce"]);

    const oneRoom = await submitJob(
      room.bot,
      baseJob({
        job_id: "job-room",
        idempotency_key: "dummy-key-room",
        isolation: "room",
        seats: ["Ada"],
      }),
      { jobsDir: root },
    );
    assert.equal(oneRoom.packet.status, "done");
    assert.deepEqual(room.calls, ["compat", "discussOnce"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitJob room path always sends a non-empty group name from job_id", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  const seen: unknown[] = [];
  const { bot } = fakeClient({
    discussOnce: async (input) => {
      seen.push(input);
      return fakeDiscuss();
    },
  });
  try {
    const record = await submitJob(
      bot,
      baseJob({
        job_id: "job-room-name",
        idempotency_key: "dummy-key-room-name",
        isolation: "room",
        seats: ["New Zealand Browser", "Elon", "Chief of Staff"],
      }),
      { jobsDir: root },
    );
    assert.equal(record.packet.status, "done");
    assert.equal(seen.length, 1);
    const input = seen[0] as { name: string; description: string; agents: string[] };
    assert.equal(input.name, jobDiscussOnceName("job-room-name"));
    assert.equal(input.name, "job-room-name-room");
    assert.ok(input.name.trim().length > 0);
    assert.equal(input.description, JOB_DISCUSS_ONCE_DESCRIPTION);
    assert.deepEqual(input.agents, ["New Zealand Browser", "Elon", "Chief of Staff"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitJob is decide-only: mode=implement does not apply or run test_command", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  let sawPrompt = "";
  const { bot, calls } = fakeClient({
    runOnceFrom: async (input) => {
      sawPrompt = (input as { prompt: string }).prompt;
      return fakeReceipt({ reply: "Do not open the PR yet." });
    },
  });
  try {
    const record = await submitJob(
      bot,
      baseJob({
        job_id: "job-implement-later",
        mode: "implement",
        actions_allowed: ["open-pr"],
        side_effect: "mutate",
        repo: "https://github.com/example/app",
        base_branch: "main",
        branch_name: "cursor/example-job",
        test_command: "npm test",
        pr: true,
        implementer: "Open a PR after accept.",
      }),
      { jobsDir: root },
    );
    assert.equal(record.mode, "implement");
    assert.equal(record.test_command, "npm test");
    assert.equal(record.pr, true);
    assert.equal(record.packet.status, "done");
    assert.equal(Object.hasOwn(record.packet, "apply"), false);
    assert.match(sawPrompt, /decide-only/);
    assert.match(sawPrompt, /does not apply actions/);
    assert.match(sawPrompt, /Test command \(do not run\)/);
    assert.deepEqual(calls, ["compat", "runOnceFrom"]);
    assert.equal(calls.includes("sendPrompt"), false);
    assert.equal(calls.includes("broadcastToAgents"), false);
    assert.equal(calls.includes("deleteAgents"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitJob reuses idempotency_key + goal when already done", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  const { bot, calls } = fakeClient();
  try {
    const first = await submitJob(bot, baseJob(), { jobsDir: root });
    const second = await submitJob(bot, baseJob(), { jobsDir: root });
    assert.equal(first.packet.recommendation, second.packet.recommendation);
    assert.deepEqual(calls, ["compat", "runOnceFrom"]);
    await assert.rejects(
      async () =>
        await submitJob(bot, baseJob({ goal: "A different goal." }), { jobsDir: root }),
      /different goal/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("submitJob records compat mismatch and maps awaiting-user / timeout", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-jobs-"));
  try {
    const mismatch = fakeClient({
      compat: async () => ({
        hostVersion: { pinned: "1", live: "2", status: "mismatch" },
        capabilities: { known: [], live: [], missing: [], extra: [] },
        wrappers: { present: [], missingFromTable: [] },
      }),
    });
    const continued = await submitJob(
      mismatch.bot,
      baseJob({ job_id: "job-compat", idempotency_key: "dummy-key-compat" }),
      { jobsDir: root },
    );
    assert.equal(continued.packet.status, "done");
    assert.equal(continued.packet.compat?.status, "mismatch");
    assert.match(continued.packet.compat?.note ?? "", /continuing/);

    const waiting = fakeClient({
      runOnceFrom: async () => fakeReceipt({ status: "awaiting-user", reply: "Need a click." }),
    });
    const paused = await submitJob(
      waiting.bot,
      baseJob({ job_id: "job-wait", idempotency_key: "dummy-key-wait" }),
      { jobsDir: root },
    );
    assert.equal(paused.packet.status, "awaiting-user");
    assert.equal(paused.packet.recommendation, "Need a click.");

    const late = await submitJob(
      fakeClient().bot,
      baseJob({
        job_id: "job-late",
        idempotency_key: "dummy-key-late",
        deadline: "2000-01-01T00:00:00.000Z",
      }),
      { jobsDir: root },
    );
    assert.equal(late.packet.status, "timeout");
    assert.match(late.packet.error ?? "", /deadline/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("job paths stay out of sand-data agent folders", () => {
  assert.equal(resolveJobsDir({}), join(tmpdir(), "grokbot-jobs"));
  assert.equal(resolveJobsDir({ [ENV_GROKBOT_JOBS_DIR]: "/tmp/custom-jobs" }), "/tmp/custom-jobs");
  const file = jobRecordPath("job-dummy", "/tmp/custom-jobs");
  assert.equal(file, join("/tmp/custom-jobs", "job-dummy.json"));
  assert.equal(file.includes("/agents/"), false);
  assert.throws(() => jobRecordPath("..", "/tmp/custom-jobs"), /Invalid job_id/);
});

test("formatJobRecord --no-reply hides turn bodies", () => {
  const record = validateJob(
    baseJob({
      packet: {
        status: "done",
        recommendation: "Ship it.",
        turns: [{ speaker: "Ada", text: "Ship it." }],
      },
    }),
  ) as Job & { packet: NonNullable<Job["packet"]> };
  const hidden = formatJobRecord(record, { noReply: true });
  assert.equal(hidden.includes("Ship it."), false);
  assert.match(hidden, /"status": "done"/);
});
