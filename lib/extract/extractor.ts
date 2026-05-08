import { nanoid } from "nanoid";
import { Type } from "@google/genai";
import { getGenAI } from "../llm/client";
import {
  FIND_DATAPOINT_SYSTEM_PROMPT,
  TARGETED_EXTRACTION_SYSTEM_PROMPT,
  buildFindUserMessage,
  buildTargetedExtractionUserMessage,
} from "../llm/prompts";
import type {
  DataPoint,
  DataPointDefinition,
  RetrievedChunk,
} from "../rag/types";
import type { PdfPage } from "../rag/pdf";
import { ragConfig } from "../constants";
import { locateQuote } from "./verify";

interface RawPoint {
  field?: unknown;
  value?: unknown;
  quote?: unknown;
  page?: unknown;
}

function buildExtractionSchema(targetFields: DataPointDefinition[]) {
  return {
    type: Type.OBJECT,
    properties: {
      dataPoints: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            field: {
              type: Type.STRING,
              enum: targetFields.map((f) => f.name),
            },
            value: { type: Type.STRING },
            quote: { type: Type.STRING },
            page: { type: Type.INTEGER },
          },
          required: ["field", "value", "quote", "page"],
          propertyOrdering: ["field", "value", "quote", "page"],
        },
      },
    },
    required: ["dataPoints"],
  };
}

const FIND_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    dataPoint: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        field: { type: Type.STRING },
        value: { type: Type.STRING },
        quote: { type: Type.STRING },
        page: { type: Type.INTEGER },
      },
      required: ["field", "value", "quote", "page"],
    },
  },
  required: ["dataPoint"],
};

function coerceRawPoint(
  raw: RawPoint,
  allowedFields: Set<string> | null,
): Omit<DataPoint, "id" | "verified" | "source"> | null {
  if (
    typeof raw.field !== "string" ||
    typeof raw.value !== "string" ||
    typeof raw.quote !== "string"
  ) {
    return null;
  }
  const field = raw.field.trim();
  const value = raw.value.trim();
  const quote = raw.quote.trim();
  if (!field || !value || !quote) return null;
  if (allowedFields && !allowedFields.has(field)) return null;
  let page = Number(raw.page);
  if (!Number.isFinite(page) || page < 1) page = 1;
  return { field, value, quote: quote.slice(0, 500), page: Math.floor(page) };
}

function dedupeKey(dp: Pick<DataPoint, "field" | "value">): string {
  return `${dp.field.toLowerCase().replace(/\s+/g, " ").trim()}::${dp.value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;
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

async function callGeminiJson<T>(args: {
  systemInstruction: string;
  userMessage: string;
  schema: object;
  model?: string;
  maxOutputTokens?: number;
}): Promise<T> {
  const ai = getGenAI();
  const maxAttempts = 4;
  const requestTimeoutMs = 240_000;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    const started = Date.now();
    try {
      console.log(`[extract]     → generateContent (attempt ${attempt})`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response;
      try {
        response = await ai.models.generateContent({
          model: args.model ?? ragConfig.model,
          contents: args.userMessage,
          config: {
            systemInstruction: args.systemInstruction,
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: args.schema,
            maxOutputTokens: args.maxOutputTokens ?? 32_768,
            abortSignal: controller.signal,
          },
        });
      } finally {
        clearTimeout(timer);
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const finishReason = response.candidates?.[0]?.finishReason;
      const text = response.text ?? "";
      console.log(
        `[extract]     ← generateContent ok in ${elapsed}s — finish=${finishReason ?? "?"}, ${text.length} chars`,
      );

      if (!text.trim()) {
        throw new Error(
          `Gemini returned empty response (finish=${finishReason ?? "unknown"}). ` +
            `This usually means MAX_TOKENS was hit or content was blocked by safety filters.`,
        );
      }
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const status =
        typeof err === "object" && err && "status" in err
          ? Number((err as { status?: number }).status)
          : 0;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[extract]     ✕ generateContent failed in ${elapsed}s: ${msg}`);
      const isRateLimit =
        status === 429 ||
        status === 503 ||
        /quota|rate.?limit|429/i.test(msg);
      if (!isRateLimit || attempt >= maxAttempts) throw err;
      const waitMs = parseRetryAfterMs(err) ?? 2000 * attempt;
      console.warn(
        `[extract] Gemini rate-limited — waiting ${waitMs}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function sliceIntoWindows<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runOneExtractionPass(
  pages: PdfPage[],
  targetFields: DataPointDefinition[],
  schema: object,
): Promise<RawPoint[]> {
  const userMessage = buildTargetedExtractionUserMessage(pages, targetFields);
  const charCount = userMessage.length;
  const firstPage = pages[0]?.pageNumber;
  const lastPage = pages[pages.length - 1]?.pageNumber;
  console.log(
    `[extract]   calling Gemini — pages ${firstPage}-${lastPage} (${pages.length}), ${charCount} chars (~${Math.round(charCount / 4)} tokens), targets=${targetFields.length}`,
  );

  const parsed = await callGeminiJson<{ dataPoints: RawPoint[] }>({
    systemInstruction: TARGETED_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    schema,
    maxOutputTokens: ragConfig.extractionMaxOutputTokens,
  });
  return Array.isArray(parsed?.dataPoints) ? parsed.dataPoints : [];
}

export interface ExtractionPassResult {
  pass: number;
  totalPasses: number;
  newPoints: DataPoint[];
  firstPage: number;
  lastPage: number;
}

export async function extractDataPoints(
  allPages: PdfPage[],
  targetFields: DataPointDefinition[],
  onPass?: (result: ExtractionPassResult) => void | Promise<void>,
): Promise<DataPoint[]> {
  if (allPages.length === 0) return [];
  if (targetFields.length === 0) {
    throw new Error("extractDataPoints requires at least one target field.");
  }

  const allowedFields = new Set(targetFields.map((f) => f.name));
  const schema = buildExtractionSchema(targetFields);

  const collected: DataPoint[] = [];
  const dedupe = new Set<string>();

  // Fixed page-windows so output stays bounded per call. Multi-pass sweeps
  // the whole document; per-pass failures don't abort the doc.
  const windows = sliceIntoWindows(allPages, ragConfig.extractionWindowPages);
  const totalPasses = Math.min(windows.length, ragConfig.extractionMaxPasses);

  for (let pass = 1; pass <= totalPasses; pass++) {
    const inputPages = windows[pass - 1];
    if (!inputPages || inputPages.length === 0) break;

    if (pass > 1 && ragConfig.extractionPacingMs > 0) {
      await new Promise((r) => setTimeout(r, ragConfig.extractionPacingMs));
    }

    let raw: RawPoint[] = [];
    try {
      raw = await runOneExtractionPass(inputPages, targetFields, schema);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[extract]   pass ${pass} failed:`, message);
    }

    const newPoints: DataPoint[] = [];
    let duplicates = 0;
    let invalid = 0;
    for (const r of raw) {
      const coerced = coerceRawPoint(r, allowedFields);
      if (!coerced) {
        invalid += 1;
        continue;
      }
      const key = dedupeKey(coerced);
      if (dedupe.has(key)) {
        duplicates += 1;
        continue;
      }

      const located = locateQuote(coerced.quote, allPages, coerced.page);
      const page = located?.page ?? coerced.page;
      const verified = located?.verified ?? false;

      const dp: DataPoint = {
        id: nanoid(10),
        field: coerced.field,
        value: coerced.value,
        quote: coerced.quote,
        page,
        verified,
        source: "extracted",
      };
      newPoints.push(dp);
      collected.push(dp);
      dedupe.add(key);
    }
    console.log(
      `[extract]   pass ${pass} raw=${raw.length} new=${newPoints.length} dup=${duplicates} invalid=${invalid}`,
    );

    if (onPass) {
      await onPass({
        pass,
        totalPasses,
        newPoints,
        firstPage: inputPages[0].pageNumber,
        lastPage: inputPages[inputPages.length - 1].pageNumber,
      });
    }
  }

  return collected;
}

export async function findSingleDataPoint(
  query: string,
  retrieved: RetrievedChunk[],
  allPages: PdfPage[],
  filename: string,
): Promise<DataPoint | null> {
  const parsed = await callGeminiJson<{ dataPoint: RawPoint | null }>({
    systemInstruction: FIND_DATAPOINT_SYSTEM_PROMPT,
    userMessage: buildFindUserMessage(retrieved, query, filename),
    schema: FIND_SCHEMA,
    maxOutputTokens: 1024,
  });

  const raw = parsed?.dataPoint;
  if (!raw) return null;

  const coerced = coerceRawPoint(raw, null);
  if (!coerced) return null;

  const located = locateQuote(coerced.quote, allPages, coerced.page);
  const page = located?.page ?? coerced.page;
  const verified = located?.verified ?? false;

  return {
    id: nanoid(10),
    field: coerced.field,
    value: coerced.value,
    quote: coerced.quote,
    page,
    verified,
    source: "ai-found",
  };
}
