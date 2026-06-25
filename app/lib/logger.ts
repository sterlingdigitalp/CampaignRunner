import { appendLine, projectPaths } from "./files";

export async function logEvent(projectRoot: string, event: string, message: string) {
  await appendLine(projectPaths(projectRoot).runLog, `[${new Date().toISOString()}] ${event}: ${message}`);
}
