import { NextResponse, type NextRequest } from "next/server";
import { decryptSession, sessionCookie } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/mfa"]);

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes pass through.
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(sessionCookie.name)?.value;
  const session = await decryptSession(token);
  if (session) {
    return NextResponse.next();
  }

  // For API requests, return 401 instead of redirecting.
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Run on every route except Next internals and static asset paths.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$).*)",
  ],
};
