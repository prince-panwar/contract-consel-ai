import { getReport } from "@/lib/db/reports";
import { requireReport } from "@/lib/auth/guard";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "viewer");
  if ("response" in g) return g.response;
  const report = await getReport(id);
  if (!report) {
    return Response.json({ error: "Report not found." }, { status: 404 });
  }

  return Response.json({
    status: report.extractionStatus,
    passesDone: report.extractionPassesDone,
    passesTotal: report.extractionPassesTotal,
    error: report.extractionError,
    dataPoints: report.dataPoints,
    targetFields: report.targetFields,
    pageCount: report.pageCount,
    filename: report.filename,
    processingStatus: report.processingStatus,
    processingError: report.processingError,
  });
}
