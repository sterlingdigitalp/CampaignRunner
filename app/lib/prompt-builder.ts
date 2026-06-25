import type { CampaignPrompt, RunnerSettings } from "./types";

export function runtimePromptParts(prompt: CampaignPrompt, settings: RunnerSettings) {
  const systemPrompt = [
    "Instructions:",
    "Continue building the existing project.",
    "Do not restart.",
    "Modify existing files when appropriate.",
    "Create new files only when necessary.",
    "Return only required artifacts using the Builder Protocol:",
    "FILE: relative/path",
    "<complete file contents>"
  ].join("\n");
  const campaignHeader = [
    "CAMPAIGN",
    "",
    `Current Step: Hour ${String(prompt.number).padStart(2, "0")} - ${prompt.title}`,
    `Project Root: ${settings.projectRoot}`,
    `Workspace Location: ${settings.workspace}`,
    ""
  ].join("\n");
  return { systemPrompt, campaignHeader, hourPrompt: prompt.body };
}

export function estimateTokens(value: string) {
  return Math.ceil(value.trim().split(/\s+/).filter(Boolean).length * 1.35);
}

export function buildRuntimePrompt(prompt: CampaignPrompt, settings: RunnerSettings) {
  const parts = runtimePromptParts(prompt, settings);
  return [parts.campaignHeader, parts.systemPrompt, "", parts.hourPrompt].join("\n");
}
