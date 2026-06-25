export type CampaignPrompt = {
  number: number;
  title: string;
  milestone?: string;
  lineNumber?: number;
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

export type PlannerProfile = "Documentation" | "Software" | "Research" | "Generic";

export type CampaignBrief = {
  projectName: string;
  projectType: PlannerProfile;
  workspace: string;
  builderProfile: string;
  targetModel: string;
  estimatedTaskSize: "Small" | "Medium" | "Large";
  brief: string;
};

export type CampaignPlanResult = {
  campaignText: string;
  validation: CampaignValidation;
  metadata: CampaignMetadata;
  milestones?: CampaignMilestone[];
  tasks: CampaignPrompt[];
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
  plannerReport?: PlannerReport;
  warnings: string[];
};

export type PlanningState = "PLANNING" | "COMPILING" | "PLANNER_REPAIR" | "VALIDATED" | "READY" | "PLANNER_FAILED";

export type PlannerRepairRecord = {
  attempt: number;
  action: string;
  diagnosticsResolved: string[];
};

export type PlannerReport = {
  originalBrief: string;
  planningDurationMs: number;
  compilerAttempts: number;
  repairAttempts: number;
  diagnosticsProduced: CompilerDiagnostic[];
  diagnosticsResolved: string[];
  finalCompileStatus: "PASS" | "FAIL";
  plannerConfidence: number;
  states: PlanningState[];
  repairs: PlannerRepairRecord[];
  finalCampaignStatistics: {
    taskCount: number;
    milestoneCount: number;
    checkpointCount: number;
    duplicateTasks: number[];
    missingTasks: number[];
  };
  ready: boolean;
};

export type CampaignMilestone = {
  id: string;
  title: string;
  lineNumber: number;
  body?: string;
  taskNumbers: number[];
};

export type CampaignCheckpoint = {
  number: number;
  title: string;
  lineNumber?: number;
  purpose?: string;
  reviewGoals?: string;
  body: string;
};

export type FinalCertification = {
  title: string;
  lineNumber?: number;
  body: string;
};

export type CompilerDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  lineNumber?: number;
  firstLineNumber?: number;
  secondLineNumber?: number;
  expected?: string;
  actual?: string;
  cause?: string;
  suggestion?: string;
};

export type CampaignAst = {
  kind: "Campaign";
  title: string;
  metadata: CampaignMetadata;
  milestones: Array<CampaignMilestone & { kind: "Milestone" }>;
  tasks: Array<CampaignPrompt & { kind: "Task"; rawHeading: string }>;
  checkpoints: Array<CampaignCheckpoint & { kind: "Checkpoint"; rawHeading: string }>;
  finalCertification: (FinalCertification & { kind: "FinalCertification"; rawHeading: string }) | null;
  summary: { kind: "Summary"; title: string; lineNumber: number; body: string } | null;
  body: string;
};

export type TaskGraphNode = {
  taskNumber: number;
  title: string;
  milestone?: string;
  dependsOn: number[];
  dependents: number[];
  lineNumber?: number;
};

export type TaskGraph = {
  nodes: TaskGraphNode[];
  edges: Array<{ from: number; to: number }>;
};

export type CompilerReport = {
  format: CampaignMetadata["format"];
  status: "PASS" | "FAIL";
  pipelineSummary: {
    lexerTaskTokens: number;
    astTaskNodes: number;
    campaignExecutableTasks: number;
    validatorTaskCount: number;
    rendererTaskCards: number;
    duplicateIntroducedAt: "none" | "lexer" | "ast" | "campaignModel" | "validator" | "renderer";
  };
  stages: {
    lexer: {
      timingMs: number;
      taskHeadingsFound: number;
      milestoneHeadingsFound: number;
      checkpointHeadingsFound: number;
      metadataDiscovered: string[];
      diagnostics: CompilerDiagnostic[];
    };
    ast: {
      timingMs: number;
      taskNodeCount: number;
      milestoneNodeCount: number;
      checkpointNodeCount: number;
      summaryNodeCount: number;
      diagnostics: CompilerDiagnostic[];
    };
    campaignModel: {
      timingMs: number;
      executableTaskCount: number;
      dependencyCount: number;
      workspaceOutputs: number;
      taskTypes: string[];
      diagnostics: CompilerDiagnostic[];
    };
    validator: {
      timingMs: number;
      taskCount: number;
      duplicateTasks: number[];
      missingTasks: number[];
      invalidDependencies: Array<{ taskNumber: number; dependency: number }>;
      malformedMetadata: string[];
      diagnostics: CompilerDiagnostic[];
    };
    renderer: {
      timingMs: number;
      renderedTaskCards: number;
      renderedMilestones: number;
      renderedCheckpoints: number;
      diagnostics: CompilerDiagnostic[];
    };
  };
  taskCount: number;
  taskNumbers: number[];
  missingTasks: number[];
  duplicateTasks: number[];
  checkpointCount: number;
  milestoneCount: number;
  profile?: string;
  workspace?: string;
  builderProtocol?: string;
  diagnostics: CompilerDiagnostic[];
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

export type CampaignProfileName = "Generic" | "TypeScript" | "Python" | "Markdown" | "Research" | "Documentation";

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

export type FileProtocolErrorCode = "NO_FILE_BLOCKS" | "MALFORMED_HEADER" | "DUPLICATE_FILE" | "EMPTY_FILE" | "UNSAFE_PATH";

export type ProtocolFailureCategory =
  | "PROTOCOL_DUPLICATE_FILE"
  | "PROTOCOL_DUPLICATE_PATH"
  | "PROTOCOL_MALFORMED_HEADER"
  | "PROTOCOL_MISSING_FILE"
  | "PROTOCOL_INVALID_PATH"
  | "PROTOCOL_EMPTY_OUTPUT"
  | "PROTOCOL_UNSAFE_PATH";

export type FileProtocolValidationError = {
  code: FileProtocolErrorCode;
  message: string;
  file?: string;
  line?: number;
  expectedSyntax?: string;
  actualSyntax?: string;
};

export type FileProtocolRepairRecord = {
  category: ProtocolFailureCategory;
  strategy: string;
  message: string;
};

export type FileProtocolValidationResult = {
  valid: boolean;
  files: FileProtocolFile[];
  errors: FileProtocolValidationError[];
  normalizations: Array<{ input: string; output: string }>;
  originalErrors?: FileProtocolValidationError[];
  repairs?: FileProtocolRepairRecord[];
};

export type ProtocolFailureRecord = {
  category: ProtocolFailureCategory;
  code: FileProtocolErrorCode;
  message: string;
  file?: string;
  attempt: number;
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
  protocolFailures?: ProtocolFailureRecord[];
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
  verificationPipelineNoopRuns: number;
  individualVerifierPasses: number;
  individualVerifierFailures: number;
  repairInvocations: number;
  repairSuccesses: number;
  repairFailures: number;
  protocolFailuresByCategory: Array<{ category: ProtocolFailureCategory; count: number }>;
  duplicateFileFrequency: number;
  malformedHeaderFrequency: number;
  repairSuccessByCategory: Array<{ category: ProtocolFailureCategory; successes: number; failures: number }>;
  averageRepairDepth: number;
  averageRepairsBeforeConvergence: number;
  topRecurringProtocolFailures: Array<{ category: ProtocolFailureCategory; file?: string; count: number }>;
  completionMetrics: {
    completedTasks: number;
    totalTasks: number;
    remainingTasks: number;
    completionRate: number;
  };
  metricValidation: {
    status: "PASS" | "WARNING" | "FAIL";
    diagnostics: Array<{ severity: "WARNING" | "FAIL"; code: string; message: string }>;
  };
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
  milestones?: CampaignMilestone[];
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
  projectRoot: string;
  settings: RunnerSettings;
  history: RunnerHistory;
  prompts: CampaignPrompt[];
  recovery: HistoryRecovery;
  lockStatus: LockStatus;
  notifications: string[];
  runtimeDashboard: {
    currentTask: number | null;
    currentTaskLabel: string;
    currentMilestone: string;
    completed: number;
    remaining: number;
    taskCount: number;
    progress: number;
    currentPrompt: CampaignPrompt | null;
  };
};

export type RunResult = {
  ok: boolean;
  message: string;
  outputFile?: string;
  history?: RunnerHistory;
};
