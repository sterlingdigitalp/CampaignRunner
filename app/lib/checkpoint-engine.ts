import fs from "node:fs/promises";
import path from "node:path";
import { appendCampaignMemory, loadCampaignMemory, renderCampaignMemory } from "./campaign-memory";
import { validateCampaignPrompts } from "./campaign-validation";
import { ensureDir, projectPaths, readJson, writeJson } from "./files";
import { readHistoryRecovering, writeHistoryAtomic } from "./history-manager";
import { completeWithLmStudio } from "./lm-studio";
import { logEvent } from "./logger";
import { estimateTokens } from "./prompt-builder";
import { buildWorkspaceContext, normalizeTaskOutputPath } from "./workspace-context";
import type {
  CampaignCheckpoint,
  CampaignPrompt,
  CheckpointAmendment,
  CheckpointRunRecord,
  ProjectSummary
} from "./types";

const CHECKPOINT_MEMORY_BUDGET = 3000;
const CHECKPOINT_WORKSPACE_BUDGET = 5000;
const MAX_NOTE_CHARS = 2000;

const AMENDMENTS_SCHEMA = {
  type: "object",
  properties: {
    assessment: { type: "string", description: "Two to four sentences: does completed work satisfy the plan, and are remaining tasks still correct?" },
    amendments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "revise", "none"] },
          taskNumber: { type: "number", description: "For revise: the task to change. Use 0 otherwise." },
          title: { type: "string" },
          objective: { type: "string" },
          constraints: { type: "string" },
          dependsOn: { type: "array", items: { type: "number" } },
          workspaceOutput: { type: "array", items: { type: "string" } },
          reason: { type: "string" }
        },
        required: ["action", "taskNumber", "title", "objective", "constraints", "dependsOn", "workspaceOutput", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["assessment", "amendments"],
  additionalProperties: false
} as const;

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "task"
  );
}

function checkpointInterval(project: ProjectSummary) {
  const taskCount = Math.max(1, project.prompts.length);
  const declared = Number(project.campaignMetadata.checkpointInterval);
  if (Number.isFinite(declared) && declared >= 1) return Math.floor(declared);
  return Math.max(1, Math.ceil(taskCount / (project.checkpoints.length + 1)));
}

/**
 * Checkpoint i (ordered by number, 1-based) is due once i*interval tasks are
 * complete. Runs at most one checkpoint per call; failures still mark the
 * checkpoint complete so a bad review can never wedge the campaign.
 */
export function dueCheckpoint(project: ProjectSummary): CampaignCheckpoint | null {
  if (project.checkpoints.length === 0) return null;
  const interval = checkpointInterval(project);
  const completedTasks = project.history.completedSteps.length;
  const completedCheckpoints = new Set(project.history.completedCheckpoints ?? []);
  const ordered = [...project.checkpoints].sort((a, b) => a.number - b.number);
  for (let index = 0; index < ordered.length; index += 1) {
    const trigger = Math.min((index + 1) * interval, project.prompts.length);
    if (!completedCheckpoints.has(ordered[index].number) && completedTasks >= trigger) return ordered[index];
  }
  return null;
}

function parseJsonObject(response: string): Record<string, unknown> | null {
  const unfenced = response.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sanitizeAmendments(value: unknown): CheckpointAmendment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      action: (item.action === "add" || item.action === "revise" ? item.action : "none") as CheckpointAmendment["action"],
      taskNumber: Number.isFinite(Number(item.taskNumber)) ? Number(item.taskNumber) : 0,
      title: typeof item.title === "string" ? item.title.trim().slice(0, 200) : "",
      objective: typeof item.objective === "string" ? item.objective.trim().slice(0, 1000) : "",
      constraints: typeof item.constraints === "string" ? item.constraints.trim().slice(0, 600) : "",
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(Number).filter(Number.isFinite) : [],
      workspaceOutput: Array.isArray(item.workspaceOutput)
        ? item.workspaceOutput
            .filter((entry): entry is string => typeof entry === "string")
            .map(normalizeTaskOutputPath)
            .filter((entry) => entry && !/\s|[<>]/.test(entry))
        : [],
      reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 400) : ""
    }))
    .slice(0, 12);
}

function taskBody(task: CampaignPrompt) {
  return [
    `TASK ${String(task.number).padStart(3, "0")} - ${task.title}`,
    "",
    `Title: ${task.title}`,
    `Task Type: ${task.taskType ?? "CREATE"}`,
    `Depends On: ${task.dependsOn?.length ? task.dependsOn.map((d) => `Task ${String(d).padStart(3, "0")}`).join(", ") : "None"}`,
    `Objective: ${task.objective ?? task.title}`,
    ...(task.constraints ? [`Constraints: ${task.constraints}`] : []),
    `Verification Goal: ${task.verificationGoal ?? "Confirm the declared workspace outputs exist and satisfy the objective."}`,
    ...(task.workspaceOutput?.length ? ["Workspace Output:", ...task.workspaceOutput.map((file) => `FILE: ${file}`)] : [])
  ].join("\n");
}

function buildCheckpointPrompt(project: ProjectSummary, checkpoint: CampaignCheckpoint, memoryContext: string, workspaceContext: string) {
  const completed = new Set(project.history.completedSteps);
  const deferred = new Set(project.history.deferredSteps ?? []);
  const describe = (prompt: CampaignPrompt) =>
    `- Task ${String(prompt.number).padStart(3, "0")}: ${prompt.title}` +
    (completed.has(prompt.number) ? " [COMPLETED]" : deferred.has(prompt.number) ? " [DEFERRED]" : " [PENDING]");
  return [
    "CAMPAIGN CHECKPOINT REVIEW",
    "",
    `Campaign: ${project.campaignTitle}`,
    `Checkpoint ${checkpoint.number}: ${checkpoint.title}`,
    ...(checkpoint.purpose ? [`Purpose: ${checkpoint.purpose}`] : []),
    ...(checkpoint.reviewGoals ? [`Review Goals: ${checkpoint.reviewGoals}`] : []),
    "",
    "Campaign plan status:",
    ...project.prompts.map(describe),
    "",
    ...(memoryContext ? [memoryContext, ""] : []),
    ...(workspaceContext ? [workspaceContext, ""] : []),
    "Instructions:",
    "Assess whether the completed work satisfies the campaign plan so far and whether the remaining tasks are still the right path to the campaign goal.",
    "The campaign goal itself is fixed. You may propose amendments only to the PATH: revise a not-yet-completed task, or add a new task at the end.",
    "Propose amendments only when genuinely necessary (a discovered conflict, a missing prerequisite, a deferred task whose objective needs correcting). Prefer zero amendments.",
    "You may not modify completed tasks. New tasks may depend only on existing task numbers.",
    "Respond with exactly one JSON object:",
    '{"assessment":"...","amendments":[{"action":"add|revise|none","taskNumber":0,"title":"","objective":"","constraints":"","dependsOn":[],"workspaceOutput":[],"reason":""}]}',
    'Use action "none" (or an empty amendments array) when no changes are needed. For unused fields use "", 0, or [].'
  ].join("\n");
}

async function applyAmendments(projectRoot: string, project: ProjectSummary, amendments: CheckpointAmendment[]) {
  const applied: CheckpointRunRecord["applied"] = [];
  const rejected: CheckpointRunRecord["rejected"] = [];
  const completed = new Set(project.history.completedSteps);
  const merged: CampaignPrompt[] = project.prompts.map((prompt) => ({ ...prompt }));
  const changedTasks: CampaignPrompt[] = [];
  const maxAdds = Math.max(1, Math.ceil(project.prompts.length * 0.2));
  let adds = 0;
  let nextNumber = merged.reduce((max, prompt) => Math.max(max, prompt.number), 0) + 1;

  for (const amendment of amendments) {
    if (amendment.action === "none") continue;

    if (amendment.action === "add") {
      if (adds >= maxAdds) {
        rejected.push({ action: "add", reason: `Amendment cap reached (${maxAdds} added task(s) per checkpoint).` });
        continue;
      }
      if (!amendment.title || !amendment.objective) {
        rejected.push({ action: "add", reason: "Added tasks require a title and an objective." });
        continue;
      }
      const existingNumbers = new Set(merged.map((prompt) => prompt.number));
      const dependsOn = (amendment.dependsOn ?? []).filter((dependency) => existingNumbers.has(dependency));
      const task: CampaignPrompt = {
        number: nextNumber,
        title: amendment.title,
        taskType: "MODIFY",
        dependsOn,
        objective: amendment.objective,
        constraints: amendment.constraints || undefined,
        verificationGoal: "Confirm the declared workspace outputs exist and satisfy the objective.",
        workspaceOutput: amendment.workspaceOutput ?? [],
        body: "",
        filename: `${String(nextNumber).padStart(3, "0")}_${slug(amendment.title)}.md`
      };
      task.body = taskBody(task);
      merged.push(task);
      changedTasks.push(task);
      applied.push({ action: "add", taskNumber: task.number, summary: `Added Task ${String(task.number).padStart(3, "0")}: ${task.title} (${amendment.reason})` });
      nextNumber += 1;
      adds += 1;
      continue;
    }

    const target = merged.find((prompt) => prompt.number === amendment.taskNumber);
    if (!target) {
      rejected.push({ action: "revise", reason: `Task ${amendment.taskNumber} does not exist.` });
      continue;
    }
    if (completed.has(target.number)) {
      rejected.push({ action: "revise", reason: `Task ${target.number} is already completed and cannot be revised.` });
      continue;
    }
    if (!amendment.objective && !amendment.title && !amendment.constraints) {
      rejected.push({ action: "revise", reason: "Revision provided no title, objective, or constraints." });
      continue;
    }
    if (amendment.title) target.title = amendment.title;
    if (amendment.objective) target.objective = amendment.objective;
    if (amendment.constraints) target.constraints = amendment.constraints;
    target.body = taskBody(target);
    changedTasks.push(target);
    applied.push({ action: "revise", taskNumber: target.number, summary: `Revised Task ${String(target.number).padStart(3, "0")} (${amendment.reason})` });
  }

  if (changedTasks.length === 0) return { applied, rejected };

  const validation = validateCampaignPrompts(merged, project.campaignMetadata, project.checkpoints);
  if (!validation.valid) {
    return {
      applied: [] as CheckpointRunRecord["applied"],
      rejected: [
        ...rejected,
        ...applied.map((item) => ({ action: item.action, reason: `Discarded: amended campaign failed validation (${validation.errors.join("; ")}).` }))
      ]
    };
  }

  const paths = projectPaths(projectRoot);
  for (const task of changedTasks) {
    await fs.writeFile(path.join(paths.prompts, task.filename), task.body.trim() + "\n", "utf8");
  }
  const storedCampaign = await readJson<Record<string, unknown>>(paths.campaignJson, {});
  await writeJson(paths.campaignJson, { ...storedCampaign, tasks: merged, taskCount: merged.length });
  const edges = merged.flatMap((prompt) => (prompt.dependsOn ?? []).map((dependency) => ({ from: dependency, to: prompt.number })));
  await writeJson(paths.taskGraph, {
    edges,
    nodes: merged.map((prompt) => ({
      taskNumber: prompt.number,
      title: prompt.title,
      milestone: prompt.milestone,
      dependsOn: prompt.dependsOn ?? [],
      dependents: edges.filter((edge) => edge.from === prompt.number).map((edge) => edge.to),
      lineNumber: prompt.lineNumber
    }))
  });
  return { applied, rejected };
}

async function markCheckpointComplete(projectRoot: string, checkpointNumber: number) {
  const { history } = await readHistoryRecovering(projectRoot);
  const completedCheckpoints = Array.from(new Set([...(history.completedCheckpoints ?? []), checkpointNumber])).sort((a, b) => a - b);
  await writeHistoryAtomic(projectRoot, { ...history, completedCheckpoints, updatedAt: new Date().toISOString() });
}

export async function runCheckpoint(projectRoot: string, project: ProjectSummary, checkpoint: CampaignCheckpoint): Promise<CheckpointRunRecord> {
  const paths = projectPaths(projectRoot);
  const label = `Checkpoint ${checkpoint.number}`;
  await logEvent(projectRoot, "CHECKPOINT_STARTED", `${label}: ${checkpoint.title}`);
  const record: CheckpointRunRecord = {
    checkpoint: checkpoint.number,
    title: checkpoint.title,
    timestamp: new Date().toISOString(),
    assessment: "",
    amendments: [],
    applied: [],
    rejected: []
  };

  try {
    const memoryEntries = await loadCampaignMemory(projectRoot);
    const memoryContext = renderCampaignMemory(memoryEntries, CHECKPOINT_MEMORY_BUDGET);
    const pseudoPrompt: CampaignPrompt = {
      number: 0,
      title: checkpoint.title,
      body: "",
      filename: "checkpoint.md",
      workspaceOutput: [],
      dependsOn: []
    };
    const workspaceBudget = Math.min(CHECKPOINT_WORKSPACE_BUDGET, Math.max(0, project.settings.contextTokens - estimateTokens(memoryContext)));
    const workspaceContext = await buildWorkspaceContext(project.settings.workspace, pseudoPrompt, project.prompts, workspaceBudget);
    const prompt = buildCheckpointPrompt(project, checkpoint, memoryContext, workspaceContext);

    const completion = await completeWithLmStudio(project.settings, prompt, {
      reasoningEffort: "high",
      customSchema: { name: "checkpoint_review", schema: AMENDMENTS_SCHEMA }
    });
    const parsed = parseJsonObject(completion.content);
    if (!parsed) throw new Error("Checkpoint response was not a valid JSON object.");
    record.assessment = typeof parsed.assessment === "string" ? parsed.assessment.slice(0, MAX_NOTE_CHARS) : "";
    record.amendments = sanitizeAmendments(parsed.amendments);

    const outcome = await applyAmendments(projectRoot, project, record.amendments);
    record.applied = outcome.applied;
    record.rejected = outcome.rejected;
    if (record.applied.length > 0) {
      await logEvent(projectRoot, "CHECKPOINT_AMENDMENTS_APPLIED", record.applied.map((item) => item.summary).join(" | "));
    }
    if (record.rejected.length > 0) {
      await logEvent(projectRoot, "CHECKPOINT_AMENDMENTS_REJECTED", record.rejected.map((item) => `${item.action}: ${item.reason}`).join(" | "));
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    await logEvent(projectRoot, "CHECKPOINT_FAILED", `${label}: ${record.error}`);
  }

  await ensureDir(paths.checkpoints);
  await writeJson(path.join(paths.checkpoints, `checkpoint_${String(checkpoint.number).padStart(2, "0")}.json`), record);
  await markCheckpointComplete(projectRoot, checkpoint.number);
  await appendCampaignMemory(projectRoot, {
    task: checkpoint.number,
    title: `Checkpoint ${checkpoint.number}: ${checkpoint.title}`,
    timestamp: record.timestamp,
    finalStatus: record.error ? "FAILED" : "VERIFIED",
    status: record.error ? "blocked" : "complete",
    notes: record.error
      ? `Checkpoint review failed: ${record.error}`
      : [record.assessment, ...record.applied.map((item) => item.summary)].filter(Boolean).join(" ").slice(0, MAX_NOTE_CHARS),
    blockers: [],
    followUps: [],
    kind: "checkpoint"
  });
  await logEvent(
    projectRoot,
    "CHECKPOINT_COMPLETED",
    `${label} complete. Applied ${record.applied.length} amendment(s), rejected ${record.rejected.length}.`
  );
  return record;
}
