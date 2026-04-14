import type { NextRequest } from "next/server";
import { getSessionAsync } from "@/lib/rag/vectorStore";
import { resolveSessionId } from "@/lib/rag/session";

export async function GET(request: NextRequest) {
  const sessionId = await resolveSessionId(request);
  const doc = await getSessionAsync(sessionId);
  if (!doc) {
    return Response.json({ error: "Session not found." }, { status: 410 });
  }
  const body = new Uint8Array(doc.pdfBytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(doc.pdfBytes.length),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${doc.filename}"`,
    },
  });
}
