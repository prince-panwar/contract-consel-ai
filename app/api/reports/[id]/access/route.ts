import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { getReportAccess, setReportSharing } from "@/lib/db/reports";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Who can see a report. Only admins grant or revoke visibility.
export async function GET(request: Request, context: RouteContext) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  const access = await getReportAccess(id);
  if (!access) return Response.json({ error: "Report not found." }, { status: 404 });
  return Response.json(access);
}

// { sharedWith: uid[] } replaces the list.
export async function PUT(request: Request, context: RouteContext) {
  const g = await requireUser(request, "admin");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  let body: { sharedWith?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.sharedWith) || !body.sharedWith.every((u) => typeof u === "string")) {
    return Response.json({ error: "'sharedWith' must be an array of user ids." }, { status: 400 });
  }
  const access = await getReportAccess(id);
  if (!access) return Response.json({ error: "Report not found." }, { status: 404 });
  const known = new Set((await listUsers()).map((u) => u.uid));
  const sharedWith = [...new Set(body.sharedWith as string[])].filter(
    (uid) => known.has(uid) && uid !== access.ownerUid,
  );
  await setReportSharing(id, sharedWith);
  await audit(request, g.user, "report.shared", { reportId: id, detail: { users: sharedWith.length } });
  return Response.json({ ownerUid: access.ownerUid, sharedWith });
}
