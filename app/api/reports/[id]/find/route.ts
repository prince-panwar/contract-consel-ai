import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { embedOne } from "@/lib/rag/embedder";
import { getReport } from "@/lib/db/reports";
import { dot } from "@/lib/rag/retriever";
import { hybridRank } from "@/lib/search/keywords";
import { findSingleDataPoint } from "@/lib/extract/extractor";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "reviewer");
  if ("response" in g) return g.response;
  const report = await getReport(id, ["chunks", "pages"]);
  if (!report) return jsonError("Report not found.", 404);
  if (report.processingStatus !== "ready") {
    return jsonError(
      `Report is still ${report.processingStatus}. Wait for embeddings to finish.`,
      409,
    );
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const query = (body.query ?? "").trim();
  if (!query) return jsonError("'query' is required.", 400);

  let qEmbedding: Float32Array;
  try {
    qEmbedding = await embedOne(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : "embedding failed";
    return jsonError(`Query embedding failed: ${message}`, 500);
  }

  // Hybrid: the query's words via BM25 plus embedding similarity, so an exact
  // term ("indemnif*") and a paraphrase both find the clause.
  const terms = [query, ...query.split(/\s+/).filter((w) => w.length >= 4)];
  const semantic = new Map(
    report.chunks.map((c, i) => [c.id, dot(qEmbedding, report.embeddings[i])]),
  );
  const byId = new Map(report.chunks.map((c) => [c.id, c]));
  const retrieved = hybridRank(report.chunks, terms, semantic, ragConfig.topK).flatMap((r) => {
    const c = byId.get(r.id);
    return c ? [{ ...c, score: r.score }] : [];
  });

  try {
    const dp = await findSingleDataPoint(query, retrieved, report.pages, report.filename);
    await audit(request, g.user, "report.ai_find", { reportId: id, detail: { found: !!dp } });
    return Response.json({ dataPoint: dp });
  } catch (err) {
    const message = err instanceof Error ? err.message : "find failed";
    return jsonError(message, 500);
  }
}
