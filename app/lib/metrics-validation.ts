import { projectPaths, writeJson } from "./files";
import type { ExecutionMetrics, RunnerHistory } from "./types";

type MetricDiagnostic = { severity: "WARNING" | "FAIL"; code: string; message: string };
type MetricValidationStatus = "PASS" | "WARNING" | "FAIL";

export function validateMetricsConsistency(input: {
  history: RunnerHistory;
  metrics: ExecutionMetrics;
  totalTasks: number;
}) {
  const diagnostics: MetricDiagnostic[] = [];
  const completedTasks = input.history.completedSteps.length;
  const expectedRate = input.totalTasks > 0 ? completedTasks / input.totalTasks : 0;
  const pipelineClassifications =
    input.metrics.verificationPipelineSuccesses +
    input.metrics.verificationPipelineFailures +
    (input.metrics.verificationPipelineNoopRuns ?? 0);

  if (input.metrics.completionMetrics?.completedTasks !== completedTasks) {
    diagnostics.push({
      severity: "FAIL",
      code: "COMPLETED_TASK_MISMATCH",
      message: "completionMetrics.completedTasks does not equal completedSteps.length."
    });
  }

  if (Math.abs(input.metrics.campaignCompletionRate - expectedRate) > 0.0001) {
    diagnostics.push({
      severity: "FAIL",
      code: "COMPLETION_RATE_MISMATCH",
      message: "campaignCompletionRate does not equal completedTasks / totalTasks."
    });
  }

  if (pipelineClassifications !== input.metrics.verificationPipelineRuns) {
    diagnostics.push({
      severity: "FAIL",
      code: "PIPELINE_COUNT_MISMATCH",
      message: "Pipeline successes, failures, and no-op runs do not add up to verificationPipelineRuns."
    });
  }

  if (input.metrics.verificationPasses !== input.metrics.individualVerifierPasses) {
    diagnostics.push({
      severity: "WARNING",
      code: "LEGACY_VERIFICATION_PASS_DRIFT",
      message: "Legacy verificationPasses differs from individualVerifierPasses."
    });
  }

  if (input.metrics.verificationFailures !== input.metrics.individualVerifierFailures) {
    diagnostics.push({
      severity: "WARNING",
      code: "LEGACY_VERIFICATION_FAILURE_DRIFT",
      message: "Legacy verificationFailures differs from individualVerifierFailures."
    });
  }

  const status: MetricValidationStatus = diagnostics.some((item) => item.severity === "FAIL")
    ? "FAIL"
    : diagnostics.some((item) => item.severity === "WARNING")
      ? "WARNING"
      : "PASS";

  return {
    status,
    diagnostics
  };
}

export async function writeMetricsValidation(projectRoot: string, report: ReturnType<typeof validateMetricsConsistency>) {
  await writeJson(projectPaths(projectRoot).metricsValidation, { ...report, checkedAt: new Date().toISOString() });
}
