import { NextResponse } from "next/server";
import { loadProject } from "@/app/lib/campaign-manager";
import { buildRuntimePrompt, estimateTokens, runtimePromptParts } from "@/app/lib/prompt-builder";
import { buildRepairPrompt } from "@/app/lib/repair-engine";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectRoot?: string };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  const project = await loadProject(projectRoot);
  const prompt = project.prompts.find((item) => item.number === project.history.currentStep);
  if (!prompt) {
    return NextResponse.json({ error: "No current prompt is available." }, { status: 404 });
  }

  const runtimePrompt = buildRuntimePrompt(prompt, project.settings);
  return NextResponse.json({
    ...runtimePromptParts(prompt, project.settings),
    runtimePrompt,
    estimatedTokens: estimateTokens(runtimePrompt),
    repairPrompt: buildRepairPrompt(prompt, project.settings, [
      {
        verifier: "Example",
        status: "FAIL",
        command: "npm run build",
        stdout: "",
        stderr: "Example verification failure output appears here after a failed run.",
        exitCode: 1,
        runtimeSeconds: 0,
        timedOut: false
      }
    ])
  });
}
