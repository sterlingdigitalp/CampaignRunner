import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./files";
import { validateFileProtocol } from "./file-protocol-validator";
import { logEvent } from "./logger";

export async function writeCandidateFiles(projectRoot: string, workspace: string, response: string, executionId: string) {
  await ensureDir(workspace);
  const validation = validateFileProtocol(response);
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
  await fs.writeFile(path.join(workspace, `.campaign_runner_last_response_${executionId}.md`), response, "utf8");
  await logEvent(projectRoot, "FILES_WRITTEN", `Wrote ${validation.files.length} protocol-compliant files.`);
  return validation;
}
