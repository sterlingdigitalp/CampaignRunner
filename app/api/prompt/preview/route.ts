import { NextResponse } from "next/server";
import { loadCampaignMemory, renderCampaignMemory } from "@/app/lib/campaign-memory";
import { loadProject } from "@/app/lib/campaign-manager";
import { buildExecutionContract } from "@/app/lib/execution-contract";
import { buildRuntimePrompt, estimateTokens, runtimePromptParts } from "@/app/lib/prompt-builder";
import { buildRepairPrompt } from "@/app/lib/repair-engine";
import { buildWorkspaceContext } from "@/app/lib/workspace-context";

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

  const { contract } = await buildExecutionContract(projectRoot, project.settings.workspace);
  const memoryContext = renderCampaignMemory(await loadCampaignMemory(projectRoot), Math.min(2500, project.settings.contextTokens));
  const contextBudget = Math.max(0, project.settings.contextTokens - estimateTokens(prompt.body) - estimateTokens(memoryContext) - 1500);
  const workspaceContext = await buildWorkspaceContext(project.settings.workspace, prompt, project.prompts, contextBudget);
  const options = { protocol: contract.builderProtocol, workspaceContext, memoryContext };
  const runtimePrompt = buildRuntimePrompt(prompt, project.settings, options);
  return NextResponse.json({
    ...runtimePromptParts(prompt, project.settings, options),
    runtimePrompt,
    estimatedTokens: estimateTokens(runtimePrompt),
    repairPrompt: buildRepairPrompt(
      prompt,
      project.settings,
      [
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
      ],
      undefined,
      undefined,
      "",
      contract.builderProtocol
    )
  });
}
