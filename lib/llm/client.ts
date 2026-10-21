import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { MASKING_INSTRUCTION, maskingEnabled, PiiMasker } from "../privacy/mask";

// Provider-agnostic structured-JSON generation. Switch LLMs purely via env:
//   LLM_PROVIDER = anthropic | gemini | openai | ollama
//                  (openai = any OpenAI-compatible API: OpenAI, DeepSeek, Groq,
//                  OpenRouter, llama.cpp server, vLLM, ...; ollama = local
//                  Ollama, no key needed)
//   LLM_MODEL    = model id (defaults per provider below)
//   LLM_API_KEY  = key for that provider (falls back to ANTHROPIC_API_KEY /
//                  GEMINI_API_KEY / OPENAI_API_KEY)
//   LLM_BASE_URL = API base URL for openai/ollama (e.g. https://api.deepseek.com;
//                  ollama defaults to http://localhost:11434/v1)

export type LlmProvider = "anthropic" | "gemini" | "openai" | "ollama";

export interface JsonRequest {
  system: string;
  userMessage: string;
  // Plain JSON Schema (objects must set additionalProperties: false).
  schema: { [key: string]: unknown };
  maxTokens: number;
  // Reasoning depth hint; only providers with an effort knob use it.
  effort: "low" | "medium";
}

export interface JsonResult<T> {
  data: T;
  model: string;
  stopReason: string;
  inputTokens?: number;
  outputTokens?: number;
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  ollama: "llama3.1:8b",
};

const FALLBACK_KEY_VARS: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const DEFAULT_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  ollama: "http://localhost:11434/v1",
};

const REQUEST_TIMEOUT_MS = 240_000;
const MAX_RETRIES = 4;

export function llmConfig(): {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
} {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (!(provider in DEFAULT_MODELS)) {
    throw new Error(
      `Unknown LLM_PROVIDER "${provider}". Use anthropic, gemini, openai (any OpenAI-compatible API) or ollama.`,
    );
  }
  const p = provider as LlmProvider;
  // Local Ollama ignores the key, but the OpenAI SDK requires a non-empty one.
  const apiKey =
    process.env.LLM_API_KEY ||
    process.env[FALLBACK_KEY_VARS[p]] ||
    (p === "ollama" ? "ollama" : "");
  if (!apiKey) {
    throw new Error(`LLM_API_KEY is not set (provider: ${provider}).`);
  }
  return {
    provider: p,
    model: process.env.LLM_MODEL || DEFAULT_MODELS[p],
    apiKey,
    baseUrl: process.env.LLM_BASE_URL || DEFAULT_BASE_URLS[p],
  };
}

const globalForLlm = globalThis as unknown as {
  __ccLlm?: { key: string; client: Anthropic | GoogleGenAI | OpenAI };
};

function getClient<T extends Anthropic | GoogleGenAI | OpenAI>(
  cfg: ReturnType<typeof llmConfig>,
  make: () => T,
): T {
  const key = `${cfg.provider}|${cfg.baseUrl ?? ""}|${cfg.apiKey}`;
  if (globalForLlm.__ccLlm?.key !== key) {
    globalForLlm.__ccLlm = { key, client: make() };
  }
  return globalForLlm.__ccLlm.client as T;
}

function parseJson<T>(text: string, stopReason: string): T {
  if (!text.trim()) {
    throw new Error(`LLM returned an empty response (stop=${stopReason}).`);
  }
  // Some OpenAI-compatible models wrap JSON in a code fence despite json mode.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}

/**
 * The single exit point to any LLM. Personal identifiers in the user message
 * are masked before sending (lib/privacy/mask.ts) and restored in the result,
 * so every caller gets privacy protection without doing anything.
 */
export async function generateJson<T>(req: JsonRequest): Promise<JsonResult<T>> {
  const cfg = llmConfig();
  const masker = maskingEnabled() ? new PiiMasker() : null;
  let outbound = req;
  if (masker) {
    const { text, counts } = masker.mask(req.userMessage);
    if (masker.size > 0) {
      outbound = { ...req, userMessage: text, system: `${req.system}\n\n${MASKING_INSTRUCTION}` };
      console.log(`[llm] masked before sending: ${JSON.stringify(counts)}`);
    }
  }
  const result = await dispatch<T>(cfg, outbound);
  return masker && masker.size > 0 ? { ...result, data: masker.unmaskDeep(result.data) } : result;
}

function dispatch<T>(cfg: ReturnType<typeof llmConfig>, req: JsonRequest): Promise<JsonResult<T>> {
  switch (cfg.provider) {
    case "anthropic":
      return generateAnthropic<T>(cfg, req);
    case "gemini":
      return generateGemini<T>(cfg, req);
    case "openai":
    case "ollama":
      return generateOpenAI<T>(cfg, req);
  }
}

async function generateAnthropic<T>(
  cfg: ReturnType<typeof llmConfig>,
  req: JsonRequest,
): Promise<JsonResult<T>> {
  // SDK retries 408/409/429/5xx (incl. 529 overloaded) and honours retry-after.
  const client = getClient(
    cfg,
    () => new Anthropic({ apiKey: cfg.apiKey, maxRetries: MAX_RETRIES, timeout: REQUEST_TIMEOUT_MS }),
  );
  // Streamed so a large max_tokens can't trip the SDK's non-streaming timeout guard.
  const response = await client.messages
    .stream({
      model: cfg.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.userMessage }],
      output_config: {
        effort: req.effort,
        format: { type: "json_schema", schema: req.schema },
      },
    })
    .finalMessage();

  const stopReason = response.stop_reason ?? "unknown";
  if (stopReason === "refusal") {
    throw new Error(
      `Model declined the request (${response.stop_details?.category ?? "unknown category"}).`,
    );
  }
  if (stopReason === "max_tokens") {
    throw new Error("Model hit max_tokens before finishing the JSON output.");
  }
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    data: parseJson<T>(text, stopReason),
    model: cfg.model,
    stopReason,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function parseRetryAfterMs(err: unknown): number | null {
  if (typeof err !== "object" || !err) return null;
  const e = err as { message?: string };
  const match = e.message?.match(/retry(?:[_ ]after|[- ]delay)?[\s:]+([\d.]+)s?/i);
  if (match) {
    const asNum = Number(match[1]);
    if (Number.isFinite(asNum) && asNum > 0) return Math.ceil(asNum * 1000) + 500;
  }
  return null;
}

async function generateGemini<T>(
  cfg: ReturnType<typeof llmConfig>,
  req: JsonRequest,
): Promise<JsonResult<T>> {
  const ai = getClient(cfg, () => new GoogleGenAI({ apiKey: cfg.apiKey }));
  // The Gemini SDK has no built-in retry; back off on rate limits (free tier).
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await ai.models.generateContent({
        model: cfg.model,
        contents: req.userMessage,
        config: {
          systemInstruction: req.system,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: req.schema,
          maxOutputTokens: req.maxTokens,
          abortSignal: controller.signal,
        },
      });
      const stopReason = String(response.candidates?.[0]?.finishReason ?? "unknown");
      return {
        data: parseJson<T>(response.text ?? "", stopReason),
        model: cfg.model,
        stopReason,
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      };
    } catch (err) {
      const status =
        typeof err === "object" && err && "status" in err
          ? Number((err as { status?: number }).status)
          : 0;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = status === 429 || status === 503 || /quota|rate.?limit|429/i.test(msg);
      if (!retryable || attempt >= MAX_RETRIES) throw err;
      const waitMs = parseRetryAfterMs(err) ?? 2000 * attempt;
      console.warn(`[llm] Gemini rate-limited — waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function generateOpenAI<T>(
  cfg: ReturnType<typeof llmConfig>,
  req: JsonRequest,
): Promise<JsonResult<T>> {
  const client = getClient(
    cfg,
    () =>
      new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
        maxRetries: MAX_RETRIES,
        timeout: REQUEST_TIMEOUT_MS,
      }),
  );
  // json_object mode works across OpenAI-compatible hosts (DeepSeek, Groq,
  // OpenRouter, Ollama); strict json_schema support varies, so the schema goes
  // in the prompt and callers validate each row.
  const response = await client.chat.completions.create({
    model: cfg.model,
    max_tokens: req.maxTokens,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${req.system}\n\nRespond with JSON matching this JSON Schema:\n${JSON.stringify(req.schema)}`,
      },
      { role: "user", content: req.userMessage },
    ],
  });
  const choice = response.choices[0];
  const stopReason = choice?.finish_reason ?? "unknown";
  if (stopReason === "length") {
    throw new Error("Model hit max_tokens before finishing the JSON output.");
  }
  return {
    data: parseJson<T>(choice?.message?.content ?? "", stopReason),
    model: cfg.model,
    stopReason,
    inputTokens: response.usage?.prompt_tokens,
    outputTokens: response.usage?.completion_tokens,
  };
}
