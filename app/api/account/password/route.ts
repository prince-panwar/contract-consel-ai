import { audit } from "@/lib/audit";
import { invalidateUserCache, requireUser } from "@/lib/auth/guard";
import { encryptSession, sessionCookie } from "@/lib/auth/session";
import { changePassword } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const g = await requireUser(request, "viewer", { allowAccountSetup: true });
  if ("response" in g) return g.response;
  let body: { current?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.current !== "string" || typeof body.next !== "string") {
    return Response.json({ error: "'current' and 'next' are required." }, { status: 400 });
  }
  try {
    const user = await changePassword(g.user.uid, body.current, body.next);
    invalidateUserCache(user.uid);
    await audit(request, user, "account.password_changed");
    // Other sessions are signed out (tokenVersion bumped); keep this one.
    const token = await encryptSession({ uid: user.uid, email: user.email, role: user.role, tv: user.tokenVersion });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie.build(token) } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not change password." }, { status: 400 });
  }
}
