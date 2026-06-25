type Validator<T> = (value: unknown) => T;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function number(value: unknown, name: string) {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function stringOrNull(value: unknown, name: string) {
  if (value !== null && typeof value !== "string") throw new Error(`${name} must be a string or null.`);
  return value;
}

function boolean(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function array(value: unknown, name: string) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

export function parseValidatedJson<T>(raw: string, validate: Validator<T>, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
  return validate(parsed);
}

export function validateExecutionPolicy(value: unknown) {
  const data = object(value, "execution_policy.json");
  number(data.maxRepairAttempts, "maxRepairAttempts");
  boolean(data.stopOnFailure, "stopOnFailure");
  boolean(data.retryOnTimeout, "retryOnTimeout");
  boolean(data.acceptOnlyVerified, "acceptOnlyVerified");
  array(data.verificationPipeline, "verificationPipeline").forEach((step, index) => {
    const item = object(step, `verificationPipeline[${index}]`);
    if (typeof item.name !== "string") throw new Error(`verificationPipeline[${index}].name must be a string.`);
    boolean(item.enabled, `verificationPipeline[${index}].enabled`);
    if (typeof item.command !== "string") throw new Error(`verificationPipeline[${index}].command must be a string.`);
    number(item.timeoutSeconds, `verificationPipeline[${index}].timeoutSeconds`);
    boolean(item.continueOnFailure, `verificationPipeline[${index}].continueOnFailure`);
  });
  return value;
}

export function validateExecutionState(value: unknown) {
  const data = object(value, "execution_state.json");
  const states = ["READY", "RUNNING", "WRITING_FILES", "VERIFYING", "REPAIRING", "COMPLETE", "FAILED", "PAUSED", "RECOVERING"];
  if (typeof data.state !== "string" || !states.includes(data.state)) throw new Error("execution_state.json has an invalid state.");
  stringOrNull(data.executionId, "executionId");
  if (data.hour !== null) number(data.hour, "hour");
  stringOrNull(data.currentVerifier, "currentVerifier");
  number(data.repairAttempt, "repairAttempt");
  stringOrNull(data.currentCommand, "currentCommand");
  stringOrNull(data.startedAt, "startedAt");
  stringOrNull(data.updatedAt, "updatedAt");
  stringOrNull(data.finalStatus, "finalStatus");
  stringOrNull(data.lastError, "lastError");
  return value;
}

export function validateMetrics(value: unknown) {
  const data = object(value, "metrics.json");
  [
    "totalExecutions",
    "verifiedExecutions",
    "failedExecutions",
    "firstPassSuccesses",
    "totalRepairAttempts",
    "averageRepairAttempts",
    "averageRuntimeSeconds",
    "averageRepairRuntimeSeconds",
    "verificationPasses",
    "verificationFailures",
    "campaignCompletionRate"
  ].forEach((key) => number(data[key], key));
  [
    "verificationPipelineRuns",
    "verificationPipelineSuccesses",
    "verificationPipelineFailures",
    "individualVerifierPasses",
    "individualVerifierFailures",
    "repairInvocations",
    "repairSuccesses",
    "repairFailures"
  ].forEach((key) => {
    if (data[key] !== undefined) number(data[key], key);
  });
  array(data.mostCommonVerifierFailures, "mostCommonVerifierFailures");
  return value;
}

export function validateHistory(value: unknown) {
  const data = object(value, "history.json");
  number(data.currentStep, "currentStep");
  array(data.completedSteps, "completedSteps");
  stringOrNull(data.startedAt, "startedAt");
  stringOrNull(data.updatedAt, "updatedAt");
  if (data.lastRuntimeSeconds !== null) number(data.lastRuntimeSeconds, "lastRuntimeSeconds");
  stringOrNull(data.nextRunAt, "nextRunAt");
  array(data.failures, "failures");
  array(data.runs, "runs");
  array(data.executions, "executions");
  return value;
}

export function validateCampaignSummary(value: unknown) {
  object(value, "campaign_summary.json");
  return value;
}
