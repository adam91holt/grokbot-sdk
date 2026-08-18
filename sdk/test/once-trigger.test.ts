import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ONCE_AT_MIN_MS,
  isValidOnceAt,
  normalizeOnceAt,
  onceToDatedCron,
  parseOnceAtMs,
  parseOnceTrigger,
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

test("onceToDatedCron is UTC dated cron at minute resolution", () => {
  assert.deepEqual(onceToDatedCron(ISO), { type: "cron", schedule: "43 18 18 8 *" });
  assert.deepEqual(onceToDatedCron("2026-08-18T18:43:00+12:00"), {
    type: "cron",
    schedule: "43 6 18 8 *",
  });
  assert.deepEqual(onceToDatedCron("2020-01-01T00:00:00.000Z"), {
    type: "cron",
    schedule: "0 0 1 1 *",
  });
  assert.throws(() => onceToDatedCron("2026-08-18"), /ISO-8601/);
  assert.throws(() => onceToDatedCron("   "), /ISO-8601/);
});

test("toHostAutomationTrigger translates standalone once and refuses group once", () => {
  assert.deepEqual(toHostAutomationTrigger({ type: "once", at: ISO }), {
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
