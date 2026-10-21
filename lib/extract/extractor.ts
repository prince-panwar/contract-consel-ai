import { nanoid } from "nanoid";
import { generateJson, type JsonRequest } from "../llm/client";
import {
  FIND_DATAPOINT_SYSTEM_PROMPT,
  TARGETED_EXTRACTION_SYSTEM_PROMPT,
  buildFindUserMessage,
  buildTargetedExtractionUserMessage,
} from "../llm/prompts";
import type {
  Chunk,
  DataPoint,
  DataPointDefinition,
  PlanPass,
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

const POINT_PROPERTIES = {
  value: { type: "string" },
  quote: { type: "string" },
  page: { type: "integer" },
};

function buildExtractionSchema(targetFields: DataPointDefinition[]) {
  return {
    type: "object",
    properties: {
      dataPoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: targetFields.map((f) => f.name) },
            ...POINT_PROPERTIES,
          },
          required: ["field", "value", "quote", "page"],
          additionalProperties: false,
        },
      },
    },
    required: ["dataPoints"],
    additionalProperties: false,
  };
}

const FIND_SCHEMA = {
  type: "object",
  properties: {
    dataPoint: {
      anyOf: [
        {
          type: "object",
          properties: { field: { type: "string" }, ...POINT_PROPERTIES },
          required: ["field", "value", "quote", "page"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: ["dataPoint"],
  additionalProperties: false,
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

async function callLlmJson<T>(req: JsonRequest): Promise<T> {
  const started = Date.now();
  console.log(`[extract]     → LLM call (effort=${req.effort})`);
  const res = await generateJson<T>(req);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[extract]     ← ${res.model} ok in ${elapsed}s — stop=${res.stopReason}, in=${res.inputTokens ?? "?"} out=${res.outputTokens ?? "?"}`,
  );
  return res.data;
}

async function runOneExtractionPass(
  pages: PdfPage[],
  targetFields: DataPointDefinition[],
  schema: { [key: string]: unknown },
  excerpts: boolean,
): Promise<RawPoint[]> {
  const userMessage = buildTargetedExtractionUserMessage(pages, targetFields, excerpts);
  const firstPage = pages[0]?.pageNumber;
  const lastPage = pages[pages.length - 1]?.pageNumber;
  console.log(
    `[extract]   calling LLM — pages ${firstPage}-${lastPage} (${pages.length}), ${userMessage.length} chars (~${Math.round(userMessage.length / 4)} tokens), targets=${targetFields.length}`,
  );
  const parsed = await callLlmJson<{ dataPoints: RawPoint[] }>({
    system: TARGETED_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    schema,
    maxTokens: ragConfig.extractionMaxOutputTokens,
    effort: "medium",
  });
  return Array.isArray(parsed?.dataPoints) ? parsed.dataPoints : [];
}

export function countPasses(pageCount: number): number {
  return Math.min(
    Math.ceil(pageCount / ragConfig.extractionWindowPages),
    ragConfig.extractionMaxPasses,
  );
}

async function extractFromSections(
  sections: PdfPage[],
  allPages: PdfPage[],
  targetFields: DataPointDefinition[],
  existing: DataPoint[],
  excerpts: boolean,
  label: string,
): Promise<DataPoint[]> {
  if (targetFields.length === 0 || sections.length === 0) return [];
  const allowedFields = new Set(targetFields.map((f) => f.name));
  const dedupe = new Set(existing.map(dedupeKey));
  const raw = await runOneExtractionPass(
    sections,
    targetFields,
    buildExtractionSchema(targetFields),
    excerpts,
  );

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
    newPoints.push({
      id: nanoid(10),
      field: coerced.field,
      value: coerced.value,
      quote: coerced.quote,
      page: located?.page ?? coerced.page,
      verified: located?.verified ?? false,
      source: "extracted",
    });
    dedupe.add(key);
  }
  console.log(
    `[extract]   ${label} raw=${raw.length} new=${newPoints.length} dup=${duplicates} invalid=${invalid}`,
  );
  return newPoints;
}

/** Thorough mode: one fixed page window (1-based pass) read in full. */
export async function extractPass(
  allPages: PdfPage[],
  pass: number,
  targetFields: DataPointDefinition[],
  existing: DataPoint[],
): Promise<DataPoint[]> {
  const size = ragConfig.extractionWindowPages;
  const window = allPages.slice((pass - 1) * size, pass * size);
  return extractFromSections(window, allPages, targetFields, existing, false, `pass ${pass}`);
}

/**
 * Focused mode: only the passages static + semantic search selected for
 * these fields. Each excerpt is labelled with its page for citations.
 */
export async function extractFocusedPass(
  allPages: PdfPage[],
  chunks: Chunk[],
  plan: PlanPass,
  pass: number,
  targetFields: DataPointDefinition[],
  existing: DataPoint[],
): Promise<DataPoint[]> {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const sections = plan.chunkIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ pageNumber: c.pageStart, text: c.text }] : [];
  });
  const fields = targetFields.filter((f) => plan.fields.includes(f.name));
  return extractFromSections(sections, allPages, fields, existing, true, `focused pass ${pass}`);
}

export async function findSingleDataPoint(
  query: string,
  retrieved: RetrievedChunk[],
  allPages: PdfPage[],
  filename: string,
): Promise<DataPoint | null> {
  const parsed = await callLlmJson<{ dataPoint: RawPoint | null }>({
    system: FIND_DATAPOINT_SYSTEM_PROMPT,
    userMessage: buildFindUserMessage(retrieved, query, filename),
    schema: FIND_SCHEMA,
    // Headroom for adaptive thinking on top of the ~200-token JSON answer.
    maxTokens: 8192,
    effort: "low",
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
