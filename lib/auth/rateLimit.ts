// In-memory login throttle: fine for a single long-running server process.
// A failed attempt counts against the client IP; success clears it.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

const globalForLimit = globalThis as unknown as {
  __ccLoginFailures?: Map<string, { count: number; resetAt: number }>;
};
const failures = (globalForLimit.__ccLoginFailures ??= new Map());

export function clientIp(request: Request): string {
  // Set by the reverse proxy (Caddy) in front of the app.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Seconds until the IP may try again, or 0 if allowed. */
export function loginBlockedFor(ip: string): number {
  const entry = failures.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.resetAt <= now) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
