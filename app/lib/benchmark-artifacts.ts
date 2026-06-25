import { execFile } from "node:child_process";
import { promisify } from "node:util";
import packageJson from "../../package.json";
import { projectPaths, writeJson } from "./files";
import { loadRuntimeJson } from "./runtime-recovery";
import type { ExecutionMetrics, ProjectSummary, RunResult } from "./types";

const execFileAsync = promisify(execFile);

export const RUNTIME_VERSION = packageJson.version;
export const PLANNER_VERSION = "2.5.1";
export const COMPILER_VERSION = "1.0.1";
export const REPAIR_ENGINE_VERSION = "2.5.1";

async function gitCommit(projectRoot: string) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function writeBenchmarkArtifacts(input: {
  projectRoot: string;
  project: ProjectSummary;
  metrics?: ExecutionMetrics;
  result?: RunResult;
}) {
  const paths = projectPaths(input.projectRoot);
  const metrics = input.metrics ?? (await loadRuntimeJson(input.projectRoot, "metrics"));
  const executions = input.project.history.executions || [];
  const firstExecution = executions[0];
  const lastExecution = executions[executions.length - 1];
  const startTime = input.project.history.startedAt ?? null;
  const endTime = input.project.history.updatedAt ?? null;
  const durationSeconds = executions.reduce((sum, execution) => sum + execution.runtimeSeconds, 0);
  const failures = input.project.history.failures.length;
  const completedTasks = input.project.history.completedSteps.length;
  const taskCount = input.project.prompts.length;
  const completion = taskCount > 0 ? completedTasks / taskCount : 0;
  const result = failures > 0 ? "FAILED" : completedTasks >= taskCount ? "COMPLETE" : "IN_PROGRESS";
  const benchmarkId = `benchmark-${input.project.campaignMetadata.campaignId || input.project.campaignTitle}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

  const artifact = {
    benchmarkId,
    runtimeVersion: RUNTIME_VERSION,
    plannerVersion: PLANNER_VERSION,
    compilerVersion: COMPILER_VERSION,
    repairEngineVersion: REPAIR_ENGINE_VERSION,
    model: input.project.settings.model,
    campaign: {
      title: input.project.campaignTitle,
      id: input.project.campaignMetadata.campaignId ?? null,
      version: input.project.campaignMetadata.version ?? null,
      profile: input.project.campaignMetadata.profile ?? null
    },
    taskCount,
    completedTasks,
    repairCount: metrics.repairInvocations,
    runtimeSeconds: durationSeconds,
    result,
    startTime,
    endTime,
    durationSeconds,
    completion,
    repairs: {
      invocations: metrics.repairInvocations,
      successes: metrics.repairSuccesses,
      failures: metrics.repairFailures,
      byCategory: metrics.repairSuccessByCategory
    },
    failures,
    telemetrySummary: {
      verificationPipelineRuns: metrics.verificationPipelineRuns,
      verificationPipelineSuccesses: metrics.verificationPipelineSuccesses,
      verificationPipelineFailures: metrics.verificationPipelineFailures,
      verificationPipelineNoopRuns: metrics.verificationPipelineNoopRuns,
      protocolFailuresByCategory: metrics.protocolFailuresByCategory,
      topRecurringProtocolFailures: metrics.topRecurringProtocolFailures,
      metricValidation: metrics.metricValidation
    },
    firstExecutionId: firstExecution?.executionId ?? null,
    lastExecutionId: lastExecution?.executionId ?? null,
    lastResultMessage: input.result?.message ?? null,
    gitCommit: await gitCommit(input.projectRoot),
    artifacts: {
      benchmark: paths.benchmark,
      benchmarkSummary: paths.benchmarkSummary,
      repairs: paths.repairs,
      metrics: paths.metrics,
      metricsValidation: paths.metricsValidation,
      configValidation: paths.configValidation
    }
  };

  await writeJson(paths.benchmark, artifact);
  await writeJson(paths.benchmarkSummary, {
    benchmarkId,
    result,
    completionPercent: Math.round(completion * 100),
    completedTasks,
    taskCount,
    repairs: metrics.repairInvocations,
    failures,
    metricValidation: metrics.metricValidation.status,
    gitCommit: artifact.gitCommit,
    updatedAt: new Date().toISOString()
  });
  return artifact;
}
