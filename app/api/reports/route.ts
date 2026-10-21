import { listReports } from "@/lib/db/reports";
import { requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const g = await requireUser(request, "viewer");
  if ("response" in g) return g.response;
  const reports = await listReports({ uid: g.user.uid, isAdmin: g.user.role === "admin" });
  return Response.json({ reports });
}
