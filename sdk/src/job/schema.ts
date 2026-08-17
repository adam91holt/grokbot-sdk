/**
 * Versioned Job contract. Input is a JSON file; output is a packet on disk.
 * v1 is decide-only: mode=implement is accepted and stored, never applied.
 */

export const JOB_SCHEMA_VERSION = 1 as const;

export const JOB_ISOLATIONS = ["clone", "room"] as const;
export type JobIsolation = (typeof JOB_ISOLATIONS)[number];

export const JOB_MODES = ["research", "recommend", "implement"] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const JOB_SIDE_EFFECTS = ["read", "mutate"] as const;
export type JobSideEffect = (typeof JOB_SIDE_EFFECTS)[number];

export const JOB_AWAITING_USER = "stop" as const;
export type JobAwaitingUser = typeof JOB_AWAITING_USER;

export const JOB_STATUSES = [
  "queued",
  "running",
  "awaiting-user",
  "done",
  "failed",
  "timeout",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Reserved forbidden defaults. Always merged into actions_forbidden.
 * actions_allowed may not name any of these. Actions are free strings
 * otherwise — there is no allowlist enum, so unknown names are kept.
 */
export const DEFAULT_ACTIONS_FORBIDDEN = [
  "message people",
  "publish",
  "spend",
  "delete",
  "force-push",
  "read/write secrets",
] as const;

export type DefaultForbiddenAction = (typeof DEFAULT_ACTIONS_FORBIDDEN)[number];

export type JobSource = {
  /** Named pointer only. No secrets, tokens, or inline credentials. */
  name: string;
  ref?: string;
};

export type JobQuietHours = {
  start: string;
  end: string;
};

export type JobTurn = {
  speaker: string;
  text: string;
  kind?: string;
  agentId?: string;
};

export type JobCompatNote = {
  status: string;
  pinned?: string;
  live?: string | null;
  note?: string;
};

/**
 * Finished (or paused) packet. Keep it small: status + recommendation +
 * turns/ref + optional diffs/links/error. `apply` is allowed on the schema
 * only when mode is implement and actions_allowed is non-empty. v1 never
 * fills or executes apply.
 */
export type JobPacket = {
  status: JobStatus;
  recommendation?: string;
  transcript_ref?: string;
  turns?: JobTurn[];
  diffs?: string[];
  links?: string[];
  error?: string;
  compat?: JobCompatNote;
  apply?: unknown;
};

export type Job = {
  schema_version: typeof JOB_SCHEMA_VERSION;
  job_id: string;
  idempotency_key: string;
  goal: string;
  done_when: string;
  seats: string[];
  isolation: JobIsolation;
  mode: JobMode;
  actions_allowed: string[];
  actions_forbidden: string[];
  sources: JobSource[];
  side_effect: JobSideEffect;
  on_awaiting_user: JobAwaitingUser;
  deadline?: string;
  quiet_hours?: JobQuietHours;
  repo?: string;
  base_branch?: string;
  branch_name?: string;
  test_command?: string;
  pr?: boolean;
  implementer?: string;
  packet?: JobPacket;
};

export type JobRecord = Job & { packet: JobPacket };

export class JobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobValidationError";
  }
}

export function packetMayIncludeApply(job: Pick<Job, "mode" | "actions_allowed">): boolean {
  return job.mode === "implement" && job.actions_allowed.length > 0;
}

export function mergeForbiddenActions(listed: string[] | undefined): string[] {
  const merged = new Set<string>(DEFAULT_ACTIONS_FORBIDDEN);
  if (listed != null) {
    for (const name of listed) merged.add(name);
  }
  return [...merged];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JobValidationError(`${field} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return asNonEmptyString(value, field);
}

function asStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new JobValidationError(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new JobValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseSources(value: unknown): JobSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new JobValidationError("sources must be an array of named refs");
  }
  return value.map((item, i) => {
    if (typeof item === "string" && item.trim().length > 0) {
      return { name: item };
    }
    if (!isRecord(item)) {
      throw new JobValidationError(`sources[${i}] must be a named ref`);
    }
    const extra = Object.keys(item).filter((key) => key !== "name" && key !== "ref");
    if (extra.length > 0) {
      throw new JobValidationError(`sources[${i}] has unknown fields: ${extra.join(", ")}`);
    }
    const name = asNonEmptyString(item.name, `sources[${i}].name`);
    const ref = asOptionalString(item.ref, `sources[${i}].ref`);
    return ref != null ? { name, ref } : { name };
  });
}

function parseQuietHours(value: unknown): JobQuietHours | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new JobValidationError("quiet_hours must be { start, end }");
  }
  return {
    start: asNonEmptyString(value.start, "quiet_hours.start"),
    end: asNonEmptyString(value.end, "quiet_hours.end"),
  };
}

function parsePacket(value: unknown, job: Pick<Job, "mode" | "actions_allowed">): JobPacket | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new JobValidationError("packet must be an object");
  }
  const status = oneOf(value.status, "packet.status", JOB_STATUSES);
  const packet: JobPacket = { status };
  const recommendation = asOptionalString(value.recommendation, "packet.recommendation");
  if (recommendation != null) packet.recommendation = recommendation;
  const transcriptRef = asOptionalString(value.transcript_ref, "packet.transcript_ref");
  if (transcriptRef != null) packet.transcript_ref = transcriptRef;
  const error = asOptionalString(value.error, "packet.error");
  if (error != null) packet.error = error;
  if (value.turns !== undefined) {
    if (!Array.isArray(value.turns)) {
      throw new JobValidationError("packet.turns must be an array");
    }
    packet.turns = value.turns.map((turn, i) => {
      if (!isRecord(turn)) {
        throw new JobValidationError(`packet.turns[${i}] must be an object`);
      }
      const speaker = asNonEmptyString(turn.speaker, `packet.turns[${i}].speaker`);
      const text = typeof turn.text === "string" ? turn.text : "";
      const kind = asOptionalString(turn.kind, `packet.turns[${i}].kind`);
      const agentId = asOptionalString(turn.agentId, `packet.turns[${i}].agentId`);
      return {
        speaker,
        text,
        ...(kind != null ? { kind } : {}),
        ...(agentId != null ? { agentId } : {}),
      };
    });
  }
  if (value.diffs !== undefined) packet.diffs = asStringList(value.diffs, "packet.diffs");
  if (value.links !== undefined) packet.links = asStringList(value.links, "packet.links");
  if (isRecord(value.compat)) {
    packet.compat = {
      status: asNonEmptyString(value.compat.status, "packet.compat.status"),
      ...(typeof value.compat.pinned === "string" ? { pinned: value.compat.pinned } : {}),
      ...(value.compat.live === null || typeof value.compat.live === "string"
        ? { live: value.compat.live }
        : {}),
      ...(typeof value.compat.note === "string" ? { note: value.compat.note } : {}),
    };
  }
  if ("apply" in value) {
    if (!packetMayIncludeApply(job)) {
      throw new JobValidationError(
        "packet.apply is forbidden unless mode is implement and actions_allowed is non-empty",
      );
    }
    packet.apply = value.apply;
  }
  return packet;
}

const KNOWN_JOB_KEYS = new Set([
  "schema_version",
  "job_id",
  "idempotency_key",
  "goal",
  "done_when",
  "seats",
  "isolation",
  "mode",
  "actions_allowed",
  "actions_forbidden",
  "sources",
  "side_effect",
  "on_awaiting_user",
  "deadline",
  "quiet_hours",
  "repo",
  "base_branch",
  "branch_name",
  "test_command",
  "pr",
  "implementer",
  "packet",
]);

/** Validate and normalize a job file. Applies isolation/mode/forbidden defaults. */
export function validateJob(value: unknown): Job {
  if (!isRecord(value)) {
    throw new JobValidationError("job must be a JSON object");
  }
  const unknown = Object.keys(value).filter((key) => !KNOWN_JOB_KEYS.has(key));
  if (unknown.length > 0) {
    throw new JobValidationError(`unknown job fields: ${unknown.join(", ")}`);
  }
  if (value.schema_version !== JOB_SCHEMA_VERSION) {
    throw new JobValidationError(`schema_version must be ${JOB_SCHEMA_VERSION}`);
  }
  const job_id = asNonEmptyString(value.job_id, "job_id");
  const idempotency_key = asNonEmptyString(value.idempotency_key, "idempotency_key");
  const goal = asNonEmptyString(value.goal, "goal");
  const done_when = asNonEmptyString(value.done_when, "done_when");
  const seats = asStringList(value.seats, "seats");
  if (seats.length === 0) {
    throw new JobValidationError("seats must list at least one agent name or id");
  }
  const isolation = oneOf(value.isolation, "isolation", JOB_ISOLATIONS, "clone");
  const mode = oneOf(value.mode, "mode", JOB_MODES, "recommend");
  const actions_allowed = asStringList(value.actions_allowed, "actions_allowed");
  const actions_forbidden = mergeForbiddenActions(
    value.actions_forbidden === undefined
      ? undefined
      : asStringList(value.actions_forbidden, "actions_forbidden"),
  );
  const reserved = new Set<string>(DEFAULT_ACTIONS_FORBIDDEN);
  const blocked = actions_allowed.filter((name) => reserved.has(name) || actions_forbidden.includes(name));
  if (blocked.length > 0) {
    throw new JobValidationError(
      `actions_allowed may not include forbidden actions: ${blocked.join(", ")}`,
    );
  }
  const sources = parseSources(value.sources);
  const side_effect = oneOf(value.side_effect, "side_effect", JOB_SIDE_EFFECTS, "read");
  const on_awaiting_user = oneOf(
    value.on_awaiting_user,
    "on_awaiting_user",
    [JOB_AWAITING_USER],
    JOB_AWAITING_USER,
  );
  const deadline = asOptionalString(value.deadline, "deadline");
  if (deadline != null && Number.isNaN(Date.parse(deadline))) {
    throw new JobValidationError("deadline must be an ISO-8601 timestamp");
  }
  const quiet_hours = parseQuietHours(value.quiet_hours);
  const repo = asOptionalString(value.repo, "repo");
  const base_branch = asOptionalString(value.base_branch, "base_branch");
  const branch_name = asOptionalString(value.branch_name, "branch_name");
  const test_command = asOptionalString(value.test_command, "test_command");
  if (value.pr !== undefined && typeof value.pr !== "boolean") {
    throw new JobValidationError("pr must be a boolean");
  }
  const implementer = asOptionalString(value.implementer, "implementer");
  const draft: Job = {
    schema_version: JOB_SCHEMA_VERSION,
    job_id,
    idempotency_key,
    goal,
    done_when,
    seats,
    isolation,
    mode,
    actions_allowed,
    actions_forbidden,
    sources,
    side_effect,
    on_awaiting_user,
    ...(deadline != null ? { deadline } : {}),
    ...(quiet_hours != null ? { quiet_hours } : {}),
    ...(repo != null ? { repo } : {}),
    ...(base_branch != null ? { base_branch } : {}),
    ...(branch_name != null ? { branch_name } : {}),
    ...(test_command != null ? { test_command } : {}),
    ...(value.pr === true || value.pr === false ? { pr: value.pr } : {}),
    ...(implementer != null ? { implementer } : {}),
  };
  const packet = parsePacket(value.packet, draft);
  if (packet != null) draft.packet = packet;
  return draft;
}

/** JSON Schema for the Job file. Keep in sync with validateJob. */
export const JOB_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/Adam91holt/grokbot-sdk/sdk/src/job/job.schema.json",
  title: "Grok Bot Job",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "job_id",
    "idempotency_key",
    "goal",
    "done_when",
    "seats",
    "on_awaiting_user",
  ],
  properties: {
    schema_version: { const: JOB_SCHEMA_VERSION },
    job_id: { type: "string", minLength: 1 },
    idempotency_key: { type: "string", minLength: 1 },
    goal: { type: "string", minLength: 1 },
    done_when: { type: "string", minLength: 1 },
    seats: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    isolation: { type: "string", enum: [...JOB_ISOLATIONS], default: "clone" },
    mode: { type: "string", enum: [...JOB_MODES], default: "recommend" },
    actions_allowed: {
      type: "array",
      items: { type: "string", minLength: 1 },
      default: [],
      description:
        "The only actions a future implement step may do. Empty = no implement, ever. Free strings; reserved forbidden defaults cannot appear here.",
    },
    actions_forbidden: {
      type: "array",
      items: { type: "string", minLength: 1 },
      default: [...DEFAULT_ACTIONS_FORBIDDEN],
      description:
        "Always includes reserved defaults: message people, publish, spend, delete, force-push, read/write secrets.",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          ref: { type: "string", minLength: 1 },
        },
      },
      description: "Named refs only. No secrets inline.",
    },
    side_effect: { type: "string", enum: [...JOB_SIDE_EFFECTS], default: "read" },
    on_awaiting_user: { type: "string", const: JOB_AWAITING_USER },
    deadline: { type: "string", minLength: 1 },
    quiet_hours: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end"],
      properties: {
        start: { type: "string", minLength: 1 },
        end: { type: "string", minLength: 1 },
      },
    },
    repo: { type: "string", minLength: 1 },
    base_branch: { type: "string", minLength: 1 },
    branch_name: { type: "string", minLength: 1 },
    test_command: { type: "string", minLength: 1 },
    pr: { type: "boolean" },
    implementer: { type: "string", minLength: 1 },
    packet: { $ref: "#/$defs/packet" },
  },
  $defs: {
    packet: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", enum: [...JOB_STATUSES] },
        recommendation: { type: "string" },
        transcript_ref: { type: "string" },
        turns: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["speaker", "text"],
            properties: {
              speaker: { type: "string", minLength: 1 },
              text: { type: "string" },
              kind: { type: "string" },
              agentId: { type: "string" },
            },
          },
        },
        diffs: { type: "array", items: { type: "string" } },
        links: { type: "array", items: { type: "string" } },
        error: { type: "string" },
        compat: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string" },
            pinned: { type: "string" },
            live: { type: ["string", "null"] },
            note: { type: "string" },
          },
        },
        apply: {
          description:
            "Allowed only when mode is implement and actions_allowed is non-empty. v1 never applies it.",
        },
      },
    },
  },
} as const;
