/**
 * Gateway / discovery errors. Token values must never appear on these objects.
 */

export const DISCOVERY_COMMAND = "discover";

export class GrokBotGatewayError extends Error {
  readonly status: number;
  readonly command: string;
  readonly requestId: string;
  readonly hint?: string;

  constructor(
    status: number,
    command: string,
    requestId: string,
    message: string,
    hint?: string,
  ) {
    super(message);
    this.name = "GrokBotGatewayError";
    this.status = status;
    this.command = command;
    this.requestId = requestId;
    if (hint != null && hint.length > 0) this.hint = hint;
  }
}

/**
 * Short recovery text when gateway.json is missing and no URL/port override
 * is set. Never includes a token.
 */
export function discoveryFailureHint(): string {
  return [
    "Set GROKBOT_GATEWAY_URL=http://127.0.0.1:1340 for this computer",
    "or GROKBOT_GATEWAY_URL=http://your-host:1340 from another machine on Tailscale or any reachable host",
    "(SAND_HOST_PORT also works).",
  ].join(" ");
}
