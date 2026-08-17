import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FACT_LINE,
  LOG_HEADER,
  MEMORY_EPISODE_PREFIX,
  MEMORY_MAX_CONTENT_LENGTH,
  MEMORY_NOTE_PREFIX,
  PROFILE_HEADER,
  forgetMemoryFact,
  formatMemoryDate,
  listMemoryFacts,
  memoryDedupeKey,
  memoryIdFor,
  normalizeMemoryContent,
  parseFacts,
  serializeFactLine,
  writeMemoryFact,
} from "../src/disk/memory.js";

test("FACT_LINE matches host serialize output", () => {
  const line = serializeFactLine("likes short commit messages", Date.parse("2026-08-16T00:00:00Z"));
  const match = FACT_LINE.exec(line);
  assert.ok(match);
  assert.equal(match?.[1], "2026-08-16");
  assert.equal(match?.[2], "likes short commit messages");
});

test("formatMemoryDate uses ISO date slice", () => {
  assert.equal(formatMemoryDate(Date.parse("2026-01-02T15:04:05Z")), "2026-01-02");
  assert.equal(formatMemoryDate(0), "unknown date");
  assert.equal(formatMemoryDate(Number.NaN), "unknown date");
});

test("normalize collapses whitespace and clamps to 500", () => {
  assert.equal(normalizeMemoryContent("  foo   bar\n"), "foo bar");
  const long = "x".repeat(MEMORY_MAX_CONTENT_LENGTH + 40);
  assert.equal(normalizeMemoryContent(long).length, MEMORY_MAX_CONTENT_LENGTH);
});

test("dedupe key is lowercase of normalized content", () => {
  assert.equal(memoryDedupeKey("  Hello   World  "), "hello world");
  assert.equal(memoryIdFor("Hello World"), memoryIdFor("hello   world"));
});

test("parseFacts skips headers and empty content", () => {
  const raw = [
    PROFILE_HEADER,
    "- (2026-08-01) first fact",
    "- (not-a-date) ignored",
    "- (2026-08-02)   ",
    "- (2026-08-03) second fact  ",
    "",
  ].join("\n");
  const facts = parseFacts(raw, "profile", 0, "/tmp/profile.md");
  assert.equal(facts.length, 2);
  assert.equal(facts[0]?.content, "first fact");
  assert.equal(facts[1]?.content, "second fact");
  assert.equal(facts[0]?.kind, "profile");
});

test("write then forget matches host append and exact-content remove", () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-memory-"));
  const agentId = "00000000-0000-4000-8000-000000000001";
  try {
    const createdAt = Date.parse("2026-08-16T12:00:00Z");
    const written = writeMemoryFact({
      agentId,
      content: "dummy preference: dark mode",
      tier: "profile",
      scope: "agent",
      createdAt,
      sandRoot: root,
    });
    assert.ok(written);
    assert.equal(written?.content, "dummy preference: dark mode");
    const file = join(root, "agents", agentId, "memory", "profile.md");
    const raw = readFileSync(file, "utf8");
    assert.ok(raw.startsWith("# About the user"));
    assert.ok(raw.includes("- (2026-08-16) dummy preference: dark mode"));
    const dup = writeMemoryFact({
      agentId,
      content: "DUMMY preference: dark mode",
      tier: "profile",
      sandRoot: root,
    });
    assert.equal(dup, null);

    const note = writeMemoryFact({
      agentId,
      content: "ephemeral dummy note",
      tier: "note",
      createdAt,
      sandRoot: root,
    });
    assert.ok(note);
    assert.equal(note?.content, `${MEMORY_NOTE_PREFIX}ephemeral dummy note`);
    assert.equal(note?.kind, "log");
    const logRaw = readFileSync(join(root, "agents", agentId, "memory", "log", "2026-08.md"), "utf8");
    assert.ok(logRaw.startsWith("# Memory log") || logRaw.startsWith(LOG_HEADER));
    assert.ok(logRaw.split("\n").some((line) => FACT_LINE.test(line)));
    const facts = listMemoryFacts(agentId, { sandRoot: root });
    assert.equal(facts.length, 2);
    assert.equal(forgetMemoryFact({ agentId, content: "dummy preference: dark mode", sandRoot: root }), true);
    assert.equal(listMemoryFacts(agentId, { sandRoot: root }).length, 1);
    assert.equal(forgetMemoryFact({ agentId, content: "no such dummy fact", sandRoot: root }), false);
    assert.equal(
      forgetMemoryFact({ agentId, content: "ephemeral dummy note", sandRoot: root }),
      false,
    );
    assert.equal(
      forgetMemoryFact({
        agentId,
        content: `${MEMORY_NOTE_PREFIX}ephemeral dummy note`,
        sandRoot: root,
      }),
      true,
    );
    assert.equal(listMemoryFacts(agentId, { sandRoot: root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log fact order starts at 0 independently of profile (host logFacts)", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-memory-order-"));
  const agentId = "00000000-0000-4000-8000-000000000002";
  try {
    const createdAt = Date.parse("2026-08-16T12:00:00Z");
    writeMemoryFact({
      agentId,
      content: "dummy profile fact",
      tier: "profile",
      createdAt,
      sandRoot: root,
    });
    writeMemoryFact({
      agentId,
      content: `${MEMORY_EPISODE_PREFIX}dummy episode throughline`,
      tier: "log",
      createdAt,
      sandRoot: root,
    });
    const facts = listMemoryFacts(agentId, { sandRoot: root });
    assert.equal(facts.length, 2);
    assert.equal(facts[0]?.kind, "profile");
    assert.equal(facts[0]?.order, 0);
    assert.equal(facts[0]?.origin, "legacy");
    assert.equal(facts[1]?.kind, "log");
    assert.equal(facts[1]?.order, 0);
    assert.ok(facts[1]?.content.startsWith(MEMORY_EPISODE_PREFIX));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty or whitespace-only write is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "grokbot-memory-empty-"));
  const agentId = "00000000-0000-4000-8000-000000000003";
  try {
    assert.equal(writeMemoryFact({ agentId, content: "   ", sandRoot: root }), null);
    // Host rememberFact prefixes notes before normalize, so "" becomes "[note]".
    const noteOnlyPrefix = writeMemoryFact({
      agentId,
      content: "",
      tier: "note",
      sandRoot: root,
    });
    assert.equal(noteOnlyPrefix?.content, MEMORY_NOTE_PREFIX.trim());
    assert.equal(forgetMemoryFact({ agentId, content: "   ", sandRoot: root }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FACT_LINE rejects unknown-date serialize output", () => {
  const line = serializeFactLine("dummy", 0);
  assert.equal(line, "- (unknown date) dummy");
  assert.equal(FACT_LINE.exec(line), null);
});
