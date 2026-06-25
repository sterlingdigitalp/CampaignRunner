import fs from "node:fs/promises";
import path from "node:path";
import { defaultHistory } from "./defaults";
import { ensureDir, fileExists, projectPaths } from "./files";
import { logEvent } from "./logger";
import { parseValidatedJson, validateHistory } from "./runtime-validation";
import type { HistoryRecovery, RunnerHistory } from "./types";

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeHistoryAtomic(projectRoot: string, history: RunnerHistory) {
  const paths = projectPaths(projectRoot);
  const tmp = `${paths.history}.tmp`;
  await ensureDir(path.dirname(paths.history));

  if (await fileExists(paths.history)) {
    await fs.copyFile(paths.history, `${paths.history}.bak`);
  }

  await fs.writeFile(tmp, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await fs.rename(tmp, paths.history);
}

export async function readHistoryRecovering(projectRoot: string): Promise<{ history: RunnerHistory; recovery: HistoryRecovery }> {
  const paths = projectPaths(projectRoot);
  const fallback = defaultHistory();

  try {
    const raw = await fs.readFile(paths.history, "utf8");
    return { history: { ...fallback, ...(parseValidatedJson(raw, validateHistory, "history.json") as RunnerHistory) }, recovery: { mode: false, message: null } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { history: fallback, recovery: { mode: false, message: null } };
    }

    const corruptFile = `${paths.history}.corrupt-${stamp()}`;
    await fs.rename(paths.history, corruptFile).catch(() => undefined);
    await logEvent(projectRoot, "HISTORY_RECOVERY", `Corrupt history moved to ${corruptFile}`);

    try {
      const backupRaw = await fs.readFile(`${paths.history}.bak`, "utf8");
      const restored = { ...fallback, ...(parseValidatedJson(backupRaw, validateHistory, "history.json.bak") as RunnerHistory) };
      await writeHistoryAtomic(projectRoot, restored);
      await logEvent(projectRoot, "HISTORY_RECOVERY", "Restored history.json from backup.");
      return {
        history: restored,
        recovery: {
          mode: false,
          message: "history.json was corrupted and restored from history.json.bak.",
          corruptFile,
          restoredFromBackup: true
        }
      };
    } catch {
      return {
        history: fallback,
        recovery: {
          mode: true,
          message: "History is corrupted and no valid backup is available.",
          corruptFile,
          restoredFromBackup: false
        }
      };
    }
  }
}

export async function rebuildHistoryFromOutputs(projectRoot: string) {
  const paths = projectPaths(projectRoot);
  const files = await fs.readdir(paths.outputs).catch(() => []);
  const completedSteps = files
    .map((file) => /^hour_(\d{2})\.md$/.exec(file)?.[1])
    .filter((number): number is string => Boolean(number))
    .map(Number)
    .sort((a, b) => a - b);
  const currentStep = Math.min((completedSteps.at(-1) ?? 0) + 1, 25);
  const history: RunnerHistory = {
    ...defaultHistory(),
    currentStep,
    completedSteps,
    updatedAt: new Date().toISOString(),
    executions: []
  };
  await writeHistoryAtomic(projectRoot, history);
  await logEvent(projectRoot, "HISTORY_RECOVERY", `Rebuilt history from ${completedSteps.length} output files.`);
  return history;
}
