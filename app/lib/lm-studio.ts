import type { BuilderProtocolName, ReasoningEffort, RunnerSettings } from "./types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string };
};

export type CompletionOptions = {
  protocol?: BuilderProtocolName;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  customSchema?: { name: string; schema: unknown };
};

export type CompletionResult = {
  content: string;
  truncated: boolean;
};

const FILE_ARTIFACTS_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path under the workspace, such as src/index.ts" },
          content: { type: "string", description: "Complete file contents" }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    },
    report: {
      type: "object",
      description: "Short structured self-report about this task",
      properties: {
        status: { type: "string", enum: ["complete", "partial", "blocked"] },
        notes: { type: "string", description: "One or two sentences of decisions or discoveries the next task needs to know" },
        blockers: { type: "array", items: { type: "string" } },
        followUps: { type: "array", items: { type: "string" } }
      },
      required: ["status", "notes", "blockers", "followUps"],
      additionalProperties: false
    }
  },
  required: ["files", "report"],
  additionalProperties: false
} as const;

export function fileArtifactsResponseFormat() {
  return {
    type: "json_schema",
    json_schema: { name: "file_artifacts", strict: true, schema: FILE_ARTIFACTS_SCHEMA }
  };
}

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

async function requestCompletion(settings: RunnerSettings, prompt: string, signal: AbortSignal, options?: CompletionOptions): Promise<CompletionResult> {
  const reasoningEffort = options?.reasoningEffort ?? settings.reasoningEffort;
  let response: Response;
  try {
    response = await fetch(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: options?.temperature ?? settings.temperature,
        max_tokens: options?.maxTokens ?? settings.maxTokens,
        messages: [{ role: "user", content: prompt }],
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(options?.customSchema
          ? { response_format: { type: "json_schema", json_schema: { name: options.customSchema.name, strict: true, schema: options.customSchema.schema } } }
          : options?.protocol === "FILE_JSON"
            ? { response_format: fileArtifactsResponseFormat() }
            : {})
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

  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new LmStudioError("EMPTY_RESPONSE", "LM Studio returned an empty response.", true);
  }

  return { content, truncated: choice?.finish_reason === "length" };
}

export async function completeWithLmStudio(settings: RunnerSettings, prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
  const attempts = Math.max(1, settings.requestRetries + 1);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, settings.requestTimeoutSeconds) * 1000);
    try {
      return await requestCompletion(settings, prompt, controller.signal, options);
    } catch (error) {
      lastError = error;
      if (!(error instanceof LmStudioError) || !error.retryable || attempt >= attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
