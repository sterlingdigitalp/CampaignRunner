import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { defaultExecutionState, defaultHistory } from "@/app/lib/defaults";
import { ensureDir } from "@/app/lib/files";
import { projectPaths } from "@/app/lib/files";
import { rebuildHistoryFromOutputs, writeHistoryAtomic } from "@/app/lib/history-manager";
import { logEvent } from "@/app/lib/logger";
import { transitionExecutionState } from "@/app/lib/execution-state";
import { parseValidatedJson, validateHistory } from "@/app/lib/runtime-validation";
import { recoverRuntimeJson } from "@/app/lib/runtime-recovery";
import type { RunnerHistory } from "@/app/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectRoot?: string;
    action?:
      | "restoreBackup"
      | "rebuildProgress"
      | "startNew"
      | "resetExecution"
      | "abortCampaign"
      | "recoverRuntime"
      | "recoverWorkspace"
      | "recoverPolicy"
      | "recoverMetrics"
      | "recoverState";
  };
  const projectRoot = body.projectRoot?.trim();

  if (!projectRoot || !body.action) {
    return NextResponse.json({ error: "Project root and recovery action are required." }, { status: 400 });
  }

  const paths = projectPaths(projectRoot);

  if (body.action === "resetExecution") {
    await transitionExecutionState(projectRoot, { state: "RECOVERING", lastError: "Manual execution reset requested." });
    await transitionExecutionState(projectRoot, { ...defaultExecutionState(), state: "READY" });
    await logEvent(projectRoot, "RECOVERY_PERFORMED", "Execution state reset to READY.");
    return NextResponse.json({ ok: true, action: body.action, recovered: ["execution_state.json"], state: "READY" });
  }

  if (body.action === "abortCampaign") {
    await transitionExecutionState(projectRoot, { state: "RECOVERING", lastError: "Manual abort requested." });
    await transitionExecutionState(projectRoot, { state: "FAILED", finalStatus: "ABORTED", lastError: "Campaign aborted by user." });
    await logEvent(projectRoot, "RECOVERY_PERFORMED", "Campaign aborted by user.");
    return NextResponse.json({ ok: true, action: body.action, recovered: [], state: "FAILED" });
  }

  if (body.action === "recoverState") {
    await recoverRuntimeJson(projectRoot, "executionState", "Manual state recovery requested.");
    return NextResponse.json({ ok: true, action: body.action, recovered: ["execution_state.json"], state: "READY" });
  }

  if (body.action === "recoverPolicy") {
    await recoverRuntimeJson(projectRoot, "executionPolicy", "Manual policy recovery requested.");
    return NextResponse.json({ ok: true, action: body.action, recovered: ["execution_policy.json"], state: "READY" });
  }

  if (body.action === "recoverMetrics") {
    await recoverRuntimeJson(projectRoot, "metrics", "Manual metrics recovery requested.");
    return NextResponse.json({ ok: true, action: body.action, recovered: ["metrics.json"], state: "READY" });
  }

  if (body.action === "recoverRuntime") {
    await recoverRuntimeJson(projectRoot, "executionState", "Manual runtime recovery requested.");
    await recoverRuntimeJson(projectRoot, "executionPolicy", "Manual runtime recovery requested.");
    await recoverRuntimeJson(projectRoot, "metrics", "Manual runtime recovery requested.");
    await recoverRuntimeJson(projectRoot, "campaignSummary", "Manual runtime recovery requested.");
    return NextResponse.json({
      ok: true,
      action: body.action,
      recovered: ["execution_state.json", "execution_policy.json", "metrics.json", "campaign_summary.json"],
      state: "READY"
    });
  }

  if (body.action === "recoverWorkspace") {
    await transitionExecutionState(projectRoot, { state: "RECOVERING", lastError: "Manual workspace recovery requested." });
    await ensureDir(paths.workspace);
    await transitionExecutionState(projectRoot, { state: "READY", finalStatus: null, lastError: null });
    await logEvent(projectRoot, "RECOVERY_PERFORMED", `Workspace verified at ${paths.workspace}`);
    return NextResponse.json({ ok: true, action: body.action, recovered: ["workspace"], state: "READY" });
  }

  if (body.action === "restoreBackup") {
    try {
      const backup = await fs.readFile(`${paths.history}.bak`, "utf8");
      const history = parseValidatedJson(backup, validateHistory, "history.json.bak") as RunnerHistory;
      await writeHistoryAtomic(projectRoot, { ...defaultHistory(), ...history });
      await logEvent(projectRoot, "HISTORY_RECOVERY", "User restored history from backup.");
      return NextResponse.json({ ok: true, action: body.action, recovered: ["history.json"], state: "READY" });
    } catch {
      return NextResponse.json({ error: "No valid history backup is available." }, { status: 400 });
    }
  }

  if (body.action === "rebuildProgress") {
    await rebuildHistoryFromOutputs(projectRoot);
    return NextResponse.json({ ok: true, action: body.action, recovered: ["history.json"], state: "READY" });
  }

  await writeHistoryAtomic(projectRoot, defaultHistory());
  await logEvent(projectRoot, "HISTORY_RECOVERY", "User started a new campaign history.");
  return NextResponse.json({ ok: true, action: body.action, recovered: ["history.json"], state: "READY" });
}
