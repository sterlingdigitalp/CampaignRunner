import crypto from "node:crypto";
import type { CompletionResult } from "./lm-studio";
import type { RunnerSettings } from "./types";

type SpeculativeEntry = {
  projectRoot: string;
  taskNumber: number;
  key: string;
  promise: Promise<CompletionResult>;
};

let entry: SpeculativeEntry | null = null;

/**
 * Key covers the exact prompt plus every sampling parameter that shapes the
 * response. Reuse happens only on an exact match, so a failed verification,
 * rollback, settings change, or different next task silently invalidates the
 * speculation and the engine generates fresh.
 */
export function speculationKey(prompt: string, settings: RunnerSettings) {
  return crypto
    .createHash("sha256")
    .update([prompt, settings.model, settings.temperature, settings.maxTokens, settings.reasoningEffort, settings.endpoint].join("|"))
    .digest("hex");
}

export function putSpeculation(next: SpeculativeEntry) {
  entry = next;
  next.promise.catch(() => undefined);
}

export function takeSpeculation(projectRoot: string, taskNumber: number, key: string) {
  const current = entry;
  entry = null;
  if (current && current.projectRoot === projectRoot && current.taskNumber === taskNumber && current.key === key) {
    return current.promise;
  }
  return null;
}
