import path from "node:path";
import type { FileProtocolFile, FileProtocolValidationResult, TaskReport } from "./types";

const REPORT_STATUSES: TaskReport["status"][] = ["complete", "partial", "blocked"];
const MAX_REPORT_NOTE_CHARS = 600;

function sanitizeReport(value: unknown): TaskReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as { status?: unknown; notes?: unknown; blockers?: unknown; followUps?: unknown };
  const strings = (input: unknown) =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, MAX_REPORT_NOTE_CHARS)).slice(0, 8) : [];
  return {
    status: REPORT_STATUSES.includes(raw.status as TaskReport["status"]) ? (raw.status as TaskReport["status"]) : "complete",
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, MAX_REPORT_NOTE_CHARS) : "",
    blockers: strings(raw.blockers),
    followUps: strings(raw.followUps)
  };
}

export function normalizeProtocolPath(value: string) {
  const input = value.trim().replace(/^["']|["']$/g, "");
  if (!input) return { input, output: "", error: "Unsafe or empty file path." };
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("/") || input.startsWith("\\")) {
    return { input, output: "", error: "Absolute paths are not allowed." };
  }

  let normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  normalized = normalized.replace(/^\.\/workspace\//i, "");
  normalized = normalized.replace(/^workspace\//i, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = path.posix.normalize(normalized);

  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return { input, output: normalized, error: "Path traversal is not allowed." };
  }
  if (normalized.split("/").some((segment) => !segment || segment === "." || /[\0<>:"|?*]/.test(segment))) {
    return { input, output: normalized, error: "Path contains an invalid filename segment." };
  }
  return { input, output: normalized, error: null };
}

export function validateFileProtocol(response: string): FileProtocolValidationResult {
  const errors: FileProtocolValidationResult["errors"] = [];
  const files: FileProtocolFile[] = [];
  const normalizations: FileProtocolValidationResult["normalizations"] = [];
  const lines = response.replace(/\r\n/g, "\n").split("\n");
  const fileHeaderIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("FILE:") || /^FILE\b/i.test(line));

  if (fileHeaderIndexes.length === 0) {
    return {
      valid: false,
      files,
      normalizations,
      errors: [{ code: "NO_FILE_BLOCKS", message: "Model response did not include any FILE: relative/path blocks." }]
    };
  }

  for (let headerIndex = 0; headerIndex < fileHeaderIndexes.length; headerIndex += 1) {
    const current = fileHeaderIndexes[headerIndex];
    const next = fileHeaderIndexes[headerIndex + 1];
    const match = /^FILE:\s*(.+)$/.exec(current.line);
    if (!match) {
      errors.push({
        code: "MALFORMED_HEADER",
        message: `Malformed FILE header on line ${current.index + 1}.`,
        line: current.index + 1,
        expectedSyntax: "FILE: relative/path",
        actualSyntax: current.line
      });
      continue;
    }
    const normalized = normalizeProtocolPath(match[1]);
    if (normalized.error) {
      errors.push({ code: "UNSAFE_PATH", message: `${normalized.error} Line ${current.index + 1}.`, file: normalized.input });
      continue;
    }
    if (normalized.input !== normalized.output) normalizations.push({ input: normalized.input, output: normalized.output });
    const relativePath = normalized.output;
    const content = lines.slice(current.index + 1, next?.index ?? lines.length).join("\n").replace(/\n+$/, "");
    if (!content.trim()) {
      errors.push({ code: "EMPTY_FILE", message: `${relativePath} is empty.`, file: relativePath });
    }
    files.push({ relativePath, originalPath: normalized.input, content });
  }

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.relativePath)) {
      errors.push({ code: "DUPLICATE_FILE", message: `${file.relativePath} appears more than once.`, file: file.relativePath });
    }
    seen.add(file.relativePath);
  }

  return { valid: errors.length === 0, files, errors, normalizations };
}

/**
 * Local models sometimes double-escape newlines inside JSON string values
 * ("\\n" instead of "\n"), yielding parsed content with literal backslash-n
 * text and no real line breaks. Detect that shape and unescape exactly once.
 * A genuinely single-line file with escape sequences in string literals is
 * left alone because real multi-line files always contain real newlines.
 */
function unescapeDoubleEscapedContent(content: string) {
  const realNewlines = (content.match(/\n/g) ?? []).length;
  const literalNewlines = (content.match(/\\+n/g) ?? []).length;
  if (literalNewlines < 3 || literalNewlines <= realNewlines * 3) return { content, repaired: false };
  const repaired = content
    .replace(/\\+r\\+n/g, "\n")
    .replace(/\\+n/g, "\n")
    .replace(/\\+t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\+\s*$/, "");
  return { content: repaired, repaired: true };
}

function extractJsonObject(response: string) {
  const trimmed = response.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  for (const candidate of [trimmed, unfenced]) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

export function validateJsonFileProtocol(response: string): FileProtocolValidationResult {
  const parsed = extractJsonObject(response);
  const entries = parsed && typeof parsed === "object" && Array.isArray((parsed as { files?: unknown }).files) ? ((parsed as { files: unknown[] }).files) : null;
  const report = parsed && typeof parsed === "object" ? sanitizeReport((parsed as { report?: unknown }).report) : undefined;

  if (!entries) {
    const fallback = validateFileProtocol(response);
    if (fallback.valid || fallback.files.length > 0) {
      return {
        ...fallback,
        originalErrors: [{ code: "INVALID_JSON", message: "Response was not the required JSON object; recovered files from FILE: blocks instead." }],
        repairs: [
          {
            category: "PROTOCOL_INVALID_JSON",
            strategy: "PARSE_FILE_BLOCKS_FALLBACK",
            message: "JSON protocol response could not be parsed; deterministic FILE: block parsing recovered the candidate files."
          }
        ]
      };
    }
    return {
      valid: false,
      files: [],
      normalizations: [],
      errors: [
        {
          code: "INVALID_JSON",
          message: 'Model response was not a JSON object matching {"files":[{"path","content"}]} and contained no FILE: blocks.'
        }
      ]
    };
  }

  const errors: FileProtocolValidationResult["errors"] = [];
  const files: FileProtocolFile[] = [];
  const normalizations: FileProtocolValidationResult["normalizations"] = [];
  const repairs: NonNullable<FileProtocolValidationResult["repairs"]> = [];

  if (entries.length === 0) {
    errors.push({ code: "NO_FILE_BLOCKS", message: "JSON response contained an empty files array." });
  }

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push({ code: "MALFORMED_HEADER", message: `files[${index}] is not an object with path and content.` });
      return;
    }
    const { path: rawPath, content } = entry as { path?: unknown; content?: unknown };
    if (typeof rawPath !== "string" || typeof content !== "string") {
      errors.push({ code: "MALFORMED_HEADER", message: `files[${index}] must have string path and string content.` });
      return;
    }
    const normalized = normalizeProtocolPath(rawPath);
    if (normalized.error) {
      errors.push({ code: "UNSAFE_PATH", message: `${normalized.error} files[${index}].`, file: normalized.input });
      return;
    }
    if (normalized.input !== normalized.output) normalizations.push({ input: normalized.input, output: normalized.output });
    const unescaped = unescapeDoubleEscapedContent(content);
    if (unescaped.repaired) {
      repairs.push({
        category: "PROTOCOL_INVALID_JSON",
        strategy: "UNESCAPE_DOUBLE_ESCAPED_CONTENT",
        message: `${normalized.output} contained double-escaped newlines; unescaped deterministically.`
      });
    }
    if (!unescaped.content.trim()) {
      errors.push({ code: "EMPTY_FILE", message: `${normalized.output} is empty.`, file: normalized.output });
    }
    files.push({ relativePath: normalized.output, originalPath: normalized.input, content: unescaped.content.replace(/\n+$/, "") });
  });

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.relativePath)) {
      errors.push({ code: "DUPLICATE_FILE", message: `${file.relativePath} appears more than once.`, file: file.relativePath });
    }
    seen.add(file.relativePath);
  }

  return { valid: errors.length === 0, files, errors, normalizations, ...(repairs.length > 0 ? { repairs } : {}), ...(report ? { report } : {}) };
}
