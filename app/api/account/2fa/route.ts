import QRCode from "qrcode";
import { audit } from "@/lib/audit";
import { invalidateUserCache, requireUser } from "@/lib/auth/guard";
import { encryptSession, sessionCookie } from "@/lib/auth/session";
import { generateSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import {
  consumeTotpStep,
  disableTotp,
  enableTotp,
  getTotpSecrets,
  getUser,
  setPendingTotp,
  verifyPassword,
} from "@/lib/auth/users";

export const runtime = "nodejs";

async function reissue(uid: string) {
  invalidateUserCache(uid);
  const u = (await getUser(uid))!;
  const token = await encryptSession({ uid: u.uid, email: u.email, role: u.role, tv: u.tokenVersion });
  return { "Set-Cookie": sessionCookie.build(token) };
}

// { action: "setup" } → QR + secret; { action: "enable", code };
// { action: "disable", password, code }
export async function POST(request: Request) {
  const g = await requireUser(request, "viewer", { allowAccountSetup: true });
  if ("response" in g) return g.response;
  const user = g.user;
  let body: { action?: unknown; code?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code : "";

  if (body.action === "setup") {
    if (user.totpEnabled) return Response.json({ error: "2FA is already on." }, { status: 409 });
    const secret = generateSecret();
    await setPendingTotp(user.uid, secret);
    const uri = otpauthUri(secret, user.email);
    return Response.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  }

  if (body.action === "enable") {
    const { pending } = await getTotpSecrets(user.uid);
    const step = pending ? verifyTotp(pending, code) : null;
    if (step === null) return Response.json({ error: "That code didn't match. Check the time on your phone and try again." }, { status: 400 });
    await enableTotp(user.uid);
    await consumeTotpStep(user.uid, step);
    await audit(request, user, "account.2fa_enabled");
    return Response.json({ ok: true }, { headers: await reissue(user.uid) });
  }

  if (body.action === "disable") {
    const password = typeof body.password === "string" ? body.password : "";
    const { active } = await getTotpSecrets(user.uid);
    const pwOk = !!(await verifyPassword(user.email, password));
    const step = active ? verifyTotp(active, code) : null;
    if (!pwOk || step === null || !(await consumeTotpStep(user.uid, step))) {
      return Response.json({ error: "Password or code is incorrect." }, { status: 400 });
    }
    await disableTotp(user.uid);
    await audit(request, user, "account.2fa_disabled");
    return Response.json({ ok: true }, { headers: await reissue(user.uid) });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
