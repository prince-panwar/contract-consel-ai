import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { clearLoginFailures, clientIp, loginBlockedFor, recordLoginFailure } from "@/lib/auth/rateLimit";
import { encryptSession, sessionCookie, verifyMfaTicket } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { consumeTotpStep, getTotpSecrets, getUser, recordLogin } from "@/lib/auth/users";

export const runtime = "nodejs";

// Second sign-in step: exchange the password ticket + authenticator code for a session.
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const retryAfter = loginBlockedFor(ip);
  if (retryAfter > 0) {
    return Response.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  let body: { ticket?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ticket = typeof body.ticket === "string" ? await verifyMfaTicket(body.ticket) : null;
  if (!ticket) return Response.json({ error: "Sign-in expired. Start again." }, { status: 401 });

  const user = await getUser(ticket.uid);
  if (!user || user.disabled || !user.totpEnabled || user.tokenVersion !== ticket.tv) {
    return Response.json({ error: "Sign-in expired. Start again." }, { status: 401 });
  }
  const { active } = await getTotpSecrets(user.uid);
  const step = active && typeof body.code === "string" ? verifyTotp(active, body.code) : null;
  // Each code works once (replay protection).
  if (step === null || !(await consumeTotpStep(user.uid, step))) {
    recordLoginFailure(ip);
    await audit(request, user, "auth.mfa_failed");
    return Response.json({ error: "Invalid or already-used code." }, { status: 401 });
  }

  clearLoginFailures(ip);
  await recordLogin(user.uid);
  await audit(request, user, "auth.login", { detail: { mfa: true } });
  const token = await encryptSession({ uid: user.uid, email: user.email, role: user.role, tv: user.tokenVersion });
  return Response.json(
    { ok: true, mustChangePassword: user.mustChangePassword },
    { headers: { "Set-Cookie": sessionCookie.build(token) } },
  );
}
