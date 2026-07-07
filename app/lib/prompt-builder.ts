import type { BuilderProtocolName, CampaignPrompt, RunnerSettings } from "./types";

export type PromptBuildOptions = {
  protocol?: BuilderProtocolName;
  workspaceContext?: string;
  memoryContext?: string;
};

function protocolInstructions(protocol: BuilderProtocolName) {
  if (protocol === "FILE_JSON") {
    return [
      "Return only required artifacts using the Builder Protocol:",
      "Respond with exactly one JSON object and nothing else:",
      '{"files":[{"path":"relative/path","content":"complete file contents"}],"report":{"status":"complete","notes":"...","blockers":[],"followUps":[]}}',
      "Each path must appear exactly once. Paths are relative to the workspace root.",
      "You must write every file listed under this task's Workspace Output.",
      "Every content value must be the complete final file, never a diff or fragment.",
      'Escape each newline in content exactly once as \\n. Never emit double-escaped sequences like \\\\n.',
      'When a file\'s content is itself JSON (like package.json), escape its inner quotes as \\" and keep the inner JSON complete and valid.',
      "In report.notes, record decisions or discoveries the next task needs to know (one or two sentences).",
      "Set report.status to partial or blocked only when you could not fully complete this task, and say why in blockers."
    ];
  }
  return [
    "Return only required artifacts using the Builder Protocol:",
    "FILE: relative/path",
    "<complete file contents>"
  ];
}

export function runtimePromptParts(prompt: CampaignPrompt, settings: RunnerSettings, options: PromptBuildOptions = {}) {
  const systemPrompt = [
    "Instructions:",
    "Continue building the existing project.",
    "Do not restart.",
    "Modify existing files when appropriate.",
    "Create new files only when necessary.",
    ...protocolInstructions(options.protocol ?? "FILE_BLOCKS")
  ].join("\n");
  const campaignHeader = [
    "CAMPAIGN",
    "",
    `Current Step: Hour ${String(prompt.number).padStart(2, "0")} - ${prompt.title}`,
    `Project Root: ${settings.projectRoot}`,
    `Workspace Location: ${settings.workspace}`,
    ""
  ].join("\n");
  return {
    systemPrompt,
    campaignHeader,
    hourPrompt: prompt.body,
    workspaceContext: options.workspaceContext ?? "",
    memoryContext: options.memoryContext ?? ""
  };
}

export function estimateTokens(value: string) {
  const trimmed = value.trim();
  const wordEstimate = trimmed.split(/\s+/).filter(Boolean).length * 1.35;
  // Code tokenizes far denser than prose per word; the char-based floor keeps
  // budgets honest for source-heavy content so prompts cannot overflow context.
  const charEstimate = trimmed.length / 4;
  return Math.ceil(Math.max(wordEstimate, charEstimate));
}

export function buildRuntimePrompt(prompt: CampaignPrompt, settings: RunnerSettings, options: PromptBuildOptions = {}) {
  const parts = runtimePromptParts(prompt, settings, options);
  return [
    parts.campaignHeader,
    parts.systemPrompt,
    "",
    ...(parts.memoryContext ? [parts.memoryContext, ""] : []),
    ...(parts.workspaceContext ? [parts.workspaceContext, ""] : []),
    parts.hourPrompt
  ].join("\n");
}
