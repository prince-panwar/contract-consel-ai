import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { encryptSession, sessionCookie, signMfaTicket } from "@/lib/auth/session";
import { recordLogin, verifyPassword } from "@/lib/auth/users";
import {
  clearLoginFailures,
  clientIp,
  loginBlockedFor,
  recordLoginFailure,
} from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const retryAfter = loginBlockedFor(ip);
  if (retryAfter > 0) {
    return Response.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  let user;
  try {
    user = await verifyPassword(email, password);
  } catch (err) {
    console.error("[auth] login failed to run:", err);
    return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 500 });
  }
  if (!user) {
    recordLoginFailure(ip);
    await audit(request, null, "auth.login_failed", { email: email.toLowerCase().slice(0, 120) });
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  if (user.totpEnabled) {
    // Password OK; the session is only issued after the authenticator code.
    return Response.json({ mfaRequired: true, ticket: await signMfaTicket(user.uid, user.tokenVersion) });
  }

  clearLoginFailures(ip);
  await recordLogin(user.uid);
  await audit(request, user, "auth.login");
  const token = await encryptSession({ uid: user.uid, email: user.email, role: user.role, tv: user.tokenVersion });
  return Response.json(
    { ok: true, mustChangePassword: user.mustChangePassword },
    { headers: { "Set-Cookie": sessionCookie.build(token) } },
  );
}
