import { audit } from "@/lib/audit";
import { invalidateUserCache, requireUser } from "@/lib/auth/guard";
import {
  createUser,
  disableTotp,
  listUsers,
  resetPassword,
  ROLES,
  updateUser,
  type Role,
} from "@/lib/auth/users";

export const runtime = "nodejs";

const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);

export async function GET(request: Request) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  return Response.json({ users: await listUsers() });
}

// Create a user; returns a one-time temporary password (must be changed at first sign-in).
export async function POST(request: Request) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  let body: { email?: unknown; name?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!isRole(body.role)) return Response.json({ error: "Role must be viewer, reviewer or admin." }, { status: 400 });
  try {
    const { user, password } = await createUser({
      email,
      name: typeof body.name === "string" ? body.name : "",
      role: body.role,
    });
    await audit(request, g.user, "user.created", { detail: { target: user.email, role: user.role } });
    return Response.json({ user, temporaryPassword: password });
  } catch (err) {
    const dup = err instanceof Error && /E11000/.test(err.message);
    return Response.json({ error: dup ? "A user with that email already exists." : "Could not create user." }, { status: dup ? 409 : 500 });
  }
}

// { uid, role?, disabled?, name?, resetPassword?: true, reset2fa?: true }
export async function PATCH(request: Request) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  let body: { uid?: unknown; role?: unknown; disabled?: unknown; name?: unknown; resetPassword?: unknown; reset2fa?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const uid = typeof body.uid === "string" ? body.uid : "";
  if (!uid) return Response.json({ error: "'uid' is required." }, { status: 400 });
  if (uid === g.user.uid && (body.disabled === true || (isRole(body.role) && body.role !== "admin"))) {
    return Response.json({ error: "You can't disable or demote your own account." }, { status: 400 });
  }

  try {
    let temporaryPassword: string | undefined;
    if (body.resetPassword === true) {
      temporaryPassword = (await resetPassword(uid)) ?? undefined;
      if (!temporaryPassword) return Response.json({ error: "User not found." }, { status: 404 });
      await audit(request, g.user, "user.password_reset", { detail: { target: uid } });
    }
    if (body.reset2fa === true) {
      await disableTotp(uid);
      await audit(request, g.user, "user.2fa_reset", { detail: { target: uid } });
    }
    const patch: { role?: Role; disabled?: boolean; name?: string } = {};
    if (isRole(body.role)) patch.role = body.role;
    if (typeof body.disabled === "boolean") patch.disabled = body.disabled;
    if (typeof body.name === "string") patch.name = body.name;
    const user = await updateUser(uid, patch);
    if (!user) return Response.json({ error: "User not found." }, { status: 404 });
    if (Object.keys(patch).length) {
      await audit(request, g.user, "user.updated", {
        detail: { target: user.email, ...(patch.role ? { role: patch.role } : {}), ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}) },
      });
    }
    invalidateUserCache(uid);
    return Response.json({ user, ...(temporaryPassword ? { temporaryPassword } : {}) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Update failed." }, { status: 400 });
  }
}
