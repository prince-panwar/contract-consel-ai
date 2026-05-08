import { jwtVerify, SignJWT } from "jose";

const COOKIE_NAME = "cc_admin";
const ALG = "HS256";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export interface AdminSessionPayload {
  sub: string; // admin email
}

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to .env.local (see .env.local.example).",
    );
  }
  if (raw.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(raw);
}

export async function encryptSession(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ sub: payload.sub })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .setSubject(payload.sub)
    .sign(getSecret());
}

export async function decryptSession(
  token: string | undefined,
): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  ttlSec: SESSION_TTL_SEC,
  build(token: string): string {
    const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
  },
  clear(): string {
    const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
    return `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
  },
};
