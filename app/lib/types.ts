export type CampaignPrompt = {
  number: number;
  title: string;
  taskType?: string;
  dependsOn?: number[];
  objective?: string;
  constraints?: string;
  verificationGoal?: string;
  workspaceOutput?: string[];
  body: string;
  filename: string;
};

export type CampaignMetadata = {
  title: string;
  campaignId?: string;
  version?: string;
  profile?: string;
  executionMode?: string;
  workspace?: string;
  builderProtocol?: string;
  estimatedTasks?: number;
  checkpointInterval?: string;
  successCriteria?: string;
  format: "legacy-hour" | "campaign-spec-v1";
};

export type CampaignCheckpoint = {
  number: number;
  title: string;
  purpose?: string;
  reviewGoals?: string;
  body: string;
};

export type FinalCertification = {
  title: string;
  body: string;
};

export type RunnerSettings = {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutSeconds: number;
  requestRetries: number;
  projectRoot: string;
  workspace: string;
  runIntervalMinutes: number;
  lockTimeoutMinutes: number;
  paused: boolean;
};

export type StepRecord = {
  promptNumber: number;
  title: string;
  startedAt: string;
  completedAt: string;
  runtimeSeconds: number;
  outputFile: string;
  model: string;
  executionId?: string;
  finalStatus?: "VERIFIED" | "FAILED";
  repairCount?: number;
  verificationRuntimeSeconds?: number;
  verifierResults?: VerificationResult[];
};

export type FailureRecord = {
  promptNumber: number;
  timestamp: string;
  message: string;
};

export type RunnerHistory = {
  currentStep: number;
  completedSteps: number[];
  startedAt: string | null;
  updatedAt: string | null;
  lastRuntimeSeconds: number | null;
  nextRunAt: string | null;
  failures: FailureRecord[];
  runs: StepRecord[];
  executions: ExecutionRecord[];
};

export type ExecutionStateName =
  | "READY"
  | "RUNNING"
  | "WRITING_FILES"
  | "VERIFYING"
  | "REPAIRING"
  | "COMPLETE"
  | "FAILED"
  | "PAUSED"
  | "RECOVERING";

export type VerificationStep = {
  name: string;
  enabled: boolean;
  command: string;
  timeoutSeconds: number;
  continueOnFailure: boolean;
};

export type ExecutionPolicy = {
  maxRepairAttempts: number;
  stopOnFailure: boolean;
  retryOnTimeout: boolean;
  acceptOnlyVerified: boolean;
  verificationPipeline: VerificationStep[];
};

export type CampaignProfileName = "Generic" | "TypeScript" | "Python" | "Markdown" | "Research";

export type CampaignProfile = {
  name: CampaignProfileName;
  builderProtocol: "FILE_BLOCKS";
  verificationPipeline: VerificationStep[];
  workspaceExpectations: string[];
};

export type ExecutionContract = {
  builderProtocol: "FILE_BLOCKS";
  verifierPipeline: VerificationStep[];
  acceptancePolicy: {
    acceptOnlyVerified: boolean;
  };
  repairPolicy: {
    maxRepairAttempts: number;
  };
  workspacePolicy: {
    maturity: "EMPTY" | "EXISTING" | "EARLY_STAGE" | "MATURE";
  };
};

export type VerificationResult = {
  verifier: string;
  status: "PASS" | "FAIL" | "SKIP";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  runtimeSeconds: number;
  timedOut: boolean;
};

export type FileProtocolFile = {
  relativePath: string;
  originalPath: string;
  content: string;
};

export type FileProtocolValidationResult = {
  valid: boolean;
  files: FileProtocolFile[];
  errors: Array<{
    code: "NO_FILE_BLOCKS" | "MALFORMED_HEADER" | "DUPLICATE_FILE" | "EMPTY_FILE" | "UNSAFE_PATH";
    message: string;
    file?: string;
  }>;
  normalizations: Array<{ input: string; output: string }>;
};

export type ExecutionRecord = {
  executionId: string;
  hour: number;
  attempt: number;
  verifierResults: VerificationResult[];
  repairCount: number;
  finalStatus: "VERIFIED" | "FAILED";
  runtimeSeconds: number;
  verificationRuntimeSeconds: number;
  outputFile?: string;
  failureReason?: string;
};

export type PersistedExecutionState = {
  state: ExecutionStateName;
  executionId: string | null;
  hour: number | null;
  currentVerifier: string | null;
  repairAttempt: number;
  currentCommand: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  finalStatus: string | null;
  lastError: string | null;
};

export type ExecutionMetrics = {
  totalExecutions: number;
  verifiedExecutions: number;
  failedExecutions: number;
  firstPassSuccesses: number;
  totalRepairAttempts: number;
  averageRepairAttempts: number;
  averageRuntimeSeconds: number;
  averageRepairRuntimeSeconds: number;
  verificationPasses: number;
  verificationFailures: number;
  verificationPipelineRuns: number;
  verificationPipelineSuccesses: number;
  verificationPipelineFailures: number;
  individualVerifierPasses: number;
  individualVerifierFailures: number;
  repairInvocations: number;
  repairSuccesses: number;
  repairFailures: number;
  mostCommonVerifierFailures: Array<{ verifier: string; count: number }>;
  campaignCompletionRate: number;
};

export type HistoryRecovery = {
  mode: boolean;
  message: string | null;
  corruptFile?: string;
  restoredFromBackup?: boolean;
};

export type CampaignValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    promptCount: number;
    taskCount: number;
    taskNumbers: number[];
    missingTasks: number[];
    duplicateTasks: number[];
    checkpointCount: number;
    profile?: string;
    workspace?: string;
    builderProtocol?: string;
    averageWords: number;
    longestPromptNumber: number | null;
    longestPromptWords: number;
  };
};

export type LockStatus = {
  exists: boolean;
  stale: boolean;
  pid?: number;
  timestamp?: string;
  campaignName?: string;
  currentStep?: number;
  ageSeconds?: number;
  ownerAlive?: boolean;
};

export type ProjectSummary = {
  campaignTitle: string;
  campaignMetadata: CampaignMetadata;
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
  projectRoot: string;
  settings: RunnerSettings;
  history: RunnerHistory;
  prompts: CampaignPrompt[];
  recovery: HistoryRecovery;
  lockStatus: LockStatus;
  notifications: string[];
};

export type RunResult = {
  ok: boolean;
  message: string;
  outputFile?: string;
  history?: RunnerHistory;
};
