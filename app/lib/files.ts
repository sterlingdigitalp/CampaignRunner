import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function appendLine(filePath: string, line: string) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

export function projectPaths(projectRoot: string) {
  return {
    root: projectRoot,
    campaign: path.join(projectRoot, "campaign.md"),
    campaignJson: path.join(projectRoot, "campaign.json"),
    summary: path.join(projectRoot, "campaign_summary.json"),
    policy: path.join(projectRoot, "execution_policy.json"),
    executionState: path.join(projectRoot, "execution_state.json"),
    metrics: path.join(projectRoot, "metrics.json"),
    settings: path.join(projectRoot, "settings.json"),
    history: path.join(projectRoot, "history.json"),
    logs: path.join(projectRoot, "logs"),
    runLog: path.join(projectRoot, "logs", "run.log"),
    outputs: path.join(projectRoot, "outputs"),
    workspace: path.join(projectRoot, "workspace"),
    prompts: path.join(projectRoot, "prompts"),
    lock: path.join(projectRoot, ".runner.lock")
  };
}
