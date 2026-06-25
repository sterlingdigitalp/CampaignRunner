import { NextResponse } from "next/server";
import { loadArtifacts } from "@/app/lib/artifacts";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectRoot?: string };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  return NextResponse.json(await loadArtifacts(projectRoot));
}
