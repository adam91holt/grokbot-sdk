/**
 * Decide-only job runner. Persists under jobs/<job_id>.json (not sand-data
 * agent folders). Reuses runOnceFrom / discussOnce / waitForIdle — does not
 * invent a host job API or waitForCompletion.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CompatVerdict } from "../gateway/compat.js";
import type {
  DiscussOnceInput,
  DiscussOnceReceipt,
  DiscussTurn,
  OneShotReceipt,
  OneShotStatus,
  RunOnceFromInput,
} from "../gateway/oneshot.js";
import { isSafeFolderId, resolveJobsDir } from "../paths.js";
import {
  packetMayIncludeApply,
  validateJob,
  type Job,
  type JobCompatNote,
  type JobPacket,
  type JobRecord,
  type JobStatus,
  type JobTurn,
} from "./schema.js";

export type JobClient = {
  compat?(options?: unknown): Promise<CompatVerdict>;
  runOnceFrom(input: RunOnceFromInput): Promise<OneShotReceipt>;
  discussOnce(input: DiscussOnceInput): Promise<DiscussOnceReceipt>;
};

export type SubmitJobOptions = {
  /** Override GROKBOT_JOBS_DIR / default tmp dir. */
  jobsDir?: string;
  timeoutMs?: number;
  intervalMs?: number;
  keepOnFailure?: boolean;
  signal?: AbortSignal;
};

const IN_FLIGHT: ReadonlySet<JobStatus> = new Set([
  "queued",
  "running",
  "awaiting-user",
  "done",
]);

export function jobRecordPath(jobId: string, jobsDir: string): string {
  if (!isSafeFolderId(jobId) || jobId !== jobId.trim()) {
    throw new Error(`Invalid job_id: ${jobId}`);
  }
  const dir = resolve(jobsDir);
  const file = join(dir, `${jobId}.json`);
  const rel = relative(dir, file);
  if (rel.length === 0 || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Invalid job_id: ${jobId}`);
  }
  return file;
}

export async function writeJobRecord(record: JobRecord, jobsDir: string): Promise<string> {
  const file = jobRecordPath(record.job_id, jobsDir);
  await mkdir(resolve(jobsDir), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return file;
}

export async function readJobRecord(jobId: string, jobsDir: string): Promise<JobRecord> {
  const file = jobRecordPath(jobId, jobsDir);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(`job not found: ${jobId}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`job file is not valid JSON: ${jobId}`);
  }
  const job = validateJob(parsed);
  if (job.packet == null) {
    throw new Error(`job file is missing a packet: ${jobId}`);
  }
  return { ...job, packet: job.packet };
}

export async function listJobRecords(jobsDir: string): Promise<JobRecord[]> {
  let names: string[];
  try {
    names = await readdir(resolve(jobsDir));
  } catch {
    return [];
  }
  const records: JobRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const jobId = name.slice(0, -".json".length);
    try {
      records.push(await readJobRecord(jobId, jobsDir));
    } catch {
      // skip unreadable / invalid files
    }
  }
  return records;
}

async function findIdempotent(
  job: Job,
  jobsDir: string,
): Promise<JobRecord | undefined> {
  const records = await listJobRecords(jobsDir);
  for (const existing of records) {
    if (existing.idempotency_key !== job.idempotency_key) continue;
    if (existing.goal !== job.goal) {
      throw new Error(
        `idempotency_key ${job.idempotency_key} is already bound to a different goal (${existing.job_id})`,
      );
    }
    if (IN_FLIGHT.has(existing.packet.status)) return existing;
  }
  return undefined;
}

function mapStatus(status: OneShotStatus): JobStatus {
  if (status === "idle") return "done";
  if (status === "awaiting-user") return "awaiting-user";
  if (status === "timeout") return "timeout";
  return "failed";
}

function turnsFromDiscuss(turns: DiscussTurn[] | undefined): JobTurn[] | undefined {
  if (turns == null || turns.length === 0) return undefined;
  return turns.map((turn) => ({
    speaker: turn.speaker,
    text: turn.text,
    ...(turn.kind.length > 0 ? { kind: turn.kind } : {}),
    ...(turn.agentId != null ? { agentId: turn.agentId } : {}),
  }));
}

function turnsFromReply(seat: string, prompt: string, reply: string | undefined): JobTurn[] {
  const turns: JobTurn[] = [{ speaker: "user", text: prompt, kind: "message" }];
  if (reply != null && reply.length > 0) {
    turns.push({ speaker: seat, text: reply, kind: "message" });
  }
  return turns;
}

function decidePrompt(job: Job): string {
  const lines = [
    job.goal,
    "",
    `Done when: ${job.done_when}`,
    "",
    "This is a decide-only job. Do not implement, open a pull request, write memories, or take live side effects.",
  ];
  if (job.mode === "implement") {
    lines.push(
      "The job file listed mode=implement. This runner does not apply actions; recommend only.",
    );
  }
  if (job.repo != null) lines.push(`Repo: ${job.repo}`);
  if (job.base_branch != null) lines.push(`Base branch: ${job.base_branch}`);
  if (job.branch_name != null) lines.push(`Branch name: ${job.branch_name}`);
  if (job.done_when.length > 0 && job.test_command != null) {
    lines.push(`Test command (do not run): ${job.test_command}`);
  }
  return lines.join("\n");
}

function usesDiscuss(job: Job): boolean {
  return job.isolation === "room" || job.seats.length > 1;
}

/** Unique throwaway room name so host createGroup never sees an omitted name. */
export function jobDiscussOnceName(jobId: string): string {
  return `${jobId}-room`;
}

export const JOB_DISCUSS_ONCE_DESCRIPTION = "Throwaway job room. Delete after idle.";

async function noteCompat(bot: JobClient): Promise<JobCompatNote | undefined> {
  if (bot.compat == null) return undefined;
  try {
    const verdict = await bot.compat();
    const status = verdict.hostVersion.status;
    const note: JobCompatNote = {
      status,
      pinned: verdict.hostVersion.pinned,
      live: verdict.hostVersion.live,
    };
    if (status === "mismatch") {
      note.note = "compat mismatch; continuing decide-only run";
    } else if (status === "unknown") {
      note.note = "compat hostVersion unknown; continuing decide-only run";
    }
    return note;
  } catch (caught) {
    return {
      status: "error",
      note: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

function stripApply(job: Job, packet: JobPacket): JobPacket {
  if (packet.apply === undefined || packetMayIncludeApply(job)) return packet;
  const { apply: _apply, ...rest } = packet;
  return rest;
}

function finishPacket(
  job: Job,
  packet: JobPacket,
  receipt: {
    status: OneShotStatus;
    reply?: string;
    turns?: DiscussTurn[];
    error?: string;
  },
): JobPacket {
  const next: JobPacket = {
    ...packet,
    status: mapStatus(receipt.status),
  };
  const turns =
    receipt.turns != null
      ? turnsFromDiscuss(receipt.turns)
      : turnsFromReply(job.seats[0] ?? "assistant", decidePrompt(job), receipt.reply);
  if (turns != null && turns.length > 0) next.turns = turns;
  if (receipt.reply != null && receipt.reply.length > 0) {
    next.recommendation = receipt.reply;
  }
  if (receipt.error != null && receipt.error.length > 0) next.error = receipt.error;
  next.transcript_ref = `jobs/${job.job_id}.json`;
  return stripApply(job, next);
}

export async function submitJob(
  bot: JobClient,
  input: unknown,
  options: SubmitJobOptions = {},
): Promise<JobRecord> {
  const job = validateJob(input);
  const jobsDir =
    options.jobsDir != null && options.jobsDir.trim().length > 0
      ? options.jobsDir
      : resolveJobsDir();

  const existing = await findIdempotent(job, jobsDir);
  if (existing != null) return existing;

  if (job.deadline != null) {
    const due = Date.parse(job.deadline);
    if (!Number.isNaN(due) && due <= Date.now()) {
      const record: JobRecord = {
        ...job,
        packet: stripApply(job, {
          status: "timeout",
          error: "deadline has already passed",
          transcript_ref: `jobs/${job.job_id}.json`,
        }),
      };
      await writeJobRecord(record, jobsDir);
      return record;
    }
  }

  const compat = await noteCompat(bot);
  let packet: JobPacket = stripApply(job, {
    status: "queued",
    transcript_ref: `jobs/${job.job_id}.json`,
    ...(compat != null ? { compat } : {}),
  });
  let record: JobRecord = { ...job, packet };
  await writeJobRecord(record, jobsDir);

  packet = { ...packet, status: "running" };
  record = { ...job, packet };
  await writeJobRecord(record, jobsDir);

  const prompt = decidePrompt(job);
  const timeoutMs =
    options.timeoutMs ??
    (job.deadline != null
      ? Math.max(1, Date.parse(job.deadline) - Date.now())
      : undefined);
  const shared = {
    prompt,
    timeoutMs,
    intervalMs: options.intervalMs,
    keepOnFailure: options.keepOnFailure,
    signal: options.signal,
  };

  try {
    if (usesDiscuss(job)) {
      const receipt = await bot.discussOnce({
        agents: job.seats,
        name: jobDiscussOnceName(job.job_id),
        description: JOB_DISCUSS_ONCE_DESCRIPTION,
        ...shared,
      });
      packet = finishPacket(job, packet, receipt);
    } else {
      const receipt = await bot.runOnceFrom({
        id: job.seats[0]!,
        ...shared,
      });
      packet = finishPacket(job, packet, receipt);
    }
  } catch (caught) {
    packet = stripApply(job, {
      ...packet,
      status: "failed",
      error: caught instanceof Error ? caught.message : String(caught),
      transcript_ref: `jobs/${job.job_id}.json`,
    });
  }

  record = { ...job, packet };
  await writeJobRecord(record, jobsDir);
  return record;
}

/** Alias for submitJob. */
export const runJob = submitJob;

export async function getJob(jobId: string, jobsDir: string = resolveJobsDir()): Promise<JobRecord> {
  return await readJobRecord(jobId, jobsDir);
}

export async function listJobs(jobsDir: string = resolveJobsDir()): Promise<JobRecord[]> {
  return await listJobRecords(jobsDir);
}

function packetMeta(record: JobRecord, noReply: boolean): Record<string, unknown> {
  const packet: Record<string, unknown> = {
    job_id: record.job_id,
    status: record.packet.status,
    mode: record.mode,
    isolation: record.isolation,
    goal: record.goal,
  };
  if (record.packet.recommendation != null && !noReply) {
    packet.recommendation = record.packet.recommendation;
  }
  if (record.packet.transcript_ref != null) {
    packet.transcript_ref = record.packet.transcript_ref;
  }
  if (record.packet.error != null) packet.error = record.packet.error;
  if (record.packet.compat != null) packet.compat = record.packet.compat;
  if (record.packet.diffs != null) packet.diffs = record.packet.diffs;
  if (record.packet.links != null) packet.links = record.packet.links;
  if (record.packet.apply !== undefined && packetMayIncludeApply(record)) {
    packet.apply = record.packet.apply;
  }
  if (!noReply && record.packet.turns != null) {
    packet.turns = record.packet.turns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
    }));
  }
  return packet;
}

/** Human turn list: `speaker: text` per line. */
export function formatJobTurns(turns: JobTurn[]): string {
  return `${turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")}\n`;
}

/** Packet metadata plus turns. Never tokens or gateway secrets. */
export function formatJobRecord(record: JobRecord, options: { noReply?: boolean } = {}): string {
  const noReply = options.noReply === true;
  const body = `${JSON.stringify(packetMeta(record, noReply), null, 2)}\n`;
  if (noReply || record.packet.turns == null || record.packet.turns.length === 0) {
    return body;
  }
  return `${formatJobTurns(record.packet.turns)}${body}`;
}

export function formatJobList(records: JobRecord[]): string {
  if (records.length === 0) return "# 0 jobs\n";
  const lines = [`# ${records.length} jobs`];
  for (const row of records) {
    lines.push(`${row.packet.status.padEnd(14)}  ${row.job_id}  ${row.goal}`);
  }
  return `${lines.join("\n")}\n`;
}

