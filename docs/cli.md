# CLI

```bash
npx grokbot <command>
```

Discovery matches `new GrokBot()`. If `GROKBOT_GATEWAY_URL` is set, it wins.

| Command | Notes |
| --- | --- |
| `health` | `ok`, `busy`, `baseUrl` — never the token |
| `discovery` | Public fields + `hasToken` boolean |
| `agents` | Name + id |
| `send <name-or-id> <prompt...>` | Host `sendPrompt` |
| `run-once [--from name] <prompt...>` | Throwaway create or host-clone |
| `discuss --from A --from B <prompt...>` | Throwaway room |
| `send-as --to <name-or-id> <message...>` | Bus seat calls SendToAgent |
| `job submit \| show \| list` | Decide-only packets |
| `compat` | Live host vs checked-in command manifest |
| `digest` | Read-only metadata, no chat bodies |

Agent arguments accept a roster name or id. `--no-reply` hides bodies on one-shot commands. Never tokens.

See [sdk/README.md](../sdk/README.md) for the full flag list.
