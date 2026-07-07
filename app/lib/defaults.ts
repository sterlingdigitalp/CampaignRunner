import path from "node:path";
import type { ExecutionMetrics, ExecutionPolicy, PersistedExecutionState, RunnerHistory, RunnerSettings } from "./types";

export const DEFAULT_PROJECT_ROOT = path.join(process.cwd(), "Project");

export function defaultSettings(projectRoot = DEFAULT_PROJECT_ROOT): RunnerSettings {
  return {
    endpoint: "http://localhost:1234/v1/chat/completions",
    model: "gpt-oss-120b-fable-5-distilled",
    temperature: 0.2,
    maxTokens: 16384,
    requestTimeoutSeconds: 900,
    requestRetries: 2,
    projectRoot,
    workspace: path.join(projectRoot, "workspace"),
    runIntervalMinutes: 60,
    lockTimeoutMinutes: 180,
    paused: false,
    contextTokens: 40000,
    reasoningEffort: "high",
    windowStart: "22:00",
    windowEnd: "06:00"
  };
}

export function defaultHistory(): RunnerHistory {
  return {
    currentStep: 1,
    completedSteps: [],
    deferredSteps: [],
    completedCheckpoints: [],
    startedAt: null,
    updatedAt: null,
    lastRuntimeSeconds: null,
    nextRunAt: null,
    failures: [],
    runs: [],
    executions: []
  };
}

export function defaultExecutionPolicy(): ExecutionPolicy {
  return {
    maxRepairAttempts: 3,
    stopOnFailure: true,
    retryOnTimeout: true,
    acceptOnlyVerified: true,
    builderProtocol: "FILE_JSON",
    deferOnFailure: true,
    maxDeferralRounds: 2,
    enforceDeclaredOutputs: true,
    gitCheckpoints: true,
    speculativeGeneration: true,
    checkpointsEnabled: true,
    verificationPipeline: [
      { name: "Install", enabled: true, command: "npm install --no-audit --no-fund", timeoutSeconds: 600, continueOnFailure: false },
      { name: "Typecheck", enabled: true, command: "npm run typecheck", timeoutSeconds: 120, continueOnFailure: false },
      { name: "Lint", enabled: false, command: "npm run lint", timeoutSeconds: 120, continueOnFailure: true },
      { name: "Build", enabled: true, command: "npm run build", timeoutSeconds: 180, continueOnFailure: false },
      { name: "Tests", enabled: false, command: "npm run test", timeoutSeconds: 180, continueOnFailure: false }
    ]
  };
}

export function defaultExecutionState(): PersistedExecutionState {
  return {
    state: "READY",
    executionId: null,
    hour: null,
    currentVerifier: null,
    repairAttempt: 0,
    currentCommand: null,
    startedAt: null,
    updatedAt: null,
    finalStatus: null,
    lastError: null
  };
}

export function defaultMetrics(): ExecutionMetrics {
  return {
    totalExecutions: 0,
    verifiedExecutions: 0,
    failedExecutions: 0,
    firstPassSuccesses: 0,
    totalRepairAttempts: 0,
    averageRepairAttempts: 0,
    averageRuntimeSeconds: 0,
    averageRepairRuntimeSeconds: 0,
    verificationPasses: 0,
    verificationFailures: 0,
    verificationPipelineRuns: 0,
    verificationPipelineSuccesses: 0,
    verificationPipelineFailures: 0,
    verificationPipelineNoopRuns: 0,
    verificationSummary: {
      configuredVerifiers: 0,
      executedVerifiers: 0,
      skippedVerifiers: 0,
      passedVerifiers: 0,
      failedVerifiers: 0,
      noopPipelineRuns: 0
    },
    individualVerifierPasses: 0,
    individualVerifierFailures: 0,
    repairInvocations: 0,
    repairSuccesses: 0,
    repairFailures: 0,
    protocolFailuresByCategory: [],
    duplicateFileFrequency: 0,
    malformedHeaderFrequency: 0,
    repairSuccessByCategory: [],
    averageRepairDepth: 0,
    averageRepairsBeforeConvergence: 0,
    topRecurringProtocolFailures: [],
    completionMetrics: {
      completedTasks: 0,
      totalTasks: 0,
      remainingTasks: 0,
      completionRate: 0
    },
    metricValidation: {
      status: "PASS",
      diagnostics: []
    },
    mostCommonVerifierFailures: [],
    campaignCompletionRate: 0
  };
}
