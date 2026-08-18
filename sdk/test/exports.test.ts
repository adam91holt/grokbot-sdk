import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCompatVerdict,
  formatDiscoveryOutput,
  formatDigest,
  formatDiscussReceipt,
  formatJobRecord,
  formatOneShotReceipt,
  formatSendAsAgentReceipt,
  lastAssistantTextFromEntries,
  jobDiscussOnceName,
  resolveCreateAgentDescription,
  resolveCreateAgentName,
  resolveDiscussOnceName,
  resolveSendAsAgentName,
  sendAsAgent,
  sendAsAgentPrompt,
  toHostCreateAgentBody,
  submitJob,
  validateJob,
  toHostSendPromptBody,
  turnsFromTranscriptEntries,
  HOST_ACCOUNT_SLOT,
  HOST_MANIFEST,
  KNOWN_TRIGGER_TYPES,
  onceToDatedCron,
  parseStoredTrigger,
  parseConversationOutline,
  parseHostModelSelection,
  parseSseBlock,
  publicDiscovery,
  resolveAgentId,
  type AgentThreadInput,
  type DeleteMemoryInput,
  type ForgetMemoryInput,
  type ReadTranscriptOptions,
  type SearchMessageQuery,
  type SetUnreadInput,
  type WidgetResponseInput,
  type WorkflowIdInput,
  type WriteMemoryInput,
} from "../src/index.js";

test("package index re-exports caller types and parseSseBlock", () => {
  const write: WriteMemoryInput = { agentId: "00000000-0000-4000-8000-0000000000aa", content: "dummy" };
  const forget: ForgetMemoryInput = { agentId: write.agentId, content: "dummy" };
  const unread: SetUnreadInput = { id: write.agentId, isUnread: false };
  const thread: AgentThreadInput = { id: write.agentId, rootId: "dummy-root" };
  const widget: WidgetResponseInput = { entryId: "e1", value: "ok" };
  const memory: DeleteMemoryInput = { id: write.agentId, memoryId: "m1" };
  const workflow: WorkflowIdInput = { id: write.agentId, workflowId: "w1" };
  const transcript: ReadTranscriptOptions = { tail: 2, skipSubagents: true };
  const search: SearchMessageQuery = { contains: "dummy", limit: 1 };
  assert.equal(write.content, "dummy");
  assert.equal(forget.content, "dummy");
  assert.equal(unread.isUnread, false);
  assert.equal(thread.rootId, "dummy-root");
  assert.equal(widget.value, "ok");
  assert.equal(memory.memoryId, "m1");
  assert.equal(workflow.workflowId, "w1");
  assert.equal(transcript.tail, 2);
  assert.equal(search.contains, "dummy");
  assert.equal(parseSseBlock(":ping"), null);
  assert.equal(typeof formatDiscoveryOutput, "function");
  assert.equal(typeof publicDiscovery, "function");
  assert.equal(typeof resolveAgentId, "function");
  assert.equal(typeof parseConversationOutline, "function");
  assert.equal(typeof parseHostModelSelection, "function");
  assert.equal(typeof formatDigest, "function");
  assert.equal(typeof formatCompatVerdict, "function");
  assert.equal(typeof formatOneShotReceipt, "function");
  assert.equal(typeof formatDiscussReceipt, "function");
  assert.equal(typeof formatSendAsAgentReceipt, "function");
  assert.equal(typeof resolveSendAsAgentName, "function");
  assert.equal(typeof sendAsAgent, "function");
  assert.equal(typeof sendAsAgentPrompt, "function");
  assert.equal(typeof formatJobRecord, "function");
  assert.equal(typeof submitJob, "function");
  assert.equal(typeof validateJob, "function");
  assert.equal(typeof resolveDiscussOnceName, "function");
  assert.equal(typeof resolveCreateAgentName, "function");
  assert.equal(typeof resolveCreateAgentDescription, "function");
  assert.equal(typeof toHostCreateAgentBody, "function");
  assert.equal(typeof jobDiscussOnceName, "function");
  assert.equal(typeof lastAssistantTextFromEntries, "function");
  assert.equal(typeof turnsFromTranscriptEntries, "function");
  assert.equal(typeof toHostSendPromptBody, "function");
  assert.equal(HOST_ACCOUNT_SLOT, "host");
  assert.equal(typeof HOST_MANIFEST.hostVersion, "string");
  assert.ok(Array.isArray(HOST_MANIFEST.commands));
  assert.equal((KNOWN_TRIGGER_TYPES as readonly string[]).includes("once"), false);
  assert.equal(parseStoredTrigger({ type: "once", at: "2026-08-18T18:43:00.000Z" }), null);
  assert.deepEqual(onceToDatedCron("2026-08-18T18:43:00+12:00"), {
    type: "cron",
    schedule: "43 18 18 8 *",
  });
});
