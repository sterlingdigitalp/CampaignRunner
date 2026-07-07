import fs from "node:fs/promises";
import path from "node:path";
import { decisionEngine } from "./decision-engine";
import { loadExecutionPolicy } from "./execution-policy";
import { getCampaignProfile } from "./campaign-profile";
import type { ExecutionContract, VerificationStep } from "./types";

const WALK_EXCLUDED_DIRS = new Set([".git", "node_modules", ".next"]);

async function listWorkspaceFiles(workspace: string) {
  const files = new Set<string>();
  async function walk(dir: string, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_EXCLUDED_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), rel);
      } else files.add(rel);
    }
  }
  await walk(workspace);
  return files;
}

export async function detectWorkspaceMaturity(workspace: string): Promise<ExecutionContract["workspacePolicy"]["maturity"]> {
  const files = await listWorkspaceFiles(workspace);
  const visibleFiles = Array.from(files).filter((file) => !path.basename(file).startsWith("."));
  if (visibleFiles.length === 0) return "EMPTY";
  if (files.has("package.json") || files.has("pyproject.toml") || files.has("Cargo.toml")) return visibleFiles.length > 8 ? "MATURE" : "EXISTING";
  return "EARLY_STAGE";
}

export async function buildExecutionContract(projectRoot: string, workspace: string): Promise<{ contract: ExecutionContract; workspaceFiles: Set<string> }> {
  const policy = await loadExecutionPolicy(projectRoot);
  const profile = getCampaignProfile("Generic");
  const builderProtocol = policy.builderProtocol ?? profile.builderProtocol;
  const workspaceFiles = await listWorkspaceFiles(workspace);
  const maturity = await detectWorkspaceMaturity(workspace);
  const sourcePipeline = maturity === "EMPTY" ? profile.verificationPipeline : policy.verificationPipeline;
  const verifierPipeline: VerificationStep[] = sourcePipeline.map((step) => ({
    ...step,
    enabled: decisionEngine.shouldRunVerifier(step, workspaceFiles, {
      builderProtocol,
      verifierPipeline: policy.verificationPipeline,
      acceptancePolicy: { acceptOnlyVerified: policy.acceptOnlyVerified },
      repairPolicy: { maxRepairAttempts: policy.maxRepairAttempts },
      workspacePolicy: { maturity }
    })
  }));
  return {
    workspaceFiles,
    contract: {
      builderProtocol,
      verifierPipeline,
      acceptancePolicy: { acceptOnlyVerified: policy.acceptOnlyVerified },
      repairPolicy: { maxRepairAttempts: policy.maxRepairAttempts },
      workspacePolicy: { maturity }
    }
  };
}
