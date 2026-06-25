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
import type { CampaignCheckpoint, CampaignMetadata, CampaignPrompt, FinalCertification, ProjectSummary, RunnerHistory, RunnerSettings } from "./types";

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
  prompts: CampaignPrompt[],
  metadata?: CampaignMetadata,
  checkpoints: CampaignCheckpoint[] = [],
  finalCertification: FinalCertification | null = null
) {
  const paths = projectPaths(projectRoot);
  const settings = defaultSettings(projectRoot);
  const history = defaultHistory();
  const parsed = parseCampaign(campaignText);
  const campaignMetadata = metadata ?? parsed.metadata;

  await Promise.all([
    ensureDir(paths.root),
    ensureDir(paths.logs),
    ensureDir(paths.outputs),
    ensureDir(paths.workspace),
    ensureDir(paths.prompts)
  ]);

  await fs.writeFile(paths.campaign, campaignText.trim() + "\n", "utf8");
  await writeJson(paths.campaignJson, {
    metadata: campaignMetadata,
    taskCount: prompts.length,
    tasks: prompts,
    checkpoints,
    finalCertification
  });
  await Promise.all(
    prompts.map((prompt) => fs.writeFile(path.join(paths.prompts, prompt.filename), prompt.body.trim() + "\n", "utf8"))
  );
  await writeJson(paths.settings, settings);
  await writeJson(paths.policy, defaultExecutionPolicy());
  await writeJson(paths.executionState, defaultExecutionState());
  await writeJson(paths.metrics, defaultMetrics());
  await writeHistoryAtomic(projectRoot, history);

  const project = await loadProject(projectRoot);
  await writeCampaignSummary(project);
  await logEvent(projectRoot, "CAMPAIGN_CREATED", `Created campaign with ${prompts.length} tasks.`);
  return project;
}

export async function loadPrompts(projectRoot: string): Promise<CampaignPrompt[]> {
  const paths = projectPaths(projectRoot);
  const files = await fs.readdir(paths.prompts).catch(() => []);
  const markdown = files.filter((file) => /^\d{2,5}_.*\.md$/.test(file)).sort();

  return Promise.all(
    markdown.map(async (file) => {
      const body = await fs.readFile(path.join(paths.prompts, file), "utf8");
      const number = Number(/^(\d{2,5})_/.exec(file)?.[1] ?? 0);
      const firstMeaningfulLine =
        body
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line && !/^(HOUR|TASK)\s+\d{1,5}/i.test(line)) ?? `Task ${String(number).padStart(3, "0")}`;

      return {
        number,
        title: firstMeaningfulLine.replace(/^#+\s*/, "").replace(/^title\s*:\s*/i, ""),
        taskType: /^HOUR\s+\d{1,3}/i.test(body) ? "LEGACY" : fieldFromBody(body, "Task Type"),
        dependsOn: parseDependsFromBody(body),
        objective: fieldFromBody(body, "Objective"),
        constraints: fieldFromBody(body, "Constraints"),
        verificationGoal: fieldFromBody(body, "Verification Goal"),
        workspaceOutput: body
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
    checkpoints?: CampaignCheckpoint[];
    finalCertification?: FinalCertification | null;
  }>(paths.campaignJson, {});
  const prompts = await loadPrompts(projectRoot);
  const settings = await readJson<RunnerSettings>(paths.settings, defaultSettings(projectRoot));
  const normalizedSettings = { ...defaultSettings(projectRoot), ...settings };
  const { history, recovery } = await readHistoryRecovering(projectRoot);
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
    checkpoints: storedCampaign.checkpoints ?? parsed.checkpoints,
    finalCertification: storedCampaign.finalCertification ?? parsed.finalCertification,
    projectRoot,
    settings: normalizedSettings,
    history: { ...defaultHistory(), ...history },
    prompts,
    recovery,
    lockStatus,
    notifications
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
