import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./files";
import { validateFileProtocol } from "./file-protocol-validator";
import { logEvent } from "./logger";
import { categorizeProtocolFailure } from "./repair-engine";
import type { FileProtocolValidationResult } from "./types";

function cleanFinalProtocolSection(response: string) {
  const endThinkIndex = response.lastIndexOf("</think>");
  if (endThinkIndex === -1) return null;
  const candidate = response.slice(endThinkIndex + "</think>".length).trim();
  return candidate.includes("FILE:") ? candidate : null;
}

function tryDeterministicProtocolRepair(response: string, validation: FileProtocolValidationResult): FileProtocolValidationResult | null {
  const unrecoverable = validation.errors.some((error) => error.code !== "DUPLICATE_FILE");
  if (unrecoverable) return null;

  const candidate = cleanFinalProtocolSection(response);
  if (!candidate) return null;

  const repaired = validateFileProtocol(candidate);
  if (!repaired.valid) return null;

  return {
    ...repaired,
    originalErrors: validation.errors,
    repairs: [
      {
        category: "PROTOCOL_DUPLICATE_FILE",
        strategy: "USE_FINAL_PROTOCOL_SECTION_AFTER_THINK_BLOCK",
        message: "Accepted the clean final Builder Protocol section after duplicate FILE blocks were found in model reasoning."
      }
    ]
  };
}

export async function writeCandidateFiles(projectRoot: string, workspace: string, response: string, executionId: string) {
  await ensureDir(workspace);
  const initialValidation = validateFileProtocol(response);
  const validation = initialValidation.valid ? initialValidation : tryDeterministicProtocolRepair(response, initialValidation) ?? initialValidation;
  if (!validation.valid) {
    await fs.writeFile(path.join(workspace, `.campaign_runner_rejected_response_${executionId}.md`), response, "utf8");
    await logEvent(projectRoot, "PROTOCOL_REJECTED", validation.errors.map((error) => error.message).join(" | "));
    return validation;
  }

  for (const file of validation.files) {
    const target = path.join(workspace, file.relativePath);
    await ensureDir(path.dirname(target));
    await fs.writeFile(target, file.content, "utf8");
  }
  for (const normalization of validation.normalizations) {
    await logEvent(projectRoot, "PROTOCOL_PATH_NORMALIZED", `${normalization.input} -> ${normalization.output}`);
  }
  for (const repair of validation.repairs ?? []) {
    await logEvent(projectRoot, "PROTOCOL_DETERMINISTIC_REPAIR", `${repair.category}: ${repair.strategy}. ${repair.message}`);
  }
  for (const error of validation.originalErrors ?? []) {
    await logEvent(projectRoot, "PROTOCOL_REPAIRED", `${categorizeProtocolFailure(error)}: ${error.message}`);
  }
  await fs.writeFile(path.join(workspace, `.campaign_runner_last_response_${executionId}.md`), response, "utf8");
  await logEvent(projectRoot, "FILES_WRITTEN", `Wrote ${validation.files.length} protocol-compliant files.`);
  return validation;
}
