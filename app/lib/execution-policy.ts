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

function normalizeProtocol(value: unknown): ExecutionPolicy["builderProtocol"] {
  return value === "FILE_BLOCKS" || value === "FILE_JSON" ? value : defaultExecutionPolicy().builderProtocol;
}

export async function loadExecutionPolicy(projectRoot: string): Promise<ExecutionPolicy> {
  const policy = await loadRuntimeJson(projectRoot, "executionPolicy");
  const defaults = defaultExecutionPolicy();
  return {
    ...defaults,
    ...policy,
    maxRepairAttempts: Math.max(0, Number(policy.maxRepairAttempts) || 0),
    verificationPipeline: (policy.verificationPipeline || []).map(normalizeStep),
    builderProtocol: normalizeProtocol(policy.builderProtocol),
    deferOnFailure: policy.deferOnFailure === undefined ? defaults.deferOnFailure : Boolean(policy.deferOnFailure),
    maxDeferralRounds: Math.max(0, Number(policy.maxDeferralRounds ?? defaults.maxDeferralRounds) || 0),
    enforceDeclaredOutputs: policy.enforceDeclaredOutputs === undefined ? defaults.enforceDeclaredOutputs : Boolean(policy.enforceDeclaredOutputs),
    gitCheckpoints: policy.gitCheckpoints === undefined ? defaults.gitCheckpoints : Boolean(policy.gitCheckpoints),
    speculativeGeneration: policy.speculativeGeneration === undefined ? defaults.speculativeGeneration : Boolean(policy.speculativeGeneration),
    checkpointsEnabled: policy.checkpointsEnabled === undefined ? defaults.checkpointsEnabled : Boolean(policy.checkpointsEnabled)
  };
}

export async function saveExecutionPolicy(projectRoot: string, policy: ExecutionPolicy) {
  const defaults = defaultExecutionPolicy();
  const normalized: ExecutionPolicy = {
    maxRepairAttempts: Math.max(0, Number(policy.maxRepairAttempts) || 0),
    stopOnFailure: Boolean(policy.stopOnFailure),
    retryOnTimeout: Boolean(policy.retryOnTimeout),
    acceptOnlyVerified: Boolean(policy.acceptOnlyVerified),
    verificationPipeline: policy.verificationPipeline.map(normalizeStep),
    builderProtocol: normalizeProtocol(policy.builderProtocol),
    deferOnFailure: policy.deferOnFailure === undefined ? defaults.deferOnFailure : Boolean(policy.deferOnFailure),
    maxDeferralRounds: Math.max(0, Number(policy.maxDeferralRounds ?? defaults.maxDeferralRounds) || 0),
    enforceDeclaredOutputs: policy.enforceDeclaredOutputs === undefined ? defaults.enforceDeclaredOutputs : Boolean(policy.enforceDeclaredOutputs),
    gitCheckpoints: policy.gitCheckpoints === undefined ? defaults.gitCheckpoints : Boolean(policy.gitCheckpoints),
    speculativeGeneration: policy.speculativeGeneration === undefined ? defaults.speculativeGeneration : Boolean(policy.speculativeGeneration),
    checkpointsEnabled: policy.checkpointsEnabled === undefined ? defaults.checkpointsEnabled : Boolean(policy.checkpointsEnabled)
  };
  await writeRuntimeJson(projectRoot, "executionPolicy", normalized);
  return normalized;
}
