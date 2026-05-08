import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { embedOne } from "@/lib/rag/embedder";
import { getReport } from "@/lib/db/reports";
import { retrieve } from "@/lib/rag/retriever";
import { findSingleDataPoint } from "@/lib/extract/extractor";

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
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);

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

  const retrieved = retrieve(
    { chunks: report.chunks, embeddings: report.embeddings },
    qEmbedding,
    ragConfig.topK,
  );

  try {
    const dp = await findSingleDataPoint(query, retrieved, report.pages, report.filename);
    return Response.json({ dataPoint: dp });
  } catch (err) {
    const message = err instanceof Error ? err.message : "find failed";
    return jsonError(message, 500);
  }
}
