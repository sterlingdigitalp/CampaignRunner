import { NextResponse } from "next/server";
import { loadProject } from "@/app/lib/campaign-manager";
import { DEFAULT_PROJECT_ROOT } from "@/app/lib/defaults";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectRoot?: string };
  const projectRoot = body.projectRoot?.trim() || DEFAULT_PROJECT_ROOT;

  try {
    const project = await loadProject(projectRoot);
    return NextResponse.json(project);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load project." },
      { status: 404 }
    );
  }
}
