import { loadRuntimeJson, writeRuntimeJson } from "./runtime-recovery";
import type { ExecutionMetrics, ExecutionRecord, RunnerHistory } from "./types";

export async function updateMetrics(projectRoot: string, history: RunnerHistory) {
  const previous = await loadRuntimeJson(projectRoot, "metrics");
  const executions = history.executions || [];
  const verified = executions.filter((record) => record.finalStatus === "VERIFIED");
  const failed = executions.filter((record) => record.finalStatus === "FAILED");
  const totalRuntime = executions.reduce((sum, record) => sum + record.runtimeSeconds, 0);
  const repairRuntime = executions.reduce((sum, record) => sum + Math.max(0, record.runtimeSeconds - record.verificationRuntimeSeconds), 0);
  const failures = new Map<string, number>();
  let individualVerifierPasses = 0;
  let individualVerifierFailures = 0;
  let verificationPipelineRuns = 0;
  let verificationPipelineSuccesses = 0;
  let verificationPipelineFailures = 0;

  executions.forEach((record) => {
    const activeResults = record.verifierResults.filter((result) => result.status !== "SKIP");
    if (activeResults.length > 0) {
      verificationPipelineRuns += 1;
      if (activeResults.every((result) => result.status === "PASS")) verificationPipelineSuccesses += 1;
      else verificationPipelineFailures += 1;
    }
    record.verifierResults.forEach((result) => {
      if (result.status === "PASS") individualVerifierPasses += 1;
      if (result.status === "FAIL") {
        individualVerifierFailures += 1;
        failures.set(result.verifier, (failures.get(result.verifier) || 0) + 1);
      }
    });
  });

  const repairInvocations = executions.reduce((sum, record) => sum + record.repairCount, 0);

  const metrics: ExecutionMetrics = {
    ...previous,
    totalExecutions: executions.length,
    verifiedExecutions: verified.length,
    failedExecutions: failed.length,
    firstPassSuccesses: verified.filter((record) => record.repairCount === 0).length,
    totalRepairAttempts: repairInvocations,
    averageRepairAttempts: executions.length ? repairInvocations / executions.length : 0,
    averageRuntimeSeconds: executions.length ? totalRuntime / executions.length : 0,
    averageRepairRuntimeSeconds: executions.length ? repairRuntime / executions.length : 0,
    verificationPasses: individualVerifierPasses,
    verificationFailures: individualVerifierFailures,
    verificationPipelineRuns,
    verificationPipelineSuccesses,
    verificationPipelineFailures,
    individualVerifierPasses,
    individualVerifierFailures,
    repairInvocations,
    repairSuccesses: verified.filter((record) => record.repairCount > 0).length,
    repairFailures: failed.filter((record) => record.repairCount > 0).length,
    mostCommonVerifierFailures: Array.from(failures.entries())
      .map(([verifier, count]) => ({ verifier, count }))
      .sort((a, b) => b.count - a.count),
    campaignCompletionRate: executions.length > 0 ? history.completedSteps.length / Math.max(history.completedSteps.length, history.currentStep - 1, 1) : 0
  };

  await writeRuntimeJson(projectRoot, "metrics", metrics);
  return metrics;
}

export function executionFailedRecord(record: ExecutionRecord | undefined) {
  return record?.finalStatus === "FAILED" ? record : null;
}
