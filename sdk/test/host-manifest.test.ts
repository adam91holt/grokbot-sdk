import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  SAND_GATEWAY_COMMANDS,
  TYPED_WRAPPER_INPUT_KEYS,
} from "../src/gateway/commands.js";
import { HOST_MANIFEST } from "../src/gateway/host-manifest.generated.js";
import { evaluateCompat, formatCompatVerdict } from "../src/gateway/compat.js";
import { GrokBot } from "../src/gateway/client.js";
import {
  buildHostManifest,
  extractGatewayCommandNames,
  extractHostCapabilities,
  extractHostVersion,
  formatHostManifest,
  renderHostManifestModule,
} from "../scripts/extract-host-manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOST_MAIN = join(here, "..", "..", "host", "host-main.cjs");
const HAS_HOST_SNAPSHOT = existsSync(HOST_MAIN);
const HOST_VERSION = join(here, "..", "..", "host", "version");
const GENERATED = join(here, "..", "src", "gateway", "host-manifest.generated.ts");

const DUMMY_HOST_MAIN = [
  'var ORDERED_REPLICAS_V1 = "orderedReplicasV1";',
  "var SAND_GATEWAY_COMMANDS = {",
  "  listAgents: (api) => api.listAgents(),",
  "  listBoxMcpServers: (api, body) => api.listBoxMcpServers(parseCommandArgs(body))",
  "};",
  "var SAND_GATEWAY_SLIM_COMMANDS = {};",
  'var HOST_CAPABILITIES = [ORDERED_REPLICAS_V1, "sendAcceptanceV1"];',
  "",
].join("\n");

test("extract script is deterministic on a dummy host snapshot", () => {
  const first = buildHostManifest({
    hostMainSource: DUMMY_HOST_MAIN,
    hostVersionText: "abc1234\n",
    wrapperInputKeys: {
      listAgents: [],
      listBoxMcpServers: ["serverIdentifiers"],
    },
  });
  const second = buildHostManifest({
    hostMainSource: DUMMY_HOST_MAIN,
    hostVersionText: "abc1234\n",
    wrapperInputKeys: {
      listAgents: [],
      listBoxMcpServers: ["serverIdentifiers"],
    },
  });
  assert.equal(extractHostVersion("abc1234\n"), "abc1234");
  assert.deepEqual(extractGatewayCommandNames(DUMMY_HOST_MAIN), [
    "listAgents",
    "listBoxMcpServers",
  ]);
  assert.deepEqual(extractHostCapabilities(DUMMY_HOST_MAIN), [
    "orderedReplicasV1",
    "sendAcceptanceV1",
  ]);
  assert.deepEqual(first, second);
  assert.equal(formatHostManifest(first), formatHostManifest(second));
  assert.equal(first.hostVersion, "abc1234");
  assert.deepEqual(first.wrappers.listBoxMcpServers, {
    inputKeys: ["serverIdentifiers"],
  });
});

test("checked-in manifest matches a fresh extract from the host snapshot", { skip: !HAS_HOST_SNAPSHOT }, () => {
  const extracted = buildHostManifest({
    hostMainSource: readFileSync(HOST_MAIN, "utf8"),
    hostVersionText: readFileSync(HOST_VERSION, "utf8"),
  });
  assert.equal(readFileSync(GENERATED, "utf8"), renderHostManifestModule(extracted));
  assert.deepEqual(HOST_MANIFEST, extracted);
});

test("SAND_GATEWAY_COMMANDS and typed wrappers stay aligned with the manifest", () => {
  assert.deepEqual([...SAND_GATEWAY_COMMANDS], [...HOST_MANIFEST.commands]);
  const table = new Set<string>(HOST_MANIFEST.commands);
  for (const name of Object.keys(TYPED_WRAPPER_INPUT_KEYS)) {
    assert.ok(table.has(name), `${name} is a typed wrapper but missing from the extracted command table`);
    assert.deepEqual(
      HOST_MANIFEST.wrappers[name]?.inputKeys,
      [...TYPED_WRAPPER_INPUT_KEYS[name as keyof typeof TYPED_WRAPPER_INPUT_KEYS]],
      `${name} input keys drifted from TypedCommandMap`,
    );
  }
  assert.deepEqual(
    Object.keys(HOST_MANIFEST.wrappers),
    Object.keys(TYPED_WRAPPER_INPUT_KEYS),
  );
});

test("evaluateCompat reports match, mismatch, and unknown hostVersion", () => {
  const pinned = HOST_MANIFEST.hostVersion;
  const known = [...HOST_MANIFEST.capabilities];
  const match = evaluateCompat({ hostVersion: pinned, capabilities: known });
  assert.equal(match.hostVersion.status, "match");
  assert.equal(match.hostVersion.live, pinned);
  assert.deepEqual(match.capabilities.missing, []);
  assert.deepEqual(match.capabilities.extra, []);
  assert.deepEqual(match.wrappers.missingFromTable, []);

  const unknown = evaluateCompat({ hostVersion: null, capabilities: known });
  assert.equal(unknown.hostVersion.status, "unknown");
  assert.equal(unknown.hostVersion.live, null);

  const mismatch = evaluateCompat({
    hostVersion: "deadbeef",
    capabilities: [...known, "futureFlagV1"],
  });
  assert.equal(mismatch.hostVersion.status, "mismatch");
  assert.deepEqual(mismatch.capabilities.extra, ["futureFlagV1"]);
  assert.equal(formatCompatVerdict(mismatch).includes("deadbeef"), true);
});

test("GrokBot.compat() uses live getHostStatus plus the extracted manifest", async () => {
  const bot = new GrokBot({
    gatewayUrl: "http://127.0.0.1:1340",
    token: "dummy-test-token",
    discoveryPath: join(here, "missing-gateway.json"),
    fetch: async () =>
      new Response(
        JSON.stringify({
          hostVersion: null,
          latestHostVersion: null,
          hostUpdateAvailable: null,
          isBusy: false,
          capabilities: [...HOST_MANIFEST.capabilities],
        }),
        { status: 200 },
      ),
  });
  const verdict = await bot.compat();
  assert.equal(verdict.hostVersion.status, "unknown");
  assert.equal(verdict.hostVersion.pinned, HOST_MANIFEST.hostVersion);
  assert.deepEqual(verdict.wrappers.missingFromTable, []);
  assert.equal(JSON.stringify(verdict).includes("dummy-test-token"), false);
});
