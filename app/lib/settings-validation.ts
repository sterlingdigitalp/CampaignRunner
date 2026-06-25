import path from "node:path";
import type { RunnerSettings } from "./types";

export function validateSettings(settings: RunnerSettings) {
  const errors: string[] = [];
  const normalized: RunnerSettings = {
    ...settings,
    endpoint: settings.endpoint.trim(),
    model: settings.model.trim() || "local-model",
    projectRoot: settings.projectRoot.trim(),
    workspace: settings.workspace.trim() || path.join(settings.projectRoot.trim(), "workspace"),
    temperature: Number(settings.temperature),
    maxTokens: Number(settings.maxTokens),
    requestTimeoutSeconds: Number(settings.requestTimeoutSeconds),
    requestRetries: Number(settings.requestRetries),
    runIntervalMinutes: Number(settings.runIntervalMinutes),
    lockTimeoutMinutes: Number(settings.lockTimeoutMinutes),
    paused: Boolean(settings.paused)
  };

  try {
    new URL(normalized.endpoint);
  } catch {
    errors.push("Endpoint must be a valid URL.");
  }

  if (!Number.isFinite(normalized.temperature)) errors.push("Temperature must be numeric.");
  normalized.temperature = Math.min(2, Math.max(0, Number.isFinite(normalized.temperature) ? normalized.temperature : 0.1));

  if (!Number.isInteger(normalized.maxTokens) || normalized.maxTokens <= 0) errors.push("Max tokens must be a positive integer.");
  if (!Number.isInteger(normalized.requestTimeoutSeconds) || normalized.requestTimeoutSeconds <= 0) errors.push("Request timeout must be a positive integer.");
  if (!Number.isInteger(normalized.requestRetries) || normalized.requestRetries < 0) errors.push("Request retries must be zero or a positive integer.");
  if (!Number.isInteger(normalized.runIntervalMinutes) || normalized.runIntervalMinutes <= 0) errors.push("Run interval must be a positive integer.");
  if (!Number.isInteger(normalized.lockTimeoutMinutes) || normalized.lockTimeoutMinutes <= 0) errors.push("Lock timeout must be a positive integer.");
  if (!normalized.projectRoot) errors.push("Project root is required.");

  return { ok: errors.length === 0, errors, settings: normalized };
}
