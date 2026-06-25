import { NextResponse } from "next/server";
import { saveSettings } from "@/app/lib/campaign-manager";
import { defaultSettings } from "@/app/lib/defaults";
import { projectPaths, readJson } from "@/app/lib/files";
import type { RunnerHistory, RunnerSettings } from "@/app/lib/types";
import { defaultHistory } from "@/app/lib/defaults";
import { writeHistoryAtomic } from "@/app/lib/history-manager";
import { logEvent } from "@/app/lib/logger";

export async function POST(request: Request) {
  const settings = (await request.json()) as RunnerSettings;
  const projectRoot = settings.projectRoot;
  try {
    const saved = await saveSettings(projectRoot, settings);
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid settings." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { projectRoot?: string; paused?: boolean };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot) {
    return NextResponse.json({ error: "Project root is required." }, { status: 400 });
  }

  const paths = projectPaths(projectRoot);
  const settings = await readJson<RunnerSettings>(paths.settings, defaultSettings(projectRoot));
  const saved = await saveSettings(projectRoot, { ...settings, paused: Boolean(body.paused) });
  const history = await readJson<RunnerHistory>(paths.history, defaultHistory());
  const nextRunAt = body.paused ? history.nextRunAt : history.nextRunAt ?? new Date(Date.now() + saved.runIntervalMinutes * 60_000).toISOString();
  await writeHistoryAtomic(projectRoot, { ...history, updatedAt: new Date().toISOString(), nextRunAt });
  await logEvent(projectRoot, "SCHEDULER", body.paused ? "Paused campaign without changing nextRunAt." : "Resumed campaign.");

  return NextResponse.json(saved);
}
