import type { NextRequest } from "next/server";
import { listAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  const q = request.nextUrl.searchParams;
  const before = Number(q.get("before"));
  const entries = await listAudit({
    uid: q.get("uid") ?? undefined,
    action: q.get("action") ?? undefined,
    reportId: q.get("reportId") ?? undefined,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: 100,
  });
  return Response.json({ entries });
}
