# Remote use

The host gateway listens on the Grok Bot computer. It is not meant to be a public website.

## Tailnet (usual)

Put the Grok Bot computer and your laptop on the same tailnet. Use the host's tailnet name or 100.x address as the URL.

```bash
export GROKBOT_GATEWAY_URL=http://your-host:1340
export SAND_GATEWAY_TOKEN=...   # copy from the host's gateway.json; do not commit it
```

```ts
import { GrokBot } from "@adam91holt/grokbot-sdk";

const bot = new GrokBot({ gatewayUrl: process.env.GROKBOT_GATEWAY_URL });
```

Any other reachable path is fine: LAN, VPN, SSH local forward. The SDK only needs HTTP to `/health` and `/api/<command>`.

## Env

| Variable | Role |
| --- | --- |
| `GROKBOT_GATEWAY_URL` | Full base URL. Wins over `gateway.json` host/port. |
| `SAND_GATEWAY_URL` | Alias for the URL. |
| `SAND_GATEWAY_TOKEN` | Bearer token. Wins over `gateway.json`. |
| `SAND_GATEWAY_BIND_HOST` + `SAND_HOST_PORT` | Swap host/port without a full URL. |

The token is loaded at runtime and kept in memory. `grokbot discovery` prints `hasToken` (boolean) only.

## Do not

- Publish the token.
- Point a browser at the gateway with the token in a query string.
- Assume `0.0.0.0` in `gateway.json` is a public bind you should expose.
