import { executeNextHour } from "./execution-engine";
import type { RunResult } from "./types";

export async function runNextPrompt(projectRoot: string): Promise<RunResult> {
  return executeNextHour(projectRoot);
}
