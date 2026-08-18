/** Shared types for the Grok Bot SDK. Shapes come from host-main.cjs. */

export type GatewayScheme = "http" | "https";

/** On-disk /home/box/sand-data/gateway.json (token is never logged). */
export type GatewayDiscoveryFile = {
  port: number;
  pid: number;
  startedAt: number;
  scheme?: GatewayScheme;
  host?: string;
  token?: string;
};

/** Public discovery view — token is stripped. */
export type GatewayDiscovery = {
  port: number;
  pid: number;
  startedAt: number;
  scheme: GatewayScheme;
  /** Bind host from the discovery file / env, or the URL override host. */
  bindHost: string;
  /**
   * Host to connect with. Wildcard bind hosts (0.0.0.0 / :: / [::]) rewrite to
   * 127.0.0.1, including the same host inside GROKBOT_GATEWAY_URL.
   * Tailscale / LAN names on a URL override pass through as-is.
   */
  connectHost: string;
  baseUrl: string;
  hasToken: boolean;
};

/** GET /health — no auth in the host handler. */
export type HealthResponse = {
  ok: boolean;
  pid: number;
  isBusy: boolean;
  activeAgentId: string | null;
  startedAt: number;
  lastBusyAtMs: number | null;
  busyOnlyAwaitingApproval?: boolean;
};

export type AgentProfile = {
  name: string;
  description: string;
  title: string;
  avatarShape: string;
  avatarColor: string;
};

export type AgentSettings = {
  notifyOnAgentUpdates: boolean;
  hiddenFromSidebar: boolean;
};

/** Host `normalizeRemoteMembers` — keys written by writeSandGroupConfig. */
export type GroupRemoteMember = {
  ownerAuthId: string;
  agentId: string;
  name: string;
  avatarDataUrl?: string;
};

export type AgentGroup = {
  version: number;
  memberIds: string[];
  remoteMembers?: GroupRemoteMember[];
  sharedRoomId?: string;
};

/**
 * Roster row from gateway listAgents / createAgent.
 * Extracted from host buildSummary / minimalAgentSummary.
 */
export type AgentSummary = {
  id: string;
  name: string;
  description: string;
  title: string;
  avatarDataUrl: string | null;
  avatarVersion: string | null;
  avatarShape: string | null;
  avatarColor: string | null;
  createdAt: number;
  updatedAt: number;
  path: string;
  isActive: boolean;
  isRunning: boolean;
  isComposingMessage: boolean;
  lastEntry: unknown;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthorId: string | null;
  newestEntryId: string | null;
  hasUnread: boolean;
  unreadCount: number;
  lastViewedAt?: number;
  lastActivityAt?: number;
  awaitingUserResponse: unknown;
  notificationsEnabled: boolean;
  notifyOnUpdatesEnabled: boolean;
  isHiddenFromSidebar: boolean;
  origin: string;
  purpose?: string;
  isGroup: boolean;
  memberIds: string[];
  remoteRoom?: unknown;
  remoteMembers?: GroupRemoteMember[];
  isSharedRoom?: boolean;
  sharedRoomId?: string;
  conversationPartnerIds: string[];
};

export type CreateAgentResult = {
  agent: AgentSummary;
  transcript?: unknown;
};

export type MemoryKind = "profile" | "log";
export type MemoryTier = "profile" | "log" | "note";
export type MemoryScope = "agent" | "user";

export type MemoryRecord = {
  id: string;
  content: string;
  createdAt: number;
  kind: MemoryKind;
};

export type MemoryOrigin = "legacy" | "explicit" | "synthesis";

export type MemoryFact = MemoryRecord & {
  path: string;
  order: number;
  /** Host parseFacts sets "legacy"; dreaming metadata may override. */
  origin?: MemoryOrigin;
};

/**
 * POST /api/sendPrompt body. Fields read by createHostGatewayApi.sendPrompt
 * (src/host/host-gateway-api.ts) and forwarded to SendPipeline.sendPrompt.
 */
export type SendPromptInput = {
  prompt: string;
  agentId?: string;
  attachmentPaths?: string[];
  attachmentNames?: string[];
  /** ProseMirror / rich-text document. Shape is host-internal — do not invent fields. */
  richText?: unknown;
  replyToId?: string;
  clientNonce?: string;
  /** When true, the host treats this as a direct-addressed group acceptance. */
  directAddressedAcceptance?: boolean;
  isFork?: boolean;
  /** W3C traceparent minted by the desktop at Enter. */
  traceparent?: string;
  /** Wall-clock epoch of the desktop Enter instant. */
  enterEpochMs?: number;
  composedAtMs?: number;
};

export type SendPromptResult = {
  accepted: true;
};

export type InterruptAgentRunResult = {
  hadActiveRun: boolean;
};

/** createHostGatewayApi.kickstartAgent */
export type KickstartAgentResult = {
  isIntroductionInFlight: boolean;
};

/**
 * PromptAcceptanceLedger.lookup (src/host/extensions/transcript/…).
 * Host records are written with this accountSlot — `var HOST_ACCOUNT_SLOT = "host"`
 * in host-main.cjs. Do not invent another slot name.
 */
export const HOST_ACCOUNT_SLOT = "host";

export type PromptAcceptanceStatusInput = {
  accountSlot: string;
  clientNonce: string;
};

export type PromptAcceptanceStatusRecord = {
  accountSlot: string;
  clientNonce: string;
  inputDigest: string;
  status: "accepted" | "rejected" | "pending";
  acceptedAtMs: number;
  agentId: string;
  echoEntryId: string | null;
  rejectionCode: string | null;
};

export type PromptAcceptanceStatus =
  | { outcome: "found"; record: PromptAcceptanceStatusRecord }
  | { outcome: "unknown-durability" }
  | { outcome: "not-found" };

/** respondToWidget / dismissWidget — createHostGatewayApi + WidgetResponses */
export type WidgetAcceptedResult = {
  accepted: boolean;
};

/** RosterSearch.searchAgents */
export type AgentSearchHit = {
  agentId: string;
  entryId: string;
  role: string;
  timestampMs: number;
  snippet: string;
};

/** BackgroundWakes.broadcastToAgents */
export type BroadcastResult = {
  total: number;
  scheduled: number;
};

/** createHostGatewayApi.deleteAgent → AgentLifecycle.deleteAgents */
export type DeleteAgentResult = {
  /** Transcript entries after delete/switch. parseTranscriptEntry — keep opaque. */
  transcript: unknown[];
};

/**
 * AgentDb.getTranscriptPage / readTranscriptPage.
 * `entries` are parseTranscriptEntry results — keep opaque.
 */
export type TranscriptPageResult = {
  entries: unknown[];
  nextBeforeSeq?: number;
};

/** AgentDb.getTranscriptWindow / readTranscriptWindow */
export type TranscriptWindowResult = {
  entries: unknown[];
  nextBeforeSeq?: number;
  threadCounts?: Record<string, number>;
};

/** AgentDb.getTranscriptTail / readTranscriptTail */
export type TranscriptTailResult = {
  entries: unknown[];
  nextBeforeSeq?: number;
};

/** AgentDb.getThread */
export type TranscriptThreadResult = {
  entries: unknown[];
};

/** session-store getAgentAvatar / getAgentAvatar() */
export type AgentAvatarResult = {
  version: string | null;
  dataUrl: string | null;
};

/** createHostGatewayApi.requestDiskSaverAudit */
export type DiskSaverAuditResult = {
  isAuditInFlight: boolean;
};

/**
 * createHostGatewayApi.listBoxMcpServers.
 * Status strings come from the box MCP exec list (connected / needsAuth /
 * loading / error and the display remap). Keep as string — host switch is not
 * a closed SDK enum.
 */
export type BoxMcpServerRow = {
  serverIdentifier: string;
  status: string;
  statusDetail?: string;
  toolCount: number;
};

export type BoxMcpServersResult = {
  servers: BoxMcpServerRow[];
};

/** isPluginAuthBlock — pluginSkills.status().authBlocked */
export type PluginAuthBlock = {
  pluginId: string;
  pluginName: string;
  marketplaceName?: string;
};

/** mcp.pluginSyncStatus — default `{ authBlocked: [] }` when pluginSkills is unset */
export type PluginSyncStatus = {
  authBlocked: PluginAuthBlock[];
};

/**
 * slackScopeIssuesOf — only missing-bot / not-found outcomes are pushed.
 * kind stays a string so a newer host can add values without breaking callers.
 */
export type ListenerScopeIssue = {
  scope: string;
  kind: string;
};

/** automations.getListenerIntegrations */
export type ListenerIntegration = {
  platform: string;
  isConnected: boolean;
  state: string;
  detail?: string;
  scopeIssues?: ListenerScopeIssue[];
  neededByCount: number;
};

export type ListenerIntegrationsResult = {
  integrations: ListenerIntegration[];
};

/** createHostGatewayApi.getListenerConnectUrl */
export type ListenerConnectUrlResult = {
  url: string;
};

/**
 * box-store-sync readStoreStatus. `fullyHydrated` is a boolean on the
 * manifest snapshot and undefined on the empty fallback.
 */
export type BoxStoreStatus = {
  durable: boolean;
  fullyHydrated: boolean | undefined;
  entryCount: number;
  storeDbEntries: number;
  agentDirEntries: number;
  totalBytes: number;
  lastSnapshotAtMs: number;
};

/** FileChannelStore.listConnections — credential-free. */
export type AgentChannelConnection = {
  platform: string;
  label: string;
  status: "configured";
};

/** CONNECTOR_MANIFESTS in src/shared/channels/… */
export type AgentChannelManifest = {
  platform: string;
  displayName: string;
  blurb: string;
  credentialLabel: string;
  availability: string;
  connectGuide: string;
};

/** automations.getAgentChannels */
export type AgentChannelsResult = {
  manifests: AgentChannelManifest[];
  connections: AgentChannelConnection[];
};

/** runner listSubagents() */
export type SubagentRecord = {
  subagentId: string;
  subagentType: string;
  title: string;
  status: string;
  startedAtMs: number;
};

/** listAsyncTasks + mergeAsyncTasks / pendingWakeMarkerToAsyncTask */
export type AsyncTaskRecord = {
  kind: "subagent" | "shell" | "cloud-agent";
  id: string;
  label: string;
  status: "running";
  startedAtMs: number;
  detail?: string;
  subagentType?: string;
};

/** fetchSkillCatalog (managed-setup) */
export type SkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
  source: "marketplace";
  publisher: string;
  iconUrl?: string;
  install: { kind: "url"; url: string };
};

/**
 * Repeating cron member. Dated crons (`43 18 18 8 *`) are the live host path
 * for a calendar fire (Pacific/Auckland local unless the host has CRON_TZ=);
 * they annual-repeat. There is no host `once` type yet.
 */
export type CronTrigger = {
  type: "cron";
  schedule: string;
};

/**
 * SDK convenience only — not a host trigger. `at` is normalized UTC ISO-8601.
 * create/update translate a standalone once to dated cron and append a
 * delete-after-fire instruction on `prompt`. Not gateway/oneshot.ts.
 */
export type OnceTrigger = {
  type: "once";
  at: string;
};

/** Host event listener types from FileAutomationStore / parseStoredTrigger. */
export type EventTriggerType =
  | "slack"
  | "github"
  | "microsoftTeams"
  | "linear"
  | "sentry"
  | "pagerduty";

/** Event members may carry host-only fields not extracted here. */
export type EventTrigger = {
  type: EventTriggerType;
  [key: string]: unknown;
};

export type AutomationTriggerMember = CronTrigger | EventTrigger;

export type GroupTrigger = {
  type: "group";
  listeners: AutomationTriggerMember[];
};

/**
 * Host parseStoredTrigger union: cron / event / group / listener list.
 * `once` is not a member — the live host would drop it.
 */
export type AutomationTrigger =
  | AutomationTriggerMember
  | GroupTrigger
  | AutomationTriggerMember[];

/**
 * FileAutomationStore.toRecord. `trigger` / `runs` stay mostly opaque — the
 * host cron-or-event union (normalizeSpecTrigger) is not fully extracted.
 */
export type GatewayAutomation = {
  id: string;
  name: string;
  prompt: string;
  trigger: unknown;
  schedule: string;
  triggerDescription: string;
  isEnabled: boolean;
  provenance: AutomationProvenance;
  createdAt: number;
  lastRunAt: number | null;
  raisedNotices?: string[];
  nextRunAt: number | null;
  runs: unknown[];
  filePath: string;
};

/** SessionStore.listAllAutomationsFrom */
export type AllAutomationRow = {
  agentId: string;
  automation: GatewayAutomation;
};

/**
 * WorkflowStore.skillToWorkflow / automationToWorkflow / pluginSkillToWorkflow.
 * Plugin rows may also set disableModelInvocation.
 */
export type GatewayWorkflow = {
  id: string;
  name: string;
  description: string;
  body: string;
  trigger: { schedule: string; isEnabled: boolean } | null;
  source: "workflow" | "automation" | "managed" | "plugin" | string;
  sourceRef: string | null;
  pluginId: string | null;
  publishedByCurrentUser: boolean;
  isEnabledForAgent: boolean;
  disableModelInvocation?: boolean;
  scheduleDescription: string | null;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  helperScripts: unknown[];
  runs: unknown[];
  filePath: string;
};

/** WorkflowStore.importMarkdown / importLiveSource hit */
export type WorkflowImportHit = {
  id: string;
  name: string;
};

export type WorkflowImportSkip = {
  source: string;
  reason: string;
};

/**
 * importAgentWorkflowMarkdown / importAgentWorkflowSource / portAgentLocalSkills.
 * `workflows` is limitSurfacedWorkflows(store.listAll()).
 */
export type WorkflowImportResult = {
  workflows: GatewayWorkflow[];
  result: {
    imported: WorkflowImportHit[];
    skipped: WorkflowImportSkip[];
  };
};

/**
 * host-upgrade getVersionState plus createHostGatewayApi.getHostStatus extras.
 * hostVersion / latestHostVersion start null until the upgrade extension reads disk.
 */
export type HostStatus = {
  hostVersion: string | null;
  latestHostVersion: string | null;
  hostUpdateAvailable: boolean | null;
  isBusy: boolean;
  capabilities: string[];
};

/** sandAgentModelParameterSchema */
export type HostModelParameter = {
  id: string;
  value: string;
};

/**
 * sandAgentDefaultModelSchema / sandComputerUseModelSchema.
 * Host omits the field when unset — do not invent a model id.
 */
export type HostModelSelection = {
  modelId: string;
  maxMode?: boolean;
  parameters: HostModelParameter[];
};

/**
 * SettingsStore.getHostSettings. Nested MCP / sidebar values are
 * host-internal — cited but not invented. notifications is SAND_DISABLED_NOTIFICATION_CONFIG.
 */
export type HostSettings = {
  notifications: {
    isEnabled: false;
    allowedApps: unknown[];
    minIntervalMs: number;
    maxPerWindow: number;
    windowMs: number;
  };
  mcpCustomInstructions: unknown;
  mcpCustomInstructionsByServerId: unknown;
  mcpDisabledToolsByServerId: unknown;
  mcpCustomInstructionsAccountScope?: unknown;
  mcpBoxServers: unknown;
  autoReviewInstructions: unknown;
  localToolPermission: unknown;
  webauthnProxyEnabled: unknown;
  userTimeZone?: string;
  userTimeZoneOverride?: string;
  agentDefaultModel?: HostModelSelection;
  computerUseModel?: HostModelSelection;
  pinnedAgentIds?: unknown;
  sidebarSections: unknown[];
  hasSeenOnboarding?: boolean;
};

/**
 * deriveOutlineFromConversationState / live outline updates.
 * Thinking `durationMs` is omitted by the host when missing or ≤ 0.
 */
export type ConversationOutlineUser = {
  kind: "user";
  id?: string;
  text?: string;
  hidden?: boolean;
};

export type ConversationOutlineAssistant = {
  kind: "assistant-text";
  id?: string;
  text?: string;
};

export type ConversationOutlineThinking = {
  kind: "thinking";
  id?: string;
  text?: string;
  durationMs?: number;
};

export type ConversationOutlineToolCall = {
  kind: "tool-call";
  id?: string;
  name?: string;
  status?: string;
  summary?: string;
};

export type ConversationOutlineSendMessage = {
  kind: "send-message";
  id?: string;
  message?: unknown;
  timestampMs?: number;
};

export type ConversationOutlineItem =
  | ConversationOutlineUser
  | ConversationOutlineAssistant
  | ConversationOutlineThinking
  | ConversationOutlineToolCall
  | ConversationOutlineSendMessage
  | { kind: string; id?: string };

export type OutlineThinkingStep = {
  id?: string;
  durationMs: number;
};

export type TranscriptRole = "user" | "assistant";

export type TranscriptTextItem = {
  type: "text";
  text: string;
};

export type TranscriptToolUseItem = {
  type: "tool_use";
  name: string;
  input: unknown;
};

export type TranscriptToolResultItem = {
  type: "tool_result";
  name: string;
  result: unknown;
};

export type TranscriptContentItem =
  | TranscriptTextItem
  | TranscriptToolUseItem
  | TranscriptToolResultItem
  | { type: string; [key: string]: unknown };

export type TranscriptLine = {
  role: TranscriptRole | string;
  message: {
    content: TranscriptContentItem[];
    [key: string]: unknown;
  };
};

export type StoreEntryKind =
  | "message"
  | "send-message"
  | "user-attachment"
  | "tool-call"
  | "notice"
  | "event"
  | "feedback"
  | string;

export type StoreEntry = {
  seq: number;
  id: string;
  kind: StoreEntryKind;
  /** Parsed JSON from transcript_entries.entry. Do not log. */
  entry: unknown;
};

export type AutomationProvenance = "user" | "untrusted";

export type DiskAutomation = {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  schedule?: string;
  trigger?: unknown;
  enabled: boolean;
  provenance: AutomationProvenance;
  createdAt: number;
  lastRunAt: number | null;
  raisedNotices?: string[];
};

export type DiskWorkflow = {
  slug: string;
  path: string;
  name: string;
  description: string;
};

export type GatewayEvent = {
  channel: string;
  payload: unknown;
};

export type SearchMessageRow = {
  id: number;
  agentId: string;
  entryId: string;
  role: "user" | "assistant" | string;
  timestampMs: number;
  /** Message body. Sensitive — do not log. */
  body: string;
};

/**
 * createHostGatewayApi.searchMedia → searchMedia() (host-main.cjs).
 * MEDIA_SELECT_COLUMNS has no SQLite row id — do not invent `id`.
 */
export type GatewaySearchMediaRow = {
  agentId: string;
  entryId: string;
  fileName: string;
  ext: string;
  mime: string | null;
  kind: string;
  timestampMs: number;
  width: number | null;
  height: number | null;
};

/** Disk search-index.db `media` table. Includes the SQLite row id. */
export type SearchMediaRow = GatewaySearchMediaRow & {
  id: number;
};

export type ActiveAgentFile = {
  activeAgentId: string;
};
