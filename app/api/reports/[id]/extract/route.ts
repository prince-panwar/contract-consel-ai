import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import {
  appendExtractedPoints,
  getReport,
  setExtractionStatus,
  setTargetFields,
  startExtraction,
} from "@/lib/db/reports";
import { extractDataPoints } from "@/lib/extract/extractor";
import type { DataPointDefinition } from "@/lib/rag/types";
import type { PdfPage } from "@/lib/rag/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const obj = item as { name?: unknown; description?: unknown };
    if (typeof obj.name !== "string") return null;
    const name = obj.name.trim();
    if (!name) return null;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const description =
      typeof obj.description === "string" ? obj.description.trim() : undefined;
    out.push(description ? { name, description } : { name });
  }
  return out.length > 0 ? out : null;
}

function runExtractionInBackground(
  reportId: string,
  pages: PdfPage[],
  targetFields: DataPointDefinition[],
): void {
  void (async () => {
    const started = Date.now();
    const totalPasses = Math.min(
      Math.ceil(pages.length / ragConfig.extractionWindowPages),
      ragConfig.extractionMaxPasses,
    );
    console.log(
      `[extract] ${reportId} starting — ${pages.length} pages, ${totalPasses} windows, ${targetFields.length} targets`,
    );
    await setExtractionStatus(reportId, "running");
    try {
      await extractDataPoints(pages, targetFields, async ({ pass, newPoints, firstPage, lastPage }) => {
        console.log(
          `[extract] ${reportId} pass ${pass}/${totalPasses} done — pages ${firstPage}-${lastPage}, +${newPoints.length} points`,
        );
        await appendExtractedPoints(reportId, newPoints, pass);
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[extract] ${reportId} done in ${elapsed}s`);
      await setExtractionStatus(reportId, "done", null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "extraction failed";
      console.error(`[extract] ${reportId} failed:`, message);
      await setExtractionStatus(reportId, "error", message);
    }
  })().catch(async (err) => {
    console.error(`[extract] ${reportId} background task crashed:`, err);
    try {
      await setExtractionStatus(
        reportId,
        "error",
        err instanceof Error ? err.message : "background task crashed",
      );
    } catch {
      /* ignore */
    }
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const targetFields = parseTargetFields((body as { targetFields?: unknown })?.targetFields);
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

  await setTargetFields(id, targetFields);
  const totalPasses = Math.min(
    Math.ceil(report.pageCount / ragConfig.extractionWindowPages),
    ragConfig.extractionMaxPasses,
  );
  await startExtraction(id, totalPasses);

  runExtractionInBackground(id, report.pages, targetFields);

  return Response.json({
    reportId: id,
    extractionStatus: "pending",
    extractionPassesTotal: totalPasses,
  });
}
