/**
 * Client helpers for one-shot runs. Not host commands — they poll real
 * gateway signals only (listAgents, getAsyncTasks, getSubagents,
 * promptAcceptanceStatus). There is no waitForCompletion host API.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentSummary,
  AsyncTaskRecord,
  CreateAgentResult,
  DeleteAgentResult,
  PromptAcceptanceStatus,
  SendPromptInput,
  SendPromptResult,
  SubagentRecord,
} from "../types.js";
import { HOST_ACCOUNT_SLOT } from "../types.js";
import type { CreateAgentInput, CreateGroupInput } from "./commands.js";
import { GROUP_MAX_MEMBERS } from "../disk/agents.js";

/** Default poll gap for waitForIdle. Not a host field. */
export const DEFAULT_WAIT_FOR_IDLE_INTERVAL_MS = 250;

/** Default wall-clock budget for runOnce / runOnceFrom / runOnceLike. */
export const DEFAULT_RUN_ONCE_TIMEOUT_MS = 120_000;

export type OneShotStatus = "idle" | "awaiting-user" | "timeout" | "error";

export type WaitForIdleInput = {
  id: string;
  timeoutMs?: number;
  clientNonce?: string;
  /** Poll gap. Default 250ms. Not a host field. */
  intervalMs?: number;
  /** When true, timeout throws instead of returning `status: "timeout"`. */
  throwOnTimeout?: boolean;
  signal?: AbortSignal;
};

export type WaitForIdleResult = {
  id: string;
  status: OneShotStatus;
  elapsedMs: number;
  isRunning: boolean;
  isComposingMessage: boolean;
  awaitingUserResponse: unknown;
  asyncTaskCount: number;
  runningSubagentCount: number;
  acceptance?: PromptAcceptanceStatus;
};

/**
 * Redacted one-shot receipt. Default includes `reply` (last assistant /
 * send-message text from getAgentTranscriptTail, falling back to
 * getAgentTranscript). That is not roster `lastMessagePreview`. No token/usage
 * fields. Wall-clock is client-side Date.now() only. Pass includeReply: false
 * (or includeTranscript: false) for metadata-only.
 */
export type OneShotReceipt = {
  id: string;
  accepted: boolean;
  status: OneShotStatus;
  elapsedMs: number;
  deleted: boolean;
  sourceId?: string;
  cloneId?: string;
  /**
   * `host-clone` is duplicateAgent → manager.cloneAgent (store.db + automations).
   * `profile-only` is createAgent with copied roster name/description/title/purpose.
   */
  inheritance?: "host-clone" | "profile-only";
  /** Last assistant / send-message text. Omitted when includeReply is false. */
  reply?: string;
  error?: string;
};

export type RunOnceInput = {
  prompt: string;
  /**
   * Agent display name. When omitted or blank, a unique throwaway name is
   * minted so host createAgent does not `name.trim()` on undefined.
   */
  name?: string;
  purpose?: string;
  /**
   * Always sent as a string (`""` when omitted). Host mintAgent does not
   * default description; materializeSession then does `description.trim()`.
   */
  description?: string;
  title?: string;
  timeoutMs?: number;
  intervalMs?: number;
  keepOnFailure?: boolean;
  /**
   * Default true. When false, skip the host tail read and omit `reply`.
   */
  includeReply?: boolean;
  /** Alias for includeReply. false also opts out. */
  includeTranscript?: boolean;
  signal?: AbortSignal;
};

export type RunOnceFromInput = {
  id: string;
  prompt: string;
  timeoutMs?: number;
  intervalMs?: number;
  keepOnFailure?: boolean;
  includeReply?: boolean;
  includeTranscript?: boolean;
  signal?: AbortSignal;
};

/**
 * SDK sendPrompt extras. Not host fields — stripped before POST /api/sendPrompt.
 * Host sendPrompt still returns only `{ accepted: true }`.
 */
export type SendPromptCallInput = SendPromptInput & {
  wait?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
  includeReply?: boolean;
  includeTranscript?: boolean;
  signal?: AbortSignal;
};

/** Returned only when the SDK caller passed `wait: true`. */
export type SendPromptWaitResult = {
  accepted: boolean;
  status: OneShotStatus;
  elapsedMs: number;
  reply?: string;
};

/** Drop SDK-only keys so they never reach the host sendPrompt body. */
export function toHostSendPromptBody(body: SendPromptCallInput): SendPromptInput {
  const {
    wait: _wait,
    timeoutMs: _timeoutMs,
    intervalMs: _intervalMs,
    includeReply: _includeReply,
    includeTranscript: _includeTranscript,
    signal: _signal,
    ...host
  } = body;
  return host;
}

export type OneShotClient = {
  resolveAgent(idOrName: string): Promise<string>;
  listAgents(): Promise<AgentSummary[]>;
  getAsyncTasks(body: { id: string }): Promise<AsyncTaskRecord[]>;
  getSubagents(body: { id: string }): Promise<SubagentRecord[]>;
  promptAcceptanceStatus(body: {
    accountSlot: string;
    clientNonce: string;
  }): Promise<PromptAcceptanceStatus>;
  createAgent(body?: CreateAgentInput): Promise<CreateAgentResult>;
  createGroup(body: CreateGroupInput): Promise<CreateAgentResult>;
  sendPrompt(body: {
    prompt: string;
    agentId: string;
    clientNonce?: string;
  }): Promise<SendPromptResult>;
  deleteAgent(body: { id: string }): Promise<DeleteAgentResult>;
  duplicateAgent(body: { id: string }): Promise<CreateAgentResult>;
  getAgentTranscriptTail?(body: { id: string; limit?: number }): Promise<unknown>;
  getAgentTranscript?(body: { id: string }): Promise<unknown>;
};

export type DiscussTurn = {
  speaker: string;
  agentId?: string;
  kind: string;
  text: string;
  timestampMs?: number;
};

/** Prefix for minted discussOnce group names when the caller omits `name`. */
export const DISCUSS_ONCE_DEFAULT_NAME_PREFIX = "throwaway-discussion-";

/** Prefix for minted createAgent / runOnce names when the caller omits `name`. */
export const CREATE_AGENT_DEFAULT_NAME_PREFIX = "throwaway-";

/**
 * Host createGroup always forwards `{ name: args.name }` into createAgent.
 * materializeSession then does `profile?.name.trim()` and throws when name
 * is omitted. Blank / whitespace-only names are treated as omitted.
 */
export function resolveDiscussOnceName(name?: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length > 0) return trimmed;
  return `${DISCUSS_ONCE_DEFAULT_NAME_PREFIX}${randomUUID()}`;
}

/**
 * Host createHostGatewayApi mintAgent forwards
 * `{ name: args.name, description: args.description }` with no `?? ""`.
 * materializeSession then does `profile?.name.trim()` and
 * `profile?.description.trim()` — optional only on `profile`. Omitted name
 * or description throws. Blank / whitespace-only names are treated as omitted.
 */
export function resolveCreateAgentName(name?: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length > 0) return trimmed;
  return `${CREATE_AGENT_DEFAULT_NAME_PREFIX}${randomUUID()}`;
}

/**
 * Always a string. Host mintAgent does not default omitted description;
 * materializeSession then calls `profile?.description.trim()`.
 */
export function resolveCreateAgentDescription(description?: string): string {
  return typeof description === "string" ? description : "";
}

/**
 * Body the SDK POSTs to host createAgent. Always includes a non-empty name
 * and a string description so materializeSession never trims undefined.
 */
export function toHostCreateAgentBody(body: CreateAgentInput = {}): CreateAgentInput {
  return {
    ...body,
    name: resolveCreateAgentName(body.name),
    description: resolveCreateAgentDescription(body.description),
  };
}

export type DiscussOnceInput = {
  /** Roster name or id. Groups are rejected. Capped at GROUP_MAX_MEMBERS (6). */
  agents: string[];
  prompt: string;
  /**
   * Group display name. When omitted or blank, a unique throwaway name is
   * minted so host createGroup does not `name.trim()` on undefined.
   */
  name?: string;
  description?: string;
  timeoutMs?: number;
  intervalMs?: number;
  keepOnFailure?: boolean;
  /**
   * Default true. When false, skip the host transcript read and omit
   * `reply` / `turns` / `transcript`.
   */
  includeReply?: boolean;
  /** Alias for includeReply. false also opts out. */
  includeTranscript?: boolean;
  signal?: AbortSignal;
};

/**
 * Throwaway group-discussion receipt. `turns` / `transcript` are the full
 * room (every member line), not `sendPrompt({ wait: true }).reply`.
 * On awaiting-user the room is kept so a widget can be answered.
 */
export type DiscussOnceReceipt = {
  id: string;
  groupId: string;
  cloneIds: string[];
  sourceIds: string[];
  accepted: boolean;
  status: OneShotStatus;
  elapsedMs: number;
  deleted: boolean;
  /** Last substantive send-message / assistant line. */
  reply?: string;
  /** Ordered room turns (user prompt + every member line). */
  turns?: DiscussTurn[];
  /** Same parsed record as `turns`. */
  transcript?: DiscussTurn[];
  error?: string;
};

function isAwaitingUser(value: unknown): boolean {
  return value != null && value !== false;
}

function runningSubagentCount(subagents: SubagentRecord[]): number {
  return subagents.filter((row) => row.status === "running").length;
}

function findAgent(agents: AgentSummary[], id: string): AgentSummary | undefined {
  return agents.find((agent) => agent.id === id);
}

export async function waitForIdle(
  bot: OneShotClient,
  input: WaitForIdleInput,
): Promise<WaitForIdleResult> {
  const startedAt = Date.now();
  const id = await bot.resolveAgent(input.id);
  const timeoutMs = input.timeoutMs;
  const intervalMs =
    input.intervalMs != null && Number.isFinite(input.intervalMs) && input.intervalMs >= 0
      ? input.intervalMs
      : DEFAULT_WAIT_FOR_IDLE_INTERVAL_MS;
  const deadline =
    timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? startedAt + timeoutMs
      : undefined;

  let last: WaitForIdleResult = {
    id,
    status: "error",
    elapsedMs: 0,
    isRunning: false,
    isComposingMessage: false,
    awaitingUserResponse: null,
    asyncTaskCount: 0,
    runningSubagentCount: 0,
  };

  while (true) {
    if (input.signal?.aborted) {
      throw new Error("waitForIdle aborted");
    }

    const [agents, tasks, subagents, acceptance] = await Promise.all([
      bot.listAgents(),
      bot.getAsyncTasks({ id }),
      bot.getSubagents({ id }),
      input.clientNonce != null && input.clientNonce.length > 0
        ? bot.promptAcceptanceStatus({
            accountSlot: HOST_ACCOUNT_SLOT,
            clientNonce: input.clientNonce,
          })
        : Promise.resolve(undefined),
    ]);

    const agent = findAgent(agents, id);
    const elapsedMs = Date.now() - startedAt;
    if (agent == null) {
      last = {
        id,
        status: "error",
        elapsedMs,
        isRunning: false,
        isComposingMessage: false,
        awaitingUserResponse: null,
        asyncTaskCount: tasks.length,
        runningSubagentCount: runningSubagentCount(subagents),
        ...(acceptance !== undefined ? { acceptance } : {}),
      };
      return last;
    }

    const runningSubs = runningSubagentCount(subagents);
    last = {
      id,
      status: "error",
      elapsedMs,
      isRunning: agent.isRunning,
      isComposingMessage: agent.isComposingMessage,
      awaitingUserResponse: agent.awaitingUserResponse,
      asyncTaskCount: tasks.length,
      runningSubagentCount: runningSubs,
      ...(acceptance !== undefined ? { acceptance } : {}),
    };

    if (acceptance?.outcome === "found" && acceptance.record.status === "rejected") {
      last.status = "error";
      return last;
    }

    const acceptanceBlocking =
      acceptance != null &&
      (acceptance.outcome === "not-found" ||
        (acceptance.outcome === "found" && acceptance.record.status === "pending"));

    const busy =
      agent.isRunning ||
      agent.isComposingMessage ||
      tasks.length > 0 ||
      runningSubs > 0 ||
      acceptanceBlocking;

    if (!busy && isAwaitingUser(agent.awaitingUserResponse)) {
      last.status = "awaiting-user";
      return last;
    }

    if (!busy) {
      last.status = "idle";
      return last;
    }

    if (deadline != null && Date.now() >= deadline) {
      last.status = "timeout";
      last.elapsedMs = Date.now() - startedAt;
      if (input.throwOnTimeout === true) {
        throw new Error(`waitForIdle timed out after ${timeoutMs}ms`);
      }
      return last;
    }

    const remaining = deadline != null ? Math.max(0, deadline - Date.now()) : intervalMs;
    await delay(Math.min(intervalMs, remaining), undefined, { signal: input.signal });
    if (deadline != null && Date.now() >= deadline) {
      last.status = "timeout";
      last.elapsedMs = Date.now() - startedAt;
      if (input.throwOnTimeout === true) {
        throw new Error(`waitForIdle timed out after ${timeoutMs}ms`);
      }
      return last;
    }
  }
}

function shouldDelete(keepOnFailure: boolean | undefined, status: OneShotStatus): boolean {
  if (keepOnFailure !== true) return true;
  return status === "idle";
}

async function deleteCreated(
  bot: OneShotClient,
  id: string | undefined,
  doDelete: boolean,
): Promise<boolean> {
  if (id == null || !doDelete) return false;
  await bot.deleteAgent({ id });
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function wantsReply(input: { includeReply?: boolean; includeTranscript?: boolean }): boolean {
  if (input.includeReply === false || input.includeTranscript === false) return false;
  return true;
}

/**
 * Host getAgentTranscriptTail / getAgentTranscriptWindow return
 * `{ entries, nextBeforeSeq? }`. getAgentTranscript returns the entries array.
 */
export function entriesFromTranscriptPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.entries)) return value.entries;
  return [];
}

function unwrapEntry(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.kind == null && "entry" in value) return value.entry;
  return value;
}

function textFromSendMessage(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  if (message.type !== "text") return undefined;
  return asNonEmptyString(message.content);
}

function textFromAssistantOrSendMessage(value: unknown): string | undefined {
  const entry = unwrapEntry(value);
  if (!isRecord(entry)) return undefined;
  if (entry.streaming === true) return undefined;
  const kind = asNonEmptyString(entry.kind);
  if (kind === "send-message") return textFromSendMessage(entry.message);
  if (kind === "message" && entry.role === "assistant") {
    return asNonEmptyString(entry.content);
  }
  if (kind == null && entry.role === "assistant") {
    return asNonEmptyString(entry.content);
  }
  return undefined;
}

/**
 * Last assistant / send-message text from host parseTranscriptEntry rows.
 * Walks unknown[] defensively; skips user, tool-call, widget, and junk.
 */
export function lastAssistantTextFromEntries(entries: unknown[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const text = textFromAssistantOrSendMessage(entries[i]);
    if (text != null) return text;
  }
  return undefined;
}

async function readTranscriptPayload(
  read: (() => Promise<unknown>) | undefined,
): Promise<unknown> {
  if (read == null) return undefined;
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** Modest tail — one-shot chats are short; host default is 500. */
const REPLY_TAIL_LIMIT = 50;

/** Host getTranscriptTail default when limit is omitted or invalid. */
const DISCUSSION_TAIL_LIMIT = 500;

function agentRef(value: unknown): { id?: string; name?: string } {
  if (typeof value === "string" && value.length > 0) return { id: value };
  if (!isRecord(value)) return {};
  return {
    ...(asNonEmptyString(value.id) != null ? { id: asNonEmptyString(value.id) } : {}),
    ...(asNonEmptyString(value.name) != null ? { name: asNonEmptyString(value.name) } : {}),
  };
}

function textFromMessageContent(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return undefined;
}

function speakerFromEntry(entry: Record<string, unknown>): { speaker: string; agentId?: string } {
  const author = agentRef(entry.author);
  const fromAgent = agentRef(entry.fromAgent);
  const fromUser = agentRef(entry.fromUser);
  const agentId = author.id ?? fromAgent.id;
  if (author.name != null) return { speaker: author.name, ...(agentId != null ? { agentId } : {}) };
  if (fromAgent.name != null) {
    return { speaker: fromAgent.name, ...(fromAgent.id != null ? { agentId: fromAgent.id } : {}) };
  }
  if (fromUser.name != null) return { speaker: fromUser.name };
  if (entry.role === "user" && fromAgent.id == null && author.id == null) {
    return { speaker: "user" };
  }
  if (entry.role === "assistant") return { speaker: "assistant", ...(agentId != null ? { agentId } : {}) };
  if (agentId != null) return { speaker: agentId, agentId };
  return { speaker: asNonEmptyString(entry.kind) ?? "unknown" };
}

function turnFromEntry(value: unknown): DiscussTurn | undefined {
  const entry = unwrapEntry(value);
  if (!isRecord(entry)) return undefined;
  if (entry.streaming === true) return undefined;
  const kind = asNonEmptyString(entry.kind);
  let text: string | undefined;
  if (kind === "send-message") text = textFromSendMessage(entry.message);
  else if (kind === "message" || kind == null) text = textFromMessageContent(entry.content);
  if (text == null) return undefined;
  const { speaker, agentId } = speakerFromEntry(entry);
  const timestampMs =
    typeof entry.timestampMs === "number" && Number.isFinite(entry.timestampMs)
      ? entry.timestampMs
      : undefined;
  return {
    speaker,
    ...(agentId != null ? { agentId } : {}),
    kind: kind ?? "message",
    text,
    ...(timestampMs != null ? { timestampMs } : {}),
  };
}

/**
 * Ordered discussion turns from host parseTranscriptEntry rows.
 * Group rooms persist member lines as send-message + author (GroupChatGlue
 * postGroupMemberMessage / readGroupHistory). Peer rows use fromAgent / toAgent.
 * Walks unknown[] defensively; skips tools, widgets, notices, streaming previews.
 */
export function turnsFromTranscriptEntries(entries: unknown[]): DiscussTurn[] {
  const turns: DiscussTurn[] = [];
  for (const row of entries) {
    const turn = turnFromEntry(row);
    if (turn != null) turns.push(turn);
  }
  return turns;
}

async function optionalReply(
  bot: OneShotClient,
  id: string | undefined,
  input: { includeReply?: boolean; includeTranscript?: boolean },
): Promise<string | undefined> {
  if (!wantsReply(input) || id == null) return undefined;
  const tail = await readTranscriptPayload(() =>
    bot.getAgentTranscriptTail == null
      ? Promise.resolve(undefined)
      : bot.getAgentTranscriptTail({ id, limit: REPLY_TAIL_LIMIT }),
  );
  const fromTail = lastAssistantTextFromEntries(entriesFromTranscriptPayload(tail));
  if (fromTail != null) return fromTail;
  const full = await readTranscriptPayload(() =>
    bot.getAgentTranscript == null ? Promise.resolve(undefined) : bot.getAgentTranscript({ id }),
  );
  return lastAssistantTextFromEntries(entriesFromTranscriptPayload(full));
}

/**
 * After a host sendPrompt accept: poll waitForIdle, then read the tail reply.
 * Not a host wait field. awaiting-user is a status, not a finished reply.
 */
export async function completeSendPromptWait(
  bot: OneShotClient,
  input: {
    agentId: string;
    accepted: boolean;
    clientNonce?: string;
    timeoutMs?: number;
    intervalMs?: number;
    includeReply?: boolean;
    includeTranscript?: boolean;
    signal?: AbortSignal;
    startedAt?: number;
  },
): Promise<SendPromptWaitResult> {
  const startedAt = input.startedAt ?? Date.now();
  const wait = await waitForIdle(bot, {
    id: input.agentId,
    timeoutMs: input.timeoutMs,
    clientNonce: input.clientNonce,
    intervalMs: input.intervalMs,
    signal: input.signal,
  });
  const reply = await optionalReply(bot, input.agentId, input);
  return {
    accepted: input.accepted,
    status: wait.status,
    elapsedMs: Date.now() - startedAt,
    ...(reply != null ? { reply } : {}),
  };
}

export async function runOnce(
  bot: OneShotClient,
  input: RunOnceInput,
): Promise<OneShotReceipt> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_ONCE_TIMEOUT_MS;
  let id: string | undefined;
  let accepted = false;
  let status: OneShotStatus = "error";
  let deleted = false;
  let error: string | undefined;
  let reply: string | undefined;

  try {
    const created = await bot.createAgent({
      isIntroductionSuppressed: true,
      name: resolveCreateAgentName(input.name),
      description: resolveCreateAgentDescription(input.description),
      ...(input.purpose != null ? { purpose: input.purpose } : {}),
      ...(input.title != null ? { title: input.title } : {}),
    });
    id = created.agent.id;
    const clientNonce = randomUUID();
    const sent = await bot.sendPrompt({
      prompt: input.prompt,
      agentId: id,
      clientNonce,
    });
    accepted = sent.accepted === true;
    const wait = await waitForIdle(bot, {
      id,
      timeoutMs,
      clientNonce,
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    status = wait.status;
    reply = await optionalReply(bot, id, input);
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    deleted = await deleteCreated(bot, id, shouldDelete(input.keepOnFailure, status));
  }

  return {
    id: id ?? "",
    accepted,
    status,
    elapsedMs: Date.now() - startedAt,
    deleted,
    ...(reply != null ? { reply } : {}),
    ...(error != null ? { error } : {}),
  };
}

/**
 * Host-native throwaway: duplicateAgent → manager.cloneAgent, then send/wait/delete
 * the clone. This is a full clone (store.db + automations + profile/settings/avatar
 * / workflow enablement). Groups are rejected. memory/ files are not copied —
 * cloneAgentDir never touches getAgentMemoryDir, and rewriteClonedAgentIdentity
 * is called with includesChatHistory=false (conversation cleared).
 */
export async function runOnceFrom(
  bot: OneShotClient,
  input: RunOnceFromInput,
): Promise<OneShotReceipt> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_ONCE_TIMEOUT_MS;
  const sourceId = await bot.resolveAgent(input.id);
  const roster = await bot.listAgents();
  const source = findAgent(roster, sourceId);
  if (source == null) {
    return {
      id: "",
      accepted: false,
      status: "error",
      elapsedMs: Date.now() - startedAt,
      deleted: false,
      sourceId,
      inheritance: "host-clone",
      error: "That Bot no longer exists.",
    };
  }
  if (source.isGroup) {
    return {
      id: "",
      accepted: false,
      status: "error",
      elapsedMs: Date.now() - startedAt,
      deleted: false,
      sourceId,
      inheritance: "host-clone",
      error: "Groups can't be duplicated yet.",
    };
  }

  let cloneId: string | undefined;
  let accepted = false;
  let status: OneShotStatus = "error";
  let deleted = false;
  let error: string | undefined;
  let reply: string | undefined;

  try {
    const cloned = await bot.duplicateAgent({ id: sourceId });
    cloneId = cloned.agent.id;
    const clientNonce = randomUUID();
    const sent = await bot.sendPrompt({
      prompt: input.prompt,
      agentId: cloneId,
      clientNonce,
    });
    accepted = sent.accepted === true;
    const wait = await waitForIdle(bot, {
      id: cloneId,
      timeoutMs,
      clientNonce,
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    status = wait.status;
    reply = await optionalReply(bot, cloneId, input);
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    deleted = await deleteCreated(bot, cloneId, shouldDelete(input.keepOnFailure, status));
  }

  return {
    id: cloneId ?? "",
    accepted,
    status,
    elapsedMs: Date.now() - startedAt,
    deleted,
    sourceId,
    cloneId: cloneId ?? "",
    inheritance: "host-clone",
    ...(reply != null ? { reply } : {}),
    ...(error != null ? { error } : {}),
  };
}

/**
 * Profile-only throwaway: createAgent with name/description/title/purpose copied
 * from listAgents. Not a host clone — does not copy store.db, automations,
 * avatar, settings, or memory/.
 */
export async function runOnceLike(
  bot: OneShotClient,
  input: RunOnceFromInput,
): Promise<OneShotReceipt> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_ONCE_TIMEOUT_MS;
  const sourceId = await bot.resolveAgent(input.id);
  const roster = await bot.listAgents();
  const source = findAgent(roster, sourceId);
  if (source == null) {
    return {
      id: "",
      accepted: false,
      status: "error",
      elapsedMs: Date.now() - startedAt,
      deleted: false,
      sourceId,
      inheritance: "profile-only",
      error: "That Bot no longer exists.",
    };
  }

  let id: string | undefined;
  let accepted = false;
  let status: OneShotStatus = "error";
  let deleted = false;
  let error: string | undefined;
  let reply: string | undefined;

  try {
    const created = await bot.createAgent({
      isIntroductionSuppressed: true,
      name: resolveCreateAgentName(source.name),
      description: resolveCreateAgentDescription(source.description),
      ...(source.title.length > 0 ? { title: source.title } : {}),
      ...(source.purpose != null ? { purpose: source.purpose } : {}),
    });
    id = created.agent.id;
    const clientNonce = randomUUID();
    const sent = await bot.sendPrompt({
      prompt: input.prompt,
      agentId: id,
      clientNonce,
    });
    accepted = sent.accepted === true;
    const wait = await waitForIdle(bot, {
      id,
      timeoutMs,
      clientNonce,
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    status = wait.status;
    reply = await optionalReply(bot, id, input);
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    deleted = await deleteCreated(bot, id, shouldDelete(input.keepOnFailure, status));
  }

  return {
    id: id ?? "",
    accepted,
    status,
    elapsedMs: Date.now() - startedAt,
    deleted,
    sourceId,
    inheritance: "profile-only",
    ...(reply != null ? { reply } : {}),
    ...(error != null ? { error } : {}),
  };
}

/** Receipt JSON. Includes `reply` when present. Never tokens or lastMessagePreview. */
export function formatOneShotReceipt(receipt: OneShotReceipt): string {
  return `${JSON.stringify({
    id: receipt.id,
    accepted: receipt.accepted,
    status: receipt.status,
    elapsedMs: receipt.elapsedMs,
    deleted: receipt.deleted,
    ...(receipt.sourceId != null ? { sourceId: receipt.sourceId } : {}),
    ...(receipt.cloneId != null ? { cloneId: receipt.cloneId } : {}),
    ...(receipt.inheritance != null ? { inheritance: receipt.inheritance } : {}),
    ...(receipt.reply != null ? { reply: receipt.reply } : {}),
    ...(receipt.error != null ? { error: receipt.error } : {}),
  })}\n`;
}

function shouldDeleteDiscuss(keepOnFailure: boolean | undefined, status: OneShotStatus): boolean {
  if (status === "awaiting-user") return false;
  if (keepOnFailure === true) return status === "idle";
  return true;
}

async function deleteEach(bot: OneShotClient, ids: string[]): Promise<boolean> {
  let deleted = false;
  for (const id of ids) {
    await bot.deleteAgent({ id });
    deleted = true;
  }
  return deleted;
}

async function waitForRoomIdle(
  bot: OneShotClient,
  input: {
    groupId: string;
    cloneIds: string[];
    timeoutMs: number;
    startedAt: number;
    clientNonce?: string;
    intervalMs?: number;
    signal?: AbortSignal;
  },
): Promise<OneShotStatus> {
  let status: OneShotStatus = "idle";
  for (const id of [input.groupId, ...input.cloneIds]) {
    if (status === "timeout" || status === "error") break;
    const remaining = Math.max(1, input.timeoutMs - (Date.now() - input.startedAt));
    const wait = await waitForIdle(bot, {
      id,
      timeoutMs: remaining,
      ...(id === input.groupId && input.clientNonce != null
        ? { clientNonce: input.clientNonce }
        : {}),
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    if (wait.status === "timeout" || wait.status === "error") status = wait.status;
    else if (wait.status === "awaiting-user") status = "awaiting-user";
  }
  return status;
}

async function readDiscussionTurns(
  bot: OneShotClient,
  id: string | undefined,
  input: { includeReply?: boolean; includeTranscript?: boolean },
): Promise<{ turns?: DiscussTurn[]; reply?: string }> {
  if (!wantsReply(input) || id == null) return {};
  const full = await readTranscriptPayload(() =>
    bot.getAgentTranscript == null ? Promise.resolve(undefined) : bot.getAgentTranscript({ id }),
  );
  let entries = entriesFromTranscriptPayload(full);
  if (entries.length === 0) {
    const tail = await readTranscriptPayload(() =>
      bot.getAgentTranscriptTail == null
        ? Promise.resolve(undefined)
        : bot.getAgentTranscriptTail({ id, limit: DISCUSSION_TAIL_LIMIT }),
    );
    entries = entriesFromTranscriptPayload(tail);
  }
  const turns = turnsFromTranscriptEntries(entries);
  const reply = lastAssistantTextFromEntries(entries);
  return {
    ...(turns.length > 0 ? { turns } : {}),
    ...(reply != null ? { reply } : {}),
  };
}

/**
 * Throwaway group discussion: duplicate each source (never the live agents),
 * createGroup with the clone ids, sendPrompt to the group (orchestrator),
 * wait until the group and every clone are idle, snapshot the full room
 * transcript, then delete group then clones.
 *
 * Host createGroup reuses a room with the same member set — that is an error
 * here (clones should make the set unique). Groups cannot be members or
 * duplicated. Does not broadcast or message anyone outside the room.
 *
 * awaiting-user: snapshot, keep the room so a widget can be answered.
 * idle / timeout / error: snapshot, then delete unless keepOnFailure.
 * Omitting `name` mints a unique throwaway name — host createGroup crashes
 * on undefined `name.trim()`.
 */
export async function discussOnce(
  bot: OneShotClient,
  input: DiscussOnceInput,
): Promise<DiscussOnceReceipt> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_ONCE_TIMEOUT_MS;
  const sourceIds: string[] = [];
  const cloneIds: string[] = [];
  let groupId: string | undefined;
  let reusedExistingGroup = false;
  let accepted = false;
  let status: OneShotStatus = "error";
  let deleted = false;
  let error: string | undefined;
  let reply: string | undefined;
  let turns: DiscussTurn[] | undefined;

  const fail = (message: string): DiscussOnceReceipt => ({
    id: "",
    groupId: "",
    cloneIds: [...cloneIds],
    sourceIds: [...sourceIds],
    accepted: false,
    status: "error",
    elapsedMs: Date.now() - startedAt,
    deleted: false,
    error: message,
  });

  if (!Array.isArray(input.agents) || input.agents.length === 0) {
    return fail("discussOnce requires at least one agent.");
  }
  if (input.agents.length > GROUP_MAX_MEMBERS) {
    return fail(`A group can have at most ${GROUP_MAX_MEMBERS} members.`);
  }

  try {
    const roster = await bot.listAgents();
    for (const ref of input.agents) {
      const id = await bot.resolveAgent(ref);
      const source = findAgent(roster, id);
      if (source == null) {
        return fail("That Bot no longer exists.");
      }
      if (source.isGroup) {
        return fail(
          "A group chat can only contain individual agents, not other group chats.",
        );
      }
      sourceIds.push(id);
    }

    for (const sourceId of sourceIds) {
      const cloned = await bot.duplicateAgent({ id: sourceId });
      cloneIds.push(cloned.agent.id);
    }

    const beforeCreate = await bot.listAgents();
    const existingGroupIds = new Set(
      beforeCreate.filter((agent) => agent.isGroup).map((agent) => agent.id),
    );
    const created = await bot.createGroup({
      name: resolveDiscussOnceName(input.name),
      ...(input.description != null ? { description: input.description } : {}),
      memberAgentIds: cloneIds,
    });
    if (existingGroupIds.has(created.agent.id)) {
      reusedExistingGroup = true;
      throw new Error("createGroup reused an existing group with the same member set.");
    }
    groupId = created.agent.id;

    const clientNonce = randomUUID();
    const sent = await bot.sendPrompt({
      prompt: input.prompt,
      agentId: groupId,
      clientNonce,
    });
    accepted = sent.accepted === true;
    status = await waitForRoomIdle(bot, {
      groupId,
      cloneIds,
      timeoutMs,
      startedAt,
      clientNonce,
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    const snapshot = await readDiscussionTurns(bot, groupId, input);
    turns = snapshot.turns;
    reply = snapshot.reply;
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
    if (groupId != null && turns == null) {
      const snapshot = await readDiscussionTurns(bot, groupId, input);
      turns = snapshot.turns;
      reply = snapshot.reply;
    }
  } finally {
    const doDelete = shouldDeleteDiscuss(input.keepOnFailure, status);
    const ids: string[] = [];
    if (doDelete && groupId != null && !reusedExistingGroup) ids.push(groupId);
    if (doDelete) ids.push(...cloneIds);
    deleted = await deleteEach(bot, ids);
  }

  return {
    id: groupId ?? "",
    groupId: groupId ?? "",
    cloneIds,
    sourceIds,
    accepted,
    status,
    elapsedMs: Date.now() - startedAt,
    deleted,
    ...(reply != null ? { reply } : {}),
    ...(turns != null ? { turns, transcript: turns } : {}),
    ...(error != null ? { error } : {}),
  };
}

/** Alias for discussOnce. */
export const runOnceDiscuss = discussOnce;

/** Human turn list: `speaker: text` per line. */
export function formatDiscussTurns(turns: DiscussTurn[]): string {
  return `${turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")}\n`;
}

/** Receipt JSON plus the full turn list. Never tokens or lastMessagePreview. */
export function formatDiscussReceipt(receipt: DiscussOnceReceipt): string {
  const body = `${JSON.stringify({
    id: receipt.id,
    groupId: receipt.groupId,
    cloneIds: receipt.cloneIds,
    sourceIds: receipt.sourceIds,
    accepted: receipt.accepted,
    status: receipt.status,
    elapsedMs: receipt.elapsedMs,
    deleted: receipt.deleted,
    ...(receipt.reply != null ? { reply: receipt.reply } : {}),
    ...(receipt.turns != null ? { turns: receipt.turns, transcript: receipt.transcript } : {}),
    ...(receipt.error != null ? { error: receipt.error } : {}),
  })}\n`;
  if (receipt.turns == null || receipt.turns.length === 0) return body;
  return `${formatDiscussTurns(receipt.turns)}${body}`;
}

/** Prefix for minted sendAsAgent bus names when the caller omits `name`. */
export const SEND_AS_AGENT_DEFAULT_NAME_PREFIX = "bus-";

/**
 * Host createAgent mintAgent forwards `{ name: args.name }` with no default.
 * materializeSession then does `profile?.name.trim()` and throws when name
 * is omitted. Blank / whitespace-only names are treated as omitted.
 */
export function resolveSendAsAgentName(name?: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length > 0) return trimmed;
  return `${SEND_AS_AGENT_DEFAULT_NAME_PREFIX}${randomUUID()}`;
}

/**
 * Tight bus prompt: one SendToAgent to the resolved target id, then stop.
 * Not a host command — the seat calls the SendToAgent tool during its turn.
 */
export function sendAsAgentPrompt(targetId: string, message: string): string {
  return [
    "Call SendToAgent exactly once.",
    `target_id: ${targetId}`,
    "Pass the message below as the SendToAgent message argument, verbatim.",
    "Do not message anyone else. Do not use SendMessage. Do not create memories.",
    "Do not implement, edit files, or run tools other than SendToAgent.",
    "Do not wait for a reply. After SendToAgent returns, stop.",
    "",
    "Message:",
    message,
  ].join("\n");
}

export type SendAsAgentInput = {
  /** Roster name or id of the recipient. Never `"all"`. */
  to: string;
  /** Text the bus passes to SendToAgent. */
  message: string;
  /**
   * Existing bus seat (name or id). When set, that seat is prompted and
   * not deleted. Alias of `from`.
   */
  bus?: string;
  /** Existing bus seat (name or id). Alias of `bus`. */
  from?: string;
  /**
   * When true, keep a minted throwaway bus after the send. Ignored in
   * reuse mode (an existing bus is never deleted).
   */
  keepBus?: boolean;
  /** Bus display name. When omitted or blank, a unique `bus-<uuid>` is minted. */
  name?: string;
  /**
   * Always sent as a string (`""` when omitted). Host mintAgent does not
   * default description; materializeSession then does `description.trim()`.
   */
  description?: string;
  timeoutMs?: number;
  intervalMs?: number;
  /**
   * Default true. When false, skip the host tail read and omit `reply`.
   */
  includeReply?: boolean;
  /** Alias for includeReply. false also opts out. */
  includeTranscript?: boolean;
  signal?: AbortSignal;
};

/**
 * Bus-seat receipt. `reply` is the last assistant / send-message text from
 * the bus transcript, not the recipient's reply and not roster
 * lastMessagePreview. No token/usage fields. No waitForCompletion.
 */
export type SendAsAgentReceipt = {
  id: string;
  busId: string;
  targetId: string;
  accepted: boolean;
  status: OneShotStatus;
  elapsedMs: number;
  deleted: boolean;
  /** Last assistant / send-message text from the bus seat. */
  reply?: string;
  error?: string;
};

function reuseBusRef(input: SendAsAgentInput): string | undefined {
  const bus = typeof input.bus === "string" ? input.bus.trim() : "";
  if (bus.length > 0) return bus;
  const from = typeof input.from === "string" ? input.from.trim() : "";
  if (from.length > 0) return from;
  return undefined;
}

/**
 * SDK-only peer send: mint or reuse a bus seat, sendPrompt that seat to call
 * the SendToAgent tool once, wait until the bus is idle, then delete the
 * throwaway unless keepBus / reuse. There is no host sendToAgent command —
 * POST /api/sendToAgent is unknown. Host agentToAgent.sendToAgent is only
 * reachable as the SendToAgent tool during a seat's turn. Survives Computer
 * Update because it uses existing host commands only (createAgent, sendPrompt,
 * waitForIdle, deleteAgent, listAgents). Never broadcastToAgents.
 */
export async function sendAsAgent(
  bot: OneShotClient,
  input: SendAsAgentInput,
): Promise<SendAsAgentReceipt> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_ONCE_TIMEOUT_MS;
  const reuseRef = reuseBusRef(input);
  const minted = reuseRef == null;
  let busId: string | undefined;
  let targetId = "";
  let accepted = false;
  let status: OneShotStatus = "error";
  let deleted = false;
  let error: string | undefined;
  let reply: string | undefined;

  const fail = (message: string): SendAsAgentReceipt => ({
    id: busId ?? "",
    busId: busId ?? "",
    targetId,
    accepted: false,
    status: "error",
    elapsedMs: Date.now() - startedAt,
    deleted: false,
    error: message,
  });

  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (to.length === 0) {
    return fail("sendAsAgent requires to (agent name or id).");
  }
  if (to.toLowerCase() === "all") {
    return fail("sendAsAgent refuses to: \"all\". Pass an explicit agent name or id.");
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (message.length === 0) {
    return fail("sendAsAgent requires a message.");
  }

  try {
    targetId = await bot.resolveAgent(to);
    if (reuseRef != null) {
      busId = await bot.resolveAgent(reuseRef);
    } else {
      const created = await bot.createAgent({
        isIntroductionSuppressed: true,
        name: resolveSendAsAgentName(input.name),
        description: resolveCreateAgentDescription(input.description),
      });
      busId = created.agent.id;
    }
    if (busId === targetId) {
      throw new Error("sendAsAgent cannot message the bus seat itself.");
    }

    const clientNonce = randomUUID();
    const sent = await bot.sendPrompt({
      prompt: sendAsAgentPrompt(targetId, message),
      agentId: busId,
      clientNonce,
    });
    accepted = sent.accepted === true;
    const wait = await waitForIdle(bot, {
      id: busId,
      timeoutMs,
      clientNonce,
      intervalMs: input.intervalMs,
      signal: input.signal,
    });
    status = wait.status;
    reply = await optionalReply(bot, busId, input);
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    const doDelete = minted && input.keepBus !== true;
    deleted = await deleteCreated(bot, busId, doDelete);
  }

  return {
    id: busId ?? "",
    busId: busId ?? "",
    targetId,
    accepted,
    status,
    elapsedMs: Date.now() - startedAt,
    deleted,
    ...(reply != null ? { reply } : {}),
    ...(error != null ? { error } : {}),
  };
}

/** Alias for sendAsAgent. */
export const runOnceSendToAgent = sendAsAgent;

/** Receipt JSON. Includes `reply` when present. Never tokens or lastMessagePreview. */
export function formatSendAsAgentReceipt(receipt: SendAsAgentReceipt): string {
  return `${JSON.stringify({
    id: receipt.id,
    busId: receipt.busId,
    targetId: receipt.targetId,
    accepted: receipt.accepted,
    status: receipt.status,
    elapsedMs: receipt.elapsedMs,
    deleted: receipt.deleted,
    ...(receipt.reply != null ? { reply: receipt.reply } : {}),
    ...(receipt.error != null ? { error: receipt.error } : {}),
  })}\n`;
}
