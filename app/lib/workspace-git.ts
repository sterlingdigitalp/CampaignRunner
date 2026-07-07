import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists } from "./files";
import { logEvent } from "./logger";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;

async function git(workspace: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd: workspace, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/**
 * Initializes a standalone git repository inside the workspace (nested repos
 * are fine — the runner's diagnostic .campaign_runner_* files are ignored so
 * rollback never deletes them). Commits any pre-existing content as the
 * baseline so EXISTING workspaces get a rollback point too. Best-effort:
 * callers treat git as optional and never fail a task on git errors.
 */
export async function ensureWorkspaceRepo(projectRoot: string, workspace: string) {
  if (await fileExists(path.join(workspace, ".git"))) return true;
  try {
    await git(workspace, ["init"]);
    await git(workspace, ["config", "user.email", "campaign-runner@local"]);
    await git(workspace, ["config", "user.name", "Campaign Runner"]);
    const gitignore = path.join(workspace, ".gitignore");
    if (!(await fileExists(gitignore))) {
      await fs.writeFile(gitignore, ".campaign_runner_*\nnode_modules/\n.DS_Store\n", "utf8");
    }
    await git(workspace, ["add", "-A"]);
    await git(workspace, ["commit", "--allow-empty", "-m", "Baseline: workspace state before campaign execution"]);
    await logEvent(projectRoot, "GIT_CHECKPOINT", "Initialized workspace git repository with baseline commit.");
    return true;
  } catch (error) {
    await logEvent(projectRoot, "GIT_ERROR", `Workspace git init failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function commitVerifiedTask(projectRoot: string, workspace: string, taskNumber: number, title: string, executionId: string) {
  try {
    await git(workspace, ["add", "-A"]);
    const status = await git(workspace, ["status", "--porcelain"]);
    if (!status) {
      await logEvent(projectRoot, "GIT_CHECKPOINT", `Task ${String(taskNumber).padStart(3, "0")} produced no workspace changes; no commit created.`);
      return null;
    }
    await git(workspace, ["commit", "-m", `Task ${String(taskNumber).padStart(3, "0")}: ${title} (${executionId})`]);
    const hash = await git(workspace, ["rev-parse", "--short", "HEAD"]);
    await logEvent(projectRoot, "GIT_CHECKPOINT", `Task ${String(taskNumber).padStart(3, "0")} committed as ${hash}.`);
    return hash;
  } catch (error) {
    await logEvent(projectRoot, "GIT_ERROR", `Workspace commit failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Restores the workspace to the last checkpoint: tracked files reset, new
 * untracked files removed. Ignored files (runner diagnostics, node_modules)
 * survive because clean runs without -x.
 */
export async function rollbackWorkspace(projectRoot: string, workspace: string, reason: string) {
  if (!(await fileExists(path.join(workspace, ".git")))) return false;
  try {
    await git(workspace, ["checkout", "--", "."]);
    await git(workspace, ["clean", "-fd"]);
    await logEvent(projectRoot, "GIT_ROLLBACK", `Workspace rolled back to last checkpoint: ${reason.slice(0, 300)}`);
    return true;
  } catch (error) {
    await logEvent(projectRoot, "GIT_ERROR", `Workspace rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
