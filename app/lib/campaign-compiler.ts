import type {
  CampaignAst,
  CampaignCheckpoint,
  CampaignMetadata,
  CampaignMilestone,
  CampaignPrompt,
  CompilerDiagnostic,
  CompilerReport,
  FinalCertification,
  TaskGraph
} from "./types";

type TokenKind = "campaign" | "milestone" | "task" | "checkpoint" | "finalCertification" | "summary";

type Token = {
  kind: TokenKind;
  lineNumber: number;
  offset: number;
  raw: string;
  number?: number;
  title?: string;
};

type StageResult<T> = {
  output: T;
  timingMs: number;
  diagnostics: CompilerDiagnostic[];
};

type LexerOutput = {
  tokens: Token[];
  metadataDiscovered: string[];
};

type CampaignModel = {
  title: string;
  metadata: CampaignMetadata;
  milestones: CampaignMilestone[];
  prompts: CampaignPrompt[];
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
  taskGraph: TaskGraph;
};

type RenderedCampaign = {
  taskCards: Array<{ taskNumber: number; title: string; milestone?: string }>;
  milestones: Array<{ id: string; title: string; taskNumbers: number[] }>;
  checkpoints: Array<{ number: number; title: string }>;
};

type ValidationOutput = {
  duplicateTasks: number[];
  missingTasks: number[];
  invalidDependencies: Array<{ taskNumber: number; dependency: number }>;
  malformedMetadata: string[];
};

type CompiledCampaign = CampaignModel & {
  ast: CampaignAst;
  rendered: RenderedCampaign;
  campaignSummary: Record<string, unknown>;
  compilerReport: CompilerReport;
};

function timed<T>(run: () => { output: T; diagnostics?: CompilerDiagnostic[] }): StageResult<T> {
  const started = performance.now();
  const result = run();
  return {
    output: result.output,
    timingMs: Number((performance.now() - started).toFixed(3)),
    diagnostics: result.diagnostics ?? []
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function cleanTitle(value: string, number: number, fallback = "Task") {
  const cleaned = value
    .replace(/^#+\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .trim();
  return cleaned || `${fallback} ${String(number).padStart(3, "0")}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldValue(block: string, label: string) {
  const escaped = escapeRegExp(label);
  const match = new RegExp(`^(?:[-*]\\s*)?(?:\\*\\*)?${escaped}:(?:\\*\\*)?\\s*(.*)$`, "im").exec(block);
  return match?.[1]?.trim() || undefined;
}

function multilineField(block: string, label: string) {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const escaped = escapeRegExp(label);
  const start = lines.findIndex((line) => new RegExp(`^(?:[-*]\\s*)?(?:\\*\\*)?${escaped}:(?:\\*\\*)?\\s*`, "i").test(line));
  if (start < 0) return undefined;
  const first = lines[start].replace(new RegExp(`^(?:[-*]\\s*)?(?:\\*\\*)?${escaped}:(?:\\*\\*)?\\s*`, "i"), "").trim();
  const collected = [first];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^(?:[-*]\s*)?(?:\*\*)?[A-Za-z][A-Za-z ]{1,40}:(?:\*\*)?\s*/.test(lines[i]) || /^#{1,6}\s+(Task|Checkpoint|Final Certification|Phase|Campaign Summary)\b/i.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim() || undefined;
}

function firstField(block: string, labels: string[]) {
  for (const label of labels) {
    const value = fieldValue(block, label) || multilineField(block, label);
    if (value) return value;
  }
  return undefined;
}

function fileEntries(block: string) {
  return block
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^FILE:\s*/i.test(line.trim()))
    .map((line) => line.trim().replace(/^FILE:\s*/i, "").trim())
    .filter(Boolean);
}

function parseDependsOn(value?: string) {
  if (!value || /^(none|nothing)$/i.test(value)) return [];
  return value
    .split(/[, ]+/)
    .map((item) => Number(/\d+/.exec(item)?.[0]))
    .filter((item) => Number.isFinite(item));
}

function malformedDependencyDiagnostics(block: string, taskNumber: number, lineNumber?: number) {
  const value = fieldValue(block, "Depends On") || fieldValue(block, "Depends on");
  if (!value || /^(none|nothing)$/i.test(value)) return [];
  const references = value.split(/[, ]+/).filter(Boolean);
  if (references.some((item) => /\d+/.test(item))) return [];
  return [
    {
      severity: "warning" as const,
      code: "MALFORMED_DEPENDENCY",
      message: `Task ${String(taskNumber).padStart(3, "0")} has a malformed dependency declaration.`,
      lineNumber,
      expected: "Depends On should reference numeric task IDs, such as Task 001 or 001.",
      actual: value,
      cause: "No numeric dependency ID was found.",
      suggestion: "Use numeric task references or declare Depends On: none."
    }
  ];
}

function lineOffsets(text: string) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function sectionBlock(text: string, tokens: Token[], index: number) {
  const token = tokens[index];
  const start = token.offset + token.raw.length;
  const end = index + 1 < tokens.length ? tokens[index + 1].offset : text.length;
  return text.slice(start, end).trim();
}

function discoverMetadata(header: string) {
  const labels = [
    "Title",
    "Campaign ID",
    "Version",
    "Profile",
    "Execution Mode",
    "Workspace",
    "Workspace root",
    "Builder Protocol",
    "Estimated Tasks",
    "Checkpoint Interval",
    "Success Criteria"
  ];
  return labels.filter((label) => fieldValue(header, label) || multilineField(header, label));
}

function parseMetadata(header: string, fallbackTitle = "CAMPAIGN"): CampaignMetadata {
  const headingTitle = /^#\s+(.+)$/m.exec(header)?.[1]?.trim();
  const title = fieldValue(header, "Title") || headingTitle || fallbackTitle;
  const estimated = fieldValue(header, "Estimated Tasks") || /Total:\s*(\d+)\s+tasks/i.exec(header)?.[1];
  const workspace = fieldValue(header, "Workspace") || fieldValue(header, "Workspace root")?.replace(/^`|`$/g, "");
  const builderProtocol = fieldValue(header, "Builder Protocol") || (/FILE:\s+lines/i.test(header) ? "FILE" : undefined);
  return {
    title,
    campaignId: fieldValue(header, "Campaign ID"),
    version: fieldValue(header, "Version"),
    profile: fieldValue(header, "Profile"),
    executionMode: fieldValue(header, "Execution Mode"),
    workspace,
    builderProtocol,
    estimatedTasks: estimated ? Number(estimated) : undefined,
    checkpointInterval: fieldValue(header, "Checkpoint Interval"),
    successCriteria: multilineField(header, "Success Criteria"),
    format: "campaign-spec-v1"
  };
}

function lexCampaign(text: string): StageResult<LexerOutput> {
  return timed(() => {
    const diagnostics: CompilerDiagnostic[] = [];
    const offsets = lineOffsets(text);
    const tokens: Token[] = [];
    const lines = text.split("\n");

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const raw = line.trim();
      if (!raw) return;

      const markdownTask = /^#{1,6}\s+Task\s+(\d{1,5})(?:\s+[—-]\s+(.+))?\s*$/i.exec(raw);
      const legacyTask = /^(?:#{1,2}\s+)?TASK\s+(\d{1,5})(?:\s+[—-]\s+(.+))?\s*$/.exec(raw);
      const malformedTask = /^#{1,6}\s+Task\b(?!\s+\d{1,5})/i.test(raw) || /^TASK(?:\s*$|\s+[^\d\s])/.test(raw);
      const milestone = /^#{1,6}\s+Phase\s+(.+?)\s*$/i.exec(raw);
      const checkpoint = /^#{1,6}\s+Checkpoint(?:\s+(\d{1,5}))?(?:\s+[—-]\s+(.+))?\s*$/i.exec(raw);
      const finalCertification = /^#{1,6}\s+Final Certification(?:\s+[—-]\s+(.+))?\s*$/i.exec(raw);
      const summary = /^#{1,6}\s+Campaign Summary\s*$/i.exec(raw);
      const campaign = /^#\s+(.+)$/.exec(raw);

      if (markdownTask || legacyTask) {
        const match = markdownTask ?? legacyTask;
        const number = Number(match?.[1]);
        tokens.push({ kind: "task", lineNumber, offset: offsets[index], raw, number, title: match?.[2]?.trim() || cleanTitle("", number) });
        return;
      }

      if (malformedTask) {
        diagnostics.push({
          severity: "error",
          code: "MALFORMED_TASK_HEADING",
          message: `Line ${lineNumber} contains a malformed task heading.`,
          lineNumber,
          expected: "Task headings must include a numeric ID, such as ### Task 12 - Title or legacy TASK 012.",
          actual: raw,
          cause: "The heading uses TASK syntax without a valid numeric task ID.",
          suggestion: "Add a numeric task ID or change the line to body text if it is not executable."
        });
        return;
      }

      if (checkpoint) {
        tokens.push({ kind: "checkpoint", lineNumber, offset: offsets[index], raw, number: checkpoint[1] ? Number(checkpoint[1]) : undefined, title: checkpoint[2]?.trim() });
        return;
      }

      if (finalCertification) {
        tokens.push({ kind: "finalCertification", lineNumber, offset: offsets[index], raw, title: finalCertification[1]?.trim() });
        return;
      }

      if (summary) {
        tokens.push({ kind: "summary", lineNumber, offset: offsets[index], raw, title: "Campaign Summary" });
        return;
      }

      if (milestone) {
        tokens.push({ kind: "milestone", lineNumber, offset: offsets[index], raw, title: milestone[1].trim() });
        return;
      }

      if (campaign) {
        tokens.push({ kind: "campaign", lineNumber, offset: offsets[index], raw, title: campaign[1].trim() });
        return;
      }

      if (/^#{1,6}\s+\S+/.test(raw) && tokens.some((token) => ["milestone", "task", "checkpoint", "finalCertification", "summary"].includes(token.kind))) {
        diagnostics.push({
          severity: "info",
          code: "UNEXPECTED_HEADING",
          message: `Line ${lineNumber} contains a non-executable heading.`,
          lineNumber,
          expected: "Executable or structural headings must be Campaign, Phase, Task, Checkpoint, Final Certification, or Campaign Summary.",
          actual: raw,
          cause: "The heading is outside the Campaign Specification v1.0 executable grammar.",
          suggestion: "Leave as body documentation or rename it to a supported structural heading."
        });
        return;
      }

      if (/\bTasks\s+\d{1,5}/i.test(raw)) {
        diagnostics.push({
          severity: "info",
          code: "BODY_TASK_REFERENCE_IGNORED",
          message: `Line ${lineNumber} references task numbers in body text and was not treated as executable.`,
          lineNumber,
          expected: "Executable tasks must be Markdown headings like ### Task 12 - Title, or legacy TASK 012 on its own line.",
          actual: raw,
          cause: "The line is prose/list text, not a task heading.",
          suggestion: "No change needed unless this line should be an executable task."
        });
      }
    });

    const firstSection = tokens.find((token) => ["milestone", "task", "checkpoint", "finalCertification", "summary"].includes(token.kind))?.offset ?? text.length;
    return { output: { tokens, metadataDiscovered: discoverMetadata(text.slice(0, firstSection)) }, diagnostics };
  });
}

function buildAst(text: string, lexerOutput: LexerOutput): StageResult<CampaignAst> {
  return timed(() => {
    const diagnostics: CompilerDiagnostic[] = [];
    const structural = lexerOutput.tokens;
    const firstSection = structural.find((token) => ["milestone", "task", "checkpoint", "finalCertification", "summary"].includes(token.kind))?.offset ?? text.length;
    const campaignTitle = structural.find((token) => token.kind === "campaign")?.title;
    const metadata = parseMetadata(text.slice(0, firstSection), campaignTitle);
    const milestones: CampaignAst["milestones"] = [];
    const tasks: CampaignAst["tasks"] = [];
    const checkpoints: CampaignAst["checkpoints"] = [];
    let finalCertification: CampaignAst["finalCertification"] = null;
    let summary: CampaignAst["summary"] = null;
    let currentMilestone: CampaignAst["milestones"][number] | null = null;

    structural.forEach((token, index) => {
      const block = sectionBlock(text, structural, index);

      if (token.kind === "milestone") {
        currentMilestone = {
          kind: "Milestone",
          id: slugify(token.title ?? `milestone_${milestones.length + 1}`) || `milestone_${milestones.length + 1}`,
          title: token.title ?? token.raw.replace(/^#+\s*/, ""),
          lineNumber: token.lineNumber,
          body: block,
          taskNumbers: []
        };
        milestones.push(currentMilestone);
        return;
      }

      if (token.kind === "task" && token.number) {
        const title = fieldValue(block, "Title") || token.title || cleanTitle("", token.number);
        const output = multilineField(block, "Workspace Output") || multilineField(block, "Output");
        const body = [`TASK ${String(token.number).padStart(3, "0")} - ${title}`, block].filter(Boolean).join("\n\n");
        diagnostics.push(...malformedDependencyDiagnostics(block, token.number, token.lineNumber));
        currentMilestone?.taskNumbers.push(token.number);
        tasks.push({
          kind: "Task",
          rawHeading: token.raw,
          number: token.number,
          title,
          milestone: currentMilestone?.title,
          lineNumber: token.lineNumber,
          taskType: fieldValue(block, "Task Type"),
          dependsOn: parseDependsOn(fieldValue(block, "Depends On") || fieldValue(block, "Depends on")),
          objective: firstField(block, ["Objective", "Action"]),
          constraints: multilineField(block, "Constraints"),
          verificationGoal: firstField(block, ["Verification Goal", "Output"]),
          workspaceOutput: fileEntries(block).concat(output ? [output] : []),
          body,
          filename: `${String(token.number).padStart(3, "0")}_${slugify(title) || "task"}.md`
        });
        return;
      }

      if (token.kind === "checkpoint") {
        checkpoints.push({
          kind: "Checkpoint",
          rawHeading: token.raw,
          number: token.number ?? checkpoints.length + 1,
          title: fieldValue(block, "Title") || token.title || token.raw.replace(/^#+\s*/, ""),
          lineNumber: token.lineNumber,
          purpose: multilineField(block, "Purpose"),
          reviewGoals: multilineField(block, "Review Goals"),
          body: [`CHECKPOINT`, block].filter(Boolean).join("\n\n")
        });
        return;
      }

      if (token.kind === "finalCertification") {
        finalCertification = {
          kind: "FinalCertification",
          rawHeading: token.raw,
          title: fieldValue(block, "Title") || token.title || "Final Certification",
          lineNumber: token.lineNumber,
          body: [`FINAL CERTIFICATION`, block].filter(Boolean).join("\n\n")
        };
        return;
      }

      if (token.kind === "summary") {
        summary = {
          kind: "Summary",
          title: "Campaign Summary",
          lineNumber: token.lineNumber,
          body: block
        };
      }
    });

    return {
      output: {
        kind: "Campaign",
        title: metadata.title,
        metadata,
        milestones,
        tasks,
        checkpoints,
        finalCertification,
        summary,
        body: text.slice(0, firstSection).trim()
      },
      diagnostics
    };
  });
}

function buildTaskGraph(prompts: CampaignPrompt[]): TaskGraph {
  const edges = prompts.flatMap((prompt) => (prompt.dependsOn ?? []).map((dependency) => ({ from: dependency, to: prompt.number })));
  return {
    edges,
    nodes: prompts.map((prompt) => ({
      taskNumber: prompt.number,
      title: prompt.title,
      milestone: prompt.milestone,
      dependsOn: prompt.dependsOn ?? [],
      dependents: edges.filter((edge) => edge.from === prompt.number).map((edge) => edge.to),
      lineNumber: prompt.lineNumber
    }))
  };
}

function buildCampaignModel(ast: CampaignAst): StageResult<CampaignModel> {
  return timed(() => {
    const prompts = ast.tasks
      .map(({ kind: _kind, rawHeading: _rawHeading, ...task }) => task)
      .sort((a, b) => a.number - b.number);
    const milestones = ast.milestones.map(({ kind: _kind, ...milestone }) => ({ ...milestone }));
    const checkpoints = ast.checkpoints.map(({ kind: _kind, rawHeading: _rawHeading, ...checkpoint }) => checkpoint);
    const finalCertification = ast.finalCertification
      ? (({ kind: _kind, rawHeading: _rawHeading, ...certification }) => certification)(ast.finalCertification)
      : null;

    return {
      output: {
        title: ast.title,
        metadata: ast.metadata,
        milestones,
        prompts,
        checkpoints,
        finalCertification,
        taskGraph: buildTaskGraph(prompts)
      }
    };
  });
}

function validateCampaignModel(model: CampaignModel): StageResult<ValidationOutput> {
  return timed(() => {
    const diagnostics: CompilerDiagnostic[] = [];
    const byNumber = new Map<number, CampaignPrompt[]>();
    model.prompts.forEach((prompt) => byNumber.set(prompt.number, [...(byNumber.get(prompt.number) ?? []), prompt]));
    const duplicateTasks = [...byNumber.entries()].filter(([, items]) => items.length > 1).map(([number]) => number);
    const taskNumbers = [...byNumber.keys()].sort((a, b) => a - b);
    const maxTask = taskNumbers.length > 0 ? Math.max(...taskNumbers) : 0;
    const missingTasks = Array.from({ length: maxTask }, (_, index) => index + 1).filter((number) => !byNumber.has(number));
    const invalidDependencies = model.prompts.flatMap((prompt) =>
      (prompt.dependsOn ?? [])
        .filter((dependency) => !byNumber.has(dependency) || dependency >= prompt.number)
        .map((dependency) => ({ taskNumber: prompt.number, dependency }))
    );
    const malformedMetadata: string[] = [];

    if (!model.metadata.title?.trim()) malformedMetadata.push("title");
    if (model.metadata.format === "campaign-spec-v1") {
      if (!model.metadata.workspace) malformedMetadata.push("workspace");
      if (!model.metadata.builderProtocol) malformedMetadata.push("builderProtocol");
    }

    duplicateTasks.forEach((number) => {
      const items = byNumber.get(number) ?? [];
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_TASK",
        message: `Task ${String(number).padStart(3, "0")} appears more than once.`,
        firstLineNumber: items[0]?.lineNumber,
        secondLineNumber: items[1]?.lineNumber,
        expected: "Each executable task number should appear once.",
        actual: items.map((item) => `line ${item.lineNumber}: Task ${item.number}`).join("; "),
        cause: "Duplicate task nodes reached the campaign model.",
        suggestion: "Inspect lexer, AST, and campaign model counts to identify where the duplicate first appears."
      });
    });

    missingTasks.forEach((number) => {
      diagnostics.push({
        severity: "warning",
        code: "MISSING_TASK_NUMBER",
        message: `Task ${String(number).padStart(3, "0")} is missing from the campaign sequence.`,
        expected: `Task ${number} should exist if the sequence is intended to be contiguous.`,
        actual: "No matching executable task heading found.",
        cause: "Task numbering skipped this value.",
        suggestion: "Confirm the gap is intentional or add the missing task heading."
      });
    });

    invalidDependencies.forEach((dependency) => {
      diagnostics.push({
        severity: "warning",
        code: "INVALID_DEPENDENCY",
        message: `Task ${String(dependency.taskNumber).padStart(3, "0")} has invalid dependency Task ${String(dependency.dependency).padStart(3, "0")}.`,
        expected: "Dependencies should reference existing prior task numbers.",
        actual: `Task ${dependency.taskNumber} depends on Task ${dependency.dependency}.`,
        cause: "Dependency is missing or points forward.",
        suggestion: "Update Depends On to reference an existing prior task."
      });
    });

    malformedMetadata.forEach((field) => {
      diagnostics.push({
        severity: model.metadata.format === "campaign-spec-v1" ? "error" : "warning",
        code: "MALFORMED_METADATA",
        message: `Campaign metadata is missing ${field}.`,
        expected: `${field} should be declared in campaign metadata.`,
        actual: "No value found.",
        cause: "The metadata header did not include this field.",
        suggestion: "Add the missing metadata field if this is a Campaign Specification v1.0 document."
      });
    });

    return { output: { duplicateTasks, missingTasks, invalidDependencies, malformedMetadata }, diagnostics };
  });
}

function renderCampaignModel(model: CampaignModel): StageResult<RenderedCampaign> {
  return timed(() => ({
    output: {
      taskCards: model.prompts.map((prompt) => ({ taskNumber: prompt.number, title: prompt.title, milestone: prompt.milestone })),
      milestones: model.milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, taskNumbers: milestone.taskNumbers })),
      checkpoints: model.checkpoints.map((checkpoint) => ({ number: checkpoint.number, title: checkpoint.title }))
    }
  }));
}

function firstDuplicateStage(reportSeed: {
  lexerNumbers: number[];
  astNumbers: number[];
  modelNumbers: number[];
  validatorDuplicates: number[];
  rendererNumbers: number[];
}): CompilerReport["pipelineSummary"]["duplicateIntroducedAt"] {
  const hasDuplicate = (numbers: number[]) => numbers.some((number, index) => numbers.indexOf(number) !== index);
  if (hasDuplicate(reportSeed.lexerNumbers)) return "lexer";
  if (hasDuplicate(reportSeed.astNumbers)) return "ast";
  if (hasDuplicate(reportSeed.modelNumbers)) return "campaignModel";
  if (reportSeed.validatorDuplicates.length > 0) return "validator";
  if (hasDuplicate(reportSeed.rendererNumbers)) return "renderer";
  return "none";
}

function buildCompilerReport(
  metadata: CampaignMetadata,
  lexer: StageResult<LexerOutput>,
  ast: StageResult<CampaignAst>,
  model: StageResult<CampaignModel>,
  validation: StageResult<ValidationOutput>,
  renderer: StageResult<RenderedCampaign>
): CompilerReport {
  const lexerTaskNumbers = lexer.output.tokens.filter((token) => token.kind === "task").map((token) => token.number ?? 0);
  const astTaskNumbers = ast.output.tasks.map((task) => task.number);
  const modelTaskNumbers = model.output.prompts.map((task) => task.number);
  const rendererTaskNumbers = renderer.output.taskCards.map((task) => task.taskNumber);
  const diagnostics = [...lexer.diagnostics, ...ast.diagnostics, ...model.diagnostics, ...validation.diagnostics, ...renderer.diagnostics];
  const status = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "FAIL" : "PASS";

  return {
    format: metadata.format,
    status,
    pipelineSummary: {
      lexerTaskTokens: lexerTaskNumbers.length,
      astTaskNodes: ast.output.tasks.length,
      campaignExecutableTasks: model.output.prompts.length,
      validatorTaskCount: model.output.prompts.length,
      rendererTaskCards: renderer.output.taskCards.length,
      duplicateIntroducedAt: firstDuplicateStage({
        lexerNumbers: lexerTaskNumbers,
        astNumbers: astTaskNumbers,
        modelNumbers: modelTaskNumbers,
        validatorDuplicates: validation.output.duplicateTasks,
        rendererNumbers: rendererTaskNumbers
      })
    },
    stages: {
      lexer: {
        timingMs: lexer.timingMs,
        taskHeadingsFound: lexerTaskNumbers.length,
        milestoneHeadingsFound: lexer.output.tokens.filter((token) => token.kind === "milestone").length,
        checkpointHeadingsFound: lexer.output.tokens.filter((token) => token.kind === "checkpoint").length,
        metadataDiscovered: lexer.output.metadataDiscovered,
        diagnostics: lexer.diagnostics
      },
      ast: {
        timingMs: ast.timingMs,
        taskNodeCount: ast.output.tasks.length,
        milestoneNodeCount: ast.output.milestones.length,
        checkpointNodeCount: ast.output.checkpoints.length,
        summaryNodeCount: ast.output.summary ? 1 : 0,
        diagnostics: ast.diagnostics
      },
      campaignModel: {
        timingMs: model.timingMs,
        executableTaskCount: model.output.prompts.length,
        dependencyCount: model.output.taskGraph.edges.length,
        workspaceOutputs: model.output.prompts.reduce((sum, prompt) => sum + (prompt.workspaceOutput?.length ?? 0), 0),
        taskTypes: Array.from(new Set(model.output.prompts.map((prompt) => prompt.taskType ?? "Unspecified"))),
        diagnostics: model.diagnostics
      },
      validator: {
        timingMs: validation.timingMs,
        taskCount: model.output.prompts.length,
        duplicateTasks: validation.output.duplicateTasks,
        missingTasks: validation.output.missingTasks,
        invalidDependencies: validation.output.invalidDependencies,
        malformedMetadata: validation.output.malformedMetadata,
        diagnostics: validation.diagnostics
      },
      renderer: {
        timingMs: renderer.timingMs,
        renderedTaskCards: renderer.output.taskCards.length,
        renderedMilestones: renderer.output.milestones.length,
        renderedCheckpoints: renderer.output.checkpoints.length,
        diagnostics: renderer.diagnostics
      }
    },
    taskCount: model.output.prompts.length,
    taskNumbers: [...modelTaskNumbers].sort((a, b) => a - b),
    missingTasks: validation.output.missingTasks,
    duplicateTasks: validation.output.duplicateTasks,
    checkpointCount: model.output.checkpoints.length,
    milestoneCount: model.output.milestones.length,
    profile: metadata.profile,
    workspace: metadata.workspace,
    builderProtocol: metadata.builderProtocol,
    diagnostics
  };
}

function buildCampaignSummary(model: CampaignModel, compilerReport: CompilerReport) {
  return {
    campaignTitle: model.metadata.title,
    campaignId: model.metadata.campaignId,
    format: model.metadata.format,
    profile: model.metadata.profile,
    workspace: model.metadata.workspace,
    builderProtocol: model.metadata.builderProtocol,
    taskCount: model.prompts.length,
    milestoneCount: model.milestones.length,
    checkpointCount: model.checkpoints.length,
    finalTask: model.prompts.at(-1)?.number ?? null,
    dependencyEdges: model.taskGraph.edges.length,
    validationStatus: compilerReport.status,
    diagnostics: compilerReport.diagnostics.length,
    duplicateIntroducedAt: compilerReport.pipelineSummary.duplicateIntroducedAt
  };
}

function compileSpecCampaign(normalized: string): CompiledCampaign {
  const lexer = lexCampaign(normalized);
  const ast = buildAst(normalized, lexer.output);
  const model = buildCampaignModel(ast.output);
  const validation = validateCampaignModel(model.output);
  const renderer = renderCampaignModel(model.output);
  const compilerReport = buildCompilerReport(model.output.metadata, lexer, ast, model, validation, renderer);
  return {
    ...model.output,
    ast: ast.output,
    rendered: renderer.output,
    campaignSummary: buildCampaignSummary(model.output, compilerReport),
    compilerReport
  };
}

function compileLegacyCampaign(normalized: string): CompiledCampaign {
  const lexer = timed<LexerOutput>(() => {
    const tokens = [...normalized.matchAll(/^(?:#{1,6}\s+)?HOUR\s+(\d{1,3})\b.*$/gim)].map((match) => ({
      kind: "task" as const,
      lineNumber: normalized.slice(0, match.index ?? 0).split("\n").length,
      offset: match.index ?? 0,
      raw: match[0],
      number: Number(match[1]),
      title: cleanTitle("", Number(match[1]), "Hour")
    }));
    return { output: { tokens, metadataDiscovered: ["legacy-hour"] } };
  });
  const metadata: CampaignMetadata = {
    title: normalized.split("\n").find((line) => line.trim().length > 0)?.replace(/^#\s*/, "").trim() || "CAMPAIGN",
    format: "legacy-hour"
  };
  const ast = timed<CampaignAst>(() => {
    const tasks = lexer.output.tokens.map((token, index) => {
      const start = token.offset + token.raw.length;
      const end = index + 1 < lexer.output.tokens.length ? lexer.output.tokens[index + 1].offset : normalized.length;
      const block = normalized.slice(start, end).trim();
      const titleLine = block.split("\n").find((line) => line.trim().length > 0) ?? "";
      const title = cleanTitle(titleLine, token.number ?? index + 1, "Hour");
      return {
        kind: "Task" as const,
        rawHeading: token.raw,
        number: token.number ?? index + 1,
        title,
        taskType: "LEGACY",
        dependsOn: [],
        objective: multilineField(block, "Objective"),
        constraints: multilineField(block, "Constraints"),
        verificationGoal: multilineField(block, "Verification Goal"),
        workspaceOutput: fileEntries(block),
        body: [`HOUR ${String(token.number ?? index + 1).padStart(2, "0")}`, block].filter(Boolean).join("\n\n"),
        filename: `${String(token.number ?? index + 1).padStart(3, "0")}_${slugify(title) || "task"}.md`
      };
    });
    return {
      output: {
        kind: "Campaign",
        title: metadata.title,
        metadata,
        milestones: [],
        tasks,
        checkpoints: [],
        finalCertification: null,
        summary: null,
        body: normalized
      }
    };
  });
  const model = buildCampaignModel(ast.output);
  const validation = validateCampaignModel(model.output);
  const renderer = renderCampaignModel(model.output);
  const compilerReport = buildCompilerReport(model.output.metadata, lexer, ast, model, validation, renderer);
  return {
    ...model.output,
    ast: ast.output,
    rendered: renderer.output,
    campaignSummary: buildCampaignSummary(model.output, compilerReport),
    compilerReport
  };
}

export function compileCampaign(text: string): CompiledCampaign {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const hasLegacyHours = /^(?:#{1,6}\s+)?HOUR\s+\d{1,3}\b/im.test(normalized);
  if (hasLegacyHours && !/^#{1,6}\s+Task\s+\d{1,5}\b/im.test(normalized) && !/^(?:#{1,2}\s+)?TASK\s+\d{1,5}\b/m.test(normalized)) {
    return compileLegacyCampaign(normalized);
  }
  return compileSpecCampaign(normalized);
}
