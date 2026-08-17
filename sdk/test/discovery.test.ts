import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";
import { GrokBot, GrokBotGatewayError } from "../src/gateway/client.js";
import {
  connectHostFor,
  discoverGateway,
  formatDiscoveryOutput,
  formatHealthOutput,
  normalizeGatewayBaseUrl,
  publicDiscovery,
  redactSecret,
} from "../src/gateway/discovery.js";
import { DISCOVERY_COMMAND, discoveryFailureHint } from "../src/gateway/errors.js";

const MISSING_DISCOVERY = join(tmpdir(), "grokbot-sdk-missing-gateway.json");
const DUMMY_TOKEN = "dummy-test-token";

function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra };
}

test("connectHostFor rewrites wildcard bind hosts to 127.0.0.1", () => {
  assert.equal(connectHostFor("0.0.0.0"), "127.0.0.1");
  assert.equal(connectHostFor("::"), "127.0.0.1");
  assert.equal(connectHostFor("[::]"), "127.0.0.1");
  assert.equal(connectHostFor("  "), "127.0.0.1");
  assert.equal(connectHostFor("grok-bot"), "grok-bot");
  assert.equal(connectHostFor("127.0.0.1"), "127.0.0.1");
});

test("wildcard SAND_GATEWAY_BIND_HOST rewrites connect host to 127.0.0.1", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      SAND_GATEWAY_BIND_HOST: "0.0.0.0",
      SAND_HOST_PORT: "1340",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.bindHost, "0.0.0.0");
  assert.equal(resolved.connectHost, "127.0.0.1");
  assert.equal(resolved.scheme, "http");
  assert.equal(resolved.port, 1340);
  assert.equal(resolved.baseUrl, "http://127.0.0.1:1340");
});

test("SAND_GATEWAY_BIND_HOST + SAND_HOST_PORT still swap host without a full URL", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      SAND_GATEWAY_BIND_HOST: "grok-bot",
      SAND_HOST_PORT: "1340",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.connectHost, "grok-bot");
  assert.equal(resolved.baseUrl, "http://grok-bot:1340");
});

test("GROKBOT_GATEWAY_URL wins over gateway.json host/port/scheme and bind-host env", () => {
  const dir = mkdtempSync(join(tmpdir(), "grokbot-discovery-"));
  const path = join(dir, "gateway.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        port: 9999,
        pid: 1,
        startedAt: 1,
        scheme: "https",
        host: "0.0.0.0",
        token: "dummy-file-token",
      }),
    );
    const resolved = discoverGateway({
      env: isolatedEnv({
        GROKBOT_GATEWAY_URL: "http://grok-bot:1340",
        SAND_GATEWAY_BIND_HOST: "10.0.0.8",
        SAND_HOST_PORT: "80",
        SAND_GATEWAY_TOKEN: DUMMY_TOKEN,
      }),
      discoveryPath: path,
    });
    assert.equal(resolved.scheme, "http");
    assert.equal(resolved.port, 1340);
    assert.equal(resolved.bindHost, "grok-bot");
    assert.equal(resolved.connectHost, "grok-bot");
    assert.equal(resolved.baseUrl, "http://grok-bot:1340");
    assert.equal(resolved.token, DUMMY_TOKEN);
    assert.equal(resolved.hasToken, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SAND_GATEWAY_URL is an alias when GROKBOT_GATEWAY_URL is unset", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      SAND_GATEWAY_URL: "http://grok-bot:1340",
      SAND_GATEWAY_BIND_HOST: "0.0.0.0",
      SAND_HOST_PORT: "9999",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.baseUrl, "http://grok-bot:1340");
  assert.equal(resolved.connectHost, "grok-bot");
  assert.equal(resolved.port, 1340);
});

test("GROKBOT_GATEWAY_URL wildcard host still rewrites to 127.0.0.1", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://0.0.0.0:1340",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.bindHost, "0.0.0.0");
  assert.equal(resolved.connectHost, "127.0.0.1");
  assert.equal(resolved.baseUrl, "http://127.0.0.1:1340");
});

test("GROKBOT_GATEWAY_URL IPv6 unspecified host [::] rewrites to 127.0.0.1", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://[::]:1340",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.connectHost, "127.0.0.1");
  assert.equal(resolved.baseUrl, "http://127.0.0.1:1340");
});

test("normalizeGatewayBaseUrl drops path/slash and rewrites bind wildcards", () => {
  assert.equal(normalizeGatewayBaseUrl("http://0.0.0.0:1340/"), "http://127.0.0.1:1340");
  assert.equal(normalizeGatewayBaseUrl("http://grok-bot:1340/extra"), "http://grok-bot:1340");
  assert.equal(normalizeGatewayBaseUrl("https://grok-bot"), "https://grok-bot:443");
});

test("GrokBot.baseUrl does not keep a trailing slash that would double-slash /api", () => {
  const bot = new GrokBot({
    baseUrl: "http://0.0.0.0:1340/",
    env: isolatedEnv(),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(bot.baseUrl, "http://127.0.0.1:1340");
});

test("GROKBOT_GATEWAY_URL wins over the SAND_GATEWAY_URL alias", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://grok-bot:1340",
      SAND_GATEWAY_URL: "http://127.0.0.1:9999",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.baseUrl, "http://grok-bot:1340");
});

test("DiscoverOptions.gatewayUrl wins over env URLs", () => {
  const resolved = discoverGateway({
    gatewayUrl: "http://grok-bot:1340",
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://other-host:1",
      SAND_GATEWAY_URL: "http://other-host:2",
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.baseUrl, "http://grok-bot:1340");
});

test("publicDiscovery never includes the token", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://127.0.0.1:1340",
      SAND_GATEWAY_TOKEN: DUMMY_TOKEN,
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  assert.equal(resolved.token, DUMMY_TOKEN);
  const pub = publicDiscovery(resolved);
  assert.equal(pub.hasToken, true);
  assert.equal("token" in pub, false);
  assert.equal(JSON.stringify(pub).includes(DUMMY_TOKEN), false);
  assert.deepEqual(Object.keys(pub).sort(), [
    "baseUrl",
    "bindHost",
    "connectHost",
    "hasToken",
    "pid",
    "port",
    "scheme",
    "startedAt",
  ]);
});

test("missing gateway.json and no URL/port throws GrokBotGatewayError with a hint", () => {
  assert.throws(
    () =>
      discoverGateway({
        env: isolatedEnv({ SAND_GATEWAY_TOKEN: DUMMY_TOKEN }),
        discoveryPath: MISSING_DISCOVERY,
      }),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.status, 0);
      assert.equal(error.command, DISCOVERY_COMMAND);
      assert.equal(error.requestId, "");
      assert.ok(error.hint);
      assert.match(error.hint, /127\.0\.0\.1:1340/);
      assert.match(error.hint, /your-host:1340/);
      assert.match(error.hint, /SAND_HOST_PORT/);
      assert.equal(error.hint.includes(DUMMY_TOKEN), false);
      assert.equal(error.message.includes(DUMMY_TOKEN), false);
      assert.equal(error.hint.includes("SAND_GATEWAY_TOKEN"), false);
      return true;
    },
  );
});

test("redactSecret and gateway errors never echo the token", async () => {
  assert.equal(redactSecret(`bad ${DUMMY_TOKEN}`, DUMMY_TOKEN), "bad [redacted]");
  assert.equal(redactSecret("no secret", undefined), "no secret");
  assert.equal(redactSecret("no secret", ""), "no secret");

  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    token: DUMMY_TOKEN,
    env: isolatedEnv({ SAND_GATEWAY_TOKEN: DUMMY_TOKEN }),
    discoveryPath: MISSING_DISCOVERY,
    fetch: async () =>
      new Response(JSON.stringify({ error: `rejected ${DUMMY_TOKEN}` }), {
        status: 401,
        statusText: "Unauthorized",
      }),
  });
  await assert.rejects(
    async () => await bot.listAgents(),
    (error: unknown) => {
      assert.ok(error instanceof GrokBotGatewayError);
      assert.equal(error.message.includes(DUMMY_TOKEN), false);
      assert.match(error.message, /\[redacted\]/);
      assert.equal(error.stack?.includes(DUMMY_TOKEN) ?? false, false);
      return true;
    },
  );
});

test("discoveryFailureHint never mentions a token", () => {
  const hint = discoveryFailureHint();
  assert.match(hint, /GROKBOT_GATEWAY_URL=http:\/\/127\.0\.0\.1:1340/);
  assert.match(hint, /GROKBOT_GATEWAY_URL=http:\/\/your-host:1340/);
  assert.match(hint, /Tailscale|reachable host/);
  assert.equal(hint.toLowerCase().includes("token"), false);
});

test("formatDiscoveryOutput prints public fields and never a token", () => {
  const resolved = discoverGateway({
    env: isolatedEnv({
      GROKBOT_GATEWAY_URL: "http://grok-bot:1340",
      SAND_GATEWAY_TOKEN: DUMMY_TOKEN,
    }),
    discoveryPath: MISSING_DISCOVERY,
  });
  const printed = formatDiscoveryOutput(publicDiscovery(resolved));
  const parsed = JSON.parse(printed) as Record<string, unknown>;
  assert.deepEqual(parsed, {
    baseUrl: "http://grok-bot:1340",
    scheme: "http",
    bindHost: "grok-bot",
    connectHost: "grok-bot",
    port: 1340,
    pid: 0,
    startedAt: 0,
    hasToken: true,
  });
  assert.equal("token" in parsed, false);
  assert.equal(printed.includes(DUMMY_TOKEN), false);
});

test("formatHealthOutput prints baseUrl ok busy activeAgentId and not a token", () => {
  const printed = formatHealthOutput("http://127.0.0.1:1340", {
    ok: true,
    isBusy: false,
    activeAgentId: "00000000-0000-4000-8000-0000000000aa",
  });
  const parsed = JSON.parse(printed) as Record<string, unknown>;
  assert.deepEqual(parsed, {
    baseUrl: "http://127.0.0.1:1340",
    ok: true,
    busy: false,
    activeAgentId: "00000000-0000-4000-8000-0000000000aa",
  });
  assert.equal(printed.includes("token"), false);
  assert.equal(printed.includes(DUMMY_TOKEN), false);
});

test("inspect / JSON of GrokBot discovery never includes the token", () => {
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    env: isolatedEnv({ SAND_GATEWAY_TOKEN: DUMMY_TOKEN }),
    discoveryPath: MISSING_DISCOVERY,
  });
  const pub = bot.discovery();
  assert.equal(inspect(bot).includes(DUMMY_TOKEN), false);
  assert.equal(inspect(pub).includes(DUMMY_TOKEN), false);
  assert.equal(JSON.stringify(pub).includes(DUMMY_TOKEN), false);
  assert.equal(JSON.stringify(bot).includes(DUMMY_TOKEN), false);
  assert.equal(String(bot).includes(DUMMY_TOKEN), false);
});

test("GrokBot constructor gatewayUrl uses the same override and strips the token", () => {
  const bot = new GrokBot({
    gatewayUrl: "http://grok-bot:1340",
    env: isolatedEnv({ SAND_GATEWAY_TOKEN: DUMMY_TOKEN }),
    discoveryPath: MISSING_DISCOVERY,
  });
  const pub = bot.discovery();
  assert.equal(pub.baseUrl, "http://grok-bot:1340");
  assert.equal(pub.hasToken, true);
  assert.equal("token" in pub, false);
  assert.equal(JSON.stringify(pub).includes(DUMMY_TOKEN), false);
});
