import { loadRuntimeJson, writeRuntimeJson } from "./runtime-recovery";
import { validateMetricsConsistency, writeMetricsValidation } from "./metrics-validation";
import type { ExecutionMetrics, ExecutionRecord, ProtocolFailureCategory, RunnerHistory } from "./types";

export async function updateMetrics(projectRoot: string, history: RunnerHistory, totalTasks?: number) {
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
  let verificationPipelineNoopRuns = 0;
  const protocolFailuresByCategory = new Map<string, number>();
  const recurringProtocolFailures = new Map<string, { category: string; file?: string; count: number }>();
  const repairSuccessByCategory = new Map<string, { category: string; successes: number; failures: number }>();

  executions.forEach((record) => {
    const categoriesInRecord = new Set<string>();
    const activeResults = record.verifierResults.filter((result) => result.status !== "SKIP");
    if (record.verifierResults.length > 0) {
      verificationPipelineRuns += 1;
      if (activeResults.length === 0) verificationPipelineNoopRuns += 1;
      else if (activeResults.every((result) => result.status === "PASS")) verificationPipelineSuccesses += 1;
      else verificationPipelineFailures += 1;
    }
    record.verifierResults.forEach((result) => {
      if (result.status === "PASS") individualVerifierPasses += 1;
      if (result.status === "FAIL") {
        individualVerifierFailures += 1;
        failures.set(result.verifier, (failures.get(result.verifier) || 0) + 1);
      }
    });
    (record.protocolFailures || []).forEach((failure) => {
      protocolFailuresByCategory.set(failure.category, (protocolFailuresByCategory.get(failure.category) || 0) + 1);
      categoriesInRecord.add(failure.category);
      const recurringKey = `${failure.category}:${failure.file ?? ""}`;
      const recurring = recurringProtocolFailures.get(recurringKey) || { category: failure.category, file: failure.file, count: 0 };
      recurring.count += 1;
      recurringProtocolFailures.set(recurringKey, recurring);
    });
    if (record.repairCount > 0 || record.finalStatus === "FAILED") {
      categoriesInRecord.forEach((category) => {
        const bucket = repairSuccessByCategory.get(category) || { category, successes: 0, failures: 0 };
        if (record.finalStatus === "VERIFIED") bucket.successes += 1;
        if (record.finalStatus === "FAILED") bucket.failures += 1;
        repairSuccessByCategory.set(category, bucket);
      });
    }
  });

  const repairInvocations = executions.reduce((sum, record) => sum + record.repairCount, 0);
  const convergedRepairs = verified.filter((record) => record.repairCount > 0);
  const resolvedTotalTasks = Math.max(totalTasks ?? history.completedSteps.length, history.completedSteps.length, 0);
  const completionRate = resolvedTotalTasks > 0 ? history.completedSteps.length / resolvedTotalTasks : 0;

  const draftMetrics: ExecutionMetrics = {
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
    verificationPipelineNoopRuns,
    individualVerifierPasses,
    individualVerifierFailures,
    repairInvocations,
    repairSuccesses: verified.filter((record) => record.repairCount > 0).length,
    repairFailures: failed.filter((record) => record.repairCount > 0).length,
    protocolFailuresByCategory: Array.from(protocolFailuresByCategory.entries())
      .map(([category, count]) => ({ category: category as ProtocolFailureCategory, count }))
      .sort((a, b) => b.count - a.count),
    duplicateFileFrequency: protocolFailuresByCategory.get("PROTOCOL_DUPLICATE_FILE") || 0,
    malformedHeaderFrequency: protocolFailuresByCategory.get("PROTOCOL_MALFORMED_HEADER") || 0,
    repairSuccessByCategory: Array.from(repairSuccessByCategory.values())
      .map((item) => ({ category: item.category as ProtocolFailureCategory, successes: item.successes, failures: item.failures }))
      .sort((a, b) => b.successes + b.failures - (a.successes + a.failures)),
    averageRepairDepth: executions.length ? repairInvocations / executions.length : 0,
    averageRepairsBeforeConvergence: convergedRepairs.length
      ? convergedRepairs.reduce((sum, record) => sum + record.repairCount, 0) / convergedRepairs.length
      : 0,
    topRecurringProtocolFailures: Array.from(recurringProtocolFailures.values())
      .map((item) => ({ category: item.category as ProtocolFailureCategory, file: item.file, count: item.count }))
      .sort((a, b) => b.count - a.count),
    completionMetrics: {
      completedTasks: history.completedSteps.length,
      totalTasks: resolvedTotalTasks,
      remainingTasks: Math.max(0, resolvedTotalTasks - history.completedSteps.length),
      completionRate
    },
    metricValidation: { status: "PASS", diagnostics: [] },
    mostCommonVerifierFailures: Array.from(failures.entries())
      .map(([verifier, count]) => ({ verifier, count }))
      .sort((a, b) => b.count - a.count),
    campaignCompletionRate: completionRate
  };
  const metricValidation = validateMetricsConsistency({ history, metrics: draftMetrics, totalTasks: resolvedTotalTasks });
  const metrics = { ...draftMetrics, metricValidation };

  await writeRuntimeJson(projectRoot, "metrics", metrics);
  await writeMetricsValidation(projectRoot, metricValidation);
  return metrics;
}

export function executionFailedRecord(record: ExecutionRecord | undefined) {
  return record?.finalStatus === "FAILED" ? record : null;
}
