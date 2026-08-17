# Use from Grok Bot

A Grok Bot agent can clone this repo and use the SDK against the host on **this computer**.

## Clone

```bash
git clone https://github.com/adam91holt/grokbot-sdk.git
cd grokbot-sdk/sdk
npm ci
```

Node 22+ is required. After `npm ci`, import from `src` with `tsx` or run `npm run build` and import `dist`.

```ts
import { GrokBot } from "./src/index.ts";

const bot = new GrokBot();
await bot.health();
```

## Why this works

On the Grok Bot computer the host writes `sand-data/gateway.json` (port, bind, token). `new GrokBot()` reads that file. If the host bound `0.0.0.0`, the SDK still connects to `127.0.0.1`.

You do not need Tailscale for this path. You do need the host process running.

## What to do / not do

- Prefer throwaways (`runOnce`, `discussOnce`, `sendAsAgent`) so live seats stay untouched.
- Do not `broadcastToAgents({ targets: "all" })`.
- Do not print `gateway.json` or `SAND_GATEWAY_TOKEN`.
- `sendAsAgent` mints a bus seat that calls the SendToAgent **tool**. It is not a host command.

## Jobs

Decide-only: a JSON file is the contract. The runner clones seats or opens a room, waits until idle, and writes a packet. It does not implement, even when `mode` is `implement`.

```bash
npx grokbot job submit ./examples/sample-job.json
```
