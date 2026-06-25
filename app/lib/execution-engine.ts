import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { completeWithLmStudio } from "./lm-studio";
import { loadProject } from "./campaign-manager";
import { decisionEngine } from "./decision-engine";
import { buildExecutionContract } from "./execution-contract";
import { transitionExecutionState } from "./execution-state";
import { ensureDir, projectPaths } from "./files";
import { writeHistoryAtomic } from "./history-manager";
import { createLock, recoverStaleLock } from "./lock-manager";
import { logEvent } from "./logger";
import { updateMetrics } from "./metrics";
import { buildRuntimePrompt } from "./prompt-builder";
import { buildRepairPrompt } from "./repair-engine";
import { writeCampaignSummary } from "./summary";
import { formatVerificationFailures, runVerificationPipeline } from "./verification-engine";
import { writeCandidateFiles } from "./workspace-writer";
import type { ExecutionPolicy, ExecutionRecord, FailureRecord, FileProtocolValidationResult, RunResult, RunnerHistory, RunnerSettings, VerificationResult } from "./types";

function nextRunTimestamp(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
}

async function failHour(
  projectRoot: string,
  history: RunnerHistory,
  settings: RunnerSettings,
  promptNumber: number,
  message: string,
  record?: ExecutionRecord
) {
  const failure: FailureRecord = { promptNumber, timestamp: new Date().toISOString(), message };
  const updated: RunnerHistory = {
    ...history,
    updatedAt: failure.timestamp,
    failures: [...history.failures, failure],
    nextRunAt: null,
    executions: record ? [...(history.executions || []), record] : history.executions || []
  };
  await writeHistoryAtomic(projectRoot, updated);
  await updateMetrics(projectRoot, updated);
  await transitionExecutionState(projectRoot, { state: "FAILED", finalStatus: "FAILED", lastError: message });
  await logEvent(projectRoot, "EXECUTION_STOPPED", `Hour ${String(promptNumber).padStart(2, "0")} failed: ${message}`);
  return updated;
}

export async function executeNextHour(projectRoot: string): Promise<RunResult> {
  const paths = projectPaths(projectRoot);
  const project = await loadProject(projectRoot);
  const { contract } = await buildExecutionContract(projectRoot, project.settings.workspace);
  const recovered = await recoverStaleLock(projectRoot, project.settings);
  if (recovered.exists && !recovered.stale) return { ok: false, message: "A campaign step is already running.", history: project.history };

  await ensureDir(project.settings.workspace);

  try {
    const { settings, prompts } = project;
    const history = project.history;
    const totalTasks = Math.max(1, prompts.length);

    if (project.recovery.mode) return { ok: false, message: project.recovery.message ?? "History recovery is required.", history };
    if (settings.paused) {
      await transitionExecutionState(projectRoot, { state: "PAUSED" });
      return { ok: false, message: "Campaign is paused.", history };
    }

    const prompt = prompts.find((item) => item.number === history.currentStep);
    if (!prompt) return { ok: false, message: "No prompt is available for the current step.", history };

    const started = new Date();
    const executionId = `${started.toISOString().replace(/[:.]/g, "-")}-hour-${String(prompt.number).padStart(2, "0")}`;
    await createLock(projectRoot, project.campaignTitle, prompt.number);
    await transitionExecutionState(projectRoot, {
      state: "RUNNING",
      executionId,
      hour: prompt.number,
      repairAttempt: 0,
      currentVerifier: null,
      currentCommand: null,
      finalStatus: null,
      lastError: null
    });

    const runtimePrompt = buildRuntimePrompt(prompt, settings);
    const promptHash = crypto.createHash("sha256").update(runtimePrompt).digest("hex").slice(0, 16);
    await logEvent(projectRoot, "PROMPT_BUILT", `Hour ${String(prompt.number).padStart(2, "0")} prompt hash ${promptHash}.`);

    let response = "";
    let finalResults: VerificationResult[] = [];
    let repairCount = 0;
    let repairRuntimeSeconds = 0;
    let protocolResult: FileProtocolValidationResult = { valid: false, files: [], errors: [], normalizations: [] };
    let previousAttemptSummary = "No previous attempt.";

    for (let attempt = 0; attempt <= contract.repairPolicy.maxRepairAttempts; attempt += 1) {
      const generationStarted = Date.now();
      await logEvent(projectRoot, attempt === 0 ? "GENERATION_STARTED" : "REPAIR_REQUESTED", `Attempt ${attempt + 1} for ${executionId}.`);
      await transitionExecutionState(projectRoot, { state: attempt === 0 ? "RUNNING" : "REPAIRING", repairAttempt: attempt });
      const promptToSend = attempt === 0 ? runtimePrompt : buildRepairPrompt(prompt, settings, finalResults, protocolResult, previousAttemptSummary, response);
      response = await completeWithLmStudio(settings, promptToSend);
      if (attempt > 0) repairRuntimeSeconds += (Date.now() - generationStarted) / 1000;
      await logEvent(projectRoot, attempt === 0 ? "GENERATION_COMPLETED" : "REPAIR_COMPLETED", `Attempt ${attempt + 1} completed.`);

      await transitionExecutionState(projectRoot, { state: "WRITING_FILES" });
      protocolResult = await writeCandidateFiles(projectRoot, settings.workspace, response, `${executionId}-attempt-${attempt + 1}`);
      previousAttemptSummary = protocolResult.valid
        ? `Wrote ${protocolResult.files.length} files.`
        : `Protocol rejected: ${protocolResult.errors.map((error) => error.message).join("; ")}`;

      const verificationStarted = Date.now();
      const verificationPolicy: ExecutionPolicy = {
        maxRepairAttempts: contract.repairPolicy.maxRepairAttempts,
        stopOnFailure: true,
        retryOnTimeout: true,
        acceptOnlyVerified: contract.acceptancePolicy.acceptOnlyVerified,
        verificationPipeline: contract.verifierPipeline
      };
      finalResults = protocolResult.valid ? await runVerificationPipeline(projectRoot, settings.workspace, verificationPolicy) : [];
      const verificationRuntimeSeconds = (Date.now() - verificationStarted) / 1000;

      if (decisionEngine.shouldAccept(finalResults, protocolResult, contract)) {
        const completed = new Date();
        const runtimeSeconds = Math.max(1, Math.round((completed.getTime() - started.getTime()) / 1000));
        const outputFile = path.join(paths.outputs, `hour_${String(prompt.number).padStart(2, "0")}.md`);
        const output = [
          `Timestamp: ${completed.toISOString()}`,
          `Runtime: ${runtimeSeconds} seconds`,
          `Model: ${settings.model}`,
          `Temperature: ${settings.temperature}`,
          `Step: Hour ${String(prompt.number).padStart(2, "0")}`,
          `Campaign: ${project.campaignTitle}`,
          `Execution ID: ${executionId}`,
          `Prompt Hash: ${promptHash}`,
          `Final Status: VERIFIED`,
          `Repair Count: ${repairCount}`,
          "",
          response,
          ""
        ].join("\n");
        await fs.writeFile(outputFile, output, "utf8");

        const completedSteps = Array.from(new Set([...history.completedSteps, prompt.number])).sort((a, b) => a - b);
        const taskNumbers = prompts.map((item) => item.number).sort((a, b) => a - b);
        const currentIndex = taskNumbers.indexOf(prompt.number);
        const nextStep = currentIndex >= 0 && currentIndex + 1 < taskNumbers.length ? taskNumbers[currentIndex + 1] : Math.max(...taskNumbers) + 1;
        const executionRecord: ExecutionRecord = {
          executionId,
          hour: prompt.number,
          attempt: attempt + 1,
          verifierResults: finalResults,
          repairCount,
          finalStatus: "VERIFIED",
          runtimeSeconds,
          verificationRuntimeSeconds,
          outputFile
        };
        const updatedHistory: RunnerHistory = {
          ...history,
          currentStep: nextStep,
          completedSteps,
          startedAt: history.startedAt ?? started.toISOString(),
          updatedAt: completed.toISOString(),
          lastRuntimeSeconds: runtimeSeconds,
          nextRunAt: completedSteps.length < totalTasks ? nextRunTimestamp(settings.runIntervalMinutes) : null,
          runs: [
            ...history.runs,
            {
              promptNumber: prompt.number,
              title: prompt.title,
              startedAt: started.toISOString(),
              completedAt: completed.toISOString(),
              runtimeSeconds,
              outputFile,
              model: settings.model,
              executionId,
              finalStatus: "VERIFIED",
              repairCount,
              verificationRuntimeSeconds,
              verifierResults: finalResults
            }
          ],
          executions: [...(history.executions || []), executionRecord]
        };
        await writeHistoryAtomic(projectRoot, updatedHistory);
        await updateMetrics(projectRoot, updatedHistory);
        await writeCampaignSummary({ ...project, history: updatedHistory });
        await transitionExecutionState(projectRoot, { state: "COMPLETE", finalStatus: "VERIFIED", currentVerifier: null, currentCommand: null });
        await logEvent(projectRoot, "CAMPAIGN_ADVANCED", `Hour ${String(prompt.number).padStart(2, "0")} VERIFIED. Advanced to ${nextStep}.`);
        return { ok: true, message: `Hour ${String(prompt.number).padStart(2, "0")} VERIFIED.`, outputFile, history: updatedHistory };
      }

      repairCount += 1;
      await logEvent(
        projectRoot,
        protocolResult.valid ? "VERIFICATION_FAILED" : "PROTOCOL_REJECTED",
        (protocolResult.valid ? formatVerificationFailures(finalResults) : protocolResult.errors.map((error) => error.message).join("\n")).slice(0, 1000)
      );
      if (decisionEngine.shouldFail(attempt, contract, protocolResult, finalResults)) {
        const runtimeSeconds = Math.max(1, Math.round((Date.now() - started.getTime()) / 1000));
        const record: ExecutionRecord = {
          executionId,
          hour: prompt.number,
          attempt: attempt + 1,
          verifierResults: finalResults,
          repairCount,
          finalStatus: "FAILED",
          runtimeSeconds,
          verificationRuntimeSeconds,
          failureReason: (protocolResult.valid ? formatVerificationFailures(finalResults) : protocolResult.errors.map((error) => error.message).join("\n")).slice(0, 2000)
        };
        const updated = await failHour(projectRoot, history, settings, prompt.number, "Verification failed after repair attempts.", record);
        return { ok: false, message: "Verification failed after repair attempts. Campaign stopped.", history: updated };
      }
    }

    return { ok: false, message: "Execution ended unexpectedly.", history };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await failHour(projectRoot, project.history, project.settings, project.history.currentStep, message);
    return { ok: false, message, history: updated };
  } finally {
    await fs.rm(paths.lock, { force: true }).catch(() => undefined);
  }
}
