import fs from "node:fs/promises";
import { getCampaignProfile } from "./campaign-profile";
import { ensureDir, projectPaths, writeJson } from "./files";
import { logEvent } from "./logger";
import type { CampaignMetadata, CampaignProfileName, ExecutionContract, ExecutionPolicy, RunnerSettings } from "./types";

export type ConfigValidationStatus = "PASS" | "WARNING" | "FAIL";

export type ConfigValidationDiagnostic = {
  severity: ConfigValidationStatus;
  code: string;
  message: string;
};

export type ConfigValidationReport = {
  status: ConfigValidationStatus;
  diagnostics: ConfigValidationDiagnostic[];
  effectiveProfile: CampaignProfileName;
  enabledVerifierCount: number;
  configuredVerifierCount: number;
  checkedAt: string;
};

function isCampaignProfileName(value: string): value is CampaignProfileName {
  return ["Generic", "TypeScript", "Python", "Markdown", "Research", "Documentation"].includes(value);
}

export async function validateExecutionConfig(input: {
  projectRoot: string;
  settings: RunnerSettings;
  policy: ExecutionPolicy;
  contract: ExecutionContract;
  metadata?: CampaignMetadata;
}): Promise<ConfigValidationReport> {
  const diagnostics: ConfigValidationDiagnostic[] = [];
  const enabledVerifierCount = input.contract.verifierPipeline.filter((step) => step.enabled).length;
  const configuredVerifierCount = input.policy.verificationPipeline.length;
  const effectiveProfile: CampaignProfileName = isCampaignProfileName(input.metadata?.profile ?? "") ? (input.metadata?.profile as CampaignProfileName) : "Generic";

  if (input.policy.acceptOnlyVerified && configuredVerifierCount === 0 && enabledVerifierCount === 0) {
    diagnostics.push({
      severity: "WARNING",
      code: "ACCEPT_ONLY_VERIFIED_WITH_NO_ENABLED_VERIFIERS",
      message: "acceptOnlyVerified is true but no verification pipeline is configured."
    });
  }

  if (input.policy.maxRepairAttempts < 1) {
    diagnostics.push({
      severity: "FAIL",
      code: "REPAIR_BUDGET_TOO_LOW",
      message: "Repair budget must be at least 1 for autonomous execution."
    });
  }

  if (!input.settings.workspace.trim()) {
    diagnostics.push({ severity: "FAIL", code: "MISSING_WORKSPACE", message: "Workspace path is missing." });
  } else {
    await ensureDir(input.settings.workspace).catch(() =>
      diagnostics.push({ severity: "FAIL", code: "MISSING_WORKSPACE", message: "Workspace path could not be created." })
    );
    await fs.access(input.settings.workspace).catch(() =>
      diagnostics.push({ severity: "FAIL", code: "MISSING_WORKSPACE", message: "Workspace path is not accessible." })
    );
  }

  if (input.contract.builderProtocol !== "FILE_BLOCKS" && input.contract.builderProtocol !== "FILE_JSON") {
    diagnostics.push({
      severity: "FAIL",
      code: "INVALID_BUILDER_PROTOCOL",
      message: `Unsupported builder protocol: ${input.contract.builderProtocol}.`
    });
  }

  const version = input.metadata?.version;
  if (version && !/^v?\d+(\.\d+){0,2}$/i.test(version)) {
    diagnostics.push({
      severity: "WARNING",
      code: "UNKNOWN_CAMPAIGN_VERSION",
      message: `Campaign version ${version} is not a recognized semantic version string.`
    });
  }

  const profile = input.metadata?.profile;
  if (!profile) {
    getCampaignProfile(effectiveProfile);
  } else {
    if (!isCampaignProfileName(profile)) {
      diagnostics.push({ severity: "WARNING", code: "UNKNOWN_RUNTIME_PROFILE", message: `Unknown campaign profile: ${profile}.` });
    } else {
      getCampaignProfile(profile);
    }
  }

  const status: ConfigValidationStatus = diagnostics.some((diagnostic) => diagnostic.severity === "FAIL")
    ? "FAIL"
    : diagnostics.some((diagnostic) => diagnostic.severity === "WARNING")
      ? "WARNING"
      : "PASS";
  const report = { status, diagnostics, effectiveProfile, enabledVerifierCount, configuredVerifierCount, checkedAt: new Date().toISOString() };
  await writeJson(projectPaths(input.projectRoot).configValidation, report);
  await logEvent(input.projectRoot, "CONFIG_VALIDATION", `${status}: ${diagnostics.map((item) => item.code).join(", ") || "No issues."}`);
  return report;
}
