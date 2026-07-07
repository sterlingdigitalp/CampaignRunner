import type {
  BuilderProtocolName,
  CampaignPrompt,
  FileProtocolValidationError,
  FileProtocolValidationResult,
  ProtocolFailureCategory,
  RunnerSettings,
  VerificationResult
} from "./types";
import { formatVerificationFailures } from "./verification-engine";

const MAX_PREVIOUS_RESPONSE_CHARS = 1800;

function fileBlocks(response: string) {
  const lines = response.replace(/\r\n/g, "\n").split("\n");
  const headers = lines
    .map((line, index) => ({ line, index, match: /^FILE:\s*(.+)$/i.exec(line) }))
    .filter((item): item is { line: string; index: number; match: RegExpExecArray } => Boolean(item.match));

  return headers.map((header, index) => {
    const next = headers[index + 1];
    const text = lines.slice(header.index, next?.index ?? lines.length).join("\n").trim();
    return { file: header.match[1].trim(), line: header.index + 1, text };
  });
}

export function categorizeProtocolFailure(error: FileProtocolValidationError): ProtocolFailureCategory {
  if (error.code === "DUPLICATE_FILE") return "PROTOCOL_DUPLICATE_FILE";
  if (error.code === "MALFORMED_HEADER") return "PROTOCOL_MALFORMED_HEADER";
  if (error.code === "NO_FILE_BLOCKS") return "PROTOCOL_MISSING_FILE";
  if (error.code === "EMPTY_FILE") return "PROTOCOL_EMPTY_OUTPUT";
  if (error.code === "INVALID_JSON") return "PROTOCOL_INVALID_JSON";
  if (error.code === "UNSAFE_PATH") return error.message.toLowerCase().includes("empty") ? "PROTOCOL_INVALID_PATH" : "PROTOCOL_UNSAFE_PATH";
  return "PROTOCOL_INVALID_PATH";
}

function categoryRepairStrategy(category: ProtocolFailureCategory, file?: string) {
  const target = file ? ` for ${file}` : "";
  const strategies: Record<ProtocolFailureCategory, string> = {
    PROTOCOL_DUPLICATE_FILE: `Return exactly one FILE block${target}. Remove all repeated FILE headers for the same path.`,
    PROTOCOL_DUPLICATE_PATH: `Choose one normalized relative path${target}. Do not emit aliases for the same file.`,
    PROTOCOL_MALFORMED_HEADER: "Rewrite the malformed header as FILE: relative/path.",
    PROTOCOL_MISSING_FILE: "Return the required FILE block using the task's Workspace Output path.",
    PROTOCOL_INVALID_PATH: "Use a non-empty relative path under the workspace.",
    PROTOCOL_EMPTY_OUTPUT: `Return non-empty complete file contents${target}.`,
    PROTOCOL_UNSAFE_PATH: "Use a safe relative path. Do not use absolute paths or path traversal.",
    PROTOCOL_INVALID_JSON: 'Return exactly one JSON object matching {"files":[{"path":"relative/path","content":"..."}]} with no surrounding text, fences, or commentary.'
  };
  return strategies[category];
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
    blocks,
    excerpt: excerpt || "No previous response text captured."
  };
}

function buildRepairTargets(protocol?: FileProtocolValidationResult) {
  const sourceErrors = protocol?.originalErrors?.length ? protocol.originalErrors : protocol?.errors ?? [];
  const seen = new Set<string>();
  return sourceErrors
    .map((error) => {
      const category = categorizeProtocolFailure(error);
      const key = `${category}:${error.file ?? ""}:${error.message}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        category,
        file: error.file,
        message: error.message,
        expectedSyntax: error.expectedSyntax,
        actualSyntax: error.actualSyntax,
        line: error.line,
        strategy: categoryRepairStrategy(category, error.file)
      };
    })
    .filter((target): target is NonNullable<typeof target> => Boolean(target));
}

export function buildRepairPrompt(
  prompt: CampaignPrompt,
  settings: RunnerSettings,
  results: VerificationResult[],
  protocol?: FileProtocolValidationResult,
  previousAttemptSummary = "Previous candidate did not satisfy the execution contract.",
  previousResponse = "",
  builderProtocol: BuilderProtocolName = "FILE_BLOCKS"
) {
  const analysis = analyzePreviousResponse(previousResponse, protocol);
  const targets = buildRepairTargets(protocol);
  const primaryTarget = targets[0];
  const targetFiles = Array.from(
    new Set([
      ...targets.map((target) => target.file).filter((file): file is string => Boolean(file)),
      ...analysis.duplicateFiles
    ])
  );
  const relevantBlocks = targetFiles.length
    ? analysis.blocks.filter((block) => targetFiles.includes(block.file))
    : analysis.blocks;
  const duplicateCounts = targetFiles
    .map((file) => `${file}: ${analysis.blocks.filter((block) => block.file === file).length}`)
    .join("\n");
  let targetedExcerpt = relevantBlocks
    .map((block) => `Line ${block.line}: ${block.text}`)
    .join("\n\n")
    .trim();
  if (!targetedExcerpt) targetedExcerpt = analysis.excerpt;
  if (targetedExcerpt.length > MAX_PREVIOUS_RESPONSE_CHARS) {
    targetedExcerpt = `${targetedExcerpt.slice(0, MAX_PREVIOUS_RESPONSE_CHARS).trim()}\n...[truncated]`;
  }

  return [
    "Repair Mode: TARGETED_PROTOCOL_REPAIR",
    "",
    "Task:",
    `Fix Hour ${String(prompt.number).padStart(2, "0")} in workspace ${settings.workspace}.`,
    prompt.title,
    "",
    "Previous attempt summary:",
    previousAttemptSummary,
    "",
    "Protocol Failure:",
    primaryTarget
      ? [
          `Category: ${primaryTarget.category}`,
          `Offending file: ${primaryTarget.file ?? "Not captured"}`,
          primaryTarget.line ? `Line: ${primaryTarget.line}` : null,
          primaryTarget.expectedSyntax ? `Expected syntax: ${primaryTarget.expectedSyntax}` : null,
          primaryTarget.actualSyntax ? `Actual syntax: ${primaryTarget.actualSyntax}` : null,
          `Required correction: ${primaryTarget.strategy}`
        ]
          .filter(Boolean)
          .join("\n")
      : "No protocol failure category was captured.",
    "",
    "All protocol violations:",
    targets.map((target) => `- ${target.category}: ${target.message}`).join("\n") ||
      protocol?.errors.map((error) => `- ${error.message}`).join("\n") ||
      "None.",
    "",
    "Detected duplicate FILE counts:",
    duplicateCounts || "None.",
    "",
    "Verification Output:",
    formatVerificationFailures(results) || "No verifier output.",
    "",
    "Previous response analysis:",
    analysis.duplicateFiles.length > 0
      ? `The following FILE blocks were emitted multiple times: ${analysis.duplicateFiles.join(", ")}. The previous response also included protocol-looking examples in reasoning text. Do not repeat reasoning, examples, or code fences unless they are actual file contents.`
      : "No duplicate FILE blocks detected.",
    "",
    "Relevant file list:",
    targetFiles.map((file) => `- ${file}`).join("\n") ||
      prompt.workspaceOutput?.map((file) => `- ${file}`).join("\n") ||
      "Files from the failed attempt or newly required files.",
    "",
    "Previous LLM response targeted excerpt:",
    targetedExcerpt,
    "",
    "Return instructions:",
    ...(builderProtocol === "FILE_JSON"
      ? [
          "Return only the corrected file(s) listed above.",
          "Do not regenerate unrelated files.",
          "Respond with exactly one JSON object and nothing else, using this Builder Protocol:",
          '{"files":[{"path":"relative/path","content":"complete file contents"}]}',
          "Each path must appear exactly once in the files array."
        ]
      : [
          "Return only the corrected FILE block(s) listed above.",
          "Do not regenerate unrelated files.",
          "Do not include explanations, reasoning, examples, or markdown fences around the response.",
          "Use this exact Builder Protocol:",
          "FILE: relative/path",
          "<complete file contents>"
        ])
  ].join("\n");
}
