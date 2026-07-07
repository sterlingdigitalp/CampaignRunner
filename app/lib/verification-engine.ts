import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { CampaignPrompt, ExecutionPolicy, VerificationResult } from "./types";
import { transitionExecutionState } from "./execution-state";
import { logEvent } from "./logger";
import { normalizeTaskOutputPath } from "./workspace-context";

/**
 * Contract check: every path the task declares under Workspace Output must
 * exist after the candidate files are written. Returns null when the task
 * declares no concrete paths; otherwise a synthetic verifier result so the
 * decision engine, repair prompts, and metrics treat it like any verifier.
 */
export async function checkDeclaredOutputs(workspace: string, prompt: CampaignPrompt): Promise<VerificationResult | null> {
  const declared = Array.from(
    new Set(
      (prompt.workspaceOutput ?? [])
        .map(normalizeTaskOutputPath)
        .filter((value) => value && !/\s|[<>]/.test(value))
    )
  );
  if (declared.length === 0) return null;

  const missing: string[] = [];
  for (const relativePath of declared) {
    await fs.access(path.join(workspace, relativePath)).catch(() => missing.push(relativePath));
  }
  const base = { verifier: "Declared Outputs", command: "declared-output-check", runtimeSeconds: 0, timedOut: false };
  if (missing.length === 0) {
    return { ...base, status: "PASS", stdout: `All ${declared.length} declared output(s) exist.`, stderr: "", exitCode: 0 };
  }
  return {
    ...base,
    status: "FAIL",
    stdout: "",
    stderr: `Missing declared workspace outputs: ${missing.join(", ")}. Write every FILE listed under this task's Workspace Output.`,
    exitCode: 1
  };
}

function runCommand(command: string, cwd: string, timeoutSeconds: number): Promise<VerificationResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutSeconds * 1000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const runtimeSeconds = Math.max(0.01, (Date.now() - started) / 1000);
      const timedOut = Boolean(error && "killed" in error && error.killed);
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        verifier: "",
        status: exitCode === 0 && !timedOut ? "PASS" : "FAIL",
        command,
        stdout: stdout.slice(-12000),
        stderr: stderr.slice(-12000),
        exitCode,
        runtimeSeconds,
        timedOut
      });
    });
  });
}

export async function runVerificationPipeline(projectRoot: string, workspace: string, policy: ExecutionPolicy) {
  const results: VerificationResult[] = [];
  await logEvent(projectRoot, "VERIFICATION_STARTED", `Running ${policy.verificationPipeline.filter((step) => step.enabled).length} enabled verifiers.`);

  for (const step of policy.verificationPipeline) {
    if (!step.enabled) {
      results.push({
        verifier: step.name,
        status: "SKIP",
        command: step.command,
        stdout: "",
        stderr: "",
        exitCode: null,
        runtimeSeconds: 0,
        timedOut: false
      });
      continue;
    }

    await transitionExecutionState(projectRoot, { state: "VERIFYING", currentVerifier: step.name, currentCommand: step.command });
    await logEvent(projectRoot, "VERIFIER_STARTED", `${step.name}: ${step.command}`);
    const result = await runCommand(step.command, workspace, step.timeoutSeconds);
    const named = { ...result, verifier: step.name };
    results.push(named);
    await logEvent(projectRoot, "VERIFIER_COMPLETED", `${step.name}: ${named.status} in ${named.runtimeSeconds.toFixed(2)}s`);
    if (named.status === "FAIL" && !step.continueOnFailure) break;
  }

  await logEvent(projectRoot, "VERIFICATION_COMPLETED", allVerifiersPassed(results) ? "PASS" : "FAIL");
  return results;
}

export function allVerifiersPassed(results: VerificationResult[]) {
  return results.filter((result) => result.status !== "SKIP").every((result) => result.status === "PASS");
}

export function formatVerificationFailures(results: VerificationResult[]) {
  return results
    .filter((result) => result.status === "FAIL")
    .map((result) => [`${result.verifier} failed (${result.command})`, result.stderr || result.stdout || `Exit code ${result.exitCode}`].join("\n"))
    .join("\n\n")
    .slice(0, 8000);
}
