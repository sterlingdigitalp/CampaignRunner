import fs from "node:fs/promises";
import path from "node:path";
import { projectPaths } from "./files";
import { loadRuntimeJson } from "./runtime-recovery";

type ArtifactFile = {
  name: string;
  path: string;
  updatedAt: string;
  size: number;
};

async function listFiles(dir: string): Promise<ArtifactFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: ArtifactFile[][] = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const children = await listFiles(fullPath);
        return children;
      }
      const stat = await fs.stat(fullPath);
      return [{ name: entry.name, path: fullPath, updatedAt: stat.mtime.toISOString(), size: stat.size }];
    })
  );

  return files.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadArtifacts(projectRoot: string) {
  const paths = projectPaths(projectRoot);
  const [
    outputs,
    generatedFiles,
    repairFiles,
    runLog,
    summary,
    compilerSummary,
    campaignAst,
    taskGraph,
    compilerReport,
    plannerReport,
    metrics,
    metricsValidation,
    benchmark,
    benchmarkSummary,
    configValidation,
    executionState,
    policy
  ] = await Promise.all([
    listFiles(paths.outputs),
    listFiles(paths.workspace),
    listFiles(paths.repairs),
    fs.readFile(paths.runLog, "utf8").catch(() => ""),
    fs.readFile(paths.summary, "utf8").catch(() => ""),
    fs.readFile(paths.campaignSummary, "utf8").catch(() => ""),
    fs.readFile(paths.campaignAst, "utf8").catch(() => ""),
    fs.readFile(paths.taskGraph, "utf8").catch(() => ""),
    fs.readFile(paths.compilerReport, "utf8").catch(() => ""),
    fs.readFile(paths.plannerReport, "utf8").catch(() => ""),
    fs.readFile(paths.metrics, "utf8").catch(() => ""),
    fs.readFile(paths.metricsValidation, "utf8").catch(() => ""),
    fs.readFile(paths.benchmark, "utf8").catch(() => ""),
    fs.readFile(paths.benchmarkSummary, "utf8").catch(() => ""),
    fs.readFile(paths.configValidation, "utf8").catch(() => ""),
    fs.readFile(paths.executionState, "utf8").catch(() => ""),
    fs.readFile(paths.policy, "utf8").catch(() => "")
  ]);

  const recoveredSummary = summary ? JSON.stringify(await loadRuntimeJson(projectRoot, "campaignSummary"), null, 2) : summary;
  const recoveredMetrics = metrics ? JSON.stringify(await loadRuntimeJson(projectRoot, "metrics"), null, 2) : metrics;
  const recoveredExecutionState = executionState ? JSON.stringify(await loadRuntimeJson(projectRoot, "executionState"), null, 2) : executionState;
  const recoveredPolicy = policy ? JSON.stringify(await loadRuntimeJson(projectRoot, "executionPolicy"), null, 2) : policy;

  return {
    outputs: outputs.slice(0, 200),
    generatedFiles: generatedFiles.slice(0, 200),
    repairFiles: repairFiles.slice(0, 200),
    runLog,
    summary: compilerSummary || recoveredSummary,
    campaignAst,
    taskGraph,
    compilerReport,
    plannerReport,
    metrics: recoveredMetrics,
    metricsValidation,
    benchmark,
    benchmarkSummary,
    configValidation,
    executionState: recoveredExecutionState,
    policy: recoveredPolicy
  };
}
