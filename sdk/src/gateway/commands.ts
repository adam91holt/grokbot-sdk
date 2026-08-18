/**
 * Real gateway command names from host-main.cjs SAND_GATEWAY_COMMANDS.
 * POST /api/<name> — the name is the path after /api/.
 *
 * Box-destructive, channel, secrets, and webauthn commands stay unsugared.
 * Call them only via commandUnsafe() or GrokBot({ allowUnsafeCommands: true }).
 */

import type {
  AgentAvatarResult,
  AgentChannelsResult,
  AgentSearchHit,
  AgentSummary,
  AllAutomationRow,
  AsyncTaskRecord,
  AutomationTrigger,
  BoxMcpServersResult,
  BoxStoreStatus,
  BroadcastResult,
  ConversationOutlineItem,
  CreateAgentResult,
  DeleteAgentResult,
  DiskSaverAuditResult,
  GatewayAutomation,
  GatewayWorkflow,
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

export const GATEWAY_API_PREFIX = "/api";
export const GATEWAY_HEALTH_PATH = "/health";
export const GATEWAY_EVENTS_PATH = "/events";
export const GATEWAY_AVATARS_PATH = "/avatars";
export const GATEWAY_AUTH_SCHEME = "Bearer";
export const GATEWAY_REQUEST_ID_HEADER = "x-sand-request-id";
export const GATEWAY_SLIM_AVATARS_HEADER = "x-sand-slim-avatars";

/** Commands that exist on the host but are not sugared on GrokBot. */
export const DESTRUCTIVE_GATEWAY_COMMANDS = [
  "resetForeverBox",
  "clearBoxStoreNow",
  "deleteAgents",
  "updateHostNow",
] as const;

export type DestructiveGatewayCommand = (typeof DESTRUCTIVE_GATEWAY_COMMANDS)[number];

/**
 * Unsugared commands that require an explicit unsafe path.
 * Includes box-destructive names plus connectChannel / secrets / webauthn.
 */
export const UNSAFE_GATEWAY_COMMANDS = [
  ...DESTRUCTIVE_GATEWAY_COMMANDS,
  "connectChannel",
  "disconnectChannel",
  "refreshChannel",
  "submitSecret",
  "setBoxSecrets",
  "requestWebAuthnCeremony",
] as const;

export type UnsafeGatewayCommand = (typeof UNSAFE_GATEWAY_COMMANDS)[number];

export function isUnsafeGatewayCommand(name: string): name is UnsafeGatewayCommand {
  return (UNSAFE_GATEWAY_COMMANDS as readonly string[]).includes(name);
}

/**
 * Deny box-destructive / channel / secrets / webauthn names unless opted in.
 * Unknown non-unsafe names stay allowed so new host commands can be reached
 * without a typed wrapper.
 */
export function assertGatewayCommandAllowed(
  name: string,
  allowUnsafeCommands: boolean,
): void {
  if (isUnsafeGatewayCommand(name) && !allowUnsafeCommands) {
    throw new Error(
      `${name} is an unsafe host command (box-destructive, channel, secrets, or webauthn). ` +
        "Pass allowUnsafeCommands: true to GrokBot, or call commandUnsafe().",
    );
  }
}

export const SAND_GATEWAY_COMMANDS = [
  "getTranscript",
  "getAgentTranscript",
  "getAgentTranscriptPage",
  "openAgentWindowed",
  "getAgentTranscriptWindow",
  "openAgentTail",
  "getAgentTranscriptTail",
  "getAgentThread",
  "sendPrompt",
  "promptAcceptanceStatus",
  "respondToWidget",
  "resolveAutoReviewApproval",
  "resolveLocalToolPermission",
  "dismissWidget",
  "submitSecret",
  "reactToMessage",
  "voteFeedback",
  "appendConnectorCard",
  "listAgents",
  "countAgents",
  "searchAgents",
  "searchMedia",
  "createAgent",
  "kickstartAgent",
  "interruptAgentRun",
  "requestDiskSaverAudit",
  "createGroup",
  "setGroupMembers",
  "updateAgent",
  "deleteAgent",
  "deleteAgents",
  "duplicateAgent",
  "setAgentUnread",
  "setAgentNotificationsEnabled",
  "setAgentNotifyOnUpdates",
  "setAgentHiddenFromSidebar",
  "openAgent",
  "setWindowFocused",
  "getAgentMemories",
  "deleteAgentMemory",
  "clearAgentMemories",
  "getAgentAutomations",
  "listAllAutomations",
  "isAgentNetworkEnabled",
  "isGlobalSearchEnabled",
  "isEgressTunnelAvailable",
  "getSharingState",
  "createRoomFromAgent",
  "createRoomInvite",
  "joinSharedRoom",
  "respondToRoomJoinRequest",
  "createSharedRoom",
  "addOwnAgentToSharedRoom",
  "removeOwnAgentFromSharedRoom",
  "setSharedRoomTyping",
  "leaveSharedRoom",
  "setAgentAutomationEnabled",
  "createAgentAutomation",
  "updateAgentAutomation",
  "deleteAgentAutomation",
  "runAgentAutomationNow",
  "broadcastToAgents",
  "getAgentWorkflows",
  "createAgentWorkflow",
  "updateAgentWorkflow",
  "setAgentWorkflowEnabled",
  "deleteAgentWorkflow",
  "runAgentWorkflowNow",
  "importAgentWorkflowText",
  "importAgentWorkflowUrl",
  "portAgentLocalSkills",
  "getConversationOutline",
  "skillsCatalog",
  "syncPluginSkills",
  "getPluginSyncStatus",
  "getSkillPublishTargets",
  "publishSkill",
  "resyncPublishedSkill",
  "unpublishSkill",
  "getAgentChannels",
  "connectChannel",
  "disconnectChannel",
  "refreshChannel",
  "getListenerIntegrations",
  "getListenerConnectUrl",
  "getSubagents",
  "getAsyncTasks",
  "setAgentAvatarBytes",
  "getAgentAvatar",
  "getAgentNotificationAvatar",
  "getForeverBoxStatus",
  "getCloudAgentInfo",
  "ensureForeverBox",
  "resetForeverBox",
  "updateForeverBox",
  "autoUpdateBoxNow",
  "snapshotBoxStoreNow",
  "getBoxStoreStatus",
  "clearBoxStoreNow",
  "updateHostNow",
  "getHostStatus",
  "setBoxMigrating",
  "prepareBoxForRecreate",
  "resumeBoxAfterRecreate",
  "handBackForeverBox",
  "startTeachRecording",
  "stopTeachRecording",
  "getTeachRecordingStatus",
  "getTrays",
  "dismissTray",
  "clearTrays",
  "uploadAttachment",
  "readAttachmentImage",
  "readAttachmentText",
  "readAttachmentChunk",
  "getHostSettings",
  "setHostSettings",
  "setBoxSecrets",
  "getBoxSecretsStatus",
  "completeMcpOAuth",
  "requestWebAuthnCeremony",
  "refreshMcp",
  "listBoxMcpServers",
] as const;

export type GatewayCommandName = (typeof SAND_GATEWAY_COMMANDS)[number];

export type AgentIdBody = { id: string };

/**
 * Host createAgent profile fields. createHostGatewayApi mintAgent forwards
 * `{ name: args.name, description: args.description }` with no `?? ""`.
 * materializeSession then does `profile?.name.trim()` and
 * `profile?.description.trim()` — omitted name or description throws.
 * The SDK wrapper always sends a non-empty name and a string description.
 */
export type CreateAgentInput = {
  name?: string;
  description?: string;
  title?: string;
  avatarShape?: string;
  avatarColor?: string;
  origin?: string;
  clientNonce?: string;
  isIntroductionSuppressed?: boolean;
  isKickstartRequested?: boolean;
  purpose?: string;
  templateId?: string;
};

/** AgentLifecycle.updateAgent — name and description are trimmed unconditionally. */
export type UpdateAgentInput = {
  id: string;
  profile: {
    name: string;
    description: string;
    title?: string;
    avatarShape?: string;
    avatarColor?: string;
  };
};

/**
 * Host createGroup({ name, description, memberAgentIds }).
 * The wrapper always calls createAgent({ name: args.name, description: args.description ?? "" }).
 * materializeSession then does `profile?.name.trim()` — omitted name throws.
 */
export type CreateGroupInput = {
  name?: string;
  description?: string;
  memberAgentIds: string[];
};

export type SetGroupMembersInput = {
  id: string;
  memberAgentIds: string[];
};

export type SearchQueryInput = {
  query: string;
  limit?: number;
};

export type TranscriptPageInput = {
  id: string;
  limit: number;
  beforeSeq?: number;
  sinceMs?: number;
  untilMs?: number;
};

export type TranscriptWindowInput = {
  id: string;
  limit?: number;
  beforeSeq?: number;
};

export type AgentThreadInput = {
  id: string;
  rootId: string;
};

/** WidgetResponses.respondToWidget — value is trimmed as a string. */
export type WidgetResponseInput = {
  entryId: string;
  value: string;
  agentId?: string;
};

export type DismissWidgetInput = {
  entryId: string;
  agentId?: string;
};

export type ReactToMessageInput = {
  entryId: string;
  emoji: string;
  agentId?: string;
};

export type DeleteMemoryInput = {
  id: string;
  memoryId: string;
};

export type AutomationIdInput = {
  id: string;
  automationId: string;
};

/**
 * FileAutomationStore.upsert / update spec.
 * `trigger` is the host cron-or-event union (normalizeSpecTrigger).
 * Event members may still carry host-only fields. Dated cron is the live
 * path for a calendar fire. A standalone SDK `{ type: "once", at }` is
 * translated to dated cron before POST; do not send `once` to the host.
 */
export type AutomationSpec = {
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  isEnabled?: boolean;
};

export type CreateAutomationInput = {
  id: string;
  spec: AutomationSpec;
};

export type UpdateAutomationInput = {
  id: string;
  automationId: string;
  spec: AutomationSpec;
};

export type SetAutomationEnabledInput = {
  id: string;
  automationId: string;
  isEnabled: boolean;
};

export type WorkflowIdInput = {
  id: string;
  workflowId: string;
};

/** WorkflowStore.create / update spec (src/host/extensions/session/…). */
export type WorkflowSpec = {
  name: string;
  description?: string;
  body: string;
  trigger?: { schedule: string; isEnabled?: boolean } | null;
  sourceRef?: string | null;
};

export type CreateWorkflowInput = {
  id: string;
  spec: WorkflowSpec;
};

export type UpdateWorkflowInput = {
  id: string;
  workflowId: string;
  spec: WorkflowSpec;
};

export type SetWorkflowEnabledInput = {
  id: string;
  workflowId: string;
  isEnabled: boolean;
};

export type BroadcastInput = {
  targets: "all" | string[];
  message: string;
};

export type SetUnreadInput = {
  id: string;
  isUnread: boolean;
  atMs?: number;
};

export type SetNotifyInput = {
  id: string;
  isEnabled: boolean;
};

export type SetHiddenInput = {
  id: string;
  isHidden: boolean;
};

/**
 * forever-box getStatus(input) reads `input.id` (the agent id), not `agentId`.
 * createHostGatewayApi.getForeverBoxStatus.
 */
export type ForeverBoxStatusInput = {
  id: string;
};

/**
 * Sessions.openAgentWindowed / openAgentTail — `id` + optional `limit`.
 * Same reply shapes as getAgentTranscriptWindow / getAgentTranscriptTail,
 * but these also switch the active agent (and kickstart if pending).
 */
export type OpenAgentBoundedInput = {
  id: string;
  limit?: number;
};

/**
 * createHostGatewayApi.listBoxMcpServers.
 * Host spreads `serverIdentifiers` (`[...serverIdentifiers]`); an omitted or
 * undefined key throws. Send `[]` to list every box server
 * (`requested.size === 0`).
 */
export type ListBoxMcpServersInput = {
  serverIdentifiers?: string[];
};

/** createHostGatewayApi.getListenerConnectUrl */
export type ListenerConnectUrlInput = {
  platform: string;
};

/** createHostGatewayApi.importAgentWorkflowText → importAgentWorkflowMarkdown */
export type ImportWorkflowTextInput = {
  id: string;
  markdown: string;
  name?: string;
};

/** createHostGatewayApi.importAgentWorkflowUrl */
export type ImportWorkflowUrlInput = {
  id: string;
  url: string;
  name?: string;
};

/**
 * Known first-class wrappers. Host wins; leftover `unknown` cites the host symbol.
 * Void host returns become `null` (respondJson uses `value ?? null`).
 */
export type TypedCommandMap = {
  listAgents: { in: Record<string, never> | undefined; out: AgentSummary[] };
  countAgents: { in: Record<string, never> | undefined; out: number };
  searchAgents: { in: SearchQueryInput; out: AgentSearchHit[] };
  createAgent: { in: CreateAgentInput; out: CreateAgentResult };
  updateAgent: { in: UpdateAgentInput; out: AgentSummary | null };
  deleteAgent: { in: AgentIdBody; out: DeleteAgentResult };
  duplicateAgent: { in: AgentIdBody; out: CreateAgentResult };
  /** Sessions.switchAgent — transcript entries (parseTranscriptEntry). */
  openAgent: { in: AgentIdBody; out: unknown[] };
  setAgentUnread: { in: SetUnreadInput; out: null };
  setAgentHiddenFromSidebar: { in: SetHiddenInput; out: null };
  /**
   * createHostGatewayApi.setAgentNotificationsEnabled — `{ id, isEnabled }`.
   * Host handler is currently a no-op (void → null). Distinct from
   * setAgentNotifyOnUpdates (settings.json notifyOnAgentUpdates).
   */
  setAgentNotificationsEnabled: { in: SetNotifyInput; out: null };
  setAgentNotifyOnUpdates: { in: SetNotifyInput; out: null };
  createGroup: { in: CreateGroupInput; out: CreateAgentResult };
  setGroupMembers: { in: SetGroupMembersInput; out: AgentSummary | null };
  sendPrompt: { in: SendPromptInput; out: SendPromptResult };
  /** Sessions.ensureLoaded — active-session transcript entries. */
  getTranscript: { in: Record<string, never> | undefined; out: unknown[] };
  getAgentTranscript: { in: AgentIdBody; out: unknown[] };
  getAgentTranscriptPage: { in: TranscriptPageInput; out: TranscriptPageResult };
  getAgentTranscriptWindow: { in: TranscriptWindowInput; out: TranscriptWindowResult };
  getAgentTranscriptTail: { in: TranscriptWindowInput; out: TranscriptTailResult };
  getAgentThread: { in: AgentThreadInput; out: TranscriptThreadResult };
  /**
   * RosterProjection.getConversationOutline → deriveOutlineFromConversationState.
   * Thinking durationMs is omitted by the host when missing or ≤ 0.
   */
  getConversationOutline: { in: AgentIdBody; out: ConversationOutlineItem[] };
  interruptAgentRun: { in: AgentIdBody; out: InterruptAgentRunResult };
  respondToWidget: { in: WidgetResponseInput; out: WidgetAcceptedResult };
  dismissWidget: { in: DismissWidgetInput; out: WidgetAcceptedResult };
  reactToMessage: { in: ReactToMessageInput; out: null };
  getAgentMemories: { in: AgentIdBody; out: MemoryRecord[] };
  deleteAgentMemory: { in: DeleteMemoryInput; out: MemoryRecord[] };
  clearAgentMemories: { in: AgentIdBody; out: MemoryRecord[] };
  getAgentAutomations: { in: AgentIdBody; out: GatewayAutomation[] };
  listAllAutomations: { in: Record<string, never> | undefined; out: AllAutomationRow[] };
  createAgentAutomation: { in: CreateAutomationInput; out: GatewayAutomation[] };
  updateAgentAutomation: { in: UpdateAutomationInput; out: GatewayAutomation[] };
  deleteAgentAutomation: { in: AutomationIdInput; out: GatewayAutomation[] };
  setAgentAutomationEnabled: { in: SetAutomationEnabledInput; out: GatewayAutomation[] };
  runAgentAutomationNow: { in: AutomationIdInput; out: null };
  getAgentWorkflows: { in: AgentIdBody; out: GatewayWorkflow[] };
  createAgentWorkflow: { in: CreateWorkflowInput; out: GatewayWorkflow[] };
  updateAgentWorkflow: { in: UpdateWorkflowInput; out: GatewayWorkflow[] };
  deleteAgentWorkflow: { in: WorkflowIdInput; out: GatewayWorkflow[] };
  setAgentWorkflowEnabled: { in: SetWorkflowEnabledInput; out: GatewayWorkflow[] };
  runAgentWorkflowNow: { in: WorkflowIdInput; out: null };
  skillsCatalog: { in: Record<string, never> | undefined; out: SkillCatalogEntry[] };
  broadcastToAgents: { in: BroadcastInput; out: BroadcastResult };
  searchMedia: { in: SearchQueryInput; out: GatewaySearchMediaRow[] };
  getHostSettings: { in: Record<string, never> | undefined; out: HostSettings };
  getHostStatus: { in: Record<string, never> | undefined; out: HostStatus };
  /**
   * decorateForeverBoxStatus(HostBox.getStatus). Spreads box state + handoff +
   * optional hostVersion / hostUpdateAvailable / diskPressure — keep opaque.
   */
  getForeverBoxStatus: { in: ForeverBoxStatusInput; out: unknown };
  promptAcceptanceStatus: { in: PromptAcceptanceStatusInput; out: PromptAcceptanceStatus };
  kickstartAgent: { in: AgentIdBody; out: KickstartAgentResult };
  getAgentChannels: { in: AgentIdBody; out: AgentChannelsResult };
  getSubagents: { in: AgentIdBody; out: SubagentRecord[] };
  getAsyncTasks: { in: AgentIdBody; out: AsyncTaskRecord[] };
  isAgentNetworkEnabled: { in: Record<string, never> | undefined; out: boolean };
  isGlobalSearchEnabled: { in: Record<string, never> | undefined; out: boolean };
  /** process.env.SAND_EGRESS_TUNNEL_ENABLED === "1" */
  isEgressTunnelAvailable: { in: Record<string, never> | undefined; out: boolean };
  getAgentAvatar: { in: AgentIdBody; out: AgentAvatarResult };
  requestDiskSaverAudit: { in: AgentIdBody; out: DiskSaverAuditResult };
  listBoxMcpServers: { in: ListBoxMcpServersInput | undefined; out: BoxMcpServersResult };
  getPluginSyncStatus: { in: Record<string, never> | undefined; out: PluginSyncStatus };
  getListenerIntegrations: { in: Record<string, never> | undefined; out: ListenerIntegrationsResult };
  getListenerConnectUrl: { in: ListenerConnectUrlInput; out: ListenerConnectUrlResult };
  getBoxStoreStatus: { in: Record<string, never> | undefined; out: BoxStoreStatus };
  openAgentWindowed: { in: OpenAgentBoundedInput; out: TranscriptWindowResult };
  openAgentTail: { in: OpenAgentBoundedInput; out: TranscriptTailResult };
  importAgentWorkflowText: { in: ImportWorkflowTextInput; out: WorkflowImportResult };
  importAgentWorkflowUrl: { in: ImportWorkflowUrlInput; out: WorkflowImportResult };
  portAgentLocalSkills: { in: AgentIdBody; out: WorkflowImportResult };
};

/**
 * Top-level input keys for each typed wrapper. Hand-cited from the `in`
 * types above — the host snapshot has no per-command JSON schema table.
 */
type WrapperInputKeys<K extends keyof TypedCommandMap> = [TypedCommandMap[K]["in"]] extends [
  undefined,
]
  ? readonly []
  : [TypedCommandMap[K]["in"]] extends [Record<string, never> | undefined]
    ? readonly []
    : readonly (keyof Exclude<TypedCommandMap[K]["in"], undefined> & string)[];

export const TYPED_WRAPPER_INPUT_KEYS = {
  listAgents: [],
  countAgents: [],
  searchAgents: ["query", "limit"],
  createAgent: [
    "name",
    "description",
    "title",
    "avatarShape",
    "avatarColor",
    "origin",
    "clientNonce",
    "isIntroductionSuppressed",
    "isKickstartRequested",
    "purpose",
    "templateId",
  ],
  updateAgent: ["id", "profile"],
  deleteAgent: ["id"],
  duplicateAgent: ["id"],
  openAgent: ["id"],
  setAgentUnread: ["id", "isUnread", "atMs"],
  setAgentHiddenFromSidebar: ["id", "isHidden"],
  setAgentNotificationsEnabled: ["id", "isEnabled"],
  setAgentNotifyOnUpdates: ["id", "isEnabled"],
  createGroup: ["name", "description", "memberAgentIds"],
  setGroupMembers: ["id", "memberAgentIds"],
  sendPrompt: [
    "prompt",
    "agentId",
    "attachmentPaths",
    "attachmentNames",
    "richText",
    "replyToId",
    "clientNonce",
    "directAddressedAcceptance",
    "isFork",
    "traceparent",
    "enterEpochMs",
    "composedAtMs",
  ],
  getTranscript: [],
  getAgentTranscript: ["id"],
  getAgentTranscriptPage: ["id", "limit", "beforeSeq", "sinceMs", "untilMs"],
  getAgentTranscriptWindow: ["id", "limit", "beforeSeq"],
  getAgentTranscriptTail: ["id", "limit", "beforeSeq"],
  getAgentThread: ["id", "rootId"],
  getConversationOutline: ["id"],
  interruptAgentRun: ["id"],
  respondToWidget: ["entryId", "value", "agentId"],
  dismissWidget: ["entryId", "agentId"],
  reactToMessage: ["entryId", "emoji", "agentId"],
  getAgentMemories: ["id"],
  deleteAgentMemory: ["id", "memoryId"],
  clearAgentMemories: ["id"],
  getAgentAutomations: ["id"],
  listAllAutomations: [],
  createAgentAutomation: ["id", "spec"],
  updateAgentAutomation: ["id", "automationId", "spec"],
  deleteAgentAutomation: ["id", "automationId"],
  setAgentAutomationEnabled: ["id", "automationId", "isEnabled"],
  runAgentAutomationNow: ["id", "automationId"],
  getAgentWorkflows: ["id"],
  createAgentWorkflow: ["id", "spec"],
  updateAgentWorkflow: ["id", "workflowId", "spec"],
  deleteAgentWorkflow: ["id", "workflowId"],
  setAgentWorkflowEnabled: ["id", "workflowId", "isEnabled"],
  runAgentWorkflowNow: ["id", "workflowId"],
  skillsCatalog: [],
  broadcastToAgents: ["targets", "message"],
  searchMedia: ["query", "limit"],
  getHostSettings: [],
  getHostStatus: [],
  getForeverBoxStatus: ["id"],
  promptAcceptanceStatus: ["accountSlot", "clientNonce"],
  kickstartAgent: ["id"],
  getAgentChannels: ["id"],
  getSubagents: ["id"],
  getAsyncTasks: ["id"],
  isAgentNetworkEnabled: [],
  isGlobalSearchEnabled: [],
  isEgressTunnelAvailable: [],
  getAgentAvatar: ["id"],
  requestDiskSaverAudit: ["id"],
  listBoxMcpServers: ["serverIdentifiers"],
  getPluginSyncStatus: [],
  getListenerIntegrations: [],
  getListenerConnectUrl: ["platform"],
  getBoxStoreStatus: [],
  openAgentWindowed: ["id", "limit"],
  openAgentTail: ["id", "limit"],
  importAgentWorkflowText: ["id", "markdown", "name"],
  importAgentWorkflowUrl: ["id", "url", "name"],
  portAgentLocalSkills: ["id"],
} as const satisfies { [K in keyof TypedCommandMap]: WrapperInputKeys<K> };
