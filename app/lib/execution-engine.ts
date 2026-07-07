import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { writeBenchmarkArtifacts } from "./benchmark-artifacts";
import { appendCampaignMemory, loadCampaignMemory, renderCampaignMemory } from "./campaign-memory";
import { completeWithLmStudio, type CompletionResult } from "./lm-studio";
import { loadProject } from "./campaign-manager";
import { commitVerifiedTask, ensureWorkspaceRepo, rollbackWorkspace } from "./workspace-git";
import { putSpeculation, speculationKey, takeSpeculation } from "./speculation";
import { validateExecutionConfig } from "./config-validation";
import { decisionEngine } from "./decision-engine";
import { buildExecutionContract } from "./execution-contract";
import { loadExecutionPolicy } from "./execution-policy";
import { transitionExecutionState } from "./execution-state";
import { ensureDir, projectPaths } from "./files";
import { readHistoryRecovering, writeHistoryAtomic } from "./history-manager";
import { createLock, recoverStaleLock } from "./lock-manager";
import { logEvent } from "./logger";
import { updateMetrics } from "./metrics";
import { buildRuntimePrompt, estimateTokens } from "./prompt-builder";
import { buildWorkspaceContext } from "./workspace-context";
import { finalizeRepairSession, persistRepairAttempt, persistRepairSeed } from "./repair-artifacts";
import { buildRepairPrompt, categorizeProtocolFailure } from "./repair-engine";
import { writeCampaignSummary } from "./summary";
import { checkDeclaredOutputs, formatVerificationFailures, runVerificationPipeline } from "./verification-engine";
import { writeCandidateFiles } from "./workspace-writer";
import type {
  CampaignMemoryEntry,
  CampaignPrompt,
  ExecutionContract,
  ExecutionPolicy,
  ExecutionRecord,
  FailureRecord,
  FileProtocolValidationResult,
  ProtocolFailureRecord,
  RunResult,
  RunnerHistory,
  RunnerSettings,
  VerificationResult
} from "./types";

const MEMORY_PROMPT_TOKEN_BUDGET = 2500;
const TRUNCATION_MAX_TOKENS_CAP = 65536;

function memoryEntryFrom(
  prompt: CampaignPrompt,
  finalStatus: CampaignMemoryEntry["finalStatus"],
  protocolResult: FileProtocolValidationResult,
  failureReason?: string
): CampaignMemoryEntry {
  const report = protocolResult.report;
  const failureNote = failureReason ? `${finalStatus === "DEFERRED" ? "Deferred" : "Failed"}: ${failureReason.slice(0, 300)}` : "";
  return {
    task: prompt.number,
    title: prompt.title,
    timestamp: new Date().toISOString(),
    finalStatus,
    status: report?.status ?? (finalStatus === "VERIFIED" ? "complete" : "blocked"),
    notes: [report?.notes ?? "", failureNote].filter(Boolean).join(" "),
    blockers: report?.blockers?.length ? report.blockers : failureReason ? [failureReason.slice(0, 300)] : [],
    followUps: report?.followUps ?? []
  };
}

function nextRunTimestamp(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
}

/**
 * Fire-and-forget: while the current task verifies on CPU, generate the
 * predicted next task on the GPU. The prediction assumes the current task is
 * accepted; the speculation key covers the exact next prompt plus sampling
 * params, so any divergence (verification failure, rollback, amendment,
 * settings change) makes the next run miss the cache and generate fresh.
 */
function launchSpeculation(input: {
  projectRoot: string;
  settings: RunnerSettings;
  contract: ExecutionContract;
  prompts: CampaignPrompt[];
  history: RunnerHistory;
  currentPrompt: CampaignPrompt;
  protocolResult: FileProtocolValidationResult;
  memoryEntries: CampaignMemoryEntry[];
}) {
  void (async () => {
    try {
      const completedSteps = Array.from(new Set([...input.history.completedSteps, input.currentPrompt.number]));
      const nextNumber = nextEligibleStep(input.prompts, completedSteps, input.history.deferredSteps ?? []);
      const nextPrompt = input.prompts.find((item) => item.number === nextNumber);
      if (!nextPrompt) return;
      const predictedEntries = [...input.memoryEntries, memoryEntryFrom(input.currentPrompt, "VERIFIED", input.protocolResult)];
      const memoryContext = renderCampaignMemory(predictedEntries, Math.min(MEMORY_PROMPT_TOKEN_BUDGET, input.settings.contextTokens));
      const contextBudget = Math.max(0, input.settings.contextTokens - estimateTokens(nextPrompt.body) - estimateTokens(memoryContext) - 1500);
      const workspaceContext = await buildWorkspaceContext(input.settings.workspace, nextPrompt, input.prompts, contextBudget);
      const runtimePrompt = buildRuntimePrompt(nextPrompt, input.settings, {
        protocol: input.contract.builderProtocol,
        workspaceContext,
        memoryContext
      });
      putSpeculation({
        projectRoot: input.projectRoot,
        taskNumber: nextPrompt.number,
        key: speculationKey(runtimePrompt, input.settings),
        promise: completeWithLmStudio(input.settings, runtimePrompt, { protocol: input.contract.builderProtocol })
      });
      await logEvent(
        input.projectRoot,
        "SPECULATION_STARTED",
        `Speculatively generating task ${String(nextPrompt.number).padStart(3, "0")} while task ${String(input.currentPrompt.number).padStart(2, "0")} verifies.`
      );
    } catch {
      // Speculation is opportunistic; never let it affect the main path.
    }
  })();
}

export function nextEligibleStep(prompts: CampaignPrompt[], completedSteps: number[], deferredSteps: number[]) {
  const completed = new Set(completedSteps);
  const deferred = new Set(deferredSteps);
  const byNumber = new Map(prompts.map((prompt) => [prompt.number, prompt]));
  const remaining = prompts
    .map((prompt) => prompt.number)
    .sort((a, b) => a - b)
    .filter((number) => !completed.has(number) && !deferred.has(number));
  const eligible = remaining.find((number) =>
    (byNumber.get(number)?.dependsOn ?? []).every((dependency) => completed.has(dependency) || !byNumber.has(dependency))
  );
  // No fallback past deferred dependencies: running a dependent task before
  // its deferred prerequisite executes it under weaker verification gates
  // (e.g. typecheck disabled because package.json doesn't exist yet). Let the
  // deferral retry round heal the prerequisite instead. Fall back only on a
  // structural deadlock (nothing deferred, e.g. a dependency cycle).
  return eligible ?? (deferred.size === 0 ? remaining[0] ?? null : null);
}

async function logAdvancementState(
  projectRoot: string,
  location: string,
  data: {
    currentStep: number | null;
    nextStep: number | null;
    completedSteps: number[];
    historyCurrentStep: number | null;
  }
) {
  await logEvent(
    projectRoot,
    "ADVANCEMENT_TRACE",
    `${location}: currentStep=${data.currentStep ?? "null"} nextStep=${data.nextStep ?? "null"} ` +
      `completedSteps=[${data.completedSteps.join(",")}] history.currentStep=${data.historyCurrentStep ?? "null"}`
  );
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

async function deferHour(
  projectRoot: string,
  history: RunnerHistory,
  prompts: CampaignPrompt[],
  settings: RunnerSettings,
  promptNumber: number,
  message: string,
  record: ExecutionRecord
) {
  const timestamp = new Date().toISOString();
  const deferredSteps = Array.from(new Set([...(history.deferredSteps ?? []), promptNumber])).sort((a, b) => a - b);
  const nextStep = nextEligibleStep(prompts, history.completedSteps, deferredSteps);
  const failure: FailureRecord = { promptNumber, timestamp, message };
  const updated: RunnerHistory = {
    ...history,
    updatedAt: timestamp,
    deferredSteps,
    currentStep: nextStep ?? history.currentStep,
    failures: [...history.failures, failure],
    nextRunAt: nextStep ? nextRunTimestamp(settings.runIntervalMinutes) : null,
    executions: [...(history.executions || []), record]
  };
  await writeHistoryAtomic(projectRoot, updated);
  await transitionExecutionState(projectRoot, {
    state: "READY",
    finalStatus: "DEFERRED",
    lastError: message,
    currentVerifier: null,
    currentCommand: null
  });
  await logEvent(
    projectRoot,
    "TASK_DEFERRED",
    `Hour ${String(promptNumber).padStart(2, "0")} deferred after repair attempts.` +
      (nextStep ? ` Continuing with task ${String(nextStep).padStart(3, "0")}.` : " No eligible tasks remain.")
  );
  return updated;
}

export async function executeNextHour(projectRoot: string): Promise<RunResult> {
  const paths = projectPaths(projectRoot);
  const project = await loadProject(projectRoot);
  const { contract } = await buildExecutionContract(projectRoot, project.settings.workspace);
  const policy = await loadExecutionPolicy(projectRoot);
  const recovered = await recoverStaleLock(projectRoot, project.settings);
  if (recovered.exists && !recovered.stale) return { ok: false, message: "A campaign step is already running.", history: project.history };

  await ensureDir(project.settings.workspace);
  if (policy.gitCheckpoints) await ensureWorkspaceRepo(projectRoot, project.settings.workspace);

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

    const configValidation = await validateExecutionConfig({
      projectRoot,
      settings,
      policy,
      contract,
      metadata: project.campaignMetadata
    });
    if (configValidation.status === "FAIL") {
      await transitionExecutionState(projectRoot, {
        state: "FAILED",
        finalStatus: "FAILED",
        lastError: `Configuration validation failed: ${configValidation.diagnostics.map((item) => item.code).join(", ")}`
      });
      return {
        ok: false,
        message: `Configuration validation failed: ${configValidation.diagnostics.map((item) => item.message).join(" ")}`,
        history
      };
    }

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

    const memoryEntries = await loadCampaignMemory(projectRoot);
    const memoryContext = renderCampaignMemory(memoryEntries, Math.min(MEMORY_PROMPT_TOKEN_BUDGET, settings.contextTokens));
    const contextBudget = Math.max(0, settings.contextTokens - estimateTokens(prompt.body) - estimateTokens(memoryContext) - 1500);
    const workspaceContext = await buildWorkspaceContext(settings.workspace, prompt, prompts, contextBudget);
    const runtimePrompt = buildRuntimePrompt(prompt, settings, { protocol: contract.builderProtocol, workspaceContext, memoryContext });
    const promptHash = crypto.createHash("sha256").update(runtimePrompt).digest("hex").slice(0, 16);
    await logEvent(
      projectRoot,
      "PROMPT_BUILT",
      `Hour ${String(prompt.number).padStart(2, "0")} prompt hash ${promptHash}. ` +
        `Protocol ${contract.builderProtocol}. Workspace context ~${estimateTokens(workspaceContext)} tokens. ` +
        `Campaign memory ~${estimateTokens(memoryContext)} tokens.`
    );

    let response = "";
    let finalResults: VerificationResult[] = [];
    let repairCount = 0;
    let repairRuntimeSeconds = 0;
    let protocolResult: FileProtocolValidationResult = { valid: false, files: [], errors: [], normalizations: [] };
    let previousAttemptSummary = "No previous attempt.";
    let tokenBudgetRaised = false;
    const protocolFailures: ProtocolFailureRecord[] = [];

    let speculativeCompletion: CompletionResult | null = null;
    const speculationPromise = takeSpeculation(projectRoot, prompt.number, speculationKey(runtimePrompt, settings));
    if (speculationPromise) {
      try {
        speculativeCompletion = await speculationPromise;
        await logEvent(projectRoot, "SPECULATION_HIT", `Reusing speculative generation for hour ${String(prompt.number).padStart(2, "0")}.`);
      } catch {
        speculativeCompletion = null;
      }
    }

    for (let attempt = 0; attempt <= contract.repairPolicy.maxRepairAttempts; attempt += 1) {
      const generationStarted = Date.now();
      await logEvent(projectRoot, attempt === 0 ? "GENERATION_STARTED" : "REPAIR_REQUESTED", `Attempt ${attempt + 1} for ${executionId}.`);
      await transitionExecutionState(projectRoot, { state: attempt === 0 ? "RUNNING" : "REPAIRING", repairAttempt: attempt });
      const responseBeforeRepair = response;
      const validationBeforeRepair = protocolResult;

      // Final-rung escalation: when every prior attempt died at the protocol
      // layer (the model cannot express these files through nested JSON —
      // JSON config files are the recurring case), downshift the last attempt
      // to plain-text FILE_BLOCKS, which has no escaping to get wrong.
      const downshift =
        contract.builderProtocol === "FILE_JSON" &&
        attempt === contract.repairPolicy.maxRepairAttempts &&
        attempt > 0 &&
        !protocolResult.valid;
      const attemptProtocol = downshift ? "FILE_BLOCKS" : contract.builderProtocol;
      if (downshift) {
        await logEvent(projectRoot, "PROTOCOL_DOWNSHIFT", `Attempt ${attempt + 1} falls back to FILE_BLOCKS after repeated protocol failures.`);
      }

      const promptToSend =
        attempt === 0
          ? runtimePrompt
          : buildRepairPrompt(prompt, settings, finalResults, protocolResult, previousAttemptSummary, response, attemptProtocol);
      // Repair escalation: first repair at temperature 0 (precision), later
      // repairs at rising temperature — a deterministic wrong answer would
      // otherwise repeat identically on every attempt.
      const repairTemperature = attempt <= 1 ? 0 : Math.min(0.8, 0.4 * (attempt - 1));
      const completion =
        attempt === 0 && speculativeCompletion
          ? speculativeCompletion
          : await completeWithLmStudio(settings, promptToSend, {
              protocol: attemptProtocol,
              ...(attempt > 0 ? { temperature: repairTemperature, reasoningEffort: "high" as const } : {}),
              ...(tokenBudgetRaised ? { maxTokens: Math.min(settings.maxTokens * 2, TRUNCATION_MAX_TOKENS_CAP) } : {})
            });
      response = completion.content;
      if (completion.truncated) {
        tokenBudgetRaised = true;
        await logEvent(
          projectRoot,
          "GENERATION_TRUNCATED",
          `Attempt ${attempt + 1} hit the output token limit; next attempt runs with up to ${Math.min(settings.maxTokens * 2, TRUNCATION_MAX_TOKENS_CAP)} tokens.`
        );
      }
      const repairAttemptSeconds = (Date.now() - generationStarted) / 1000;
      if (attempt > 0) repairRuntimeSeconds += repairAttemptSeconds;
      await logEvent(projectRoot, attempt === 0 ? "GENERATION_COMPLETED" : "REPAIR_COMPLETED", `Attempt ${attempt + 1} completed.`);

      await transitionExecutionState(projectRoot, { state: "WRITING_FILES" });
      protocolResult = await writeCandidateFiles(projectRoot, settings.workspace, response, `${executionId}-attempt-${attempt + 1}`, attemptProtocol);
      if (attempt === 0 && (!protocolResult.valid || (protocolResult.originalErrors?.length ?? 0) > 0)) {
        await persistRepairSeed({
          projectRoot,
          prompt,
          originalPrompt: runtimePrompt,
          originalResponse: response,
          validation: protocolResult,
          executionId
        });
      }
      if (attempt > 0) {
        await persistRepairAttempt({
          projectRoot,
          prompt,
          executionId,
          repairAttemptNumber: attempt,
          originalTaskPrompt: runtimePrompt,
          originalResponse: responseBeforeRepair,
          originalValidation: validationBeforeRepair,
          repairPrompt: promptToSend,
          repairResponse: response,
          repairValidation: protocolResult,
          durationSeconds: repairAttemptSeconds,
          finalOutcome: protocolResult.valid ? "REPAIRED" : "PENDING"
        });
      }
      const protocolErrors = protocolResult.originalErrors?.length ? protocolResult.originalErrors : protocolResult.errors;
      protocolFailures.push(
        ...protocolErrors.map((error) => ({
          category: categorizeProtocolFailure(error),
          code: error.code,
          message: error.message,
          file: error.file,
          attempt: attempt + 1
        }))
      );
      previousAttemptSummary = protocolResult.valid
        ? `Wrote ${protocolResult.files.length} files.`
        : `Protocol rejected: ${protocolResult.errors.map((error) => error.message).join("; ")}`;
      if (completion.truncated) {
        previousAttemptSummary =
          `Response was cut off at the output token limit before completing. ${previousAttemptSummary} ` +
          "The token limit has been raised; return the complete files and be concise.";
      }

      if (policy.speculativeGeneration && protocolResult.valid) {
        launchSpeculation({
          projectRoot,
          settings,
          contract,
          prompts,
          history,
          currentPrompt: prompt,
          protocolResult,
          memoryEntries
        });
      }

      const verificationStarted = Date.now();
      const verificationPolicy: ExecutionPolicy = {
        maxRepairAttempts: contract.repairPolicy.maxRepairAttempts,
        stopOnFailure: true,
        retryOnTimeout: true,
        acceptOnlyVerified: contract.acceptancePolicy.acceptOnlyVerified,
        verificationPipeline: contract.verifierPipeline
      };
      finalResults = protocolResult.valid ? await runVerificationPipeline(projectRoot, settings.workspace, verificationPolicy) : [];
      if (protocolResult.valid && policy.enforceDeclaredOutputs) {
        const declaredOutputs = await checkDeclaredOutputs(settings.workspace, prompt);
        if (declaredOutputs) {
          finalResults = [declaredOutputs, ...finalResults];
          if (declaredOutputs.status === "FAIL") {
            await logEvent(projectRoot, "DECLARED_OUTPUTS_MISSING", declaredOutputs.stderr.slice(0, 500));
          }
        }
      }
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

        await logAdvancementState(projectRoot, "before calculating next task", {
          currentStep: prompt.number,
          nextStep: null,
          completedSteps: history.completedSteps,
          historyCurrentStep: history.currentStep
        });
        const completedSteps = Array.from(new Set([...history.completedSteps, prompt.number])).sort((a, b) => a - b);
        const taskNumbers = prompts.map((item) => item.number).sort((a, b) => a - b);
        const nextStep = nextEligibleStep(prompts, completedSteps, history.deferredSteps ?? []) ?? Math.max(...taskNumbers) + 1;
        await logAdvancementState(projectRoot, "after calculating next task", {
          currentStep: prompt.number,
          nextStep,
          completedSteps,
          historyCurrentStep: history.currentStep
        });
        const executionRecord: ExecutionRecord = {
          executionId,
          hour: prompt.number,
          attempt: attempt + 1,
          verifierResults: finalResults,
          repairCount,
          finalStatus: "VERIFIED",
          runtimeSeconds,
          verificationRuntimeSeconds,
          outputFile,
          protocolFailures,
          ...(protocolResult.report ? { report: protocolResult.report } : {})
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
        await logAdvancementState(projectRoot, "immediately before writing history", {
          currentStep: updatedHistory.currentStep,
          nextStep,
          completedSteps: updatedHistory.completedSteps,
          historyCurrentStep: history.currentStep
        });
        await writeHistoryAtomic(projectRoot, updatedHistory);
        await appendCampaignMemory(projectRoot, memoryEntryFrom(prompt, "VERIFIED", protocolResult));
        if (policy.gitCheckpoints) await commitVerifiedTask(projectRoot, settings.workspace, prompt.number, prompt.title, executionId);
        const { history: reloadedHistory } = await readHistoryRecovering(projectRoot);
        await logAdvancementState(projectRoot, "immediately after reloading history from disk", {
          currentStep: reloadedHistory.currentStep,
          nextStep,
          completedSteps: reloadedHistory.completedSteps,
          historyCurrentStep: history.currentStep
        });
        const metrics = await updateMetrics(projectRoot, updatedHistory, totalTasks);
        await writeCampaignSummary({ ...project, history: updatedHistory });
        if (repairCount > 0 || protocolFailures.length > 0) {
          await finalizeRepairSession({
            projectRoot,
            prompt,
            finalOutcome: "REPAIRED",
            finalResolution: "Execution accepted after repair and verification."
          });
        }
        await writeBenchmarkArtifacts({
          projectRoot,
          project: { ...project, history: updatedHistory },
          metrics,
          result: { ok: true, message: `Hour ${String(prompt.number).padStart(2, "0")} VERIFIED.`, outputFile, history: updatedHistory }
        });
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
        const failureReason = (protocolResult.valid ? formatVerificationFailures(finalResults) : protocolResult.errors.map((error) => error.message).join("\n")).slice(0, 2000);
        const record: ExecutionRecord = {
          executionId,
          hour: prompt.number,
          attempt: attempt + 1,
          verifierResults: finalResults,
          repairCount,
          finalStatus: "FAILED",
          runtimeSeconds,
          verificationRuntimeSeconds,
          failureReason,
          protocolFailures,
          ...(protocolResult.report ? { report: protocolResult.report } : {})
        };

        if (policy.gitCheckpoints) {
          await rollbackWorkspace(projectRoot, settings.workspace, `Hour ${String(prompt.number).padStart(2, "0")} failed verification after repair attempts.`);
        }

        if (policy.deferOnFailure) {
          const updated = await deferHour(projectRoot, history, prompts, settings, prompt.number, failureReason, record);
          await appendCampaignMemory(projectRoot, memoryEntryFrom(prompt, "DEFERRED", protocolResult, failureReason));
          await finalizeRepairSession({
            projectRoot,
            prompt,
            finalOutcome: "FAILED",
            finalResolution: "Repair budget exhausted; task deferred so the campaign can continue."
          });
          const metrics = await updateMetrics(projectRoot, updated, totalTasks);
          const message = `Hour ${String(prompt.number).padStart(2, "0")} deferred after repair attempts.`;
          await writeBenchmarkArtifacts({
            projectRoot,
            project: { ...project, history: updated },
            metrics,
            result: { ok: false, message, history: updated }
          });
          return { ok: false, deferred: true, message, history: updated };
        }

        const updated = await failHour(projectRoot, history, settings, prompt.number, "Verification failed after repair attempts.", record);
        await appendCampaignMemory(projectRoot, memoryEntryFrom(prompt, "FAILED", protocolResult, failureReason));
        await finalizeRepairSession({
          projectRoot,
          prompt,
          finalOutcome: "FAILED",
          finalResolution: "Repair budget exhausted before the task passed protocol and verification."
        });
        const metrics = await updateMetrics(projectRoot, updated, totalTasks);
        await writeBenchmarkArtifacts({
          projectRoot,
          project: { ...project, history: updated },
          metrics,
          result: { ok: false, message: "Verification failed after repair attempts. Campaign stopped.", history: updated }
        });
        return { ok: false, message: "Verification failed after repair attempts. Campaign stopped.", history: updated };
      }
    }

    return { ok: false, message: "Execution ended unexpectedly.", history };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (policy.gitCheckpoints) {
      await rollbackWorkspace(projectRoot, project.settings.workspace, `Execution error: ${message}`).catch(() => undefined);
    }
    const updated = await failHour(projectRoot, project.history, project.settings, project.history.currentStep, message);
    return { ok: false, message, history: updated };
  } finally {
    await fs.rm(paths.lock, { force: true }).catch(() => undefined);
  }
}
