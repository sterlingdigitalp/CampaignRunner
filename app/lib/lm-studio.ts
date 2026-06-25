import type { RunnerSettings } from "./types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export type LmStudioErrorCode = "SERVER_UNAVAILABLE" | "MODEL_UNLOADED" | "TIMEOUT" | "INVALID_JSON" | "EMPTY_RESPONSE" | "HTTP_ERROR";

export class LmStudioError extends Error {
  constructor(
    public code: LmStudioErrorCode,
    message: string,
    public retryable: boolean
  ) {
    super(message);
  }
}

async function requestCompletion(settings: RunnerSettings, prompt: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        messages: [{ role: "user", content: prompt }]
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LmStudioError("TIMEOUT", `LM Studio request timed out after ${settings.requestTimeoutSeconds}s.`, true);
    }
    throw new LmStudioError("SERVER_UNAVAILABLE", "LM Studio is unavailable. Confirm the server is running and reachable.", true);
  }

  let data: ChatResponse;
  try {
    data = (await response.json()) as ChatResponse;
  } catch {
    throw new LmStudioError("INVALID_JSON", "LM Studio returned invalid JSON.", true);
  }

  if (!response.ok) {
    const message = data.error?.message || `LM Studio returned HTTP ${response.status}`;
    const unloaded = /model|load|not found|unavailable/i.test(message);
    throw new LmStudioError(unloaded ? "MODEL_UNLOADED" : "HTTP_ERROR", message, response.status >= 500 || unloaded);
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new LmStudioError("EMPTY_RESPONSE", "LM Studio returned an empty response.", true);
  }

  return content;
}

export async function completeWithLmStudio(settings: RunnerSettings, prompt: string) {
  const attempts = Math.max(1, settings.requestRetries + 1);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, settings.requestTimeoutSeconds) * 1000);
    try {
      return await requestCompletion(settings, prompt, controller.signal);
    } catch (error) {
      lastError = error;
      if (!(error instanceof LmStudioError) || !error.retryable || attempt >= attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
