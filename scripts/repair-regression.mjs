import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const outDir = path.join(os.tmpdir(), "campaign-runner-repair-regression");

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const compile = spawnSync(
  path.join(repoRoot, "node_modules/.bin/tsc"),
  [
    "--outDir",
    outDir,
    "--rootDir",
    repoRoot,
    "--module",
    "commonjs",
    "--target",
    "ES2020",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--resolveJsonModule",
    "--skipLibCheck",
    "--noEmit",
    "false",
    path.join(repoRoot, "app/lib/file-protocol-validator.ts"),
    path.join(repoRoot, "app/lib/workspace-writer.ts"),
    path.join(repoRoot, "app/lib/repair-engine.ts"),
    path.join(repoRoot, "app/lib/repair-artifacts.ts"),
    path.join(repoRoot, "app/lib/metrics.ts"),
    path.join(repoRoot, "app/lib/config-validation.ts"),
    path.join(repoRoot, "app/lib/benchmark-artifacts.ts")
  ],
  { cwd: repoRoot, encoding: "utf8" }
);

if (compile.status !== 0) {
  process.stderr.write(compile.stdout);
  process.stderr.write(compile.stderr);
  process.exit(compile.status ?? 1);
}

const { validateFileProtocol } = await import(pathToFileURL(path.join(outDir, "app/lib/file-protocol-validator.js")));
const { buildRepairPrompt } = await import(pathToFileURL(path.join(outDir, "app/lib/repair-engine.js")));
const { writeCandidateFiles } = await import(pathToFileURL(path.join(outDir, "app/lib/workspace-writer.js")));
const { persistRepairSeed, persistRepairAttempt, finalizeRepairSession } = await import(pathToFileURL(path.join(outDir, "app/lib/repair-artifacts.js")));
const { updateMetrics } = await import(pathToFileURL(path.join(outDir, "app/lib/metrics.js")));
const { validateExecutionConfig } = await import(pathToFileURL(path.join(outDir, "app/lib/config-validation.js")));
const { writeBenchmarkArtifacts } = await import(pathToFileURL(path.join(outDir, "app/lib/benchmark-artifacts.js")));

const prompt = {
  number: 40,
  title: "Close the exit gate",
  workspaceOutput: ["knowledge_service/docs/README.md"],
  body: "TASK 040 - Close the exit gate",
  filename: "040_close_the_exit_gate.md"
};
const settings = {
  projectRoot: "/tmp/project",
  workspace: "/tmp/project/workspace",
  model: "test",
  temperature: 0,
  runIntervalMinutes: 1,
  paused: false
};

function noVerifierFailures() {
  return [];
}

const duplicateFromReasoning = `<think>
I should return:
FILE: knowledge_service/docs/README.md
# Knowledge Service Documentation
</think>

FILE: knowledge_service/docs/README.md
# Knowledge Service Documentation

## Project Status: Phase 0 Complete

The architecture is internally consistent and Phase 1 implementation may begin.
`;

const duplicateValidation = validateFileProtocol(duplicateFromReasoning);
assert.equal(duplicateValidation.valid, false, "old validator rejects duplicate FILE blocks");
assert.equal(duplicateValidation.errors[0].code, "DUPLICATE_FILE");

const repairPrompt = buildRepairPrompt(prompt, settings, noVerifierFailures(), duplicateValidation, "Protocol rejected.", duplicateFromReasoning);
assert.match(repairPrompt, /TARGETED_PROTOCOL_REPAIR/);
assert.match(repairPrompt, /Category: PROTOCOL_DUPLICATE_FILE/);
assert.match(repairPrompt, /Return only the corrected FILE block/);
assert.match(repairPrompt, /Do not regenerate unrelated files/);

const projectRoot = path.join(outDir, "project");
const workspace = path.join(projectRoot, "workspace");
const repairedWrite = await writeCandidateFiles(projectRoot, workspace, duplicateFromReasoning, "task-40-duplicate");
assert.equal(repairedWrite.valid, true, "new writer accepts clean final Builder Protocol section");
assert.equal(repairedWrite.files.length, 1);
assert.equal(repairedWrite.files[0].relativePath, "knowledge_service/docs/README.md");
assert.equal(repairedWrite.originalErrors?.[0]?.code, "DUPLICATE_FILE");

await persistRepairSeed({
  projectRoot,
  prompt,
  originalPrompt: "ORIGINAL TASK PROMPT",
  originalResponse: duplicateFromReasoning,
  validation: duplicateValidation,
  executionId: "task-40-duplicate"
});
await persistRepairAttempt({
  projectRoot,
  prompt,
  executionId: "task-40-duplicate",
  repairAttemptNumber: 1,
  originalTaskPrompt: "ORIGINAL TASK PROMPT",
  originalResponse: duplicateFromReasoning,
  originalValidation: duplicateValidation,
  repairPrompt,
  repairResponse: duplicateFromReasoning,
  repairValidation: repairedWrite,
  durationSeconds: 1.25,
  finalOutcome: "REPAIRED"
});
await finalizeRepairSession({
  projectRoot,
  prompt,
  finalOutcome: "REPAIRED",
  finalResolution: "Regression repair accepted."
});
assert.equal(await fs.readFile(path.join(projectRoot, "repairs/task040/attempt1/repair_prompt.md"), "utf8"), repairPrompt);
assert.match(await fs.readFile(path.join(projectRoot, "repairs/task040/summary.json"), "utf8"), /Regression repair accepted/);

const malformed = "FILE knowledge_service/docs/README.md\n# Missing colon";
const malformedValidation = validateFileProtocol(malformed);
assert.equal(malformedValidation.valid, false);
assert.equal(malformedValidation.errors[0].code, "MALFORMED_HEADER");
assert.match(buildRepairPrompt(prompt, settings, noVerifierFailures(), malformedValidation, "Protocol rejected.", malformed), /PROTOCOL_MALFORMED_HEADER/);
assert.match(buildRepairPrompt(prompt, settings, noVerifierFailures(), malformedValidation, "Protocol rejected.", malformed), /Expected syntax: FILE: relative\/path/);

const duplicatePath = "FILE: ./knowledge_service/docs/README.md\n# One\n\nFILE: knowledge_service/docs/README.md\n# One";
const duplicatePathValidation = validateFileProtocol(duplicatePath);
assert.equal(duplicatePathValidation.valid, false);
assert.equal(duplicatePathValidation.errors[0].code, "DUPLICATE_FILE");
assert.match(buildRepairPrompt(prompt, settings, noVerifierFailures(), duplicatePathValidation, "Protocol rejected.", duplicatePath), /PROTOCOL_DUPLICATE_FILE/);

const missing = "No file block here.";
const missingValidation = validateFileProtocol(missing);
assert.equal(missingValidation.valid, false);
assert.equal(missingValidation.errors[0].code, "NO_FILE_BLOCKS");
assert.match(buildRepairPrompt(prompt, settings, noVerifierFailures(), missingValidation, "Protocol rejected.", missing), /PROTOCOL_MISSING_FILE/);

const history = {
  currentStep: 41,
  completedSteps: Array.from({ length: 40 }, (_, index) => index + 1),
  startedAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:10:00.000Z",
  lastRuntimeSeconds: 60,
  nextRunAt: null,
  failures: [],
  runs: [],
  executions: [
    {
      executionId: "task-40-duplicate",
      hour: 40,
      attempt: 1,
      verifierResults: [
        { verifier: "Typecheck", status: "SKIP", command: "npm run typecheck", stdout: "", stderr: "", exitCode: null, runtimeSeconds: 0, timedOut: false }
      ],
      repairCount: 0,
      finalStatus: "VERIFIED",
      runtimeSeconds: 10,
      verificationRuntimeSeconds: 0,
      protocolFailures: [{ category: "PROTOCOL_DUPLICATE_FILE", code: "DUPLICATE_FILE", message: "duplicate", file: "knowledge_service/docs/README.md", attempt: 1 }]
    }
  ]
};
const metrics = await updateMetrics(projectRoot, history, 40);
assert.equal(metrics.campaignCompletionRate, 1);
assert.equal(metrics.verificationPipelineRuns, 1);
assert.equal(metrics.verificationPipelineNoopRuns, 1);
assert.equal(metrics.verificationPipelineSuccesses, 0);
assert.equal(metrics.metricValidation.status, "PASS");
assert.equal(JSON.parse(await fs.readFile(path.join(projectRoot, "metricsValidation.json"), "utf8")).status, "PASS");

const configReport = await validateExecutionConfig({
  projectRoot,
  settings: { ...settings, requestTimeoutSeconds: 1, requestRetries: 0, maxTokens: 100, endpoint: "http://localhost", lockTimeoutMinutes: 1 },
  policy: { maxRepairAttempts: 3, stopOnFailure: true, retryOnTimeout: true, acceptOnlyVerified: true, verificationPipeline: [] },
  contract: {
    builderProtocol: "FILE_BLOCKS",
    verifierPipeline: [],
    acceptancePolicy: { acceptOnlyVerified: true },
    repairPolicy: { maxRepairAttempts: 3 },
    workspacePolicy: { maturity: "EMPTY" }
  },
  metadata: { title: "Regression Campaign", profile: "Documentation", version: "1.0" }
});
assert.equal(configReport.status, "WARNING");
assert.match(JSON.stringify(configReport), /ACCEPT_ONLY_VERIFIED_WITH_NO_ENABLED_VERIFIERS/);

await writeBenchmarkArtifacts({
  projectRoot,
  metrics,
  result: { ok: true, message: "Regression complete.", history },
  project: {
    campaignTitle: "Regression Campaign",
    campaignMetadata: { title: "Regression Campaign", campaignId: "regression", version: "1.0", profile: "Documentation" },
    checkpoints: [],
    finalCertification: null,
    projectRoot,
    settings: { ...settings, requestTimeoutSeconds: 1, requestRetries: 0, maxTokens: 100, endpoint: "http://localhost", lockTimeoutMinutes: 1 },
    history,
    prompts: Array.from({ length: 40 }, (_, index) => ({ ...prompt, number: index + 1 })),
    recovery: { mode: false, message: null },
    lockStatus: { exists: false, stale: false },
    notifications: [],
    runtimeDashboard: {
      currentTask: null,
      currentTaskLabel: "Complete",
      currentMilestone: "None",
      completed: 40,
      remaining: 0,
      taskCount: 40,
      progress: 100,
      currentPrompt: null
    }
  }
});
assert.match(await fs.readFile(path.join(projectRoot, "benchmark.json"), "utf8"), /repairEngineVersion/);
assert.match(await fs.readFile(path.join(projectRoot, "benchmarkSummary.json"), "utf8"), /completionPercent/);

console.log("repair regression: PASS");
console.log("duplicate FILE repair: PASS");
console.log("malformed FILE repair: PASS");
console.log("duplicate path repair: PASS");
console.log("missing FILE repair: PASS");
console.log("repair artifacts: PASS");
console.log("telemetry calculations: PASS");
console.log("configuration validation: PASS");
console.log("benchmark metadata: PASS");
