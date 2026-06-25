"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FolderOpen, Pause, Play, RotateCw, Save, Settings, TerminalSquare, TimerReset } from "lucide-react";
import { validateCampaignPrompts } from "./lib/campaign-validation";
import { parseCampaign } from "./lib/parser";
import type { CampaignCheckpoint, CampaignMetadata, CampaignPrompt, CampaignValidation, ExecutionPolicy, PersistedExecutionState, ProjectSummary, RunnerHistory, RunnerSettings } from "./lib/types";

type Screen = "create" | "review" | "settings" | "dashboard" | "artifacts";
type ArtifactFile = { name: string; path: string; updatedAt: string; size: number };
type Artifacts = { outputs: ArtifactFile[]; generatedFiles: ArtifactFile[]; runLog: string; summary: string; metrics: string; executionState: string; policy: string };
type RuntimePreview = { systemPrompt: string; campaignHeader: string; hourPrompt: string; runtimePrompt: string; estimatedTokens: number; repairPrompt: string };
type StatusPanel = {
  workspace: string;
  history: string;
  settings: string;
  logs: string;
  lockStatus: { exists: boolean; stale: boolean; ownerAlive?: boolean; ageSeconds?: number };
  executionState: PersistedExecutionState;
  policy: ExecutionPolicy;
  schedulerStatus: string;
  lmStudioStatus: string;
};

const defaultProjectRoot = "/Users/sterlingdigital/CampaignRunner/Project";

async function postJson<T>(url: string, data: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Request failed.");
  }
  return payload as T;
}

function fieldClass() {
  return "w-full rounded border border-line bg-white px-3 py-2 text-sm outline-none focus:border-action";
}

function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const classes =
    variant === "primary"
      ? "border-action bg-action text-white hover:bg-[#285f62]"
      : "border-line bg-white text-ink hover:bg-panel";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center gap-2 rounded border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
    >
      {children}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-line bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("create");
  const [campaignText, setCampaignText] = useState("");
  const [projectRoot, setProjectRoot] = useState(defaultProjectRoot);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewMetadata, setReviewMetadata] = useState<CampaignMetadata | null>(null);
  const [reviewCheckpoints, setReviewCheckpoints] = useState<CampaignCheckpoint[]>([]);
  const [reviewPrompts, setReviewPrompts] = useState<CampaignPrompt[]>([]);
  const [campaignValidation, setCampaignValidation] = useState<CampaignValidation | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<RunnerSettings | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ExecutionPolicy | null>(null);
  const [artifacts, setArtifacts] = useState<Artifacts | null>(null);
  const [runtimePreview, setRuntimePreview] = useState<RuntimePreview | null>(null);
  const [statusPanel, setStatusPanel] = useState<StatusPanel | null>(null);
  const [message, setMessage] = useState("Paste a campaign specification to begin.");
  const [busy, setBusy] = useState(false);

  const completedCount = project?.history.completedSteps.length ?? 0;
  const totalTasks = project?.prompts.length ?? reviewPrompts.length;
  const progress = Math.round((completedCount / Math.max(1, totalTasks)) * 100);
  const currentPrompt = project?.prompts.find((prompt) => prompt.number === project.history.currentStep);

  const loadProject = useCallback(
    async (root = projectRoot) => {
      const loaded = await postJson<ProjectSummary>("/api/campaign/load", { projectRoot: root });
      setProject(loaded);
      setSettingsDraft(loaded.settings);
      if (loaded.recovery.message) setMessage(loaded.recovery.message);
      if (loaded.notifications.length > 0) setMessage(loaded.notifications.join(" "));
      localStorage.setItem("campaignRunner.projectRoot", root);
      return loaded;
    },
    [projectRoot]
  );

  const loadArtifacts = useCallback(async () => {
    if (!projectRoot) return;
    const loaded = await postJson<Artifacts>("/api/artifacts", { projectRoot });
    setArtifacts(loaded);
  }, [projectRoot]);

  const loadStatus = useCallback(async (root = projectRoot) => {
    if (!root) return;
    const loaded = await postJson<StatusPanel>("/api/status", { projectRoot: root });
    setStatusPanel(loaded);
    setPolicyDraft(loaded.policy);
  }, [projectRoot]);

  useEffect(() => {
    const stored = localStorage.getItem("campaignRunner.projectRoot");
    if (stored) {
      setProjectRoot(stored);
      loadProject(stored)
        .then(() => setScreen("dashboard"))
        .catch(() => undefined);
    }
  }, [loadProject]);

  useEffect(() => {
    if (screen === "artifacts") {
      loadArtifacts().catch((error) => setMessage(error.message));
    }
    if (screen === "dashboard") {
      loadStatus(project?.projectRoot ?? projectRoot).catch(() => undefined);
    }
    if (screen === "settings") {
      loadStatus(project?.projectRoot ?? projectRoot).catch(() => undefined);
    }
  }, [screen, loadArtifacts, loadStatus, project?.projectRoot, projectRoot]);

  useEffect(() => {
    const id = window.setInterval(async () => {
      if (!project || project.settings.paused || project.history.completedSteps.length >= project.prompts.length || !project.history.nextRunAt) return;
      if (Date.now() < new Date(project.history.nextRunAt).getTime()) return;
      try {
        setBusy(true);
        setMessage("Scheduled run started.");
        await postJson("/api/run", { projectRoot: project.projectRoot });
        const loaded = await loadProject(project.projectRoot);
        setMessage(`Scheduled run complete. Current task is ${String(loaded.history.currentStep).padStart(3, "0")}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Scheduled run failed.");
      } finally {
        setBusy(false);
      }
    }, 30_000);

    return () => window.clearInterval(id);
  }, [project, loadProject]);

  const nav = useMemo(
    () => [
      ["create", "Create Campaign"],
      ["review", "Campaign Review"],
      ["settings", "Project Settings"],
      ["dashboard", "Execution Dashboard"],
      ["artifacts", "Execution Monitor"]
    ] as Array<[Screen, string]>,
    []
  );

  function generateReview() {
    const parsed = parseCampaign(campaignText);
    const validation = validateCampaignPrompts(parsed.prompts, parsed.metadata, parsed.checkpoints);
    setReviewTitle(parsed.title);
    setReviewMetadata(parsed.metadata);
    setReviewCheckpoints(parsed.checkpoints);
    setReviewPrompts(parsed.prompts);
    setCampaignValidation(validation);
    setMessage(validation.valid ? `Campaign parsed into ${parsed.prompts.length} tasks.` : validation.errors[0] ?? "Campaign validation failed.");
    setScreen("review");
  }

  async function saveCampaign() {
    setBusy(true);
    try {
      const saved = await postJson<ProjectSummary>("/api/campaign/create", {
        campaignText,
        projectRoot,
        prompts: reviewPrompts
      });
      setProject(saved);
      setCampaignValidation(validateCampaignPrompts(reviewPrompts, reviewMetadata ?? undefined, reviewCheckpoints));
      setSettingsDraft(saved.settings);
      localStorage.setItem("campaignRunner.projectRoot", projectRoot);
      await loadStatus(projectRoot).catch(() => undefined);
      setMessage("Campaign saved. Configure LM Studio settings next.");
      setScreen("settings");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save campaign.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setBusy(true);
    try {
      const saved = await postJson<RunnerSettings>("/api/settings", settingsDraft);
      if (policyDraft) await postJson<ExecutionPolicy>("/api/policy", { projectRoot: saved.projectRoot, policy: policyDraft });
      setSettingsDraft(saved);
      await loadProject(saved.projectRoot);
      setProjectRoot(saved.projectRoot);
      setMessage("Settings saved.");
      setScreen("dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    if (!project) return;
    setBusy(true);
    try {
      setMessage("Running next task.");
      const result = await postJson<{ message: string; history: RunnerHistory }>("/api/run", { projectRoot: project.projectRoot });
      await loadProject(project.projectRoot);
      await loadArtifacts().catch(() => undefined);
      await loadStatus(project.projectRoot).catch(() => undefined);
      setMessage(result.message);
    } catch (error) {
      await loadProject(project.projectRoot).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "Run failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setPaused(paused: boolean) {
    if (!project) return;
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: project.projectRoot, paused })
      });
      await loadProject(project.projectRoot);
      setMessage(paused ? "Campaign paused." : "Campaign resumed.");
    } finally {
      setBusy(false);
    }
  }

  function updatePrompt(index: number, patch: Partial<CampaignPrompt>) {
    setReviewPrompts((items) => {
      const updated = items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
      setCampaignValidation(validateCampaignPrompts(updated, reviewMetadata ?? undefined, reviewCheckpoints));
      return updated;
    });
  }

  function openLocalPath(path: string) {
    postJson("/api/open", { path }).catch((error) => setMessage(error.message));
  }

  async function previewRuntimePrompt() {
    if (!project) return;
    try {
      const preview = await postJson<RuntimePreview>("/api/prompt/preview", { projectRoot: project.projectRoot });
      setRuntimePreview(preview);
      setMessage(`Runtime prompt preview is ${preview.estimatedTokens} estimated tokens.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview runtime prompt.");
    }
  }

  function updatePolicyStep(index: number, patch: Partial<ExecutionPolicy["verificationPipeline"][number]>) {
    if (!policyDraft) return;
    setPolicyDraft({
      ...policyDraft,
      verificationPipeline: policyDraft.verificationPipeline.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step))
    });
  }

  function movePolicyStep(index: number, direction: -1 | 1) {
    if (!policyDraft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= policyDraft.verificationPipeline.length) return;
    const steps = [...policyDraft.verificationPipeline];
    const [step] = steps.splice(index, 1);
    steps.splice(nextIndex, 0, step);
    setPolicyDraft({ ...policyDraft, verificationPipeline: steps });
  }

  function addPolicyStep() {
    if (!policyDraft) return;
    setPolicyDraft({
      ...policyDraft,
      verificationPipeline: [
        ...policyDraft.verificationPipeline,
        { name: "Verifier", enabled: false, command: "echo configure verifier", timeoutSeconds: 120, continueOnFailure: false }
      ]
    });
  }

  async function recoveryAction(
    action:
      | "restoreBackup"
      | "rebuildProgress"
      | "startNew"
      | "resetExecution"
      | "abortCampaign"
      | "recoverRuntime"
      | "recoverWorkspace"
      | "recoverPolicy"
      | "recoverMetrics"
      | "recoverState"
  ) {
    if (!project) return;
    try {
      await postJson("/api/recovery", { projectRoot: project.projectRoot, action });
      await loadProject(project.projectRoot);
      setMessage("Recovery action completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recovery action failed.");
    }
  }

  return (
    <main className="min-h-screen px-6 py-5">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Campaign Runner</h1>
            <p className="mt-1 text-sm text-neutral-600">Local campaign execution for LM Studio.</p>
          </div>
          <div className="text-right text-sm text-neutral-600">
            <div>{project?.campaignTitle ?? reviewTitle ?? "No campaign loaded"}</div>
            <div className="font-mono text-xs">{project?.projectRoot ?? projectRoot}</div>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[240px_1fr]">
          <nav className="border border-line bg-white p-2">
            {nav.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScreen(key)}
                className={`block w-full rounded px-3 py-2 text-left text-sm ${screen === key ? "bg-ink text-white" : "hover:bg-panel"}`}
              >
                {label}
              </button>
            ))}
            <div className="mt-4 border-t border-line pt-3 text-xs text-neutral-600">{message}</div>
          </nav>

          <section className="min-h-[720px] border border-line bg-panel p-5">
            {screen === "create" && (
              <div className="grid gap-4">
                <div>
                  <label className="text-sm font-medium">Project Folder</label>
                  <input className={fieldClass()} value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Paste Campaign</label>
                  <textarea
                    className={`${fieldClass()} mt-2 min-h-[520px] font-mono`}
                    value={campaignText}
                    onChange={(event) => setCampaignText(event.target.value)}
                    placeholder={"# CAMPAIGN\nTitle:\nCampaign ID:\n\n# TASK 001\nTitle:\nObjective:\nWorkspace Output:\nFILE: src/app.py"}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={generateReview} disabled={!campaignText.trim()}>
                    <RotateCw size={16} /> Generate Campaign
                  </Button>
                  <Button variant="secondary" onClick={() => setCampaignText("")}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {screen === "review" && (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{reviewTitle || "Campaign Review"}</h2>
                    <p className="text-sm text-neutral-600">{reviewPrompts.length} parsed tasks</p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setScreen("create")}>
                      Back
                    </Button>
                    <Button onClick={saveCampaign} disabled={busy || reviewPrompts.length === 0 || campaignValidation?.valid === false}>
                      <Save size={16} /> Save Campaign
                    </Button>
                  </div>
                </div>
                {campaignValidation && (
                  <div className="grid gap-3 border border-line bg-white p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Tasks Parsed" value={campaignValidation.stats.taskCount} />
                      <Metric label="Checkpoints" value={campaignValidation.stats.checkpointCount} />
                      <Metric label="Profile" value={campaignValidation.stats.profile ?? "Generic"} />
                      <Metric label="Builder Protocol" value={campaignValidation.stats.builderProtocol ?? "Default"} />
                      <Metric label="Average Words" value={campaignValidation.stats.averageWords} />
                      <Metric label="Longest Task" value={campaignValidation.stats.longestPromptNumber ? `Task ${String(campaignValidation.stats.longestPromptNumber).padStart(3, "0")}` : "None"} />
                      <Metric label="Longest Words" value={campaignValidation.stats.longestPromptWords} />
                      <Metric label="Missing Tasks" value={campaignValidation.stats.missingTasks.length || "None"} />
                      <Metric label="Duplicate Tasks" value={campaignValidation.stats.duplicateTasks.length || "None"} />
                    </div>
                    {campaignValidation.errors.length > 0 && <MessageList title="Validation Errors" items={campaignValidation.errors} tone="error" />}
                    {campaignValidation.warnings.length > 0 && <MessageList title="Warnings & Task Size Advisor" items={campaignValidation.warnings} tone="warning" />}
                  </div>
                )}
                <div className="grid max-h-[610px] gap-3 overflow-auto pr-2">
                  {reviewPrompts.map((prompt, index) => (
                    <div key={prompt.filename} className="border border-line bg-white p-3">
                      <div className="mb-2 flex items-center gap-3">
                        <span className="w-20 text-sm font-semibold">Task {String(prompt.number).padStart(3, "0")}</span>
                        <input className={fieldClass()} value={prompt.title} onChange={(event) => updatePrompt(index, { title: event.target.value })} />
                      </div>
                      <textarea className={`${fieldClass()} min-h-28 font-mono`} value={prompt.body} onChange={(event) => updatePrompt(index, { body: event.target.value })} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {screen === "settings" && settingsDraft && (
              <div className="grid max-w-3xl gap-4">
                <h2 className="text-xl font-semibold">Project Settings</h2>
                {[
                  ["Project Root", "projectRoot"],
                  ["Workspace", "workspace"],
                  ["LM Studio Endpoint", "endpoint"],
                  ["Model", "model"]
                ].map(([label, key]) => (
                  <label key={key} className="text-sm font-medium">
                    {label}
                    <input
                      className={`${fieldClass()} mt-2`}
                      value={String(settingsDraft[key as keyof RunnerSettings])}
                      onChange={(event) => setSettingsDraft({ ...settingsDraft, [key]: event.target.value })}
                    />
                  </label>
                ))}
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-medium">
                    Temperature
                    <input className={`${fieldClass()} mt-2`} type="number" step="0.1" value={settingsDraft.temperature} onChange={(event) => setSettingsDraft({ ...settingsDraft, temperature: Number(event.target.value) })} />
                  </label>
                  <label className="text-sm font-medium">
                    Max Tokens
                    <input className={`${fieldClass()} mt-2`} type="number" value={settingsDraft.maxTokens} onChange={(event) => setSettingsDraft({ ...settingsDraft, maxTokens: Number(event.target.value) })} />
                  </label>
                  <label className="text-sm font-medium">
                    Request Timeout
                    <input className={`${fieldClass()} mt-2`} type="number" value={settingsDraft.requestTimeoutSeconds} onChange={(event) => setSettingsDraft({ ...settingsDraft, requestTimeoutSeconds: Number(event.target.value) })} />
                  </label>
                  <label className="text-sm font-medium">
                    Request Retries
                    <input className={`${fieldClass()} mt-2`} type="number" value={settingsDraft.requestRetries} onChange={(event) => setSettingsDraft({ ...settingsDraft, requestRetries: Number(event.target.value) })} />
                  </label>
                  <label className="text-sm font-medium">
                    Run Interval
                    <input className={`${fieldClass()} mt-2`} type="number" value={settingsDraft.runIntervalMinutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, runIntervalMinutes: Number(event.target.value) })} />
                  </label>
                  <label className="text-sm font-medium">
                    Lock Timeout
                    <input className={`${fieldClass()} mt-2`} type="number" value={settingsDraft.lockTimeoutMinutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, lockTimeoutMinutes: Number(event.target.value) })} />
                  </label>
                </div>
                <div className="border border-line bg-white p-4 text-sm">
                  <h3 className="font-semibold">Recommended LM Studio Profile</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {["Context 16K-32K", "Temperature 0.1", "Top P 0.9", "Top K 40", "Repeat Penalty 1.1", "Flash Attention ON", "Unified KV Cache ON", "Keep Model Loaded ON", "MTP ON", "Concurrent Predictions 1", "Recommended Output <2000 tokens"].map((item) => (
                      <div key={item} className="border-b border-line pb-1">{item}</div>
                    ))}
                  </div>
                </div>
                {policyDraft && (
                  <div className="border border-line bg-white p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">Verification Pipeline</h3>
                      <Button variant="secondary" onClick={addPolicyStep}>Add Verifier</Button>
                    </div>
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label>
                          Max Repairs
                          <input className={`${fieldClass()} mt-1`} type="number" value={policyDraft.maxRepairAttempts} onChange={(event) => setPolicyDraft({ ...policyDraft, maxRepairAttempts: Number(event.target.value) })} />
                        </label>
                        <label className="flex items-center gap-2 pt-6">
                          <input type="checkbox" checked={policyDraft.stopOnFailure} onChange={(event) => setPolicyDraft({ ...policyDraft, stopOnFailure: event.target.checked })} />
                          Stop on failure
                        </label>
                        <label className="flex items-center gap-2 pt-6">
                          <input type="checkbox" checked={policyDraft.retryOnTimeout} onChange={(event) => setPolicyDraft({ ...policyDraft, retryOnTimeout: event.target.checked })} />
                          Retry timeout
                        </label>
                        <label className="flex items-center gap-2 pt-6">
                          <input type="checkbox" checked={policyDraft.acceptOnlyVerified} onChange={(event) => setPolicyDraft({ ...policyDraft, acceptOnlyVerified: event.target.checked })} />
                          Verified only
                        </label>
                      </div>
                      {policyDraft.verificationPipeline.map((step, index) => (
                        <div key={`${step.name}-${index}`} className="grid gap-2 border border-line p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2">
                              <input type="checkbox" checked={step.enabled} onChange={(event) => updatePolicyStep(index, { enabled: event.target.checked })} />
                              Enabled
                            </label>
                            <input className="w-40 rounded border border-line px-2 py-1" value={step.name} onChange={(event) => updatePolicyStep(index, { name: event.target.value })} />
                            <button type="button" className="rounded border border-line px-2 py-1" onClick={() => movePolicyStep(index, -1)}>Up</button>
                            <button type="button" className="rounded border border-line px-2 py-1" onClick={() => movePolicyStep(index, 1)}>Down</button>
                            <label className="flex items-center gap-2">
                              <input type="checkbox" checked={step.continueOnFailure} onChange={(event) => updatePolicyStep(index, { continueOnFailure: event.target.checked })} />
                              Continue
                            </label>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                            <input className={fieldClass()} value={step.command} onChange={(event) => updatePolicyStep(index, { command: event.target.value })} />
                            <input className={fieldClass()} type="number" value={step.timeoutSeconds} onChange={(event) => updatePolicyStep(index, { timeoutSeconds: Number(event.target.value) })} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button onClick={saveSettings} disabled={busy}>
                  <Settings size={16} /> Save Settings
                </Button>
              </div>
            )}

            {screen === "dashboard" && project && (
              <div className="grid gap-5">
                {project.recovery.mode && (
                  <div className="border border-red-300 bg-red-50 p-4">
                    <h3 className="font-semibold text-red-800">Recovery Mode</h3>
                    <p className="mt-2 text-sm text-red-800">{project.recovery.message}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button variant="secondary" onClick={() => recoveryAction("restoreBackup")}>Restore Backup</Button>
                      <Button variant="secondary" onClick={() => recoveryAction("rebuildProgress")}>Rebuild Progress</Button>
                      <Button variant="secondary" onClick={() => recoveryAction("startNew")}>Start New Campaign</Button>
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>Campaign Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-4 border border-line bg-white">
                    <div className="h-full bg-action" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label="Current Task" value={completedCount >= totalTasks ? "Complete" : `Task ${String(project.history.currentStep).padStart(3, "0")}`} />
                  <Metric label="Final Status" value={project.history.executions.at(-1)?.finalStatus ?? "Ready"} />
                  <Metric label="Completed" value={completedCount} />
                  <Metric label="Remaining" value={Math.max(0, totalTasks - completedCount)} />
                  <Metric label="Last Runtime" value={project.history.lastRuntimeSeconds ? `${project.history.lastRuntimeSeconds}s` : "None"} />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label="Campaign" value={project.campaignMetadata.title} />
                  <Metric label="Tasks" value={project.prompts.length} />
                  <Metric label="Checkpoints" value={project.checkpoints.length} />
                  <Metric label="Milestone" value={project.checkpoints.length ? `${project.checkpoints.length} checkpoints` : "None"} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Metric label="Next Scheduled Run" value={project.history.nextRunAt ? new Date(project.history.nextRunAt).toLocaleString() : "Not scheduled"} />
                  <Metric label="Current Model" value={project.settings.model} />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric label="Lock Status" value={project.lockStatus.exists ? (project.lockStatus.stale ? "Stale" : "Active") : "Clear"} />
                  <Metric label="Scheduler Status" value={project.settings.paused ? "Paused" : "Running"} />
                  <Metric label="Workspace Files" value={artifacts?.generatedFiles.length ?? "Open artifacts"} />
                </div>
                <div className="border border-line bg-white p-4">
                  <div className="text-sm font-semibold">Current Task</div>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-panel p-3 text-sm">{currentPrompt?.body ?? "No current prompt available."}</pre>
                </div>
                {runtimePreview && (
                  <div className="border border-line bg-white p-4">
                    <div className="text-sm font-semibold">Runtime Prompt Preview</div>
                    <div className="mt-1 text-xs text-neutral-600">Estimated tokens: {runtimePreview.estimatedTokens}</div>
                    <div className="mt-3 grid gap-3">
                      <PreviewBlock title="System Prompt" value={runtimePreview.systemPrompt} />
                      <PreviewBlock title="Campaign Header" value={runtimePreview.campaignHeader} />
                      <PreviewBlock title="Task Prompt" value={runtimePreview.hourPrompt} />
                      <PreviewBlock title="Repair Prompt" value={runtimePreview.repairPrompt} />
                    </div>
                  </div>
                )}
                <FailureDashboard project={project} onOpen={openLocalPath} onRetry={runNow} onReset={() => recoveryAction("resetExecution")} onAbort={() => recoveryAction("abortCampaign")} busy={busy} />
                <StatusPanelView status={statusPanel} />
                <div className="border border-line bg-white p-4">
                  <div className="text-sm font-semibold">Runtime Recovery</div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => recoveryAction("resetExecution")}>Reset to READY</Button>
                    <Button variant="secondary" onClick={() => recoveryAction("recoverRuntime")}>Rebuild Runtime</Button>
                    <Button variant="secondary" onClick={() => recoveryAction("recoverWorkspace")}>Recover Workspace</Button>
                    <Button variant="secondary" onClick={() => recoveryAction("recoverPolicy")}>Recover Policy</Button>
                    <Button variant="secondary" onClick={() => recoveryAction("recoverMetrics")}>Recover Metrics</Button>
                    <Button variant="secondary" onClick={() => recoveryAction("recoverState")}>Recover State</Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={previewRuntimePrompt}>
                    <Eye size={16} /> Preview Runtime Prompt
                  </Button>
                  <Button onClick={runNow} disabled={busy || completedCount >= totalTasks}>
                    <Play size={16} /> Run Now
                  </Button>
                  <Button variant="secondary" onClick={() => setPaused(true)} disabled={busy || project.settings.paused}>
                    <Pause size={16} /> Pause
                  </Button>
                  <Button variant="secondary" onClick={() => setPaused(false)} disabled={busy || !project.settings.paused}>
                    <TimerReset size={16} /> Resume
                  </Button>
                  <Button variant="secondary" onClick={() => openLocalPath(project.settings.workspace)}>
                    <FolderOpen size={16} /> Open Workspace
                  </Button>
                  <Button variant="secondary" onClick={() => openLocalPath(`${project.projectRoot}/outputs`)}>
                    <FolderOpen size={16} /> Open Outputs
                  </Button>
                  <Button variant="secondary" onClick={() => openLocalPath(`${project.projectRoot}/logs`)}>
                    <TerminalSquare size={16} /> Open Logs
                  </Button>
                </div>
              </div>
            )}

            {screen === "artifacts" && (
              <div className="grid gap-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Execution Monitor</h2>
                  <Button variant="secondary" onClick={loadArtifacts}>
                    <RotateCw size={16} /> Refresh
                  </Button>
                </div>
                <ExecutionMonitor artifacts={artifacts} project={project} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <FileList title="Recent Outputs" files={artifacts?.outputs ?? []} onOpen={openLocalPath} />
                  <FileList title="Generated Files" files={artifacts?.generatedFiles ?? []} onOpen={openLocalPath} />
                </div>
                <div className="border border-line bg-white p-4">
                  <h3 className="font-semibold">Campaign Summary</h3>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap bg-panel p-3 text-sm">{artifacts?.summary || "No summary generated yet."}</pre>
                </div>
                <div className="border border-line bg-white p-4">
                  <h3 className="font-semibold">Execution History</h3>
                  <div className="mt-3 max-h-48 overflow-auto text-sm">
                    {(project?.history.runs ?? []).map((run) => (
                      <button key={`${run.promptNumber}-${run.completedAt}`} type="button" onClick={() => openLocalPath(run.outputFile)} className="block w-full border-b border-line py-2 text-left hover:bg-panel">
                        Task {String(run.promptNumber).padStart(3, "0")} - {run.title} - {run.runtimeSeconds}s
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border border-line bg-white p-4">
                  <h3 className="font-semibold">Run Log</h3>
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap bg-panel p-3 text-sm">{artifacts?.runLog || "No log entries yet."}</pre>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function FileList({ title, files, onOpen }: { title: string; files: ArtifactFile[]; onOpen: (path: string) => void }) {
  return (
    <div className="border border-line bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3 max-h-80 overflow-auto">
        {files.length === 0 && <div className="text-sm text-neutral-500">No files yet.</div>}
        {files.map((file) => (
          <button key={file.path} type="button" onClick={() => onOpen(file.path)} className="block w-full border-b border-line py-2 text-left text-sm hover:bg-panel">
            <span className="block font-medium">{file.name}</span>
            <span className="block truncate text-xs text-neutral-500">{file.path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warning" }) {
  const classes = tone === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div className={`border p-3 text-sm ${classes}`}>
      <div className="font-semibold">{title}</div>
      <ul className="mt-2 list-disc pl-5">
        {items.slice(0, 12).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {items.length > 12 && <div className="mt-2">Showing 12 of {items.length} items.</div>}
    </div>
  );
}

function StatusPanelView({ status }: { status: StatusPanel | null }) {
  if (!status) {
    return (
      <div className="border border-line bg-white p-4 text-sm text-neutral-600">
        Recovery Dashboard status will appear after refresh.
      </div>
    );
  }

  const lockText = status.lockStatus.exists
    ? status.lockStatus.stale
      ? "Stale lock detected"
      : `Active lock${status.lockStatus.ageSeconds ? `, ${status.lockStatus.ageSeconds}s old` : ""}`
    : "No lock";

  return (
    <div className="border border-line bg-white p-4">
      <div className="text-sm font-semibold">Recovery Dashboard</div>
      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div><span className="font-medium">Workspace:</span> {status.workspace}</div>
        <div><span className="font-medium">History:</span> {status.history}</div>
        <div><span className="font-medium">Settings:</span> {status.settings}</div>
        <div><span className="font-medium">Logs:</span> {status.logs}</div>
        <div><span className="font-medium">Lock:</span> {lockText}</div>
        <div><span className="font-medium">Engine:</span> {status.executionState.state}</div>
        <div><span className="font-medium">Verifier:</span> {status.executionState.currentVerifier ?? "None"}</div>
        <div><span className="font-medium">Repair Attempt:</span> {status.executionState.repairAttempt}</div>
        <div><span className="font-medium">Scheduler:</span> {status.schedulerStatus}</div>
        <div><span className="font-medium">LM Studio:</span> {status.lmStudioStatus}</div>
      </div>
    </div>
  );
}

function PreviewBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap bg-panel p-3 text-sm">{value}</pre>
    </div>
  );
}

function ExecutionMonitor({ artifacts, project }: { artifacts: Artifacts | null; project: ProjectSummary | null }) {
  const state = parseJson<PersistedExecutionState>(artifacts?.executionState);
  const metrics = parseJson<Record<string, unknown>>(artifacts?.metrics);
  const policy = parseJson<ExecutionPolicy>(artifacts?.policy);
  const latest = project?.history.executions.at(-1);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Current State" value={state?.state ?? "READY"} />
        <Metric label="Current Verifier" value={state?.currentVerifier ?? "None"} />
        <Metric label="Repair Attempt" value={state?.repairAttempt ?? 0} />
        <Metric label="Final Status" value={state?.finalStatus ?? latest?.finalStatus ?? "None"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-line bg-white p-4">
          <h3 className="font-semibold">Verification Results</h3>
          <div className="mt-3 max-h-72 overflow-auto text-sm">
            {(latest?.verifierResults ?? []).length === 0 && <div className="text-neutral-500">No verifier results yet.</div>}
            {(latest?.verifierResults ?? []).map((result) => (
              <div key={`${result.verifier}-${result.command}`} className="border-b border-line py-2">
                <div className="font-medium">{result.verifier}: {result.status}</div>
                <div className="font-mono text-xs text-neutral-600">{result.command}</div>
                <div className="text-xs text-neutral-600">{result.runtimeSeconds.toFixed(2)}s</div>
              </div>
            ))}
          </div>
        </div>
        <div className="border border-line bg-white p-4">
          <h3 className="font-semibold">Metrics</h3>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap bg-panel p-3 text-sm">{metrics ? JSON.stringify(metrics, null, 2) : "No metrics yet."}</pre>
        </div>
      </div>
      <div className="border border-line bg-white p-4">
        <h3 className="font-semibold">Verification Configuration</h3>
        <div className="mt-3 grid gap-2 text-sm">
          {(policy?.verificationPipeline ?? []).map((step) => (
            <div key={`${step.name}-${step.command}`} className="grid gap-2 border-b border-line pb-2 md:grid-cols-[140px_80px_1fr]">
              <span className="font-medium">{step.name}</span>
              <span>{step.enabled ? "Enabled" : "Disabled"}</span>
              <span className="font-mono text-xs">{step.command}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-line bg-white p-4">
        <h3 className="font-semibold">Current Command</h3>
        <pre className="mt-3 whitespace-pre-wrap bg-panel p-3 text-sm">{state?.currentCommand ?? "No command running."}</pre>
      </div>
    </div>
  );
}

function FailureDashboard({
  project,
  onOpen,
  onRetry,
  onReset,
  onAbort,
  busy
}: {
  project: ProjectSummary;
  onOpen: (path: string) => void;
  onRetry: () => void;
  onReset: () => void;
  onAbort: () => void;
  busy: boolean;
}) {
  const latest = project.history.executions.at(-1);
  if (latest?.finalStatus !== "FAILED") return null;
  const failedVerifier = latest.verifierResults.find((result) => result.status === "FAIL");

  return (
    <div className="border border-red-300 bg-red-50 p-4 text-red-900">
      <h3 className="font-semibold">Failure Dashboard</h3>
      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div><span className="font-medium">Hour:</span> {String(latest.hour).padStart(2, "0")}</div>
        <div><span className="font-medium">Verifier:</span> {failedVerifier?.verifier ?? "Unknown"}</div>
        <div><span className="font-medium">Repair Attempts:</span> {latest.repairCount}</div>
        <div><span className="font-medium">Suggested Next Action:</span> inspect logs, then retry the hour.</div>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap bg-white p-3 text-sm">{latest.failureReason ?? failedVerifier?.stderr ?? failedVerifier?.stdout ?? "No error output captured."}</pre>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => onOpen(`${project.projectRoot}/logs`)}>Open Logs</Button>
        {latest.outputFile && <Button variant="secondary" onClick={() => onOpen(latest.outputFile!)}>Open Output</Button>}
        <Button variant="secondary" onClick={onReset}>Reset to READY</Button>
        <Button variant="secondary" onClick={onAbort}>Abort Campaign</Button>
        <Button onClick={onRetry} disabled={busy}>Retry Task</Button>
      </div>
    </div>
  );
}

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
