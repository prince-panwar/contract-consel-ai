import { jwtVerify, SignJWT } from "jose";
import type { Role } from "./users";

const COOKIE_NAME = "cc_admin";
const ALG = "HS256";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const MFA_TICKET_TTL_SEC = 5 * 60; // between password and 2FA code

export interface SessionPayload {
  uid: string;
  email: string;
  role: Role;
  tv: number; // user's tokenVersion when issued
}

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error("SESSION_SECRET is not set. Add it to .env (see .env.example).");
  }
  if (raw.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(raw);
}

export async function encryptSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ typ: "session", email: p.email, role: p.role, tv: p.tv })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .setSubject(p.uid)
    .sign(getSecret());
}

/**
 * Signature/expiry check only (used by the proxy for page routes). API routes
 * additionally re-check the user in the database via requireUser().
 */
export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    if (payload.typ !== "session" || typeof payload.sub !== "string") return null;
    return {
      uid: payload.sub,
      email: String(payload.email ?? ""),
      role: payload.role as Role,
      tv: Number(payload.tv ?? 0),
    };
  } catch {
    return null;
  }
}

/** Short-lived proof that the password step passed; exchanged for a session with a 2FA code. */
export async function signMfaTicket(uid: string, tv: number): Promise<string> {
  return new SignJWT({ typ: "mfa", tv })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MFA_TICKET_TTL_SEC}s`)
    .setSubject(uid)
    .sign(getSecret());
}

export async function verifyMfaTicket(ticket: string): Promise<{ uid: string; tv: number } | null> {
  try {
    const { payload } = await jwtVerify(ticket, getSecret(), { algorithms: [ALG] });
    if (payload.typ !== "mfa" || typeof payload.sub !== "string") return null;
    return { uid: payload.sub, tv: Number(payload.tv ?? 0) };
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
