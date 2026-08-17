import { readFileSync } from "node:fs";
import {
  ENV_GROKBOT_GATEWAY_URL,
  ENV_SAND_GATEWAY_BIND_HOST,
  ENV_SAND_GATEWAY_TOKEN,
  ENV_SAND_GATEWAY_URL,
  ENV_SAND_HOST_PORT,
  gatewayDiscoveryPath,
  resolveSandRoot,
} from "../paths.js";
import type {
  GatewayDiscovery,
  GatewayDiscoveryFile,
  GatewayScheme,
  HealthResponse,
} from "../types.js";
import { DISCOVERY_COMMAND, GrokBotGatewayError, discoveryFailureHint } from "./errors.js";

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export type ResolvedGateway = GatewayDiscovery & {
  /** In-memory only. Never log, print, or serialize this. */
  token?: string;
};

export function connectHostFor(bindHost: string): string {
  const trimmed = bindHost.trim();
  if (trimmed.length === 0) return "127.0.0.1";
  if (WILDCARD_HOSTS.has(trimmed)) return "127.0.0.1";
  return trimmed;
}

function readPort(raw: string | undefined): number | undefined {
  if (raw == null || raw.length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed != null && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function formatBaseUrl(scheme: GatewayScheme, host: string, port: number): string {
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${authority}:${port}`;
}

/**
 * Normalize a full origin override: drop path/userinfo/trailing slash, and
 * rewrite bind wildcards (0.0.0.0 / ::) to 127.0.0.1. Tailscale / LAN names
 * pass through connectHostFor unchanged.
 */
export function normalizeGatewayBaseUrl(raw: string): string {
  const parsed = parseGatewayUrl(raw);
  return formatBaseUrl(parsed.scheme, connectHostFor(parsed.host), parsed.port);
}

/** Parse a full origin override. Never logs the raw value (may contain userinfo). */
function parseGatewayUrl(raw: string): { scheme: GatewayScheme; host: string; port: number } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `Invalid gateway URL. Set ${ENV_GROKBOT_GATEWAY_URL} to an http(s) origin such as http://127.0.0.1:1340.`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Gateway URL must be http or https. Use ${ENV_GROKBOT_GATEWAY_URL} (alias ${ENV_SAND_GATEWAY_URL}).`,
    );
  }
  const scheme: GatewayScheme = url.protocol === "https:" ? "https" : "http";
  const host = url.hostname.trim();
  if (host.length === 0) {
    throw new Error(`Gateway URL is missing a host.`);
  }
  const port = readPort(url.port) ?? (scheme === "https" ? 443 : 80);
  return { scheme, host, port };
}

function readDiscoveryFile(path: string): GatewayDiscoveryFile | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.port !== "number" || !Number.isInteger(rec.port) || rec.port <= 0) {
    return null;
  }
  if (typeof rec.pid !== "number" || !Number.isInteger(rec.pid) || rec.pid <= 0) {
    return null;
  }
  if (typeof rec.startedAt !== "number") return null;
  const scheme = rec.scheme === "https" || rec.scheme === "http" ? rec.scheme : undefined;
  const host = typeof rec.host === "string" ? rec.host : undefined;
  const token = typeof rec.token === "string" && rec.token.length > 0 ? rec.token : undefined;
  return {
    port: rec.port,
    pid: rec.pid,
    startedAt: rec.startedAt,
    ...(scheme !== undefined ? { scheme } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(token !== undefined ? { token } : {}),
  };
}

export type DiscoverOptions = {
  sandRoot?: string;
  env?: NodeJS.ProcessEnv;
  discoveryPath?: string;
  /**
   * Full gateway origin override (scheme + host + port).
   * Same as GROKBOT_GATEWAY_URL / SAND_GATEWAY_URL. Wins over gateway.json
   * host/port/scheme and over SAND_GATEWAY_BIND_HOST / SAND_HOST_PORT.
   */
  gatewayUrl?: string;
};

/**
 * Load gateway.json + env overrides.
 * Token comes from SAND_GATEWAY_TOKEN or the discovery file, and stays in memory.
 * A full URL (options.gatewayUrl, GROKBOT_GATEWAY_URL, or SAND_GATEWAY_URL)
 * wins over gateway.json host/port/scheme.
 */
export function discoverGateway(options: DiscoverOptions = {}): ResolvedGateway {
  const env = options.env ?? process.env;
  const sandRoot = options.sandRoot ?? resolveSandRoot(env);
  const path = options.discoveryPath ?? gatewayDiscoveryPath(sandRoot);
  const file = readDiscoveryFile(path);

  const overrideUrl = firstNonEmpty(
    options.gatewayUrl,
    env[ENV_GROKBOT_GATEWAY_URL],
    env[ENV_SAND_GATEWAY_URL],
  );
  const fromUrl = overrideUrl != null ? parseGatewayUrl(overrideUrl) : null;

  const scheme: GatewayScheme = fromUrl?.scheme ?? file?.scheme ?? "http";
  const bindHost =
    fromUrl?.host ||
    env[ENV_SAND_GATEWAY_BIND_HOST]?.trim() ||
    file?.host?.trim() ||
    "127.0.0.1";
  const port = fromUrl?.port ?? readPort(env[ENV_SAND_HOST_PORT]) ?? file?.port;
  if (port == null) {
    throw new GrokBotGatewayError(
      0,
      DISCOVERY_COMMAND,
      "",
      `Gateway port not found. Expected ${path}, ${ENV_SAND_HOST_PORT}, or ${ENV_GROKBOT_GATEWAY_URL}.`,
      discoveryFailureHint(),
    );
  }

  const envToken = env[ENV_SAND_GATEWAY_TOKEN]?.trim();
  const token = envToken && envToken.length > 0 ? envToken : file?.token;
  // connectHostFor rewrites bind wildcards (0.0.0.0 / :: / [::]) to loopback.
  // That includes GROKBOT_GATEWAY_URL / SAND_GATEWAY_URL hosts copied from
  // gateway.json's bind address. Tailscale MagicDNS and LAN names pass through.
  const host = connectHostFor(fromUrl != null ? fromUrl.host : bindHost);
  const baseUrl = formatBaseUrl(scheme, host, port);

  return {
    port,
    pid: file?.pid ?? 0,
    startedAt: file?.startedAt ?? 0,
    scheme,
    bindHost,
    connectHost: host,
    baseUrl,
    hasToken: token != null && token.length > 0,
    ...(token != null && token.length > 0 ? { token } : {}),
  };
}

/** CLI `grokbot health` — baseUrl + host health fields. Never includes a token. */
export function formatHealthOutput(
  baseUrl: string,
  health: Pick<HealthResponse, "ok" | "isBusy" | "activeAgentId">,
): string {
  return JSON.stringify(
    {
      baseUrl,
      ok: health.ok,
      busy: health.isBusy,
      activeAgentId: health.activeAgentId,
    },
    null,
    2,
  );
}

/**
 * CLI `grokbot discovery` — public fields only.
 * Never includes a token; `hasToken` is a boolean.
 */
export function formatDiscoveryOutput(discovery: GatewayDiscovery): string {
  return JSON.stringify(
    {
      baseUrl: discovery.baseUrl,
      scheme: discovery.scheme,
      bindHost: discovery.bindHost,
      connectHost: discovery.connectHost,
      port: discovery.port,
      pid: discovery.pid,
      startedAt: discovery.startedAt,
      hasToken: discovery.hasToken,
    },
    null,
    2,
  );
}

/** Replace every occurrence of `secret` so logs / errors cannot echo it. */
export function redactSecret(text: string, secret: string | undefined): string {
  if (secret == null || secret.length === 0) return text;
  return text.split(secret).join("[redacted]");
}

/** Strip the token for anything that might be printed or logged. */
export function publicDiscovery(resolved: ResolvedGateway): GatewayDiscovery {
  return {
    port: resolved.port,
    pid: resolved.pid,
    startedAt: resolved.startedAt,
    scheme: resolved.scheme,
    bindHost: resolved.bindHost,
    connectHost: resolved.connectHost,
    baseUrl: resolved.baseUrl,
    hasToken: resolved.hasToken,
  };
}
