import fs from "node:fs/promises";
import { fileExists, projectPaths } from "./files";
import { logEvent } from "./logger";
import type { LockStatus, RunnerSettings } from "./types";

type RunnerLock = {
  pid: number;
  timestamp: string;
  campaignName: string;
  currentStep: number;
};

function processAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readLockStatus(projectRoot: string, timeoutMinutes = 180): Promise<LockStatus> {
  const lockPath = projectPaths(projectRoot).lock;
  if (!(await fileExists(lockPath))) return { exists: false, stale: false };

  try {
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as Partial<RunnerLock>;
    const timestamp = lock.timestamp ?? new Date(0).toISOString();
    const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
    const ownerAlive = typeof lock.pid === "number" ? processAlive(lock.pid) : false;
    const stale = !ownerAlive || ageSeconds > Math.max(1, timeoutMinutes) * 60;
    return {
      exists: true,
      stale,
      pid: lock.pid,
      timestamp,
      campaignName: lock.campaignName,
      currentStep: lock.currentStep,
      ageSeconds,
      ownerAlive
    };
  } catch {
    return { exists: true, stale: true, ownerAlive: false };
  }
}

export async function recoverStaleLock(projectRoot: string, settings: RunnerSettings) {
  const paths = projectPaths(projectRoot);
  const status = await readLockStatus(projectRoot, settings.lockTimeoutMinutes);
  if (!status.exists || !status.stale) return status;
  await fs.rm(paths.lock, { force: true });
  await logEvent(projectRoot, "LOCK_CLEANUP", `Removed stale lock for ${status.campaignName ?? "unknown campaign"} step ${status.currentStep ?? "unknown"}.`);
  return { ...status, exists: false };
}

export async function createLock(projectRoot: string, campaignName: string, currentStep: number) {
  const lock: RunnerLock = {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    campaignName,
    currentStep
  };
  await fs.writeFile(projectPaths(projectRoot).lock, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}
