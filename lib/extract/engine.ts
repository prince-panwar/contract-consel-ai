import { ragConfig } from "../constants";
import type { Chunk, DataPoint, DataPointDefinition, ExtractionMode, PlanPass } from "../rag/types";
import type { PdfPage } from "../rag/pdf";
import type { SaveEmbeddings } from "../rag/vectors";
import { findDefinitions } from "./definitions";
import { extractFocusedPass, extractPass, extractWindow } from "./extractor";
import { planFocusedExtraction } from "./plan";
import { reconcile } from "./reconcile";
import { documentChars, pageWindows } from "./windows";

/**
 * The extraction pipeline without the database or job queue, shared by the
 * extract route and runner (lib/extract/runner.ts) and the accuracy benchmark
 * (bin/eval-cuad.ts), so the benchmark measures exactly what users get.
 *
 *   plan → one LLM call per pass → finish (reconcile disagreeing readings)
 */

export interface PlannedExtraction {
  mode: ExtractionMode;
  plan: PlanPass[];
  passesTotal: number;
}

function thoroughPlan(pages: PdfPage[], fields: DataPointDefinition[]): PlannedExtraction {
  const names = fields.map((f) => f.name);
  const plan = pageWindows(pages, ragConfig.extractionWindowChars).map((w) => ({
    fields: names,
    chunkIds: [],
    pageStart: w.pageStart,
    pageEnd: w.pageEnd,
  }));
  return { mode: "thorough", plan, passesTotal: plan.length };
}

export async function planExtraction(
  doc: { pages: PdfPage[]; chunks: Chunk[]; embeddings: Float32Array[]; embeddingModel?: string },
  fields: DataPointDefinition[],
  requested: ExtractionMode,
  saveEmbeddings?: SaveEmbeddings,
): Promise<PlannedExtraction> {
  const chars = documentChars(doc.pages);
  // Fits one call: read it all. Better answers than any excerpt selection,
  // because definitions, exceptions and amendments are read together.
  if (chars > 0 && chars <= ragConfig.fullContextChars) {
    const names = fields.map((f) => f.name);
    const last = doc.pages[doc.pages.length - 1].pageNumber;
    return {
      mode: "thorough",
      plan: [{ fields: names, chunkIds: [], pageStart: doc.pages[0].pageNumber, pageEnd: last }],
      passesTotal: 1,
    };
  }
  if (requested === "focused") {
    const plan = await planFocusedExtraction(doc, fields, saveEmbeddings);
    if (plan) return { mode: "focused", plan, passesTotal: plan.length };
  }
  // Search couldn't narrow it down (or the user asked): read every page.
  return thoroughPlan(doc.pages, fields);
}

/** Definitions to attach to a partial read, unless that read already contains them. */
function definitionsFor(pages: PdfPage[], window?: { pageStart: number; pageEnd: number }): string | undefined {
  const defs = findDefinitions(pages, ragConfig.definitionsMaxChars);
  if (!defs) return undefined;
  if (window && pages.length > 0) {
    const whole = window.pageStart <= pages[0].pageNumber && window.pageEnd >= pages[pages.length - 1].pageNumber;
    if (whole) return undefined;
  }
  return defs.text;
}

export async function runPlannedPass(
  doc: { pages: PdfPage[]; chunks: Chunk[] },
  planned: { mode: ExtractionMode; plan: PlanPass[] },
  pass: number,
  fields: DataPointDefinition[],
  existing: DataPoint[],
): Promise<DataPoint[]> {
  const step = planned.plan[pass - 1];
  if (planned.mode === "focused" && step) {
    return extractFocusedPass(doc.pages, doc.chunks, step, pass, fields, existing, definitionsFor(doc.pages));
  }
  if (step?.pageStart !== undefined && step.pageEnd !== undefined) {
    const window = { pageStart: step.pageStart, pageEnd: step.pageEnd };
    return extractWindow(doc.pages, window.pageStart, window.pageEnd, fields, existing, definitionsFor(doc.pages, window));
  }
  // A run planned before page windows existed: fixed 20-page windows.
  return extractPass(doc.pages, pass, fields, existing);
}

/** Runs once after the last pass; returns the report's final data points. */
export async function finishExtraction(
  pages: PdfPage[],
  fields: DataPointDefinition[],
  points: DataPoint[],
): Promise<DataPoint[]> {
  return reconcile(points, fields, definitionsFor(pages));
}
