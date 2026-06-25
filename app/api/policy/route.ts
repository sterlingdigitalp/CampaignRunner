import { NextResponse } from "next/server";
import { loadExecutionPolicy, saveExecutionPolicy } from "@/app/lib/execution-policy";
import { logEvent } from "@/app/lib/logger";

export async function POST(request: Request) {
  const body = await request.json();
  const projectRoot = String(body.projectRoot || "").trim();
  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  if (body.policy) {
    const saved = await saveExecutionPolicy(projectRoot, body.policy);
    await logEvent(projectRoot, "SETTINGS_CHANGED", "Saved execution policy.");
    return NextResponse.json(saved);
  }

  return NextResponse.json(await loadExecutionPolicy(projectRoot));
}
