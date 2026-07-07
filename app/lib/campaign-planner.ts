import { validateCampaignSpecification } from "./campaign-validator";
import type { CampaignBrief, CampaignPlanResult, CompilerDiagnostic, PlannerProfile, PlannerRepairRecord, PlannerReport, PlanningState } from "./types";

const MAX_PLANNER_REPAIRS = 3;

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "campaign"
  );
}

function cleanLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function taskCountFor(size: CampaignBrief["estimatedTaskSize"], deliverableCount: number) {
  const base = size === "Small" ? 6 : size === "Large" ? 14 : 10;
  return Math.max(base, Math.min(24, deliverableCount || base));
}

function profileTypes(profile: PlannerProfile) {
  if (profile === "Software") return ["CREATE", "MODIFY", "VERIFY", "REFACTOR", "FINALIZE"];
  if (profile === "Research") return ["SEARCH", "SYNTHESIZE", "VERIFY", "REPORT", "FINALIZE"];
  if (profile === "Documentation") return ["CREATE", "MODIFY", "REVIEW", "FINALIZE"];
  return ["CREATE", "MODIFY", "VERIFY", "FINALIZE"];
}

function inferDeliverables(brief: CampaignBrief) {
  const lines = cleanLines(brief.brief);
  const explicit = lines.filter((line) => /(^| )(build|create|write|document|research|implement|deliver|produce|add|verify|review)\b/i.test(line));
  if (explicit.length >= 3) return explicit.slice(0, 24);

  const profileDefaults: Record<PlannerProfile, string[]> = {
    Documentation: [
      "Create the documentation structure",
      "Write the project overview",
      "Document architecture and responsibilities",
      "Document workflows and operating procedures",
      "Review consistency across documents",
      "Finalize index and completion notes"
    ],
    Software: [
      "Create project scaffold",
      "Implement core data model",
      "Implement primary workflow",
      "Add validation and error handling",
      "Verify build and tests",
      "Refactor and finalize"
    ],
    Research: [
      "Identify research questions",
      "Collect primary sources",
      "Synthesize findings",
      "Verify claims against evidence",
      "Produce final report",
      "Finalize citations and limitations"
    ],
    Generic: [
      "Define project structure",
      "Create core artifacts",
      "Refine artifacts",
      "Verify completeness",
      "Finalize deliverables",
      "Prepare handoff"
    ]
  };
  return profileDefaults[brief.projectType];
}

function fileFor(profile: PlannerProfile, workspace: string, index: number, title: string) {
  const prefix = workspace.replace(/^\/+|\/+$/g, "") || "workspace";
  const name = `${String(index).padStart(3, "0")}_${slug(title)}`;
  if (profile === "Software") return `${prefix}/src/${name}.md`;
  if (profile === "Research") return `${prefix}/research/${name}.md`;
  return `${prefix}/docs/${name}.md`;
}

function quoteBrief(briefText: string) {
  return briefText
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildDraftCampaign(brief: CampaignBrief, quoteProjectBrief = false) {
  const projectName = brief.projectName.trim() || "Untitled Campaign";
  const workspace = brief.workspace.trim() || slug(projectName);
  const deliverables = inferDeliverables(brief);
  const count = taskCountFor(brief.estimatedTaskSize, deliverables.length);
  const taskTypes = profileTypes(brief.projectType);
  const tasks = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const title = deliverables[index] || `${brief.projectType} task ${number}`;
    const type = number === count ? "FINALIZE" : taskTypes[Math.min(index % taskTypes.length, taskTypes.length - 1)];
    const depends = number === 1 ? "None" : `Task ${String(number - 1).padStart(3, "0")}`;
    const output = fileFor(brief.projectType, workspace, number, title);
    return [
      `# TASK ${String(number).padStart(3, "0")}`,
      `Title: ${title}`,
      `Task Type: ${type}`,
      `Depends On: ${depends}`,
      `Objective: ${title}. Use the project brief as source intent and produce only the scoped artifact for this task.`,
      `Constraints: Keep the output focused. Do not complete future tasks early. Follow the Builder Protocol exactly.${
        brief.projectType === "Software"
          ? " Do not use Node-only globals (require, module, process) unless @types/node is a declared devDependency. Import every name you use, even ones you also re-export."
          : ""
      }`,
      `Verification Goal: Confirm ${output} exists and satisfies this task objective.`,
      `Workspace Output:`,
      `FILE: ${output}`
    ].join("\n");
  });

  const checkpointInterval = Math.max(3, Math.min(8, Math.ceil(count / 3)));
  const checkpointBlocks = Array.from({ length: Math.max(1, Math.floor(count / checkpointInterval)) }, (_, index) => {
    const after = Math.min(count, (index + 1) * checkpointInterval);
    return [
      `# CHECKPOINT ${index + 1}`,
      `Title: Review tasks 1-${after}`,
      `Purpose: Confirm completed artifacts are coherent before continuing.`,
      `Review Goals: Validate scope, dependencies, and output consistency.`
    ].join("\n");
  });

  return [
    `# CAMPAIGN`,
    `Title: ${projectName}`,
    `Campaign ID: ${slug(projectName).toUpperCase()}-${Date.now().toString().slice(-6)}`,
    `Version: 1.0`,
    `Profile: ${brief.builderProfile || brief.projectType}`,
    `Execution Mode: Sequential`,
    `Workspace: ${workspace}`,
    `Builder Protocol: FILE`,
    `Estimated Tasks: ${count}`,
    `Checkpoint Interval: ${checkpointInterval}`,
    `Success Criteria: All planned tasks verify successfully and final certification confirms readiness.`,
    ``,
    `Project Brief:`,
    quoteProjectBrief ? quoteBrief(brief.brief || "No additional brief supplied.") : brief.brief.trim() || "No additional brief supplied.",
    ``,
    ...tasks.flatMap((task) => [task, ""]),
    ...checkpointBlocks.flatMap((checkpoint) => [checkpoint, ""]),
    `# FINAL CERTIFICATION`,
    `Title: Final campaign certification`,
    `Purpose: Confirm all tasks are complete, verified, and ready for handoff.`,
    ``,
    `## Campaign Summary`,
    `Total: ${count} tasks`,
    `Profile: ${brief.projectType}`,
    `Target Model: ${brief.targetModel || "Local LM Studio model"}`
  ].join("\n");
}

function diagnosticsFrom(result: CampaignPlanResult) {
  return result.validation.errors.map((message) => ({
    severity: "error" as const,
    code: message.includes("Duplicate tasks")
      ? "DUPLICATE_TASK"
      : message.includes("malformed task heading")
        ? "MALFORMED_TASK_HEADING"
        : "PLANNER_VALIDATION_ERROR",
    message
  }));
}

function tryUseBriefAsCampaign(brief: CampaignBrief) {
  if (!/(^|\n)#{1,6}\s+Task\s+\d{1,5}\b/i.test(brief.brief) && !/(^|\n)(?:#{1,2}\s+)?TASK\s+\d{1,5}\b/.test(brief.brief)) return null;
  const result = validateCampaignSpecification(brief.brief);
  return result.validation.valid ? result.campaignText : null;
}

function repairDraftCampaign(brief: CampaignBrief, draft: string, diagnostics: CompilerDiagnostic[], attempt: number): { campaignText: string; repair: PlannerRepairRecord } {
  const codes = Array.from(new Set(diagnostics.map((diagnostic) => diagnostic.code)));
  const briefCampaign = tryUseBriefAsCampaign(brief);
  if (briefCampaign) {
    return {
      campaignText: briefCampaign,
      repair: {
        attempt,
        action: "Used original brief as canonical Campaign Specification because it compiled successfully.",
        diagnosticsResolved: codes
      }
    };
  }

  if (codes.some((code) => ["DUPLICATE_TASK", "MALFORMED_TASK_HEADING", "BODY_TASK_REFERENCE_IGNORED"].includes(code))) {
    return {
      campaignText: buildDraftCampaign(brief, true),
      repair: {
        attempt,
        action: "Quoted Project Brief lines so embedded headings remain context and cannot become executable tasks.",
        diagnosticsResolved: codes
      }
    };
  }

  return {
    campaignText: draft,
    repair: {
      attempt,
      action: "No deterministic repair rule matched the compiler diagnostics.",
      diagnosticsResolved: []
    }
  };
}

function attachPlannerReport(result: CampaignPlanResult, report: PlannerReport): CampaignPlanResult {
  return {
    ...result,
    plannerReport: report,
    warnings: [...result.warnings, `Planner status: ${report.ready ? "READY" : "FAILED"} after ${report.compilerAttempts} compile attempt(s) and ${report.repairAttempts} repair(s).`]
  };
}

export function planCampaign(brief: CampaignBrief, maxRepairAttempts = MAX_PLANNER_REPAIRS) {
  const started = performance.now();
  const states: PlanningState[] = ["PLANNING"];
  const repairs: PlannerRepairRecord[] = [];
  const producedDiagnostics: CompilerDiagnostic[] = [];
  let campaignText = buildDraftCampaign(brief);
  let compilerAttempts = 0;
  let finalResult: CampaignPlanResult | null = null;

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    states.push("COMPILING");
    compilerAttempts += 1;
    const result = validateCampaignSpecification(campaignText);
    finalResult = result;

    const diagnostics = [...result.metadata ? [] : [], ...diagnosticsFrom(result)];
    producedDiagnostics.push(...diagnostics);

    if (result.validation.valid) {
      states.push("VALIDATED", "READY");
      const report = buildPlannerReport(brief, started, compilerAttempts, repairs, producedDiagnostics, result, states, true);
      return attachPlannerReport(result, report);
    }

    if (attempt >= maxRepairAttempts) break;

    states.push("PLANNER_REPAIR");
    const repaired = repairDraftCampaign(brief, campaignText, diagnostics, repairs.length + 1);
    repairs.push(repaired.repair);
    if (repaired.campaignText === campaignText) break;
    campaignText = repaired.campaignText;
  }

  states.push("PLANNER_FAILED");
  const fallback = finalResult ?? validateCampaignSpecification(campaignText);
  return attachPlannerReport(fallback, buildPlannerReport(brief, started, compilerAttempts, repairs, producedDiagnostics, fallback, states, false));
}

function buildPlannerReport(
  brief: CampaignBrief,
  started: number,
  compilerAttempts: number,
  repairs: PlannerRepairRecord[],
  diagnosticsProduced: CompilerDiagnostic[],
  finalResult: CampaignPlanResult,
  states: PlanningState[],
  ready: boolean
): PlannerReport {
  const diagnosticsResolved = Array.from(new Set(repairs.flatMap((repair) => repair.diagnosticsResolved)));
  return {
    originalBrief: brief.brief,
    planningDurationMs: Number((performance.now() - started).toFixed(3)),
    compilerAttempts,
    repairAttempts: repairs.length,
    diagnosticsProduced,
    diagnosticsResolved,
    finalCompileStatus: finalResult.validation.valid ? "PASS" : "FAIL",
    plannerConfidence: ready ? Math.max(0.6, 1 - repairs.length * 0.15) : 0,
    states,
    repairs,
    finalCampaignStatistics: {
      taskCount: finalResult.tasks.length,
      milestoneCount: finalResult.milestones?.length ?? 0,
      checkpointCount: finalResult.checkpoints.length,
      duplicateTasks: finalResult.validation.stats.duplicateTasks,
      missingTasks: finalResult.validation.stats.missingTasks
    },
    ready
  };
}
