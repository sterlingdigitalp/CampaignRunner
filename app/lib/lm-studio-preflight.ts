import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileExists } from "./files";
import type { RunnerSettings } from "./types";

const execFileAsync = promisify(execFile);
const SERVER_START_TIMEOUT_MS = 30_000;
const MODEL_LOAD_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 90_000;

export type PreflightResult = {
  ok: boolean;
  messages: string[];
};

function originOf(endpoint: string) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "http://localhost:1234";
  }
}

async function lmsBinary() {
  const fallback = path.join(os.homedir(), ".lmstudio", "bin", "lms");
  return (await fileExists(fallback)) ? fallback : "lms";
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: response.ok, status: response.status, data: (await response.json().catch(() => null)) as unknown };
  } finally {
    clearTimeout(timeout);
  }
}

async function listModels(origin: string) {
  const result = await fetchJson(`${origin}/v1/models`, 5_000);
  const data = result.data as { data?: Array<{ id?: string }> } | null;
  return data?.data?.map((model) => model.id).filter((id): id is string => Boolean(id)) ?? [];
}

async function modelState(origin: string, model: string) {
  try {
    const result = await fetchJson(`${origin}/api/v0/models`, 5_000);
    const data = result.data as { data?: Array<{ id?: string; state?: string }> } | null;
    return data?.data?.find((item) => item.id === model)?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Self-healing preflight for unattended windows: confirm the server is up
 * (starting it via `lms server start` if not), the target model exists, the
 * model is loaded (loading it via `lms load` if not — a 63GB load takes
 * minutes), then prove end-to-end generation with a one-token probe.
 */
export async function preflightLmStudio(settings: RunnerSettings): Promise<PreflightResult> {
  const messages: string[] = [];
  const origin = originOf(settings.endpoint);

  let models: string[] = [];
  try {
    models = await listModels(origin);
    messages.push(`Server reachable at ${origin} (${models.length} models).`);
  } catch {
    messages.push(`Server unreachable at ${origin}; attempting "lms server start".`);
    try {
      await execFileAsync(await lmsBinary(), ["server", "start"], { timeout: SERVER_START_TIMEOUT_MS });
      models = await listModels(origin);
      messages.push(`Server started; ${models.length} models available.`);
    } catch (error) {
      messages.push(`Could not start LM Studio server: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, messages };
    }
  }

  if (!models.includes(settings.model)) {
    messages.push(`Model ${settings.model} is not available on the server. Available: ${models.slice(0, 10).join(", ")}`);
    return { ok: false, messages };
  }

  const state = await modelState(origin, settings.model);
  if (state !== "loaded") {
    messages.push(`Model ${settings.model} state is "${state}"; loading via lms (this can take minutes).`);
    try {
      await execFileAsync(await lmsBinary(), ["load", settings.model, "--gpu", "max", "-y"], { timeout: MODEL_LOAD_TIMEOUT_MS });
      messages.push(`Model ${settings.model} loaded.`);
    } catch (error) {
      messages.push(`Model load failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, messages };
    }
  } else {
    messages.push(`Model ${settings.model} is loaded.`);
  }

  try {
    const probe = await fetchJson(settings.endpoint, PROBE_TIMEOUT_MS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: settings.model, max_tokens: 4, temperature: 0, messages: [{ role: "user", content: "Reply with OK." }] })
    });
    const data = probe.data as { choices?: Array<{ message?: { content?: string } }> } | null;
    if (!probe.ok || !data?.choices?.length) {
      messages.push(`Generation probe failed with HTTP ${probe.status}.`);
      return { ok: false, messages };
    }
    messages.push("Generation probe succeeded.");
  } catch (error) {
    messages.push(`Generation probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, messages };
  }

  return { ok: true, messages };
}
