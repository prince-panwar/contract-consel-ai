import { deleteReport, getReport } from "@/lib/db/reports";
import { deletePdf } from "@/lib/db/pdfBlob";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);

  // Strip out heavy server-only fields the client doesn't need.
  return Response.json({
    reportId: report.reportId,
    filename: report.filename,
    pageCount: report.pageCount,
    targetFields: report.targetFields,
    dataPoints: report.dataPoints,
    extractionStatus: report.extractionStatus,
    extractionPassesDone: report.extractionPassesDone,
    extractionPassesTotal: report.extractionPassesTotal,
    extractionError: report.extractionError,
    extractionStartedAt: report.extractionStartedAt,
    createdAt: report.createdAt,
    lastAccessAt: report.lastAccessAt,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  await deletePdf(id).catch(() => {});
  const removed = await deleteReport(id);
  if (!removed) return jsonError("Report not found.", 404);
  return new Response(null, { status: 204 });
}
