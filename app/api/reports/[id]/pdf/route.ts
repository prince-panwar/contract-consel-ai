import { getReport } from "@/lib/db/reports";
import { readPdf } from "@/lib/db/pdfBlob";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const report = await getReport(id);
  if (!report) {
    return Response.json({ error: "Report not found." }, { status: 404 });
  }
  const buf = await readPdf(id);
  if (!buf) {
    return Response.json({ error: "PDF not found." }, { status: 404 });
  }

  const body = new Uint8Array(buf.byteLength);
  body.set(buf);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${report.filename}"`,
    },
  });
}
