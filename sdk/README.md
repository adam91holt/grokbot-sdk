# @adam91holt/grokbot-sdk

TypeScript client for a Grok Bot host. Not a made-up HTTP API.

Two surfaces:

1. Gateway (`GrokBot`) — live HTTP: `GET /health`, `GET /events`, `GET /avatars/<id>`, `POST /api/<command>`.
   Command names come from `SAND_GATEWAY_COMMANDS` (checked in as an extracted manifest).
   A small extracted manifest (`hostVersion`, command table, typed-wrapper input keys) is checked in so snapshot drift is visible; `bot.compat()` / `grokbot compat` compare live `getHostStatus()` to that manifest.
2. Disk (`GrokBotDisk`) — readers for `sand-data` (default `/home/box/sand-data`, alias `/home/box/agent-data`; override with `SAND_DATA_ROOT`).

Prefer the gateway whenever the host is running — it is the live, authoritative view, and the host owns watchers, dreaming metadata, and cross-shard memory merge. Disk readers work at any time (same computer, no token, no host process needed); use them to grep or bulk-scan files, to reach transcript JSONL / `store.db` / `search-index.db`, or when the gateway is unreachable.

Disk memory writes match the host fact-line format, but they bypass the host. Prefer `getAgentMemories` or the host `update_state` tool when the host is running.

`npm test` is dummy-only. Set `GROKBOT_LIVE=1` to add a live gateway smoke (health, host status, roster/MCP/listener counts — no tokens or chat text). CI runs `npm test` in `sdk/` without that env.

The public-facing overview lives in the
[root README](https://github.com/adam91holt/grokbot-sdk#readme). This file is
the deeper API reference.

<!-- Links in this file must be absolute. It ships as the npm page, and npm
     rewrites relative paths against the repo root — `../README.md` became
     /tree/README.md (a 404) before this was fixed. -->


## Install

Requires Node 22+ (CI uses Node 24).

```bash
npm i @adam91holt/grokbot-sdk
```

In this directory: `npm ci`, then `npm run build`, then `npm test`.
CLI after build: `npx grokbot` or `node dist/cli.js`.

```ts
import { GrokBot, GrokBotDisk } from "@adam91holt/grokbot-sdk";

const bot = new GrokBot();
const disk = new GrokBotDisk();
const health = await bot.health();
const agents = await bot.listAgents();
const id = agents[0] != null ? await bot.resolveAgent(agents[0].name) : undefined;
const memories = id != null ? await bot.getAgentMemories({ id }) : [];
console.log(health.ok, agents.length, memories.length);
```

Send a prompt after listing:

```ts
if (id != null) {
  const result = await bot.sendPrompt({ agentId: id, prompt: "status only" });
  console.log(result.accepted);
  const waited = await bot.sendPrompt({
    agentId: id,
    prompt: "status only",
    wait: true,
    timeoutMs: 60_000,
  });
  console.log(waited.status, waited.reply);
}
```

Host `sendPrompt` is still `{ accepted: true }` — there is no host `wait` field or `waitForCompletion`. SDK `wait: true` (default false) polls the same `waitForIdle` signals after accept, then reads `getAgentTranscriptTail` for `reply`. `awaitingUserResponse` is status `awaiting-user`, not a finished reply. You can also call `waitForIdle({ id, timeoutMs, clientNonce? })` yourself.

One-shot helpers (create/clone → send → wait → `deleteAgent` in `finally`):

```ts
const fresh = await bot.runOnce({ prompt: "status only" });
const cloned = await bot.runOnceFrom({ id: "Ada", prompt: "status only" });
const room = await bot.discussOnce({
  agents: ["Ada", "Bea"],
  prompt: "status only",
});
const peer = await bot.sendAsAgent({ to: "Ada", message: "status only" });
```

Receipts include `reply` by default: the last assistant / `send-message` text from host `getAgentTranscriptTail` (or `getAgentTranscript`), captured before `deleteAgent`. That is not roster `lastMessagePreview`. Pass `includeReply: false` (alias `includeTranscript: false`) for metadata-only. No token counts. `runOnce` / `createAgent` always POST a non-empty `name` and a string `description` (mint `throwaway-<uuid>` and `""` when omitted) so host `materializeSession` does not call `name.trim()` / `description.trim()` on undefined. `runOnceFrom` is host `duplicateAgent` → `manager.cloneAgent`: a full clone of `store.db`, profile (`"<name> copy"`), settings (`hiddenFromSidebar: false`), workflow enablement, avatar, and automations. Conversation is then cleared (`rewriteClonedAgentIdentity(..., false)`). `memory/` files are not copied. Groups cannot be duplicated. `runOnceLike` is a separate profile-only path (`createAgent` with copied name/description/title/purpose) — not a host clone.

`discussOnce` clones each named agent (never the live roster rows), `createGroup`s those clones, `sendPrompt`s the group (the host runs the group orchestrator), waits until the group and every clone are idle, then returns the **full room** as `turns` / `transcript` — not `sendPrompt({ wait: true }).reply`. Snapshot happens before delete. Host `createGroup` reuses a room with the same member set; the helper treats that as an error. When `name` is omitted, the helper mints a unique throwaway group name so host `createGroup` does not call `name.trim()` on undefined. `awaiting-user` snapshots and keeps the room so a widget can be answered. Otherwise it `deleteAgent`s the group, then each clone. It does not `broadcastToAgents` or message the source agents.

`sendAsAgent` is SDK-only inter-agent send. There is no host `sendToAgent` command (`POST /api/sendToAgent` is unknown). The helper mints a throwaway **bus** seat (`createAgent` with `isIntroductionSuppressed`, a `bus-<uuid>` name, and `description: ""`), `sendPrompt`s that seat to call the **SendToAgent tool** once toward `to` (name or id, resolved first), waits until the bus is idle (`waitForIdle` / the same signals as `sendPrompt({ wait: true })`), then `deleteAgent`s the bus unless `keepBus` is set. Pass `bus` or `from` to reuse an existing seat — that path does not create or delete. Default isolation is throwaway; live roster seats are touched only when those ids/names are passed as `to` / `from` / `bus`. Never `to: "all"`. Never `broadcastToAgents`. Receipt: `busId`, `targetId`, `accepted`, `status`, `elapsedMs`, `deleted`, optional bus `reply`. No tokens. No `waitForCompletion`. This survives Computer Update because it uses existing host commands only.

Routine automations on the live host are `{ type: "cron", schedule }` or event listeners (`slack`, `github`, …). A dated cron (`43 18 18 8 *`) is the host path that actually fires for a calendar time; host cron is Pacific/Auckland local (unless the host has `CRON_TZ=`). It annual-repeats and there is no disable-after-fire contract. `{ type: "once", at }` is an SDK helper only (`onceToDatedCron` / create-update translation to that dated cron in host-local fields). Create/update also append a short prompt footer telling the agent to delete the routine after it executes so it does not fire again next year. Cron-only and event-listener specs are not rewritten. Prefer ISO-8601 with a time and timezone; epoch ms must be `> 1e12`. Date-only and whitespace `at` are rejected. Do not put `once` in a group — the host would drop it and keep slack/etc. Unrelated to `runOnce` / `discussOnce`. The host must add `once` to its trigger allowlist before a true one-shot will exist.

## Jobs (decide-only)

A job JSON file is the contract. `submitJob` / `runJob` (also `grokbot job submit <file.json>`) clones the named seats, waits until idle, and writes a packet (status + recommendation + turns) under `GROKBOT_JOBS_DIR` (default `$TMPDIR/grokbot-jobs`). It does not write into sand-data agent folders. There is no host job API and no `waitForCompletion`.

```ts
import { submitJob, validateJob } from "@adam91holt/grokbot-sdk";

const job = validateJob({
  schema_version: 1,
  job_id: "job-recommend-sample",
  idempotency_key: "sample-recommend-1",
  goal: "Recommend whether to add a job file.",
  done_when: "The packet has a one-sentence recommendation.",
  seats: ["Ada"],
  on_awaiting_user: "stop",
});
const record = await submitJob(bot, job);
console.log(record.packet.status, record.packet.recommendation);
```

- `isolation=clone` (default) + one seat → existing `runOnceFrom`. Several seats → existing `discussOnce` (throwaway room of clones). `isolation=room` always uses `discussOnce`. The room path always sends a non-empty group name derived from `job_id` (host `createGroup` crashes when `name` is omitted). Live source ids are never put in the group.
- `compat()` runs first when the client has it. A mismatch is recorded on the packet; the run continues. No negotiate API.
- `mode=implement` is accepted and stored. v1 does not apply, open PRs, run `test_command`, or write memories. `actions_allowed` empty means no implement, ever. Packet `apply` is allowed only when mode is implement and `actions_allowed` is non-empty — v1 still does not fill or execute it.
- Reserved `actions_forbidden` defaults: message people, publish, spend, delete, force-push, read/write secrets. Actions are free strings (no allowlist enum).
- Same `idempotency_key` + same `goal` does not spawn a second live run when a job is already queued, running, awaiting-user, or done.
- `on_awaiting_user` is `stop`. The packet is persisted; throwaway rooms stay if `discussOnce` already keeps them.
- Schema: `sdk/src/job/job.schema.json`. Sample: `examples/sample-job.json`.

```bash
grokbot job submit examples/sample-job.json
grokbot job show job-recommend-sample
grokbot job list
```

Prints packet metadata + turns (speaker + text) unless `--no-reply`. Never tokens or gateway secrets.

## Cards

`SendMessage` takes a `type` that decides what the user sees. An unknown type,
or a shape the host rejects, is **discarded without an error** — the model is
told the call was queued and the user simply sees nothing. These builders emit
the exact payload the host expects and throw on the constraints it enforces, so
a mistake surfaces where it was made.

```ts
import { choice, confirm, cursorAgent } from "@adam91holt/grokbot-sdk";

// Multiple choice. The picked option's `value` comes back as the user's reply,
// so it replaces asking in prose and parsing the answer.
choice({
  prompt: "Enable the remaining tools?",
  helpText: "CreateAgent lets an agent sign on a new crewmate.",
  options: [
    { label: "Enable", value: "Enable all three", style: "primary" },
    { label: "Leave blocked", style: "danger" },
  ],
  allowCustom: true,
});

choice({ prompt: "Ship it?", options: ["Ship", "Hold"] }); // bare strings are fine
confirm("Restart the host?");                              // yes/no shorthand
cursorAgent("bc-…");                                       // Cursor run card
```

Constraints, all enforced at build time rather than lost at delivery: `prompt`
and at least one `label` are required, there is a hard ceiling of
`MAX_CHOICE_OPTIONS` (6), and `style` is `default` / `primary` / `danger`.

`dismissOnMoveOn` auto-dismisses the card once the user sends a newer message
without answering — use it only for questions that go moot, never for a decision
you still need. A dismissal is reported as a decline: treat it as no, and do not
re-ask.

A Cursor run does **not** render its card automatically. Send `cursorAgent(bcId)`
once the launch returns an id, or the user is left with a bare URL.

## Security

- Gateway token lives in `sand-data/gateway.json` (or `SAND_GATEWAY_TOKEN`). Loaded at runtime, kept in memory.
- Never log, print, commit, or embed the token, host-secrets, or connector credentials.
- `gateway.json`, `.env`, and `host-secrets.json` are gitignored. The token must never land in git.
- Transcripts and `store.db` entries are sensitive. CLI prints metadata unless `--raw` (then it warns). `run-once` prints `reply` unless `--no-reply`. `discuss` prints the turn list (speaker + text) unless `--no-reply`.
- `grokbot discovery` / `bot.discovery()` expose `hasToken` (boolean) only — never the token.

## Disk vs gateway

- Live list / prompt / interrupt: `GrokBot`
- Health / host status / egress: `health()` / `getHostStatus()` / `isEgressTunnelAvailable()`
- MCP / listeners / box store: `listBoxMcpServers()` (default lists every box server) / `getListenerIntegrations()` / `getBoxStoreStatus()`
- Name or id: `bot.resolveAgent("Ada")` and typed methods that take `{ id }` accept a roster name or id. The host still receives `{ id }`. `sendPrompt` keeps the host field name `agentId`.
- Bounded open (also switches the active agent): `openAgentWindowed()` / `openAgentTail()`
- Memories while host is up: `getAgentMemories`
- Memories / profiles without a running host or token: `GrokBotDisk` (same computer only)
- JSONL scan: `GrokBotDisk.readTranscript` (skip `sand-subagent-*`)
- `store.db` / blobs: `openStore(id)`, `getBlob` only

Env: `SAND_DATA_ROOT`, `SAND_USER_DATA_DIR`, `SAND_GATEWAY_TOKEN`, `SAND_HOST_PORT`, `SAND_GATEWAY_BIND_HOST`, `GROKBOT_GATEWAY_URL` (alias `SAND_GATEWAY_URL`), `GROKBOT_JOBS_DIR` (job JSON store; default `$TMPDIR/grokbot-jobs`).

Unary gateway calls time out after 30s unless you pass `timeoutMs` or an `AbortSignal`. SSE `events()` stays open unless you pass one of those explicitly.

## Local vs remote

**Local** (this computer, the Grok Bot host): omit the URL. The SDK reads `sand-data/gateway.json` and rewrites wildcard bind hosts (`0.0.0.0` / `::`) to `127.0.0.1`.

```ts
const bot = new GrokBot();
// or, if you want to be explicit:
// GROKBOT_GATEWAY_URL=http://127.0.0.1:1340
```

```bash
grokbot health
grokbot discovery
```

**Remote** (any reachable host): there is no local `gateway.json`. Point at the host and pass the token in the environment — never commit it, never log it.

```bash
GROKBOT_GATEWAY_URL=http://your-host:1340
SAND_GATEWAY_TOKEN=...   # copy from the host's gateway.json; do not git this
```

```ts
const bot = new GrokBot({ gatewayUrl: "http://your-host:1340" });
```

```bash
grokbot discovery   # public fields only; hasToken is a boolean
```

`SAND_GATEWAY_BIND_HOST` + `SAND_HOST_PORT` still swap host/port without a full URL.
The URL wins over `gateway.json` host/port/scheme. Token still comes from `SAND_GATEWAY_TOKEN` or `gateway.json`.

## Destructive commands are not sugared

`resetForeverBox`, `clearBoxStoreNow`, `deleteAgents`, `updateHostNow`, plus channel / secrets / webauthn commands, exist on the host table but not as first-class methods.
They require `allowUnsafeCommands: true` or `bot.commandUnsafe(...)`. `command()` does not turn a missing body into `{}`. Unknown non-unsafe host names are still allowed.

## CLI

The CLI uses the same discovery as `new GrokBot()`. If `GROKBOT_GATEWAY_URL` is set, it wins.

```bash
grokbot health
grokbot discovery
grokbot status
grokbot compat
grokbot agents
grokbot memories <agentIdOrName>
grokbot workflows
```

`health` prints `baseUrl`, `ok`, `busy`, `activeAgentId` — never the token. `discovery` prints the public discovery view (`baseUrl`, `connectHost`, `hasToken`, …) and never the token. `status` adds `hostVersion`, `capabilities`, and `egressTunnel`. `compat` prints a host-contract verdict (pinned vs live `hostVersion`, known capabilities, typed wrappers still in the extracted command table) and never tokens. If discovery fails (no `gateway.json` and no URL/port), they print the local vs remote env vars to set. `agents` prints name + id only. `workflows` lists disk workflow slugs / names / descriptions — not SKILL.md bodies.

```bash
grokbot send <agentIdOrName> <prompt...>
grokbot run-once [--from <idOrName>] [--no-reply] <prompt...>
grokbot discuss --from <idOrName> --from <idOrName> [--no-reply] <prompt...>
grokbot send-as --to <name-or-id> [--from <name-or-id>] [--keep-bus] [--no-reply] <message...>
grokbot transcript <agentIdOrName> [--tail N] [--raw]
grokbot automations [--all]
grokbot tasks <agentIdOrName>
grokbot interrupt <agentIdOrName>
grokbot mcp
grokbot listeners
grokbot digest
grokbot job submit <file.json>
grokbot job show <job_id>
grokbot job list
```

`tasks` / `mcp` / `listeners` print metadata only (ids, status, counts) — no prompts, no connect URLs.

`run-once` prints a receipt with `reply` (last assistant / send-message text from the host tail, not roster `lastMessagePreview`). `--no-reply` is metadata-only. Never tokens. Without `--from` it `createAgent`s with `isIntroductionSuppressed`, a minted name when `--name` is omitted, and `description: ""`. `--from` uses host `duplicateAgent` (full clone, not persona-only; `memory/` is not copied). The clone/temp agent is `deleteAgent`d afterwards unless `--keep-on-failure`.

`discuss` clones each `--from`, creates a throwaway group, sends the prompt to that group, and prints the full turn list (speaker + text) before deleting the group then the clones. `--no-reply` hides bodies. `awaiting-user` keeps the room. Never tokens. Never messages the source agents.

`send-as` mints a throwaway bus seat (or reuses `--from` / `--bus`), prompts that seat to call the SendToAgent tool once toward `--to`, waits until idle, then deletes the throwaway unless `--keep-bus`. There is no host `sendToAgent` command. `--no-reply` is metadata-only. Never tokens. Never `to=all`.

`digest` is a read-only summary: health, host status/settings, roster (no chat previews), memory / store.db / transcript counts, automations (name, schedule, lastRun — not prompts), listeners, box store, and outline thinking `durationMs` when the host sent one. It never prints tokens, `gateway.json` secrets, chat bodies, or memory dumps. One line notes that the host API does not expose token usage.

`job submit` validates a job file, clones seats via `runOnceFrom` / `discussOnce`, and writes the packet under `GROKBOT_JOBS_DIR`. Decide-only: it does not implement, even when `mode` is `implement`. `job show` / `job list` read those files. `--no-reply` hides turn bodies. Never tokens.

Agent arguments accept a name or id (`grokbot send Ada "status only"`).

## Layout

```
src/gateway/  client, discovery, command names, extracted host-manifest
scripts/      extract-host-manifest (optional; needs a local host snapshot, not in this repo)
src/disk/     agents, memory, transcripts, store, automations, workflows, search-index
src/job/      versioned job schema + decide-only disk runner
src/cli.ts
examples/     list-agents, send-prompt, dream-scan, sample-job.json
```

`npm test` is dummy-only. Host-bundle citation tests skip when `host/host-main.cjs` is not present (this public repo does not ship the host). `npm run extract-manifest` can refresh the checked-in manifest if you have a local host snapshot.
