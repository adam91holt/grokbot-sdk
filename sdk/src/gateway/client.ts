import { randomUUID } from "node:crypto";
import type {
  AgentAvatarResult,
  AgentChannelsResult,
  AgentSearchHit,
  AgentSummary,
  AllAutomationRow,
  AsyncTaskRecord,
  BoxMcpServersResult,
  BoxStoreStatus,
  BroadcastResult,
  ConversationOutlineItem,
  CreateAgentResult,
  DeleteAgentResult,
  DiskSaverAuditResult,
  GatewayAutomation,
  GatewayDiscovery,
  GatewayEvent,
  GatewayWorkflow,
  HealthResponse,
  HostSettings,
  HostStatus,
  InterruptAgentRunResult,
  KickstartAgentResult,
  ListenerConnectUrlResult,
  ListenerIntegrationsResult,
  MemoryRecord,
  PluginSyncStatus,
  PromptAcceptanceStatus,
  PromptAcceptanceStatusInput,
  GatewaySearchMediaRow,
  SendPromptInput,
  SendPromptResult,
  SkillCatalogEntry,
  SubagentRecord,
  TranscriptPageResult,
  TranscriptTailResult,
  TranscriptThreadResult,
  TranscriptWindowResult,
  WidgetAcceptedResult,
  WorkflowImportResult,
} from "../types.js";
import { evaluateCompat, type CompatVerdict } from "./compat.js";
import {
  GATEWAY_API_PREFIX,
  GATEWAY_AUTH_SCHEME,
  GATEWAY_AVATARS_PATH,
  GATEWAY_EVENTS_PATH,
  GATEWAY_HEALTH_PATH,
  GATEWAY_REQUEST_ID_HEADER,
  GATEWAY_SLIM_AVATARS_HEADER,
  assertGatewayCommandAllowed,
  type AgentIdBody,
  type AgentThreadInput,
  type AutomationIdInput,
  type BroadcastInput,
  type CreateAgentInput,
  type CreateAutomationInput,
  type CreateGroupInput,
  type CreateWorkflowInput,
  type DeleteMemoryInput,
  type DismissWidgetInput,
  type ForeverBoxStatusInput,
  type GatewayCommandName,
  type ImportWorkflowTextInput,
  type ImportWorkflowUrlInput,
  type ListBoxMcpServersInput,
  type ListenerConnectUrlInput,
  type OpenAgentBoundedInput,
  type ReactToMessageInput,
  type SearchQueryInput,
  type SetAutomationEnabledInput,
  type SetGroupMembersInput,
  type SetHiddenInput,
  type SetNotifyInput,
  type SetUnreadInput,
  type SetWorkflowEnabledInput,
  type TranscriptPageInput,
  type TranscriptWindowInput,
  type UpdateAgentInput,
  type UpdateAutomationInput,
  type UpdateWorkflowInput,
  type WidgetResponseInput,
  type WorkflowIdInput,
} from "./commands.js";
import { toHostAutomationSpec } from "../once-trigger.js";
import {
  composeGatewayAbort,
  isTimeoutAbort,
  resolveGatewayTimeoutMs,
  type GatewayRequestOptions,
} from "./abort.js";
import {
  discoverGateway,
  normalizeGatewayBaseUrl,
  publicDiscovery,
  redactSecret,
  type DiscoverOptions,
  type ResolvedGateway,
} from "./discovery.js";
import { GrokBotGatewayError } from "./errors.js";
import {
  completeSendPromptWait,
  discussOnce,
  runOnce,
  runOnceFrom,
  runOnceLike,
  runOnceDiscuss,
  runOnceSendToAgent,
  sendAsAgent,
  toHostCreateAgentBody,
  toHostSendPromptBody,
  waitForIdle,
  type DiscussOnceInput,
  type DiscussOnceReceipt,
  type RunOnceFromInput,
  type RunOnceInput,
  type OneShotReceipt,
  type SendAsAgentInput,
  type SendAsAgentReceipt,
  type SendPromptCallInput,
  type SendPromptWaitResult,
  type WaitForIdleInput,
  type WaitForIdleResult,
} from "./oneshot.js";
import { parseConversationOutline } from "./outline.js";
import { resolveAgentId } from "./resolve-agent.js";
import { resolveDiskAgent } from "../disk/agents.js";
import { resolveSandRoot } from "../paths.js";

export { DEFAULT_GATEWAY_TIMEOUT_MS, type GatewayRequestOptions } from "./abort.js";
export { DISCOVERY_COMMAND, GrokBotGatewayError, discoveryFailureHint } from "./errors.js";

export type GrokBotOptions = DiscoverOptions &
  GatewayRequestOptions & {
    /**
     * Override the final request origin after discovery.
     * Prefer `gatewayUrl` (or GROKBOT_GATEWAY_URL) so scheme/host/port stay in sync.
     */
    baseUrl?: string;
    /**
     * Override token. Prefer SAND_GATEWAY_TOKEN or gateway.json.
     * Never log this value.
     */
    token?: string;
    /** Default true — ask the host to strip inline avatar data URLs. */
    slimAvatars?: boolean;
    /**
     * Allow box-destructive / channel / secrets / webauthn commands via
     * `command()`. Default false. Typed wrappers never need this.
     */
    allowUnsafeCommands?: boolean;
    fetch?: typeof fetch;
  };

export class GrokBot {
  readonly slimAvatars: boolean;
  readonly timeoutMs: number | undefined;
  readonly allowUnsafeCommands: boolean;
  #options: GrokBotOptions;
  #resolved: ResolvedGateway | null = null;
  #fetch: typeof fetch;

  constructor(options: GrokBotOptions = {}) {
    this.#options = options;
    this.slimAvatars = options.slimAvatars !== false;
    this.timeoutMs = options.timeoutMs;
    this.allowUnsafeCommands = options.allowUnsafeCommands === true;
    this.#fetch = options.fetch ?? fetch;
  }

  static fromDiscovery(options: GrokBotOptions = {}): GrokBot {
    return new GrokBot(options);
  }

  refreshDiscovery(): GatewayDiscovery {
    this.#resolved = this.#load();
    return publicDiscovery(this.#resolved);
  }

  discovery(): GatewayDiscovery {
    return publicDiscovery(this.#ensure());
  }

  /**
   * Resolve a roster name or id to the agent id host POST bodies use.
   * UUID / `sand-subagent-*` values pass through. Names use disk
   * `resolveAgent` then gateway `listAgents`. sendPrompt still sends
   * the resolved value as `agentId`.
   */
  async resolveAgent(idOrName: string): Promise<string> {
    const sandRoot = this.#options.sandRoot ?? resolveSandRoot(this.#options.env);
    return await resolveAgentId(idOrName, {
      resolveDisk: (needle) => resolveDiskAgent(needle, sandRoot),
      listAgents: async () => await this.listAgents(),
    });
  }

  async #agentBody<T extends { id: string }>(body: T): Promise<T> {
    return { ...body, id: await this.resolveAgent(body.id) };
  }

  get baseUrl(): string {
    if (this.#options.baseUrl != null && this.#options.baseUrl.trim().length > 0) {
      return normalizeGatewayBaseUrl(this.#options.baseUrl);
    }
    return this.#ensure().baseUrl;
  }

  async health(options?: GatewayRequestOptions): Promise<HealthResponse> {
    const requestId = randomUUID();
    const res = await this.#request("GET", GATEWAY_HEALTH_PATH, {
      requestId,
      command: "health",
      auth: false,
      ...options,
    });
    return (await this.#readJson(res, "health", requestId)) as HealthResponse;
  }

  async avatar(agentId: string, options?: GatewayRequestOptions): Promise<Uint8Array> {
    const requestId = randomUUID();
    const path = `${GATEWAY_AVATARS_PATH}/${encodeURIComponent(agentId)}`;
    const res = await this.#request("GET", path, {
      requestId,
      command: `avatars/${agentId}`,
      auth: true,
      ...options,
    });
    if (!res.ok) {
      throw await this.#error(res, `avatars/${agentId}`, requestId);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * SSE GET /events?channels= — async iterator of { channel, payload }.
   * Pass channel names to filter; omit for all channels.
   * Does not apply the default unary timeout (streams stay open).
   */
  async *events(
    channels?: string[],
    options?: GatewayRequestOptions,
  ): AsyncGenerator<GatewayEvent> {
    const requestId = randomUUID();
    const query =
      channels != null && channels.length > 0
        ? `?channels=${encodeURIComponent(channels.join(","))}`
        : "";
    const res = await this.#request("GET", `${GATEWAY_EVENTS_PATH}${query}`, {
      requestId,
      command: "events",
      auth: true,
      accept: "text/event-stream",
      applyDefaultTimeout: false,
      ...options,
    });
    if (!res.ok) {
      throw await this.#error(res, "events", requestId);
    }
    if (res.body == null) return;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const block of parts) {
        const event = parseSseBlock(block);
        if (event != null) yield event;
      }
    }
    // Flush a trailing multi-byte UTF-8 sequence held by stream:true.
    buffer += decoder.decode();
    const tail = parseSseBlock(buffer);
    if (tail != null) yield tail;
  }

  /**
   * Compare live `getHostStatus()` to the extracted host-snapshot manifest.
   * Verdict only — never tokens or command payloads.
   */
  async compat(options?: GatewayRequestOptions): Promise<CompatVerdict> {
    const status = await this.getHostStatus(options);
    return evaluateCompat(status);
  }

  /**
   * Generic POST /api/<name>. Omits the JSON body when `body` is undefined
   * (does not coerce a missing body to `{}`).
   *
   * Box-destructive, channel, secrets, and webauthn names require
   * `allowUnsafeCommands` or `commandUnsafe()`. Unknown non-unsafe names
   * are allowed so new host commands can be reached without a wrapper.
   */
  async command<TIn, TOut>(
    name: GatewayCommandName | string,
    body?: TIn,
    options?: GatewayRequestOptions,
  ): Promise<TOut> {
    return await this.#postCommand(name, body, options, this.allowUnsafeCommands);
  }

  /**
   * Escape hatch for unsugared unsafe commands (box-destructive, channel,
   * secrets, webauthn). Same POST as `command()`, with the unsafe gate off.
   */
  async commandUnsafe<TIn, TOut>(
    name: GatewayCommandName | string,
    body?: TIn,
    options?: GatewayRequestOptions,
  ): Promise<TOut> {
    return await this.#postCommand(name, body, options, true);
  }

  async #postCommand<TIn, TOut>(
    name: string,
    body: TIn | undefined,
    options: GatewayRequestOptions | undefined,
    allowUnsafeCommands: boolean,
  ): Promise<TOut> {
    assertGatewayCommandAllowed(name, allowUnsafeCommands);
    const requestId = randomUUID();
    const path = `${GATEWAY_API_PREFIX}/${name}`;
    const res = await this.#request("POST", path, {
      requestId,
      command: name,
      auth: true,
      ...(body !== undefined ? { json: body } : {}),
      ...options,
    });
    return (await this.#readJson(res, name, requestId)) as TOut;
  }

  // --- Agents ---

  listAgents(): Promise<AgentSummary[]> {
    return this.command("listAgents", {});
  }

  countAgents(): Promise<number> {
    return this.command("countAgents", {});
  }

  searchAgents(body: SearchQueryInput): Promise<AgentSearchHit[]> {
    return this.command("searchAgents", body);
  }

  /**
   * Always POSTs a string name and description. Host mintAgent forwards
   * `{ name: args.name, description: args.description }` with no `?? ""`;
   * materializeSession then does `profile?.name.trim()` /
   * `profile?.description.trim()`. Omitting name mints `throwaway-<uuid>`.
   * Omitting description sends `""`.
   */
  createAgent(body: CreateAgentInput = {}): Promise<CreateAgentResult> {
    return this.command("createAgent", toHostCreateAgentBody(body));
  }

  async updateAgent(body: UpdateAgentInput): Promise<AgentSummary | null> {
    return await this.command("updateAgent", await this.#agentBody(body));
  }

  async deleteAgent(body: AgentIdBody): Promise<DeleteAgentResult> {
    return await this.command("deleteAgent", await this.#agentBody(body));
  }

  async duplicateAgent(body: AgentIdBody): Promise<CreateAgentResult> {
    return await this.command("duplicateAgent", await this.#agentBody(body));
  }

  async openAgent(body: AgentIdBody): Promise<unknown[]> {
    return await this.command("openAgent", await this.#agentBody(body));
  }

  async setAgentUnread(body: SetUnreadInput): Promise<null> {
    return await this.command("setAgentUnread", await this.#agentBody(body));
  }

  async setAgentHiddenFromSidebar(body: SetHiddenInput): Promise<null> {
    return await this.command("setAgentHiddenFromSidebar", await this.#agentBody(body));
  }

  /**
   * createHostGatewayApi.setAgentNotificationsEnabled.
   * Distinct from setAgentNotifyOnUpdates. Host handler is currently a no-op.
   */
  async setAgentNotificationsEnabled(body: SetNotifyInput): Promise<null> {
    return await this.command("setAgentNotificationsEnabled", await this.#agentBody(body));
  }

  async setAgentNotifyOnUpdates(body: SetNotifyInput): Promise<null> {
    return await this.command("setAgentNotifyOnUpdates", await this.#agentBody(body));
  }

  createGroup(body: CreateGroupInput): Promise<CreateAgentResult> {
    return this.command("createGroup", body);
  }

  async setGroupMembers(body: SetGroupMembersInput): Promise<AgentSummary | null> {
    return await this.command("setGroupMembers", await this.#agentBody(body));
  }

  // --- Chat ---

  async sendPrompt(body: SendPromptCallInput & { wait: true }): Promise<SendPromptWaitResult>;
  async sendPrompt(body: SendPromptInput & { wait?: false }): Promise<SendPromptResult>;
  async sendPrompt(body: SendPromptCallInput): Promise<SendPromptResult | SendPromptWaitResult> {
    const hostBody = toHostSendPromptBody(body);
    const startedAt = Date.now();
    if (hostBody.agentId == null || hostBody.agentId.trim().length === 0) {
      if (body.wait === true) {
        throw new Error("sendPrompt wait: true requires agentId");
      }
      return await this.command<SendPromptInput, SendPromptResult>("sendPrompt", hostBody);
    }
    const agentId = await this.resolveAgent(hostBody.agentId);
    const sent = await this.command<SendPromptInput, SendPromptResult>("sendPrompt", {
      ...hostBody,
      agentId,
    });
    if (body.wait !== true) return sent;
    return await completeSendPromptWait(this, {
      agentId,
      accepted: sent.accepted === true,
      clientNonce: hostBody.clientNonce,
      timeoutMs: body.timeoutMs,
      intervalMs: body.intervalMs,
      includeReply: body.includeReply,
      includeTranscript: body.includeTranscript,
      signal: body.signal,
      startedAt,
    });
  }

  getTranscript(): Promise<unknown[]> {
    return this.command("getTranscript", {});
  }

  async getAgentTranscript(body: AgentIdBody): Promise<unknown[]> {
    return await this.command("getAgentTranscript", await this.#agentBody(body));
  }

  async getAgentTranscriptPage(body: TranscriptPageInput): Promise<TranscriptPageResult> {
    return await this.command("getAgentTranscriptPage", await this.#agentBody(body));
  }

  async getAgentTranscriptWindow(body: TranscriptWindowInput): Promise<TranscriptWindowResult> {
    return await this.command("getAgentTranscriptWindow", await this.#agentBody(body));
  }

  async getAgentTranscriptTail(body: TranscriptWindowInput): Promise<TranscriptTailResult> {
    return await this.command("getAgentTranscriptTail", await this.#agentBody(body));
  }

  async getAgentThread(body: AgentThreadInput): Promise<TranscriptThreadResult> {
    return await this.command("getAgentThread", await this.#agentBody(body));
  }

  async getConversationOutline(body: AgentIdBody): Promise<ConversationOutlineItem[]> {
    const raw = await this.command("getConversationOutline", await this.#agentBody(body));
    return parseConversationOutline(raw);
  }

  async interruptAgentRun(body: AgentIdBody): Promise<InterruptAgentRunResult> {
    return await this.command("interruptAgentRun", await this.#agentBody(body));
  }

  async respondToWidget(body: WidgetResponseInput): Promise<WidgetAcceptedResult> {
    if (body.agentId == null || body.agentId.trim().length === 0) {
      return await this.command("respondToWidget", body);
    }
    return await this.command("respondToWidget", {
      ...body,
      agentId: await this.resolveAgent(body.agentId),
    });
  }

  async dismissWidget(body: DismissWidgetInput): Promise<WidgetAcceptedResult> {
    if (body.agentId == null || body.agentId.trim().length === 0) {
      return await this.command("dismissWidget", body);
    }
    return await this.command("dismissWidget", {
      ...body,
      agentId: await this.resolveAgent(body.agentId),
    });
  }

  async reactToMessage(body: ReactToMessageInput): Promise<null> {
    if (body.agentId == null || body.agentId.trim().length === 0) {
      return await this.command("reactToMessage", body);
    }
    return await this.command("reactToMessage", {
      ...body,
      agentId: await this.resolveAgent(body.agentId),
    });
  }

  promptAcceptanceStatus(body: PromptAcceptanceStatusInput): Promise<PromptAcceptanceStatus> {
    return this.command("promptAcceptanceStatus", body);
  }

  /**
   * Client poll until the agent is idle. Uses listAgents (isRunning /
   * isComposingMessage / awaitingUserResponse), getAsyncTasks, getSubagents,
   * and promptAcceptanceStatus when a nonce is passed (accountSlot is always
   * HOST_ACCOUNT_SLOT). Not a host command. Host sendPrompt is still
   * `{ accepted: true }`; pass SDK `wait: true` to poll after accept.
   */
  async waitForIdle(input: WaitForIdleInput): Promise<WaitForIdleResult> {
    return await waitForIdle(this, input);
  }

  /**
   * createAgent (introduction suppressed) → sendPrompt (minted clientNonce) →
   * waitForIdle → read tail `reply` → deleteAgent in finally.
   * Always POSTs a string name and description (mints `throwaway-<uuid>` and
   * `""` when omitted). Pass includeReply: false for metadata-only.
   */
  async runOnce(input: RunOnceInput): Promise<OneShotReceipt> {
    return await runOnce(this, input);
  }

  /**
   * duplicateAgent (manager.cloneAgent) → send → wait → delete the clone.
   * Rejects groups. Full host clone, not a persona-only thread.
   */
  async runOnceFrom(input: RunOnceFromInput): Promise<OneShotReceipt> {
    return await runOnceFrom(this, input);
  }

  /**
   * Profile-only throwaway: createAgent with copied name/description/title/purpose.
   * Does not clone store.db, automations, or memory/.
   */
  async runOnceLike(input: RunOnceFromInput): Promise<OneShotReceipt> {
    return await runOnceLike(this, input);
  }

  /**
   * Throwaway group discussion: duplicate each source, createGroup with the
   * clone ids, sendPrompt to the group, wait until the group and every clone
   * are idle, snapshot the full room transcript, then delete group then clones.
   * Reused same-member-set groups are an error. awaiting-user keeps the room.
   * Omitting `name` mints a unique throwaway name (host createGroup crashes
   * on undefined `name.trim()`).
   */
  async discussOnce(input: DiscussOnceInput): Promise<DiscussOnceReceipt> {
    return await discussOnce(this, input);
  }

  /** Alias for discussOnce. */
  async runOnceDiscuss(input: DiscussOnceInput): Promise<DiscussOnceReceipt> {
    return await runOnceDiscuss(this, input);
  }

  /**
   * SDK-only peer send: mint or reuse a bus seat, sendPrompt that seat to
   * call the SendToAgent tool once, wait until idle, then deleteAgent the
   * throwaway unless keepBus / reuse. There is no host sendToAgent command.
   */
  async sendAsAgent(input: SendAsAgentInput): Promise<SendAsAgentReceipt> {
    return await sendAsAgent(this, input);
  }

  /** Alias for sendAsAgent. */
  async runOnceSendToAgent(input: SendAsAgentInput): Promise<SendAsAgentReceipt> {
    return await runOnceSendToAgent(this, input);
  }

  // --- Memory ---

  async getAgentMemories(body: AgentIdBody): Promise<MemoryRecord[]> {
    return await this.command("getAgentMemories", await this.#agentBody(body));
  }

  async deleteAgentMemory(body: DeleteMemoryInput): Promise<MemoryRecord[]> {
    return await this.command("deleteAgentMemory", await this.#agentBody(body));
  }

  async clearAgentMemories(body: AgentIdBody): Promise<MemoryRecord[]> {
    return await this.command("clearAgentMemories", await this.#agentBody(body));
  }

  // --- Automations ---

  async getAgentAutomations(body: AgentIdBody): Promise<GatewayAutomation[]> {
    return await this.command("getAgentAutomations", await this.#agentBody(body));
  }

  listAllAutomations(): Promise<AllAutomationRow[]> {
    return this.command("listAllAutomations", {});
  }

  async createAgentAutomation(body: CreateAutomationInput): Promise<GatewayAutomation[]> {
    return await this.command(
      "createAgentAutomation",
      await this.#agentBody({ ...body, spec: toHostAutomationSpec(body.spec) }),
    );
  }

  async updateAgentAutomation(body: UpdateAutomationInput): Promise<GatewayAutomation[]> {
    return await this.command(
      "updateAgentAutomation",
      await this.#agentBody({ ...body, spec: toHostAutomationSpec(body.spec) }),
    );
  }

  async deleteAgentAutomation(body: AutomationIdInput): Promise<GatewayAutomation[]> {
    return await this.command("deleteAgentAutomation", await this.#agentBody(body));
  }

  async setAgentAutomationEnabled(body: SetAutomationEnabledInput): Promise<GatewayAutomation[]> {
    return await this.command("setAgentAutomationEnabled", await this.#agentBody(body));
  }

  async runAgentAutomationNow(body: AutomationIdInput): Promise<null> {
    return await this.command("runAgentAutomationNow", await this.#agentBody(body));
  }

  // --- Workflows ---

  async getAgentWorkflows(body: AgentIdBody): Promise<GatewayWorkflow[]> {
    return await this.command("getAgentWorkflows", await this.#agentBody(body));
  }

  async createAgentWorkflow(body: CreateWorkflowInput): Promise<GatewayWorkflow[]> {
    return await this.command("createAgentWorkflow", await this.#agentBody(body));
  }

  async updateAgentWorkflow(body: UpdateWorkflowInput): Promise<GatewayWorkflow[]> {
    return await this.command("updateAgentWorkflow", await this.#agentBody(body));
  }

  async deleteAgentWorkflow(body: WorkflowIdInput): Promise<GatewayWorkflow[]> {
    return await this.command("deleteAgentWorkflow", await this.#agentBody(body));
  }

  async setAgentWorkflowEnabled(body: SetWorkflowEnabledInput): Promise<GatewayWorkflow[]> {
    return await this.command("setAgentWorkflowEnabled", await this.#agentBody(body));
  }

  async runAgentWorkflowNow(body: WorkflowIdInput): Promise<null> {
    return await this.command("runAgentWorkflowNow", await this.#agentBody(body));
  }

  skillsCatalog(): Promise<SkillCatalogEntry[]> {
    return this.command("skillsCatalog", {});
  }

  // --- Broadcast / search / host ---

  broadcastToAgents(body: BroadcastInput): Promise<BroadcastResult> {
    return this.command("broadcastToAgents", body);
  }

  searchMedia(body: SearchQueryInput): Promise<GatewaySearchMediaRow[]> {
    return this.command("searchMedia", body);
  }

  getHostSettings(): Promise<HostSettings> {
    return this.command("getHostSettings", {});
  }

  getHostStatus(options?: GatewayRequestOptions): Promise<HostStatus> {
    return this.command("getHostStatus", {}, options);
  }

  async getForeverBoxStatus(body: ForeverBoxStatusInput): Promise<unknown> {
    return await this.command("getForeverBoxStatus", await this.#agentBody(body));
  }

  async kickstartAgent(body: AgentIdBody): Promise<KickstartAgentResult> {
    return await this.command("kickstartAgent", await this.#agentBody(body));
  }

  async getAgentChannels(body: AgentIdBody): Promise<AgentChannelsResult> {
    return await this.command("getAgentChannels", await this.#agentBody(body));
  }

  async getSubagents(body: AgentIdBody): Promise<SubagentRecord[]> {
    return await this.command("getSubagents", await this.#agentBody(body));
  }

  async getAsyncTasks(body: AgentIdBody): Promise<AsyncTaskRecord[]> {
    return await this.command("getAsyncTasks", await this.#agentBody(body));
  }

  isAgentNetworkEnabled(): Promise<boolean> {
    return this.command("isAgentNetworkEnabled", {});
  }

  isGlobalSearchEnabled(): Promise<boolean> {
    return this.command("isGlobalSearchEnabled", {});
  }

  async isEgressTunnelAvailable(): Promise<boolean> {
    return await this.command("isEgressTunnelAvailable", {});
  }

  /**
   * POST /api/getAgentAvatar — data URL + version.
   * Distinct from avatar() which is GET /avatars/:id (raw PNG bytes).
   */
  async getAgentAvatar(body: AgentIdBody): Promise<AgentAvatarResult> {
    return await this.command("getAgentAvatar", await this.#agentBody(body));
  }

  async requestDiskSaverAudit(body: AgentIdBody): Promise<DiskSaverAuditResult> {
    return await this.command("requestDiskSaverAudit", await this.#agentBody(body));
  }

  /**
   * Always send `serverIdentifiers` as an array. Host `[...serverIdentifiers]`
   * throws if the key is omitted (`{}` → undefined). `[]` lists every server.
   */
  async listBoxMcpServers(body?: ListBoxMcpServersInput): Promise<BoxMcpServersResult> {
    const serverIdentifiers = Array.isArray(body?.serverIdentifiers)
      ? body.serverIdentifiers
      : [];
    return await this.command("listBoxMcpServers", { serverIdentifiers });
  }

  async getPluginSyncStatus(): Promise<PluginSyncStatus> {
    return await this.command("getPluginSyncStatus", {});
  }

  async getListenerIntegrations(): Promise<ListenerIntegrationsResult> {
    return await this.command("getListenerIntegrations", {});
  }

  async getListenerConnectUrl(body: ListenerConnectUrlInput): Promise<ListenerConnectUrlResult> {
    return await this.command("getListenerConnectUrl", body);
  }

  async getBoxStoreStatus(): Promise<BoxStoreStatus> {
    return await this.command("getBoxStoreStatus", {});
  }

  /** Sessions.openAgentWindowed — switches the active agent, then a window. */
  async openAgentWindowed(body: OpenAgentBoundedInput): Promise<TranscriptWindowResult> {
    return await this.command("openAgentWindowed", await this.#agentBody(body));
  }

  /** Sessions.openAgentTail — switches the active agent, then a tail. */
  async openAgentTail(body: OpenAgentBoundedInput): Promise<TranscriptTailResult> {
    return await this.command("openAgentTail", await this.#agentBody(body));
  }

  async importAgentWorkflowText(body: ImportWorkflowTextInput): Promise<WorkflowImportResult> {
    return await this.command("importAgentWorkflowText", await this.#agentBody(body));
  }

  async importAgentWorkflowUrl(body: ImportWorkflowUrlInput): Promise<WorkflowImportResult> {
    return await this.command("importAgentWorkflowUrl", await this.#agentBody(body));
  }

  async portAgentLocalSkills(body: AgentIdBody): Promise<WorkflowImportResult> {
    return await this.command("portAgentLocalSkills", await this.#agentBody(body));
  }

  #load(): ResolvedGateway {
    const discovered = discoverGateway({
      ...this.#options,
      gatewayUrl: this.#options.gatewayUrl ?? this.#options.baseUrl,
    });
    const token = this.#options.token ?? discovered.token;
    // Re-normalize options.baseUrl so a trailing slash / 0.0.0.0 override
    // cannot undo discoverGateway (connectHostFor + formatBaseUrl).
    const baseUrl =
      this.#options.baseUrl != null && this.#options.baseUrl.trim().length > 0
        ? normalizeGatewayBaseUrl(this.#options.baseUrl)
        : discovered.baseUrl;
    return {
      ...discovered,
      baseUrl,
      hasToken: token != null && token.length > 0,
      ...(token != null && token.length > 0 ? { token } : {}),
    };
  }

  #ensure(): ResolvedGateway {
    if (this.#resolved == null) this.#resolved = this.#load();
    return this.#resolved;
  }

  async #request(
    method: string,
    path: string,
    opts: GatewayRequestOptions & {
      requestId: string;
      command: string;
      auth: boolean;
      json?: unknown;
      accept?: string;
      applyDefaultTimeout?: boolean;
    },
  ): Promise<Response> {
    const resolved = this.#ensure();
    const headers = new Headers();
    headers.set(GATEWAY_REQUEST_ID_HEADER, opts.requestId);
    if (this.slimAvatars) headers.set(GATEWAY_SLIM_AVATARS_HEADER, "1");
    if (opts.accept != null) headers.set("accept", opts.accept);
    if (opts.auth && resolved.token != null) {
      headers.set("authorization", `${GATEWAY_AUTH_SCHEME} ${resolved.token}`);
    }
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(opts.json);
    }
    const timeoutMs = resolveGatewayTimeoutMs(
      opts.timeoutMs,
      this.timeoutMs,
      opts.applyDefaultTimeout !== false,
    );
    const { signal, cleanup } = composeGatewayAbort(timeoutMs, [
      opts.signal,
      this.#options.signal,
    ]);
    try {
      return await this.#fetchWithAbort(
        `${resolved.baseUrl}${path}`,
        { method, headers, body, signal },
        { signal, timeoutMs, command: opts.command, requestId: opts.requestId },
      );
    } finally {
      cleanup();
    }
  }

  async #fetchWithAbort(
    url: string,
    init: RequestInit,
    ctx: {
      signal?: AbortSignal;
      timeoutMs: number | undefined;
      command: string;
      requestId: string;
    },
  ): Promise<Response> {
    if (ctx.signal?.aborted) {
      throw this.#abortError(ctx.signal, ctx.timeoutMs, ctx.command, ctx.requestId);
    }
    const pending = this.#fetch(url, init);
    if (ctx.signal == null) return await pending;
    try {
      return await new Promise<Response>((resolve, reject) => {
        const onAbort = (): void => {
          reject(this.#abortError(ctx.signal, ctx.timeoutMs, ctx.command, ctx.requestId));
        };
        ctx.signal?.addEventListener("abort", onAbort, { once: true });
        pending.then(
          (response) => {
            ctx.signal?.removeEventListener("abort", onAbort);
            resolve(response);
          },
          (error: unknown) => {
            ctx.signal?.removeEventListener("abort", onAbort);
            if (ctx.signal?.aborted) {
              reject(this.#abortError(ctx.signal, ctx.timeoutMs, ctx.command, ctx.requestId));
              return;
            }
            reject(error);
          },
        );
      });
    } catch (error) {
      if (error instanceof GrokBotGatewayError) throw error;
      if (ctx.signal?.aborted) {
        throw this.#abortError(ctx.signal, ctx.timeoutMs, ctx.command, ctx.requestId);
      }
      const message = error instanceof Error ? error.message : String(error);
      const token = this.#options.token ?? this.#resolved?.token;
      throw new GrokBotGatewayError(
        0,
        ctx.command,
        ctx.requestId,
        redactSecret(message, token),
      );
    }
  }

  #abortError(
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
    command: string,
    requestId: string,
  ): GrokBotGatewayError {
    const timedOut = isTimeoutAbort(signal);
    const message = timedOut
      ? `Gateway request timed out after ${timeoutMs ?? "?"}ms`
      : "Gateway request aborted";
    return new GrokBotGatewayError(0, command, requestId, message);
  }

  async #readJson(res: Response, command: string, requestId: string): Promise<unknown> {
    if (!res.ok) throw await this.#error(res, command, requestId);
    const text = await res.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as unknown;
  }

  async #error(res: Response, command: string, requestId: string): Promise<GrokBotGatewayError> {
    let message = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text.length > 0) {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string") message = parsed.error;
      }
    } catch {
      // keep status text
    }
    const token = this.#options.token ?? this.#resolved?.token;
    return new GrokBotGatewayError(res.status, command, requestId, redactSecret(message, token));
  }
}

/**
 * Parse one SSE event block from host openSseStream (gateway-server.ts):
 * `data: ${JSON.stringify(event)}\\n\\n` plus `retry:` / `:ping` keepalives.
 * WHATWG event streams allow CR / LF / CRLF line breaks — strip trailing CR
 * so JSON.parse is not poisoned by `}\\r`.
 */
export function parseSseBlock(block: string): GatewayEvent | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed != null && typeof parsed === "object" && "channel" in parsed) {
      const rec = parsed as { channel: unknown; payload?: unknown };
      if (typeof rec.channel === "string") {
        return { channel: rec.channel, payload: rec.payload };
      }
    }
    return { channel: "unknown", payload: parsed };
  } catch {
    return null;
  }
}
