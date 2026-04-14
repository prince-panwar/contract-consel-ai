import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { embedOne } from "@/lib/rag/embedder";
import { getSessionAsync } from "@/lib/rag/vectorStore";
import { retrieve } from "@/lib/rag/retriever";
import { resolveSessionId } from "@/lib/rag/session";
import { findSingleDataPoint } from "@/lib/extract/extractor";

export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const sessionId = await resolveSessionId(request);
  const doc = await getSessionAsync(sessionId);
  if (!doc) return jsonError("Session expired. Upload the contract again.", 410);

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

  const retrieved = retrieve(doc, qEmbedding, ragConfig.topK);

  try {
    const dp = await findSingleDataPoint(query, retrieved, doc.pages, doc.filename);
    return Response.json({ dataPoint: dp });
  } catch (err) {
    const message = err instanceof Error ? err.message : "find failed";
    return jsonError(message, 500);
  }
}
