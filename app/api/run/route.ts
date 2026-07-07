import { NextResponse } from "next/server";
import { runAutonomousWindow, runNextPrompt } from "@/app/lib/runner";

export async function POST(request: Request) {
  const body = (await request.json()) as { projectRoot?: string; mode?: "campaign" | "window" };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  const result = body.mode === "window" ? await runAutonomousWindow(projectRoot) : await runNextPrompt(projectRoot);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
