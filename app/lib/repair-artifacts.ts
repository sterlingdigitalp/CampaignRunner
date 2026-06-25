import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, projectPaths, writeJson } from "./files";
import { categorizeProtocolFailure } from "./repair-engine";
import type { CampaignPrompt, FileProtocolValidationResult } from "./types";

export type RepairAttemptArtifact = {
  taskNumber: number;
  repairAttemptNumber: number;
  timestamp: string;
  repairCategory: string | null;
  finalOutcome: "PENDING" | "REPAIRED" | "FAILED";
};

function taskDir(projectRoot: string, taskNumber: number) {
  return path.join(projectPaths(projectRoot).repairs, `task${String(taskNumber).padStart(3, "0")}`);
}

function attemptDir(projectRoot: string, taskNumber: number, attemptNumber: number) {
  return path.join(taskDir(projectRoot, taskNumber), `attempt${attemptNumber}`);
}

function firstCategory(validation: FileProtocolValidationResult) {
  const sourceErrors = validation.originalErrors?.length ? validation.originalErrors : validation.errors;
  return sourceErrors[0] ? categorizeProtocolFailure(sourceErrors[0]) : null;
}

export async function persistRepairSeed(input: {
  projectRoot: string;
  prompt: CampaignPrompt;
  originalPrompt: string;
  originalResponse: string;
  validation: FileProtocolValidationResult;
  executionId: string;
}) {
  const dir = taskDir(input.projectRoot, input.prompt.number);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, "original_prompt.md"), input.originalPrompt, "utf8");
  await fs.writeFile(path.join(dir, "original_response.md"), input.originalResponse, "utf8");
  await writeJson(path.join(dir, "original_validation.json"), input.validation);
  await writeJson(path.join(dir, "summary.json"), {
    taskNumber: input.prompt.number,
    taskTitle: input.prompt.title,
    executionId: input.executionId,
    startedAt: new Date().toISOString(),
    repairCategory: firstCategory(input.validation),
    finalOutcome: "PENDING",
    attempts: []
  });
}

export async function persistRepairAttempt(input: {
  projectRoot: string;
  prompt: CampaignPrompt;
  executionId: string;
  repairAttemptNumber: number;
  originalTaskPrompt: string;
  originalResponse: string;
  originalValidation: FileProtocolValidationResult;
  repairPrompt: string;
  repairResponse: string;
  repairValidation: FileProtocolValidationResult;
  durationSeconds: number;
  finalOutcome: "REPAIRED" | "FAILED" | "PENDING";
}) {
  const timestamp = new Date().toISOString();
  const dir = attemptDir(input.projectRoot, input.prompt.number, input.repairAttemptNumber);
  await ensureDir(dir);
  await Promise.all([
    fs.writeFile(path.join(dir, "original_prompt.md"), input.originalTaskPrompt, "utf8"),
    fs.writeFile(path.join(dir, "original_response.md"), input.originalResponse, "utf8"),
    fs.writeFile(path.join(dir, "repair_prompt.md"), input.repairPrompt, "utf8"),
    fs.writeFile(path.join(dir, "repair_response.md"), input.repairResponse, "utf8"),
    writeJson(path.join(dir, "original_validation.json"), input.originalValidation),
    writeJson(path.join(dir, "validation.json"), input.repairValidation)
  ]);

  const repairCategory = firstCategory(input.repairValidation) ?? firstCategory(input.originalValidation);
  const attempt: RepairAttemptArtifact = {
    taskNumber: input.prompt.number,
    repairAttemptNumber: input.repairAttemptNumber,
    timestamp,
    repairCategory,
    finalOutcome: input.finalOutcome
  };
  await writeJson(path.join(dir, "summary.json"), {
    ...attempt,
    executionId: input.executionId,
    repairDurationSeconds: input.durationSeconds,
    protocolFailure: input.repairValidation.errors[0]?.message ?? input.originalValidation.errors[0]?.message ?? null,
    finalResolution: input.finalOutcome === "REPAIRED" ? "Repair response passed protocol validation." : "Repair response still failed validation."
  });

  const summaryPath = path.join(taskDir(input.projectRoot, input.prompt.number), "summary.json");
  const current = JSON.parse(await fs.readFile(summaryPath, "utf8").catch(() => "{}")) as {
    attempts?: RepairAttemptArtifact[];
    finalOutcome?: string;
  };
  const attempts = [...(current.attempts ?? []).filter((item) => item.repairAttemptNumber !== input.repairAttemptNumber), attempt].sort(
    (a, b) => a.repairAttemptNumber - b.repairAttemptNumber
  );
  await writeJson(summaryPath, {
    ...current,
    taskNumber: input.prompt.number,
    taskTitle: input.prompt.title,
    executionId: input.executionId,
    repairCategory,
    finalOutcome: input.finalOutcome,
    attempts
  });
}

export async function finalizeRepairSession(input: {
  projectRoot: string;
  prompt: CampaignPrompt;
  finalOutcome: "REPAIRED" | "FAILED";
  finalResolution: string;
}) {
  const summaryPath = path.join(taskDir(input.projectRoot, input.prompt.number), "summary.json");
  const current = JSON.parse(await fs.readFile(summaryPath, "utf8").catch(() => "{}"));
  await writeJson(summaryPath, {
    ...current,
    taskNumber: input.prompt.number,
    taskTitle: input.prompt.title,
    completedAt: new Date().toISOString(),
    finalOutcome: input.finalOutcome,
    finalResolution: input.finalResolution
  });
}
