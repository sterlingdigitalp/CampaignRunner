import fs from "node:fs/promises";
import path from "node:path";
import { defaultExecutionPolicy, defaultExecutionState, defaultHistory, defaultMetrics, defaultSettings } from "./defaults";
import { ensureDir, projectPaths, readJson, writeJson } from "./files";
import { readHistoryRecovering, writeHistoryAtomic } from "./history-manager";
import { readLockStatus, recoverStaleLock } from "./lock-manager";
import { logEvent } from "./logger";
import { parseCampaign } from "./parser";
import { validateSettings } from "./settings-validation";
import { writeCampaignSummary } from "./summary";
import type { CampaignCheckpoint, CampaignMetadata, CampaignMilestone, CampaignPrompt, FinalCertification, PlannerReport, ProjectSummary, RunnerHistory, RunnerSettings } from "./types";

function fieldFromBody(body: string, label: string) {
  return new RegExp(`^${label}:\\s*(.*)$`, "im").exec(body)?.[1]?.trim();
}

function parseDependsFromBody(body: string) {
  const value = fieldFromBody(body, "Depends On");
  if (!value || /^none$/i.test(value)) return [];
  return value
    .split(/[, ]+/)
    .map((item) => Number(/\d+/.exec(item)?.[0]))
    .filter((item) => Number.isFinite(item));
}

export async function createCampaign(
  projectRoot: string,
  campaignText: string,
  _prompts: CampaignPrompt[],
  metadata?: CampaignMetadata,
  checkpoints: CampaignCheckpoint[] = [],
  finalCertification: FinalCertification | null = null,
  plannerReport?: PlannerReport
) {
  const paths = projectPaths(projectRoot);
  const settings = defaultSettings(projectRoot);
  const history = defaultHistory();
  const parsed = parseCampaign(campaignText);
  const campaignPrompts = parsed.prompts;
  const campaignMetadata = metadata ?? parsed.metadata;
  const taskGraph = {
    edges: campaignPrompts.flatMap((prompt) => (prompt.dependsOn ?? []).map((dependency) => ({ from: dependency, to: prompt.number }))),
    nodes: campaignPrompts.map((prompt) => ({
      taskNumber: prompt.number,
      title: prompt.title,
      milestone: prompt.milestone,
      dependsOn: prompt.dependsOn ?? [],
      dependents: campaignPrompts.filter((candidate) => (candidate.dependsOn ?? []).includes(prompt.number)).map((candidate) => candidate.number),
      lineNumber: prompt.lineNumber
    }))
  };
  const compilerReport = {
    ...parsed.compilerReport,
    taskCount: campaignPrompts.length,
    taskNumbers: campaignPrompts.map((prompt) => prompt.number).sort((a, b) => a - b)
  };
  const campaignSummary = {
    ...parsed.campaignSummary,
    campaignTitle: campaignMetadata.title,
    taskCount: campaignPrompts.length,
    dependencyEdges: taskGraph.edges.length,
    validationStatus: compilerReport.status
  };

  await Promise.all([
    ensureDir(paths.root),
    ensureDir(paths.logs),
    ensureDir(paths.outputs),
    ensureDir(paths.workspace),
    ensureDir(paths.prompts),
    ensureDir(paths.repairs)
  ]);

  await fs.writeFile(paths.campaign, campaignText.trim() + "\n", "utf8");
  await writeJson(paths.campaignJson, {
    metadata: campaignMetadata,
    taskCount: campaignPrompts.length,
    milestones: parsed.milestones,
    tasks: campaignPrompts,
    checkpoints,
    finalCertification
  });
  await writeJson(paths.campaignAst, parsed.ast);
  await writeJson(paths.taskGraph, taskGraph);
  await writeJson(paths.campaignSummary, campaignSummary);
  await writeJson(paths.compilerReport, compilerReport);
  if (plannerReport) await writeJson(paths.plannerReport, plannerReport);
  await Promise.all(
    campaignPrompts.map((prompt) => fs.writeFile(path.join(paths.prompts, prompt.filename), prompt.body.trim() + "\n", "utf8"))
  );
  await writeJson(paths.settings, settings);
  await writeJson(paths.policy, defaultExecutionPolicy());
  await writeJson(paths.executionState, defaultExecutionState());
  await writeJson(paths.metrics, defaultMetrics());
  await writeHistoryAtomic(projectRoot, history);

  const project = await loadProject(projectRoot);
  await writeCampaignSummary(project);
  await logEvent(projectRoot, "CAMPAIGN_CREATED", `Created campaign with ${campaignPrompts.length} tasks.`);
  return project;
}

export async function loadPrompts(projectRoot: string): Promise<CampaignPrompt[]> {
  const paths = projectPaths(projectRoot);
  const files = await fs.readdir(paths.prompts).catch(() => []);
  const markdown = files.filter((file) => /^\d{2,5}_.*\.md$/.test(file)).sort();
  const storedCampaign = await readJson<{ tasks?: CampaignPrompt[] }>(paths.campaignJson, {});
  const storedByFile = new Map((storedCampaign.tasks ?? []).map((task) => [task.filename, task]));
  const storedByNumber = new Map((storedCampaign.tasks ?? []).map((task) => [task.number, task]));

  return Promise.all(
    markdown.map(async (file) => {
      const body = await fs.readFile(path.join(paths.prompts, file), "utf8");
      const number = Number(/^(\d{2,5})_/.exec(file)?.[1] ?? 0);
      const stored = storedByFile.get(file) ?? storedByNumber.get(number);
      const firstMeaningfulLine =
        body
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line && !/^(HOUR|TASK)\s+\d{1,5}/i.test(line)) ?? `Task ${String(number).padStart(3, "0")}`;

      return {
        number,
        title: stored?.title ?? firstMeaningfulLine.replace(/^#+\s*/, "").replace(/^title\s*:\s*/i, ""),
        milestone: stored?.milestone,
        lineNumber: stored?.lineNumber,
        taskType: stored?.taskType ?? (/^HOUR\s+\d{1,3}/i.test(body) ? "LEGACY" : fieldFromBody(body, "Task Type")),
        dependsOn: stored?.dependsOn ?? parseDependsFromBody(body),
        objective: stored?.objective ?? fieldFromBody(body, "Objective"),
        constraints: stored?.constraints ?? fieldFromBody(body, "Constraints"),
        verificationGoal: stored?.verificationGoal ?? fieldFromBody(body, "Verification Goal"),
        workspaceOutput: stored?.workspaceOutput ?? body
          .split("\n")
          .filter((line) => /^FILE:\s*/i.test(line))
          .map((line) => line.replace(/^FILE:\s*/i, "").trim()),
        body,
        filename: file
      };
    })
  );
}

export async function loadProject(projectRoot: string): Promise<ProjectSummary> {
  const paths = projectPaths(projectRoot);
  const campaignText = await fs.readFile(paths.campaign, "utf8").catch(() => "");
  const parsed = parseCampaign(campaignText);
  const storedCampaign = await readJson<{
    metadata?: CampaignMetadata;
    milestones?: CampaignMilestone[];
    checkpoints?: CampaignCheckpoint[];
    finalCertification?: FinalCertification | null;
  }>(paths.campaignJson, {});
  const prompts = await loadPrompts(projectRoot);
  const settings = await readJson<RunnerSettings>(paths.settings, defaultSettings(projectRoot));
  const normalizedSettings = { ...defaultSettings(projectRoot), ...settings };
  const { history, recovery } = await readHistoryRecovering(projectRoot);
  const mergedHistory = { ...defaultHistory(), ...history };
  const taskCount = prompts.length;
  const completed = mergedHistory.completedSteps.length;
  const currentPrompt = prompts.find((prompt) => prompt.number === mergedHistory.currentStep) ?? null;
  const remaining = Math.max(0, taskCount - completed);
  const progress = Math.round((completed / Math.max(1, taskCount)) * 100);
  const initialLockStatus = await readLockStatus(projectRoot, normalizedSettings.lockTimeoutMinutes);
  const notifications: string[] = [];
  if (initialLockStatus.exists && initialLockStatus.stale) {
    await recoverStaleLock(projectRoot, normalizedSettings);
    notifications.push("A stale execution lock was removed automatically.");
  }
  const lockStatus = await readLockStatus(projectRoot, normalizedSettings.lockTimeoutMinutes);

  return {
    campaignTitle: parsed.title,
    campaignMetadata: storedCampaign.metadata ?? parsed.metadata,
    milestones: storedCampaign.milestones ?? parsed.milestones,
    checkpoints: storedCampaign.checkpoints ?? parsed.checkpoints,
    finalCertification: storedCampaign.finalCertification ?? parsed.finalCertification,
    projectRoot,
    settings: normalizedSettings,
    history: mergedHistory,
    prompts,
    recovery,
    lockStatus,
    notifications,
    runtimeDashboard: {
      currentTask: completed >= taskCount ? null : mergedHistory.currentStep,
      currentTaskLabel: completed >= taskCount ? "Complete" : `Task ${String(mergedHistory.currentStep).padStart(3, "0")}`,
      currentMilestone: currentPrompt?.milestone ?? "None",
      completed,
      remaining,
      taskCount,
      progress,
      currentPrompt
    }
  };
}

export async function saveSettings(projectRoot: string, settings: RunnerSettings) {
  const validation = validateSettings({ ...settings, projectRoot });
  if (!validation.ok) {
    throw new Error(validation.errors.join(" "));
  }
  const normalized = validation.settings;
  await ensureDir(normalized.workspace);
  await writeJson(projectPaths(projectRoot).settings, normalized);
  await logEvent(projectRoot, "SETTINGS_CHANGED", "Saved validated settings.");
  return normalized;
}
