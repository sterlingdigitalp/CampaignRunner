import { executeNextHour } from "./execution-engine";
import { loadProject } from "./campaign-manager";
import { logEvent } from "./logger";
import type { RunResult } from "./types";

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
    if (project.history.completedSteps.length >= project.prompts.length) {
      return {
        ok: true,
        message: messages.length > 0 ? `${messages.join(" ")} Campaign complete.` : "Campaign complete.",
        history: project.history
      };
    }

    latest = await executeNextHour(projectRoot);
    messages.push(latest.message);
    if (!latest.ok) return { ...latest, message: messages.join(" ") };

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

    if (updated.history.completedSteps.length >= updated.prompts.length) {
      return {
        ok: true,
        message: `${messages.join(" ")} Campaign complete.`,
        outputFile: latest.outputFile,
        history: updated.history
      };
    }
  }
}
