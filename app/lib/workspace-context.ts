import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokens } from "./prompt-builder";
import type { CampaignPrompt } from "./types";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "__pycache__", ".venv"]);
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".pdf", ".zip", ".gz", ".tar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".sqlite", ".db"
]);
const MAX_TREE_ENTRIES = 500;
const MAX_FILE_BYTES = 200_000;
const MANIFEST_FILES = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "README.md"];

type WorkspaceFile = {
  relativePath: string;
  size: number;
  modifiedMs: number;
};

function isExcluded(name: string) {
  return name === ".DS_Store" || name.startsWith(".campaign_runner");
}

async function listWorkspaceFiles(workspace: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (isExcluded(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), rel);
        continue;
      }
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      if (stat) files.push({ relativePath: rel, size: stat.size, modifiedMs: stat.mtimeMs });
    }
  }
  await walk(workspace, "");
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function normalizeTaskOutputPath(value: string) {
  return value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^workspace\//i, "");
}

function taskOutputPaths(prompt: CampaignPrompt | undefined) {
  return (prompt?.workspaceOutput ?? []).map(normalizeTaskOutputPath).filter(Boolean);
}

async function readTextFile(workspace: string, relativePath: string, size: number) {
  if (size > MAX_FILE_BYTES) return null;
  if (BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return null;
  const content = await fs.readFile(path.join(workspace, relativePath), "utf8").catch(() => null);
  if (content === null || content.includes("\0")) return null;
  return content;
}

function truncateToTokens(content: string, tokenBudget: number) {
  const approximateChars = Math.max(200, tokenBudget * 4);
  if (content.length <= approximateChars) return { content, truncated: false };
  return { content: `${content.slice(0, approximateChars)}\n...[truncated]`, truncated: true };
}

/**
 * Builds the "existing project" section of the builder prompt: a file tree plus
 * token-budgeted contents, prioritizing the current task's declared outputs,
 * its dependencies' outputs, and project manifests. Returns "" for an empty
 * workspace so first tasks keep the original minimal prompt.
 */
export async function buildWorkspaceContext(
  workspace: string,
  prompt: CampaignPrompt,
  allPrompts: CampaignPrompt[],
  budgetTokens: number
): Promise<string> {
  if (budgetTokens <= 0) return "";
  const files = await listWorkspaceFiles(workspace);
  if (files.length === 0) return "";

  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const promptByNumber = new Map(allPrompts.map((item) => [item.number, item]));
  const priorityPaths: string[] = [
    ...taskOutputPaths(prompt),
    ...(prompt.dependsOn ?? []).flatMap((dependency) => taskOutputPaths(promptByNumber.get(dependency))),
    ...MANIFEST_FILES
  ];
  const remainingByRecency = [...files].sort((a, b) => b.modifiedMs - a.modifiedMs).map((file) => file.relativePath);
  const orderedPaths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...priorityPaths, ...remainingByRecency]) {
    if (seen.has(candidate) || !byPath.has(candidate)) continue;
    seen.add(candidate);
    orderedPaths.push(candidate);
  }

  const treeEntries = files.slice(0, MAX_TREE_ENTRIES).map((file) => `- ${file.relativePath} (${file.size} bytes)`);
  const treeOverflow = files.length > MAX_TREE_ENTRIES ? [`- ...and ${files.length - MAX_TREE_ENTRIES} more files`] : [];
  const sections: string[] = [
    "WORKSPACE CONTEXT",
    "",
    "The workspace already contains the files below. Modify existing files using their exact paths. Do not recreate files that need no changes.",
    "",
    "File tree (relative to workspace root):",
    ...treeEntries,
    ...treeOverflow
  ];

  let remainingTokens = Math.max(0, budgetTokens - estimateTokens(sections.join("\n")));
  const contentSections: string[] = [];
  let omitted = 0;
  for (const relativePath of orderedPaths) {
    if (remainingTokens < 50) {
      omitted += 1;
      continue;
    }
    const file = byPath.get(relativePath);
    const content = file ? await readTextFile(workspace, relativePath, file.size) : null;
    if (content === null) continue;
    const { content: fitted } = truncateToTokens(content, remainingTokens);
    const section = `=== ${relativePath} ===\n${fitted}`;
    const cost = estimateTokens(section) + 10;
    if (cost > remainingTokens && contentSections.length > 0) {
      omitted += 1;
      continue;
    }
    contentSections.push(section);
    remainingTokens = Math.max(0, remainingTokens - cost);
  }

  if (contentSections.length > 0) {
    sections.push("", "Current file contents:", "", contentSections.join("\n\n"));
  }
  if (omitted > 0) {
    sections.push("", `(${omitted} additional files exist but are not shown; consult the file tree.)`);
  }
  return sections.join("\n");
}
