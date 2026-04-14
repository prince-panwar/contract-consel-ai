import type { NextRequest } from "next/server";
import { getSessionAsync } from "@/lib/rag/vectorStore";
import { resolveSessionId } from "@/lib/rag/session";

export async function GET(request: NextRequest) {
  const sessionId = await resolveSessionId(request);
  const doc = await getSessionAsync(sessionId);
  if (!doc) {
    return Response.json({ error: "Session not found." }, { status: 410 });
  }

  return Response.json({
    status: doc.extractionStatus,
    passesDone: doc.extractionPassesDone,
    passesTotal: doc.extractionPassesTotal,
    error: doc.extractionError,
    dataPoints: doc.dataPoints,
    pageCount: doc.pageCount,
    filename: doc.filename,
  });
}
