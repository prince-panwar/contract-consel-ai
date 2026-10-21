import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const g = await requireUser(request);
  if ("user" in g) await audit(request, g.user, "auth.logout");
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie.clear() } });
}
