import type { NextRequest } from "next/server";
import { deleteSession } from "@/lib/rag/vectorStore";
import { buildClearCookie, resolveSessionId } from "@/lib/rag/session";

export async function DELETE(request: NextRequest) {
  const sessionId = await resolveSessionId(request);
  if (sessionId) deleteSession(sessionId);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": buildClearCookie() },
  });
}

export async function GET(request: NextRequest) {
  const sessionId = await resolveSessionId(request);
  return Response.json({ sessionId });
}
