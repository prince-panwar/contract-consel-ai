import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { ragConfig } from "../constants";

export async function resolveSessionId(
  request: NextRequest,
): Promise<string | null> {
  const header = request.headers.get("x-session-id");
  if (header) return header;
  const cookieStore = await cookies();
  return cookieStore.get(ragConfig.cookieName)?.value ?? null;
}

export function newSessionId(): string {
  return nanoid(16);
}

export function buildSessionCookie(sessionId: string): string {
  const maxAge = Math.floor(ragConfig.sessionTtlMs / 1000);
  return `${ragConfig.cookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearCookie(): string {
  return `${ragConfig.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
