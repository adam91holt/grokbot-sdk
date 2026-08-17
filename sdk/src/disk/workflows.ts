import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSafeFolderId, workflowSkillPath, workflowsDir } from "../paths.js";
import type { DiskWorkflow } from "../types.js";

function parseFrontmatter(raw: string): { name: string; description: string } {
  if (!raw.startsWith("---")) return { name: "", description: "" };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { name: "", description: "" };
  const fm = raw.slice(4, end);
  let name = "";
  let description = "";
  let inDesc = false;
  const descLines: string[] = [];
  for (const line of fm.split("\n")) {
    if (inDesc) {
      if (/^\S/.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
        inDesc = false;
      } else {
        descLines.push(line.replace(/^\s+/, "").replace(/^-\s+/, ""));
        continue;
      }
    }
    const nameMatch = /^name:\s*(.+)\s*$/.exec(line);
    if (nameMatch) {
      name = (nameMatch[1] ?? "").trim();
      continue;
    }
    if (/^description:\s*>-?\s*$/.test(line) || /^description:\s*\|-?\s*$/.test(line)) {
      inDesc = true;
      continue;
    }
    const descMatch = /^description:\s*(.+)\s*$/.exec(line);
    if (descMatch) description = (descMatch[1] ?? "").trim();
  }
  if (descLines.length > 0) description = descLines.join(" ").trim();
  return { name, description };
}

export function listGlobalWorkflows(sandRoot?: string): DiskWorkflow[] {
  const root = workflowsDir(sandRoot);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: DiskWorkflow[] = [];
  for (const slug of names) {
    if (!isSafeFolderId(slug)) continue;
    const path = workflowSkillPath(slug, sandRoot);
    try {
      if (!statSync(join(root, slug)).isDirectory()) continue;
    } catch {
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { name, description } = parseFrontmatter(raw);
    out.push({
      slug,
      path,
      name: name.length > 0 ? name : slug,
      description,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
