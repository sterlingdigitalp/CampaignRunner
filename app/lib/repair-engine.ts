import type { CampaignPrompt, FileProtocolValidationResult, RunnerSettings, VerificationResult } from "./types";
import { formatVerificationFailures } from "./verification-engine";

const MAX_PREVIOUS_RESPONSE_CHARS = 2600;

function fileBlocks(response: string) {
  const lines = response.replace(/\r\n/g, "\n").split("\n");
  const headers = lines
    .map((line, index) => ({ line, index, match: /^FILE:\s*(.+)$/i.exec(line) }))
    .filter((item): item is { line: string; index: number; match: RegExpExecArray } => Boolean(item.match));

  return headers.map((header, index) => {
    const next = headers[index + 1];
    const text = lines.slice(header.index, next?.index ?? lines.length).join("\n").trim();
    return { file: header.match[1].trim(), text };
  });
}

export function analyzePreviousResponse(response: string, protocol?: FileProtocolValidationResult) {
  const blocks = fileBlocks(response);
  const counts = new Map<string, number>();
  blocks.forEach((block) => counts.set(block.file, (counts.get(block.file) || 0) + 1));
  const duplicateFiles = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([file]) => file);
  const protocolFiles = new Set(protocol?.errors.map((error) => error.file).filter((file): file is string => Boolean(file)) ?? []);
  const relevant = blocks.filter((block) => duplicateFiles.includes(block.file) || protocolFiles.has(block.file));
  const excerptBlocks = relevant.length > 0 ? relevant : blocks;
  let excerpt = excerptBlocks.map((block) => block.text).join("\n\n").trim();

  if (!excerpt) excerpt = response.trim();
  if (excerpt.length > MAX_PREVIOUS_RESPONSE_CHARS) {
    excerpt = `${excerpt.slice(0, MAX_PREVIOUS_RESPONSE_CHARS).trim()}\n...[truncated]`;
  }

  return {
    duplicateFiles,
    excerpt: excerpt || "No previous response text captured."
  };
}

export function buildRepairPrompt(
  prompt: CampaignPrompt,
  settings: RunnerSettings,
  results: VerificationResult[],
  protocol?: FileProtocolValidationResult,
  previousAttemptSummary = "Previous candidate did not satisfy the execution contract.",
  previousResponse = ""
) {
  const analysis = analyzePreviousResponse(previousResponse, protocol);
  return [
    "Task:",
    `Fix Hour ${String(prompt.number).padStart(2, "0")} in workspace ${settings.workspace}.`,
    prompt.title,
    "",
    "Previous attempt summary:",
    previousAttemptSummary,
    "",
    "Verification Output:",
    formatVerificationFailures(results) || "No verifier output.",
    "",
    "Protocol violations:",
    protocol?.errors.map((error) => `- ${error.message}`).join("\n") || "None.",
    "",
    "Previous response analysis:",
    analysis.duplicateFiles.length > 0
      ? `The following FILE blocks were emitted multiple times: ${analysis.duplicateFiles.join(", ")}. Repair only this issue if no verifier failures remain.`
      : "No duplicate FILE blocks detected.",
    "",
    "Files requiring repair:",
    protocol?.files.map((file) => `- ${file.relativePath}`).join("\n") || "Files from the failed attempt or newly required files.",
    "",
    "Previous LLM response excerpt:",
    analysis.excerpt,
    "",
    "Return instructions:",
    "Fix ONLY the issues listed.",
    "Return ONLY modified files using this exact Builder Protocol:",
    "FILE: relative/path",
    "<complete file contents>"
  ].join("\n");
}
