import { deleteReport, getReport, touchReport } from "@/lib/db/reports";
import { deletePdf } from "@/lib/db/pdfBlob";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "viewer");
  if ("response" in g) return g.response;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);
  await touchReport(id);
  await audit(request, g.user, "report.viewed", { reportId: id });

  return Response.json({
    reportId: report.reportId,
    filename: report.filename,
    pageCount: report.pageCount,
    targetFields: report.targetFields,
    dataPoints: report.dataPoints,
    processingStatus: report.processingStatus,
    processingError: report.processingError,
    extractionStatus: report.extractionStatus,
    extractionMode: report.extractionMode,
    extractionPassesDone: report.extractionPassesDone,
    extractionPassesTotal: report.extractionPassesTotal,
    extractionError: report.extractionError,
    extractionStartedAt: report.extractionStartedAt,
    createdAt: report.createdAt,
    lastAccessAt: report.lastAccessAt,
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "admin");
  if ("response" in g) return g.response;
  await deletePdf(id).catch(() => {});
  const removed = await deleteReport(id);
  if (!removed) return jsonError("Report not found.", 404);
  await audit(request, g.user, "report.deleted", { reportId: id });
  return new Response(null, { status: 204 });
}
