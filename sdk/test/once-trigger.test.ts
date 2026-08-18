import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_CRON_TIME_ZONE,
  ONCE_AT_MIN_MS,
  ONCE_DATED_CRON_DELETE_INSTRUCTION,
  isValidOnceAt,
  normalizeOnceAt,
  onceToDatedCron,
  parseOnceAtMs,
  parseOnceTrigger,
  toHostAutomationSpec,
  toHostAutomationTrigger,
} from "../src/once-trigger.js";

const ISO = "2026-08-18T18:43:00.000Z";
const MS = Date.parse(ISO);

test("parseOnceAtMs prefers ISO with time+timezone and epoch ms > 1e12", () => {
  assert.equal(ONCE_AT_MIN_MS, 1e12);
  assert.equal(parseOnceAtMs(ISO), MS);
  assert.equal(parseOnceAtMs(`  ${ISO}  `), MS);
  assert.equal(parseOnceAtMs("2026-08-18T18:43:00+12:00"), Date.parse("2026-08-18T18:43:00+12:00"));
  assert.equal(parseOnceAtMs(MS), MS);
  assert.equal(parseOnceAtMs(String(MS)), MS);
  assert.equal(isValidOnceAt(ISO), true);
  assert.equal(normalizeOnceAt("  2026-08-18T18:43:00+12:00  "), "2026-08-18T06:43:00.000Z");
});

test("parseOnceAtMs rejects date-only, seconds, 0, negatives, and whitespace", () => {
  assert.equal(parseOnceAtMs("2026-08-18"), null);
  assert.equal(parseOnceAtMs("2026-08-18T18:43:00"), null);
  assert.equal(parseOnceAtMs(""), null);
  assert.equal(parseOnceAtMs("   "), null);
  assert.equal(parseOnceAtMs("not-a-date"), null);
  assert.equal(parseOnceAtMs(0), null);
  assert.equal(parseOnceAtMs(-1), null);
  assert.equal(parseOnceAtMs(1_755_542_580), null);
  assert.equal(parseOnceAtMs("1755542580"), null);
  assert.equal(parseOnceAtMs(ONCE_AT_MIN_MS), null);
  assert.equal(parseOnceAtMs(Number.NaN), null);
  assert.equal(parseOnceAtMs(Number.POSITIVE_INFINITY), null);
  assert.equal(parseOnceAtMs({ iso: ISO }), null);
  assert.equal(isValidOnceAt("   "), false);
});

test("parseOnceTrigger normalizes at and rejects once+cron mix", () => {
  assert.deepEqual(parseOnceTrigger({ type: "once", at: `  ${ISO}  ` }), { type: "once", at: ISO });
  assert.deepEqual(parseOnceTrigger({ type: "once", at: MS }), { type: "once", at: ISO });
  assert.equal(parseOnceTrigger({ type: "once" }), null);
  assert.equal(parseOnceTrigger({ type: "once", at: "   " }), null);
  assert.equal(parseOnceTrigger({ type: "once", at: ISO, schedule: "43 18 18 8 *" }), null);
  assert.equal(parseOnceTrigger({ type: "cron", schedule: "0 9 * * *" }), null);
});

test("onceToDatedCron emits Pacific/Auckland clock fields, not UTC", () => {
  assert.equal(HOST_CRON_TIME_ZONE, "Pacific/Auckland");
  // 18:43 Auckland (NZST +12) must fire at 18:43 host-local, not 06:43.
  assert.deepEqual(onceToDatedCron("2026-08-18T18:43:00+12:00"), {
    type: "cron",
    schedule: "43 18 18 8 *",
  });
  // 18:43 UTC is 06:43 the next calendar day in Auckland (NZST +12).
  assert.deepEqual(onceToDatedCron(ISO), { type: "cron", schedule: "43 6 19 8 *" });
  // 00:00 UTC 1 Jan is 13:00 Auckland (NZDT +13).
  assert.deepEqual(onceToDatedCron("2020-01-01T00:00:00.000Z"), {
    type: "cron",
    schedule: "0 13 1 1 *",
  });
  assert.deepEqual(onceToDatedCron("2026-08-18T18:43:00+12:00", "UTC"), {
    type: "cron",
    schedule: "43 6 18 8 *",
  });
  assert.throws(() => onceToDatedCron("2026-08-18"), /ISO-8601/);
  assert.throws(() => onceToDatedCron("   "), /ISO-8601/);
  assert.throws(() => onceToDatedCron(ISO, "Not/AZone"), /time zone/);
});

test("toHostAutomationTrigger translates standalone once and refuses group once", () => {
  assert.deepEqual(toHostAutomationTrigger({ type: "once", at: "2026-08-18T18:43:00+12:00" }), {
    type: "cron",
    schedule: "43 18 18 8 *",
  });
  assert.deepEqual(toHostAutomationTrigger({ type: "cron", schedule: "0 9 * * *" }), {
    type: "cron",
    schedule: "0 9 * * *",
  });
  assert.deepEqual(toHostAutomationTrigger({ type: "slack" }), { type: "slack" });
  assert.throws(() => toHostAutomationTrigger({ type: "once" }), /once\.at/);
  assert.throws(
    () => toHostAutomationTrigger({ type: "once", at: ISO, schedule: "43 18 18 8 *" }),
    /combined with a cron schedule/,
  );
  assert.throws(
    () => toHostAutomationTrigger([{ type: "once", at: ISO }, { type: "slack" }]),
    /group\/list member/,
  );
  assert.throws(
    () =>
      toHostAutomationTrigger({
        type: "group",
        listeners: [{ type: "once", at: ISO }, { type: "slack" }],
      }),
    /group\/list member/,
  );
});

test("toHostAutomationSpec appends delete-after-fire footer only on once → dated cron", () => {
  const once = toHostAutomationSpec({
    name: "dummy once",
    prompt: "ping",
    trigger: { type: "once", at: "2026-08-18T18:43:00+12:00" },
  });
  assert.deepEqual(once.trigger, { type: "cron", schedule: "43 18 18 8 *" });
  assert.equal(once.prompt.startsWith("ping"), true);
  assert.equal(once.prompt.endsWith(ONCE_DATED_CRON_DELETE_INSTRUCTION), true);
  assert.equal(once.prompt.includes(ONCE_DATED_CRON_DELETE_INSTRUCTION), true);
  assert.equal(once.prompt.split(ONCE_DATED_CRON_DELETE_INSTRUCTION).length - 1, 1);

  const already = toHostAutomationSpec({
    name: "dummy once",
    prompt: `ping\n\n${ONCE_DATED_CRON_DELETE_INSTRUCTION}`,
    trigger: { type: "once", at: "2026-08-18T18:43:00+12:00" },
  });
  assert.equal(already.prompt, `ping\n\n${ONCE_DATED_CRON_DELETE_INSTRUCTION}`);

  const cron = toHostAutomationSpec({
    name: "dummy cron",
    prompt: "ping",
    trigger: { type: "cron", schedule: "0 9 * * *" },
  });
  assert.deepEqual(cron.trigger, { type: "cron", schedule: "0 9 * * *" });
  assert.equal(cron.prompt, "ping");
  assert.equal(cron.prompt.includes(ONCE_DATED_CRON_DELETE_INSTRUCTION), false);

  const slack = toHostAutomationSpec({
    name: "dummy slack",
    prompt: "ping",
    trigger: { type: "slack" },
  });
  assert.deepEqual(slack.trigger, { type: "slack" });
  assert.equal(slack.prompt, "ping");
});
