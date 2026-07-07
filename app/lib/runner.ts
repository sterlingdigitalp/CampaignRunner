import { dueCheckpoint, runCheckpoint } from "./checkpoint-engine";
import { buildExecutionContract } from "./execution-contract";
import { executeNextHour, nextEligibleStep } from "./execution-engine";
import { loadExecutionPolicy } from "./execution-policy";
import { loadProject } from "./campaign-manager";
import { writeHistoryAtomic } from "./history-manager";
import { preflightLmStudio } from "./lm-studio-preflight";
import { logEvent } from "./logger";
import { allVerifiersPassed, formatVerificationFailures, runVerificationPipeline } from "./verification-engine";
import type { ExecutionPolicy, ProjectSummary, RunResult } from "./types";

const HARD_FAILURE_LIMIT = 3;
const HARD_FAILURE_BACKOFF_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeWindowDeadline(windowEnd: string, now = new Date()) {
  const [hours, minutes] = windowEnd.split(":").map(Number);
  const deadline = new Date(now);
  deadline.setHours(hours, minutes, 0, 0);
  if (deadline.getTime() <= now.getTime() + 60_000) deadline.setDate(deadline.getDate() + 1);
  return deadline;
}

function campaignProgress(project: ProjectSummary) {
  const deferred = project.history.deferredSteps ?? [];
  return {
    completed: project.history.completedSteps.length,
    total: project.prompts.length,
    deferred,
    complete: project.history.completedSteps.length >= project.prompts.length
  };
}

function traceLoop(
  projectRoot: string,
  iteration: number,
  source: "initial-in-memory-load" | "fresh-pre-execute-load" | "fresh-post-execute-load",
  currentStep: number,
  completedSteps: number[],
  promptNumber: number | null
) {
  const message =
    `iteration=${iteration} source=${source} currentStep=${currentStep} ` +
    `completedSteps=[${completedSteps.join(",")}] prompt.number=${promptNumber ?? "none"}`;
  console.log(`[runNextPrompt] ${message}`);
  return logEvent(projectRoot, "RUN_LOOP_TRACE", message);
}

export async function runNextPrompt(projectRoot: string): Promise<RunResult> {
  const messages: string[] = [];
  let latest: RunResult | null = null;
  let iteration = 0;

  for (;;) {
    iteration += 1;
    const project = await loadProject(projectRoot);
    const prompt = project.prompts.find((item) => item.number === project.history.currentStep) ?? null;
    await traceLoop(
      projectRoot,
      iteration,
      iteration === 1 ? "initial-in-memory-load" : "fresh-pre-execute-load",
      project.history.currentStep,
      project.history.completedSteps,
      prompt?.number ?? null
    );

    if (project.settings.paused) {
      return {
        ok: messages.length > 0,
        message: messages.length > 0 ? `${messages.join(" ")} Campaign paused.` : "Campaign is paused.",
        history: project.history
      };
    }
    const policy = await loadExecutionPolicy(projectRoot);
    if (policy.checkpointsEnabled) {
      const checkpoint = dueCheckpoint(project);
      if (checkpoint) {
        const record = await runCheckpoint(projectRoot, project, checkpoint);
        messages.push(`Checkpoint ${checkpoint.number} complete (${record.applied.length} amendment(s) applied).`);
        continue;
      }
    }

    if (project.history.completedSteps.length >= project.prompts.length) {
      const final = await runFinalVerification(projectRoot, project, policy);
      const base = messages.length > 0 ? `${messages.join(" ")} Campaign complete.` : "Campaign complete.";
      return {
        ok: final.passed,
        message: base + final.note,
        history: project.history
      };
    }

    latest = await executeNextHour(projectRoot);
    messages.push(latest.message);
    if (!latest.ok && !latest.deferred) return { ...latest, message: messages.join(" ") };

    const updated = await loadProject(projectRoot);
    const nextPrompt = updated.prompts.find((item) => item.number === updated.history.currentStep) ?? null;
    await traceLoop(
      projectRoot,
      iteration,
      "fresh-post-execute-load",
      updated.history.currentStep,
      updated.history.completedSteps,
      nextPrompt?.number ?? null
    );

    const progress = campaignProgress(updated);
    if (latest.deferred && nextEligibleStep(updated.prompts, updated.history.completedSteps, progress.deferred) === null) {
      return {
        ok: false,
        message: `${messages.join(" ")} All remaining tasks are deferred: [${progress.deferred.join(", ")}]. Run an autonomous window to retry them.`,
        history: updated.history
      };
    }
  }
}

/**
 * Whole-project verification after the last task completes. Tasks that ran
 * while the workspace was immature (e.g. before package.json existed) were
 * verified under weaker gates; this closes that hole and makes the summary
 * honest about the final state.
 */
async function runFinalVerification(projectRoot: string, project: ProjectSummary, policy: ExecutionPolicy) {
  const { contract } = await buildExecutionContract(projectRoot, project.settings.workspace);
  const enabled = contract.verifierPipeline.filter((step) => step.enabled);
  if (enabled.length === 0) {
    await logEvent(projectRoot, "FINAL_VERIFICATION", "No verifiers applicable to the final workspace.");
    return { passed: true, note: "" };
  }
  const results = await runVerificationPipeline(projectRoot, project.settings.workspace, {
    maxRepairAttempts: policy.maxRepairAttempts,
    stopOnFailure: true,
    retryOnTimeout: true,
    acceptOnlyVerified: true,
    verificationPipeline: contract.verifierPipeline
  });
  const passed = allVerifiersPassed(results);
  await logEvent(
    projectRoot,
    "FINAL_VERIFICATION",
    passed ? `PASS: ${enabled.map((step) => step.name).join(", ")}` : `FAIL: ${formatVerificationFailures(results).slice(0, 800)}`
  );
  return { passed, note: passed ? " Final verification PASS." : ` FINAL VERIFICATION FAILED: ${formatVerificationFailures(results).slice(0, 300)}` };
}

async function windowSummary(projectRoot: string, reason: string, executed: number, policy?: ExecutionPolicy): Promise<RunResult> {
  const project = await loadProject(projectRoot);
  const progress = campaignProgress(project);
  const deferredNote = progress.deferred.length > 0 ? ` Deferred tasks: [${progress.deferred.join(", ")}].` : "";
  let finalNote = "";
  let finalPassed = true;
  if (progress.complete && policy) {
    const final = await runFinalVerification(projectRoot, project, policy);
    finalNote = final.note;
    finalPassed = final.passed;
  }
  const message =
    `${reason}. Executed ${executed} task run(s); ${progress.completed}/${progress.total} tasks complete.` + deferredNote + finalNote;
  await logEvent(projectRoot, "RUN_WINDOW_COMPLETED", message);
  return { ok: progress.complete && finalPassed, message, history: project.history };
}

export async function runAutonomousWindow(projectRoot: string): Promise<RunResult> {
  const initial = await loadProject(projectRoot);
  if (initial.recovery.mode) {
    return { ok: false, message: initial.recovery.message ?? "History recovery is required.", history: initial.history };
  }
  const policy = await loadExecutionPolicy(projectRoot);
  const maxDeferralRounds = policy.maxDeferralRounds ?? 2;
  const deadline = computeWindowDeadline(initial.settings.windowEnd);
  let deferralRound = 0;
  let consecutiveHardFailures = 0;
  let executed = 0;
  await logEvent(
    projectRoot,
    "RUN_WINDOW_STARTED",
    `Autonomous window started; running until ${deadline.toISOString()} (windowEnd ${initial.settings.windowEnd}).`
  );

  const preflight = await preflightLmStudio(initial.settings);
  for (const message of preflight.messages) {
    await logEvent(projectRoot, "PREFLIGHT", message);
  }
  if (!preflight.ok) {
    const message = `LM Studio preflight failed: ${preflight.messages.at(-1) ?? "unknown error"}`;
    await logEvent(projectRoot, "RUN_WINDOW_COMPLETED", message);
    return { ok: false, message, history: initial.history };
  }

  for (;;) {
    if (Date.now() >= deadline.getTime()) {
      return windowSummary(projectRoot, "Window deadline reached", executed, policy);
    }

    const project = await loadProject(projectRoot);
    if (project.settings.paused) return windowSummary(projectRoot, "Campaign paused", executed, policy);
    if (project.recovery.mode) return windowSummary(projectRoot, "History recovery required", executed, policy);

    if (policy.checkpointsEnabled) {
      const checkpoint = dueCheckpoint(project);
      if (checkpoint) {
        await runCheckpoint(projectRoot, project, checkpoint);
        continue;
      }
    }

    const progress = campaignProgress(project);
    if (progress.complete) return windowSummary(projectRoot, "Campaign complete", executed, policy);

    const eligible = nextEligibleStep(project.prompts, project.history.completedSteps, progress.deferred);
    if (eligible === null) {
      if (progress.deferred.length === 0) return windowSummary(projectRoot, "No runnable tasks found", executed, policy);
      deferralRound += 1;
      if (deferralRound > maxDeferralRounds) {
        return windowSummary(projectRoot, `Deferral retry budget exhausted after ${maxDeferralRounds} round(s)`, executed, policy);
      }
      const requeueStep = nextEligibleStep(project.prompts, project.history.completedSteps, []);
      await writeHistoryAtomic(projectRoot, {
        ...project.history,
        deferredSteps: [],
        currentStep: requeueStep ?? project.history.currentStep,
        updatedAt: new Date().toISOString()
      });
      await logEvent(
        projectRoot,
        "DEFERRAL_ROUND_STARTED",
        `Round ${deferralRound}/${maxDeferralRounds}: retrying ${progress.deferred.length} deferred task(s) [${progress.deferred.join(", ")}].`
      );
      continue;
    }

    if (project.history.currentStep !== eligible) {
      await writeHistoryAtomic(projectRoot, { ...project.history, currentStep: eligible, updatedAt: new Date().toISOString() });
    }

    const result = await executeNextHour(projectRoot);
    executed += 1;
    if (result.ok || result.deferred) {
      consecutiveHardFailures = 0;
      continue;
    }

    consecutiveHardFailures += 1;
    if (consecutiveHardFailures >= HARD_FAILURE_LIMIT) {
      return windowSummary(projectRoot, `Aborted after ${HARD_FAILURE_LIMIT} consecutive hard failures (${result.message})`, executed, policy);
    }
    await logEvent(
      projectRoot,
      "RUN_WINDOW_RETRY",
      `Hard failure ${consecutiveHardFailures}/${HARD_FAILURE_LIMIT}: ${result.message} Running preflight and retrying in ${HARD_FAILURE_BACKOFF_MS / 1000}s.`
    );
    const recovery = await preflightLmStudio(project.settings);
    for (const message of recovery.messages) {
      await logEvent(projectRoot, "PREFLIGHT", message);
    }
    await sleep(HARD_FAILURE_BACKOFF_MS);
  }
}
