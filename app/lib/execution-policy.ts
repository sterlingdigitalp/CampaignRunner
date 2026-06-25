import { defaultExecutionPolicy } from "./defaults";
import { loadRuntimeJson, writeRuntimeJson } from "./runtime-recovery";
import type { ExecutionPolicy, VerificationStep } from "./types";

function normalizeStep(step: VerificationStep): VerificationStep {
  return {
    name: String(step.name || "Verifier"),
    enabled: Boolean(step.enabled),
    command: String(step.command || ""),
    timeoutSeconds: Math.max(1, Number(step.timeoutSeconds) || 120),
    continueOnFailure: Boolean(step.continueOnFailure)
  };
}

export async function loadExecutionPolicy(projectRoot: string): Promise<ExecutionPolicy> {
  const policy = await loadRuntimeJson(projectRoot, "executionPolicy");
  return {
    ...defaultExecutionPolicy(),
    ...policy,
    maxRepairAttempts: Math.max(0, Number(policy.maxRepairAttempts) || 0),
    verificationPipeline: (policy.verificationPipeline || []).map(normalizeStep)
  };
}

export async function saveExecutionPolicy(projectRoot: string, policy: ExecutionPolicy) {
  const normalized: ExecutionPolicy = {
    maxRepairAttempts: Math.max(0, Number(policy.maxRepairAttempts) || 0),
    stopOnFailure: Boolean(policy.stopOnFailure),
    retryOnTimeout: Boolean(policy.retryOnTimeout),
    acceptOnlyVerified: Boolean(policy.acceptOnlyVerified),
    verificationPipeline: policy.verificationPipeline.map(normalizeStep)
  };
  await writeRuntimeJson(projectRoot, "executionPolicy", normalized);
  return normalized;
}
