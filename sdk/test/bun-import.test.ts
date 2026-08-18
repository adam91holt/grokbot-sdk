/**
 * Bun 1.3.14 has no node:sqlite builtin. The package index used to pull
 * disk store/search-index (and that builtin) on `import { GrokBot }`.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { GrokBot } from "../src/index.js";

const execFileAsync = promisify(execFile);
const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

const FROM_SPEC = /\bfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /^import\s+["']([^"']+)["']/;
const TYPE_ONLY = /^(?:import|export)\s+type\b/;

function staticImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (TYPE_ONLY.test(line)) continue;
    FROM_SPEC.lastIndex = 0;
    const fromMatch = FROM_SPEC.exec(line);
    if (fromMatch?.[1] != null) {
      specs.push(fromMatch[1]);
      continue;
    }
    const side = SIDE_EFFECT_IMPORT.exec(line);
    if (side?.[1] != null) specs.push(side[1]);
  }
  return specs;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(fromFile), spec);
  if (base.endsWith(".js")) return `${base.slice(0, -3)}.ts`;
  return base;
}

function walkStaticGraph(entry: string): { files: string[]; sqliteImporters: string[] } {
  const seen = new Set<string>();
  const sqliteImporters: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file == null || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const spec of staticImportSpecifiers(source)) {
      if (spec === "node:sqlite") sqliteImporters.push(file);
      const local = resolveLocal(file, spec);
      if (local != null) queue.push(local);
    }
  }
  return { files: [...seen], sqliteImporters };
}

function resolveBun(): string | null {
  try {
    const out = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

test("package index static graph does not import node:sqlite", () => {
  const { sqliteImporters, files } = walkStaticGraph(join(SRC_ROOT, "index.ts"));
  assert.ok(files.some((file) => file.endsWith("/gateway/client.ts")));
  assert.deepEqual(sqliteImporters, []);
});

test("import { GrokBot } from the package index constructs without sqlite", async () => {
  const bot = new GrokBot();
  assert.equal(typeof bot.listAgents, "function");
  assert.equal(typeof bot.updateAgent, "function");
});

const bunBin = resolveBun();

test("Bun imports GrokBot from the package index without node:sqlite", { skip: bunBin == null }, async () => {
  const indexUrl = new URL("../src/index.ts", import.meta.url).href;
  const { stdout } = await execFileAsync(bunBin!, [
    "-e",
    `import { GrokBot } from ${JSON.stringify(indexUrl)};
     const bot = new GrokBot();
     if (typeof bot.listAgents !== "function") throw new Error("listAgents missing");
     console.log("ok");`,
  ]);
  assert.equal(stdout.trim(), "ok");
});
