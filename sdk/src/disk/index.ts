import { resolveSandRoot, sandPaths, type SandPaths } from "../paths.js";
import type { MemoryFact, MemoryScope } from "../types.js";
import {
  getDiskAgent,
  listDiskAgents,
  readActiveAgentId,
  readGroup,
  readProfile,
  readSettings,
  resolveDiskAgent,
  type DiskAgent,
} from "./agents.js";
import { listAgentAutomations, listAllDiskAutomations } from "./automations.js";
import {
  forgetMemoryFact,
  listMemoryFacts,
  writeMemoryFact,
  type ForgetMemoryInput,
  type WriteMemoryInput,
} from "./memory.js";
import { openSearchIndex, SearchIndex } from "./search-index.js";
import { AgentStore, openAgentStore } from "./store.js";
import {
  listTranscriptFiles,
  readTranscript,
  type ReadTranscriptOptions,
  type TranscriptIndexEntry,
} from "./transcripts.js";
import { listGlobalWorkflows } from "./workflows.js";

export class GrokBotDisk {
  readonly sandRoot: string;
  readonly paths: SandPaths;

  constructor(options: { sandRoot?: string } = {}) {
    this.sandRoot = options.sandRoot ?? resolveSandRoot();
    this.paths = sandPaths(this.sandRoot);
  }

  listAgents(): DiskAgent[] {
    return listDiskAgents(this.sandRoot);
  }

  getAgent(agentId: string): DiskAgent | null {
    return getDiskAgent(agentId, this.sandRoot);
  }

  resolveAgent(idOrName: string): DiskAgent | null {
    return resolveDiskAgent(idOrName, this.sandRoot);
  }

  getProfile(agentId: string) {
    return readProfile(agentId, this.sandRoot);
  }

  getSettings(agentId: string) {
    return readSettings(agentId, this.sandRoot);
  }

  getGroup(agentId: string) {
    return readGroup(agentId, this.sandRoot);
  }

  getActiveAgentId(): string | null {
    return readActiveAgentId(this.sandRoot);
  }

  listMemories(agentId: string, scope: MemoryScope = "agent"): MemoryFact[] {
    return listMemoryFacts(agentId, { scope, sandRoot: this.sandRoot });
  }

  /**
   * Disk fallback for host rememberFact. Prefer gateway getAgentMemories /
   * update_state when the host is up.
   */
  writeMemory(input: Omit<WriteMemoryInput, "sandRoot">): MemoryFact | null {
    return writeMemoryFact({ ...input, sandRoot: this.sandRoot });
  }

  /**
   * Disk fallback for host forgetFact. Prefer gateway / update_state when
   * the host is up. Content must match the recorded line after normalize.
   */
  forgetMemory(input: Omit<ForgetMemoryInput, "sandRoot">): boolean {
    return forgetMemoryFact({ ...input, sandRoot: this.sandRoot });
  }

  readTranscript(agentId: string, options: Omit<ReadTranscriptOptions, "sandRoot"> = {}) {
    return readTranscript(agentId, { ...options, sandRoot: this.sandRoot });
  }

  listTranscripts(options: { skipSubagents?: boolean } = {}): TranscriptIndexEntry[] {
    return listTranscriptFiles(this.sandRoot, options);
  }

  openStore(agentId: string): AgentStore {
    return openAgentStore(agentId, this.sandRoot);
  }

  listAutomations(agentId: string) {
    return listAgentAutomations(agentId, this.sandRoot);
  }

  listAllAutomations() {
    return listAllDiskAutomations(this.sandRoot);
  }

  listWorkflows() {
    return listGlobalWorkflows(this.sandRoot);
  }

  openSearchIndex(): SearchIndex {
    return openSearchIndex(this.sandRoot);
  }
}

export {
  DEFAULT_HIDDEN_FROM_SIDEBAR,
  DEFAULT_NOTIFY_ON_AGENT_UPDATES,
  GROUP_CONFIG_VERSION,
  GROUP_MAX_MEMBERS,
  getDiskAgent,
  listDiskAgents,
  normalizeMemberIds,
  normalizeRemoteMembers,
  parseSandGroup,
  parseSandProfile,
  parseSandSettings,
  readActiveAgentId,
  readGroup,
  readProfile,
  readSettings,
  resolveDiskAgent,
} from "./agents.js";
export type { DiskAgent } from "./agents.js";
export {
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
} from "./memory.js";
export type { ForgetMemoryInput, WriteMemoryInput } from "./memory.js";
export {
  AUTOMATION_CONFIG_FILENAME,
  AUTOMATION_MAX_NAME_LENGTH,
  KNOWN_TRIGGER_TYPES,
  ROUTINE_NOTICE_IDS,
  listAgentAutomations,
  listAllDiskAutomations,
  parseStoredAutomationConfig,
  parseStoredTrigger,
} from "./automations.js";
export {
  AgentStore,
  BRANCHED_ENTRY_FILTER_SQL,
  CONVERSATION_BLOB_SCHEMA,
  MAIN_TRANSCRIPT_MESSAGE_FILTER_SQL,
  SQLITE_DB_SIDECAR_SUFFIXES,
  STORE_ENTRY_KINDS,
  STORE_KV_KEYS,
  STORE_SCHEMA,
  WINDOW_ENTRY_FILTER_SQL,
  openAgentStore,
  sqliteRoUri,
} from "./store.js";
export { SearchIndex, openSearchIndex } from "./search-index.js";
export {
  SUBAGENT_PREFIX,
  TRANSCRIPT_NON_MESSAGE_TYPES,
  formatLegacyTranscriptLine,
  isLegacyTranscriptEnvelope,
  isTranscriptNonMessage,
  listTranscriptFiles,
  parseLegacyTranscriptLine,
  readTranscript,
  summarizeContent,
} from "./transcripts.js";
export type { ReadTranscriptOptions, TranscriptIndexEntry } from "./transcripts.js";
export type { SearchMediaQuery, SearchMessageQuery } from "./search-index.js";
export { listGlobalWorkflows } from "./workflows.js";
