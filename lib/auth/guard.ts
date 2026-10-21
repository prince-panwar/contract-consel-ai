import { decryptSession, sessionCookie } from "./session";
import { atLeast, getUser, type Role, type User } from "./users";
import { getReportAccess } from "../db/reports";

// Every account must have an authenticator app set up before it can do
// anything but finish account setup. Set REQUIRE_2FA=false to relax.
export function twoFactorRequired(): boolean {
  return (process.env.REQUIRE_2FA ?? "true").toLowerCase() !== "false";
}

// Every API route calls requireUser(). Unlike the proxy's signature check,
// this re-reads the user so disabling an account, changing a role or a
// password takes effect immediately (tokenVersion), not when the JWT expires.

const CACHE_MS = 15_000;
const globalForGuard = globalThis as unknown as {
  __ccUserCache?: Map<string, { user: User | null; at: number }>;
};
const cache = (globalForGuard.__ccUserCache ??= new Map());

export function invalidateUserCache(uid: string): void {
  cache.delete(uid);
}

async function loadUser(uid: string): Promise<User | null> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const user = await getUser(uid);
  cache.set(uid, { user, at: Date.now() });
  return user;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export type Guarded = { user: User } | { response: Response };

export async function requireUser(
  request: Request,
  min: Role = "viewer",
  // Account endpoints (and "who am I") must work while account setup is
  // pending (forced password change, 2FA enrolment); everything else waits.
  opts: { allowAccountSetup?: boolean } = {},
): Promise<Guarded> {
  const session = await decryptSession(readCookie(request, sessionCookie.name));
  if (!session) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await loadUser(session.uid);
  if (!user || user.disabled || user.tokenVersion !== session.tv) {
    return {
      response: Response.json(
        { error: "Your session has ended. Please sign in again." },
        { status: 401, headers: { "Set-Cookie": sessionCookie.clear() } },
      ),
    };
  }
  if (!opts.allowAccountSetup) {
    if (user.mustChangePassword) {
      return { response: Response.json({ error: "Change your password to continue.", mustChangePassword: true }, { status: 403 }) };
    }
    if (twoFactorRequired() && !user.totpEnabled) {
      return { response: Response.json({ error: "Set up two-factor authentication to continue.", mfaSetupRequired: true }, { status: 403 }) };
    }
  }
  if (!atLeast(user.role, min)) {
    return { response: Response.json({ error: "You don't have permission to do that." }, { status: 403 }) };
  }
  return { user };
}

/**
 * requireUser + per-report visibility: admins see every report; others only
 * reports they uploaded or that an admin shared with them. Reports a user
 * can't see answer 404, so their existence isn't revealed.
 */
export async function requireReport(request: Request, reportId: string, min: Role = "viewer"): Promise<Guarded> {
  const g = await requireUser(request, min);
  if ("response" in g) return g;
  if (g.user.role === "admin") return g;
  const access = await getReportAccess(reportId);
  if (!access || (access.ownerUid !== g.user.uid && !access.sharedWith.includes(g.user.uid))) {
    return { response: Response.json({ error: "Report not found." }, { status: 404 }) };
  }
  return g;
}
