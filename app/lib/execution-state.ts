import { projectPaths } from "./files";
import { logEvent } from "./logger";
import { loadRuntimeJson, writeRuntimeJson } from "./runtime-recovery";
import type { ExecutionStateName, PersistedExecutionState } from "./types";

export async function loadExecutionState(projectRoot: string) {
  return loadRuntimeJson(projectRoot, "executionState");
}

export async function transitionExecutionState(
  projectRoot: string,
  patch: Partial<PersistedExecutionState> & { state: ExecutionStateName }
) {
  const current = await loadExecutionState(projectRoot);
  const next: PersistedExecutionState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  if (!next.startedAt && next.state === "RUNNING") next.startedAt = next.updatedAt;
  await writeRuntimeJson(projectRoot, "executionState", next);
  await logEvent(projectRoot, "STATE_TRANSITION", `${current.state} -> ${next.state}`);
  return next;
}
