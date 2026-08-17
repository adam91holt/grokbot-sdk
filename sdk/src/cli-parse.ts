export type CliArgs = {
  command: string;
  rest: string[];
  raw: boolean;
  all: boolean;
  tail: number | null;
  from: string | null;
  /** Every `--from` value, in order. `from` is the last one (run-once). */
  froms: string[];
  /** `--to` — send-as recipient (name or id). */
  to: string | null;
  /** `--bus` — existing send-as bus seat (name or id). */
  bus: string | null;
  name: string | null;
  purpose: string | null;
  timeoutMs: number | null;
  keepOnFailure: boolean;
  keepBus: boolean;
  noReply: boolean;
};

function takeValue(argv: string[], i: number, flag: string): { value: string; next: number } {
  const next = argv[i + 1];
  if (next == null || next.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return { value: next, next: i + 1 };
}

export function parseCliArgs(argv: string[]): CliArgs {
  const flags = new Set<string>();
  const positional: string[] = [];
  let tail: number | null = null;
  let from: string | null = null;
  const froms: string[] = [];
  let to: string | null = null;
  let bus: string | null = null;
  let name: string | null = null;
  let purpose: string | null = null;
  let timeoutMs: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--raw") flags.add("raw");
    else if (arg === "--all") flags.add("all");
    else if (arg === "--keep-on-failure") flags.add("keep-on-failure");
    else if (arg === "--keep-bus") flags.add("keep-bus");
    else if (arg === "--no-reply") flags.add("no-reply");
    else if (arg === "--tail") {
      const taken = takeValue(argv, i, "--tail");
      tail = Number.parseInt(taken.value, 10);
      i = taken.next;
    } else if (arg.startsWith("--tail=")) {
      tail = Number.parseInt(arg.slice("--tail=".length), 10);
    } else if (arg === "--from") {
      const taken = takeValue(argv, i, "--from");
      from = taken.value;
      froms.push(taken.value);
      i = taken.next;
    } else if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
      froms.push(from);
    } else if (arg === "--to") {
      const taken = takeValue(argv, i, "--to");
      to = taken.value;
      i = taken.next;
    } else if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    } else if (arg === "--bus") {
      const taken = takeValue(argv, i, "--bus");
      bus = taken.value;
      i = taken.next;
    } else if (arg.startsWith("--bus=")) {
      bus = arg.slice("--bus=".length);
    } else if (arg === "--name") {
      const taken = takeValue(argv, i, "--name");
      name = taken.value;
      i = taken.next;
    } else if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
    } else if (arg === "--purpose") {
      const taken = takeValue(argv, i, "--purpose");
      purpose = taken.value;
      i = taken.next;
    } else if (arg.startsWith("--purpose=")) {
      purpose = arg.slice("--purpose=".length);
    } else if (arg === "--timeout-ms") {
      const taken = takeValue(argv, i, "--timeout-ms");
      timeoutMs = Number.parseInt(taken.value, 10);
      i = taken.next;
    } else if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
    } else if (arg === "--help" || arg === "-h") {
      positional.unshift("help");
    } else {
      positional.push(arg);
    }
  }
  return {
    command: positional[0] ?? "help",
    rest: positional.slice(1),
    raw: flags.has("raw"),
    all: flags.has("all"),
    tail: tail != null && Number.isFinite(tail) ? tail : null,
    from,
    froms,
    to,
    bus,
    name,
    purpose,
    timeoutMs: timeoutMs != null && Number.isFinite(timeoutMs) ? timeoutMs : null,
    keepOnFailure: flags.has("keep-on-failure"),
    keepBus: flags.has("keep-bus"),
    noReply: flags.has("no-reply"),
  };
}

export function cliUsage(): string {
  return `grokbot — Grok Bot gateway + sand-data CLI

Usage:
  grokbot health
  grokbot discovery
  grokbot status
  grokbot compat
  grokbot agents
  grokbot workflows
  grokbot send <agentIdOrName> <prompt...>
  grokbot run-once [--from <idOrName>] [--name <name>] [--purpose <purpose>] [--timeout-ms N] [--keep-on-failure] [--no-reply] <prompt...>
  grokbot discuss --from <idOrName> --from <idOrName> [--name <name>] [--timeout-ms N] [--keep-on-failure] [--no-reply] <prompt...>
  grokbot send-as --to <name-or-id> [--from <name-or-id>] [--bus <name-or-id>] [--name <name>] [--timeout-ms N] [--keep-bus] [--no-reply] <message...>
  grokbot memories <agentIdOrName>
  grokbot transcript <agentIdOrName> [--tail N] [--raw]
  grokbot automations [--all] [--raw]
  grokbot tasks <agentIdOrName>
  grokbot interrupt <agentIdOrName>
  grokbot mcp
  grokbot listeners
  grokbot digest
  grokbot job submit <file.json>
  grokbot job show <job_id>
  grokbot job list

Token is loaded at runtime from gateway.json or SAND_GATEWAY_TOKEN and is never printed.
Gateway URL: GROKBOT_GATEWAY_URL (alias SAND_GATEWAY_URL).
  local:   omit the URL (gateway.json); or GROKBOT_GATEWAY_URL=http://127.0.0.1:1340
  remote:  GROKBOT_GATEWAY_URL=http://<hostname>:1340 and SAND_GATEWAY_TOKEN
On this computer, omit the URL — wildcard bind hosts rewrite to 127.0.0.1.
grokbot health prints baseUrl, ok, busy, activeAgentId — never the token.
grokbot discovery prints public fields only (hasToken is a boolean).
grokbot status adds hostVersion, capabilities, egressTunnel.
grokbot compat prints a host-contract verdict (pinned vs live hostVersion, known capabilities, typed wrappers still in the extracted command table). Never tokens.
grokbot workflows lists disk workflow slugs / names / descriptions — not SKILL.md bodies.
tasks / mcp / listeners print metadata only (no prompts, no connect URLs).
digest is read-only: health, host, roster (no chat previews), counts, automations
(name/schedule/lastRun), listeners, box store, outline thinking durations when present.
It never prints tokens, gateway.json secrets, chat bodies, or memory dumps.
job submit runs a decide-only job file: clones seats (runOnceFrom for one,
discussOnce for several or isolation=room), waits until idle, writes a packet
under GROKBOT_JOBS_DIR (default $TMPDIR/grokbot-jobs). Never sand-data agent
folders. mode=implement is stored, not executed. --no-reply hides turn bodies.
job show / job list read those files. Never tokens or gateway secrets.
Typed methods accept an agent name or id; the host still receives { id }
(sendPrompt keeps the host field name agentId).
run-once creates a throwaway agent (or --from duplicates one via host cloneAgent),
sends the prompt, waits until idle / awaiting-user / timeout, then deleteAgent.
Name is optional; a unique throwaway name is minted and description is sent as
"" when omitted so host createAgent does not name.trim() / description.trim()
on undefined.
Receipt includes reply (last assistant / send-message text from the host tail,
not roster lastMessagePreview). --no-reply is metadata-only. Never tokens.
--from is a full host clone (store.db + automations); memory/ files are not copied.
discuss clones each --from (never the live agents), createGroup with those clones,
sends the prompt to the group, waits until the group and every clone are idle,
prints the full turn list (speaker + text), then deleteAgent group then clones.
Name is optional; a unique throwaway name is minted when omitted so host
createGroup does not name.trim() on undefined. Host createGroup reuses a room
with the same member set — discuss treats that as an error. awaiting-user
snapshots the transcript and keeps the room. --no-reply hides bodies. Never
tokens. Never messages anyone outside the room.
send-as mints a throwaway bus seat (or reuses --from / --bus), sendPrompts that
seat to call the SendToAgent tool once toward --to, waits until the bus is idle,
then deleteAgent the throwaway unless --keep-bus or reuse. There is no host
sendToAgent command — this is SDK-only and survives Computer Update. Never
broadcastToAgents. Never to=all. --no-reply is metadata-only. Never tokens.
--raw prints transcript / automation prompt bodies (sensitive). Other commands stay metadata-only.
`;
}
