import { getReport } from "@/lib/db/reports";
import { readPdf } from "@/lib/db/pdfBlob";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Header values must be ASCII; a raw non-ASCII or quoted filename made the
// Response constructor throw and the viewer fail to load. RFC 6266 form.
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "viewer");
  if ("response" in g) return g.response;
  const report = await getReport(id);
  if (!report) {
    return Response.json({ error: "Report not found." }, { status: 404 });
  }
  const buf = await readPdf(id);
  if (!buf) {
    return Response.json({ error: "PDF not found." }, { status: 404 });
  }

  await audit(request, g.user, "report.pdf_viewed", { reportId: id });
  const body = new Uint8Array(buf.byteLength);
  body.set(buf);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(report.filename),
    },
  });
}
