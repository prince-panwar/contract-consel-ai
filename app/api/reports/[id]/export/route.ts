import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { buildXlsx } from "@/lib/export/xlsx";
import { buildDocx } from "@/lib/export/docx";
import { buildPdf } from "@/lib/export/pdf";
import { buildExportModel, exportBaseName } from "@/lib/export/model";
import { getReport } from "@/lib/db/reports";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const FORMATS = {
  pdf: { type: "application/pdf", build: buildPdf },
  docx: {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    build: buildDocx,
  },
  xlsx: {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    build: buildXlsx,
  },
} as const;

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "viewer");
  if ("response" in g) return g.response;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);

  let body: { format?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const format = body.format;
  if (format !== "pdf" && format !== "docx" && format !== "xlsx") {
    return jsonError("'format' must be 'pdf', 'docx' or 'xlsx'.", 400);
  }
  const rows = report.dataPoints;
  if (rows.length === 0) return jsonError("No data points to export.", 400);
  if (rows.length > ragConfig.exportMaxRows) {
    return jsonError(`Too many rows (max ${ragConfig.exportMaxRows}).`, 413);
  }

  const model = buildExportModel({
    filename: report.filename,
    pageCount: report.pageCount,
    mode: report.extractionMode,
    targetFields: report.targetFields,
    dataPoints: rows,
  });
  const { type, build } = FORMATS[format];
  const buf = await build(model);
  const name = `${exportBaseName(report.filename)}-contract-review.${format}`;
  await audit(request, g.user, "report.exported", { reportId: id, detail: { format, rows: rows.length } });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(buf.length),
    },
  });
}
