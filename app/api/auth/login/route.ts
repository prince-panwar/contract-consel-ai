import type { NextRequest } from "next/server";
import { verifyCredentials } from "@/lib/auth/credentials";
import { encryptSession, sessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email =
    typeof (body as { email?: unknown })?.email === "string"
      ? (body as { email: string }).email
      : "";
  const password =
    typeof (body as { password?: unknown })?.password === "string"
      ? (body as { password: string }).password
      : "";

  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  let ok = false;
  try {
    ok = await verifyCredentials(email, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth misconfigured.";
    return Response.json({ error: message }, { status: 500 });
  }

  if (!ok) {
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = await encryptSession({ sub: email });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookie.build(token),
    },
  });
}
