import { NextResponse } from "next/server";
import { loadArtifacts } from "@/app/lib/artifacts";
import { loadProject } from "@/app/lib/campaign-manager";
import { readLockStatus } from "@/app/lib/lock-manager";
import { loadExecutionState } from "@/app/lib/execution-state";
import { loadExecutionPolicy } from "@/app/lib/execution-policy";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectRoot?: string };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  const project = await loadProject(projectRoot);
  const artifacts = await loadArtifacts(projectRoot);
  const lockStatus = await readLockStatus(projectRoot, project.settings.lockTimeoutMinutes);
  const executionState = await loadExecutionState(projectRoot);
  const policy = await loadExecutionPolicy(projectRoot);

  let lmStudioStatus = "Not checked";
  try {
    const url = new URL(project.settings.endpoint);
    const response = await fetch(`${url.origin}/v1/models`, { signal: AbortSignal.timeout(1500) });
    lmStudioStatus = response.ok ? "Reachable" : `HTTP ${response.status}`;
  } catch {
    lmStudioStatus = "Unavailable";
  }

  return NextResponse.json({
    workspace: project.settings.workspace,
    history: project.recovery.mode ? "Recovery required" : "OK",
    settings: "Validated on save",
    logs: artifacts.runLog ? "Present" : "Empty",
    lockStatus,
    executionState,
    policy,
    schedulerStatus: project.settings.paused ? "Paused" : project.history.nextRunAt ? `Next run ${project.history.nextRunAt}` : "Not scheduled",
    lmStudioStatus
  });
}
