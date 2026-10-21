import type { NextRequest } from "next/server";
import {
  getReport,
  resumeExtraction,
  setTargetFields,
  startExtraction,
} from "@/lib/db/reports";
import { countPasses } from "@/lib/extract/extractor";
import { planFocusedExtraction } from "@/lib/extract/plan";
import { runExtraction } from "@/lib/extract/runner";
import type { DataPointDefinition, ExtractionMode, PlanPass } from "@/lib/rag/types";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

const MAX_KEYWORDS = 20;

function parseKeywords(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of input) {
    if (typeof k !== "string") continue;
    const kw = k.trim().slice(0, 80);
    if (!kw || seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out.length > 0 ? out : undefined;
}

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function parseTargetFields(input: unknown): DataPointDefinition[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: DataPointDefinition[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const obj = item as { name?: unknown; description?: unknown; keywords?: unknown };
    if (typeof obj.name !== "string") return null;
    const name = obj.name.trim();
    if (!name) return null;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const description =
      typeof obj.description === "string" ? obj.description.trim() : undefined;
    const keywords = parseKeywords(obj.keywords);
    out.push({
      name,
      ...(description ? { description } : {}),
      ...(keywords ? { keywords } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

// Starts (or resumes) an extraction run; passes execute in the background
// runner, so this needs the long-running Node server, not serverless.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "reviewer");
  if ("response" in g) return g.response;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);
  if (report.processingStatus !== "ready") {
    return jsonError(`Report is still ${report.processingStatus}.`, 409);
  }

  let body: { targetFields?: unknown; resume?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (body.resume === true) {
    const ok = await resumeExtraction(id);
    if (!ok) return jsonError("Nothing to resume for this report.", 409);
    runExtraction(id);
    await audit(request, g.user, "extraction.resumed", { reportId: id });
    return Response.json({
      reportId: id,
      extractionStatus: "running",
      extractionPassesTotal: report.extractionPassesTotal,
    });
  }

  const targetFields = parseTargetFields(body.targetFields);
  if (!targetFields) {
    return jsonError(
      "'targetFields' must be a non-empty array of { name, description? } items with unique names.",
      400,
    );
  }

  if (
    report.extractionStatus === "pending" ||
    report.extractionStatus === "running"
  ) {
    return jsonError("Extraction is already running for this report.", 409);
  }

  let mode: ExtractionMode = body.mode === "thorough" ? "thorough" : "focused";
  let plan: PlanPass[] = [];
  if (mode === "focused") {
    const withChunks = await getReport(id, ["chunks"]);
    try {
      const focused = await planFocusedExtraction(
        withChunks?.chunks ?? [],
        withChunks?.embeddings ?? [],
        targetFields,
      );
      if (focused) plan = focused;
      else mode = "thorough"; // search couldn't narrow it down; read it all
    } catch (err) {
      const message = err instanceof Error ? err.message : "search failed";
      return jsonError(`Could not prepare focused extraction: ${message}`, 502);
    }
  }
  const totalPasses = mode === "focused" ? plan.length : countPasses(report.pageCount);
  if (totalPasses === 0) return jsonError("This document has no readable text.", 422);

  await setTargetFields(id, targetFields);
  await startExtraction(id, mode, plan, totalPasses);
  runExtraction(id);
  await audit(request, g.user, "extraction.started", {
    reportId: id,
    detail: { mode, fields: targetFields.length, passes: totalPasses },
  });

  return Response.json({
    reportId: id,
    extractionStatus: "pending",
    extractionMode: mode,
    extractionPassesTotal: totalPasses,
  });
}
