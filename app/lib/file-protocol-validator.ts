import path from "node:path";
import type { FileProtocolFile, FileProtocolValidationResult } from "./types";

function normalizeProtocolPath(value: string) {
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
