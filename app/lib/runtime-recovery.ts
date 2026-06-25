import fs from "node:fs/promises";
import path from "node:path";
import { defaultExecutionPolicy, defaultExecutionState, defaultMetrics } from "./defaults";
import { ensureDir, fileExists, projectPaths } from "./files";
import { logEvent } from "./logger";
import {
  parseValidatedJson,
  validateCampaignSummary,
  validateExecutionPolicy,
  validateExecutionState,
  validateMetrics
} from "./runtime-validation";
import type { ExecutionMetrics, ExecutionPolicy, PersistedExecutionState } from "./types";

type RuntimeKind = "executionState" | "executionPolicy" | "metrics" | "campaignSummary";

type RuntimeMap = {
  executionState: PersistedExecutionState;
  executionPolicy: ExecutionPolicy;
  metrics: ExecutionMetrics;
  campaignSummary: Record<string, unknown>;
};

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function config<T extends RuntimeKind>(projectRoot: string, kind: T) {
  const paths = projectPaths(projectRoot);
  const map = {
    executionState: {
      path: paths.executionState,
      label: "execution_state.json",
      defaults: defaultExecutionState(),
      validate: validateExecutionState
    },
    executionPolicy: {
      path: paths.policy,
      label: "execution_policy.json",
      defaults: defaultExecutionPolicy(),
      validate: validateExecutionPolicy
    },
    metrics: {
      path: paths.metrics,
      label: "metrics.json",
      defaults: defaultMetrics(),
      validate: validateMetrics
    },
    campaignSummary: {
      path: paths.summary,
      label: "campaign_summary.json",
      defaults: {},
      validate: validateCampaignSummary
    }
  };
  return map[kind];
}

async function writeJsonWithBackup(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  if (await fileExists(filePath)) {
    await fs.copyFile(filePath, `${filePath}.bak`).catch(() => undefined);
  }
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

async function writeRecoveryState(projectRoot: string, reason: string) {
  const paths = projectPaths(projectRoot);
  const recovering: PersistedExecutionState = {
    ...defaultExecutionState(),
    state: "RECOVERING",
    updatedAt: new Date().toISOString(),
    lastError: reason
  };
  await writeJsonWithBackup(paths.executionState, recovering);
  await logEvent(projectRoot, "STATE_TRANSITION", `FAILED -> RECOVERING (${reason})`);
}

async function writeReadyState(projectRoot: string) {
  const paths = projectPaths(projectRoot);
  await writeJsonWithBackup(paths.executionState, { ...defaultExecutionState(), state: "READY", updatedAt: new Date().toISOString() });
  await logEvent(projectRoot, "STATE_TRANSITION", "RECOVERING -> READY");
}

export async function writeRuntimeJson<T extends RuntimeKind>(projectRoot: string, kind: T, data: RuntimeMap[T]) {
  await writeJsonWithBackup(config(projectRoot, kind).path, data);
}

export async function loadRuntimeJson<T extends RuntimeKind>(projectRoot: string, kind: T): Promise<RuntimeMap[T]> {
  const item = config(projectRoot, kind);
  if (!(await fileExists(item.path))) {
    await writeJsonWithBackup(item.path, item.defaults);
    return item.defaults as RuntimeMap[T];
  }

  try {
    return parseValidatedJson(await fs.readFile(item.path, "utf8"), item.validate, item.label) as RuntimeMap[T];
  } catch (error) {
    return recoverRuntimeJson(projectRoot, kind, error instanceof Error ? error.message : String(error));
  }
}

export async function recoverRuntimeJson<T extends RuntimeKind>(
  projectRoot: string,
  kind: T,
  reason = "Runtime file is malformed."
): Promise<RuntimeMap[T]> {
  const item = config(projectRoot, kind);
  const corruptFile = `${item.path}.corrupt-${stamp()}`;
  await fs.rename(item.path, corruptFile).catch(() => undefined);
  await writeRecoveryState(projectRoot, `${item.label}: ${reason}`).catch(() => undefined);
  await logEvent(projectRoot, "RECOVERY_PERFORMED", `Preserved corrupt ${item.label} at ${corruptFile}`);

  const backupPath = `${item.path}.bak`;
  if (await fileExists(backupPath)) {
    try {
      const restored = parseValidatedJson(await fs.readFile(backupPath, "utf8"), item.validate, `${item.label}.bak`) as RuntimeMap[T];
      await writeJsonWithBackup(item.path, restored);
      await logEvent(projectRoot, "RECOVERY_PERFORMED", `Restored ${item.label} from backup.`);
      await writeReadyState(projectRoot).catch(() => undefined);
      return restored;
    } catch (error) {
      await logEvent(projectRoot, "RECOVERY_PERFORMED", `Backup for ${item.label} was invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await writeJsonWithBackup(item.path, item.defaults);
  await logEvent(projectRoot, "RECOVERY_PERFORMED", `Regenerated ${item.label} from safe defaults.`);
  await writeReadyState(projectRoot).catch(() => undefined);
  return item.defaults as RuntimeMap[T];
}
