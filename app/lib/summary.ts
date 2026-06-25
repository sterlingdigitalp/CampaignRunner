import { writeRuntimeJson } from "./runtime-recovery";
import type { ProjectSummary } from "./types";

export async function writeCampaignSummary(project: ProjectSummary) {
  const runtimes = project.history.runs.map((run) => run.runtimeSeconds);
  const averageRuntime = runtimes.length > 0 ? Math.round(runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length) : 0;
  const totalTasks = Math.max(1, project.prompts.length);
  const completedPercent = Math.round((project.history.completedSteps.length / totalTasks) * 100);
  const remaining = Math.max(0, totalTasks - project.history.completedSteps.length);
  const estimatedCompletion =
    project.history.nextRunAt && remaining > 0
      ? new Date(new Date(project.history.nextRunAt).getTime() + Math.max(0, remaining - 1) * project.settings.runIntervalMinutes * 60_000).toISOString()
      : null;

  await writeRuntimeJson(project.projectRoot, "campaignSummary", {
    campaignTitle: project.campaignTitle,
        currentStep: project.history.currentStep,
        totalTasks,
    completedPercent,
    estimatedCompletion,
    averageRuntime,
    failures: project.history.failures,
    nextScheduledExecution: project.history.nextRunAt
  });
}
