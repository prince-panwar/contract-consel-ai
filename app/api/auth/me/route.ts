import { requireUser, twoFactorRequired } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const g = await requireUser(request, "viewer", { allowAccountSetup: true });
  if ("response" in g) return g.response;
  const { uid, email, name, role, totpEnabled, mustChangePassword } = g.user;
  return Response.json({
    uid,
    email,
    name,
    role,
    totpEnabled,
    mustChangePassword,
    mfaSetupRequired: twoFactorRequired() && !totpEnabled,
  });
}
