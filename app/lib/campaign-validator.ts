import { parseCampaign } from "./parser";
import { validateCampaignPrompts } from "./campaign-validation";
import type { CampaignPlanResult } from "./types";

export function validateCampaignSpecification(campaignText: string): CampaignPlanResult {
  const parsed = parseCampaign(campaignText);
  const validation = validateCampaignPrompts(parsed.prompts, parsed.metadata, parsed.checkpoints);
  const errors = [...validation.errors, ...parsed.compilerReport.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.message)];
  const warnings = [
    ...validation.warnings,
    ...parsed.compilerReport.diagnostics.filter((diagnostic) => diagnostic.severity !== "error").map((diagnostic) => diagnostic.message)
  ];

  if (!parsed.metadata.title?.trim()) errors.push("Campaign title is required.");
  if (parsed.metadata.format === "campaign-spec-v1") {
    if (!parsed.metadata.workspace) errors.push("Workspace is required.");
    if (!parsed.metadata.builderProtocol) errors.push("Builder Protocol is required.");
    if (!parsed.metadata.profile) warnings.push("Profile is missing; Generic will be assumed.");
    if (!parsed.metadata.executionMode) warnings.push("Execution Mode is missing; Sequential will be assumed.");
  }

  parsed.prompts.forEach((task) => {
    const label = `Task ${String(task.number).padStart(3, "0")}`;
    if (!task.workspaceOutput?.length) errors.push(`${label} must declare at least one Workspace Output or FILE entry.`);
    if (!task.verificationGoal) errors.push(`${label} must include a Verification Goal or Output contract.`);
  });

  const numbers = new Set(parsed.prompts.map((task) => task.number));
  parsed.prompts.forEach((task) => {
    (task.dependsOn ?? []).forEach((dependency) => {
      if (!numbers.has(dependency)) errors.push(`Task ${String(task.number).padStart(3, "0")} depends on missing Task ${String(dependency).padStart(3, "0")}.`);
    });
  });

  return {
    campaignText,
    validation: { ...validation, valid: errors.length === 0, errors, warnings },
    metadata: parsed.metadata,
    milestones: parsed.milestones,
    tasks: parsed.prompts,
    checkpoints: parsed.checkpoints,
    finalCertification: parsed.finalCertification,
    warnings
  };
}
