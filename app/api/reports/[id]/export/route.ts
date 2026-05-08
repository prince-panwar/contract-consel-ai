import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { buildXlsx } from "@/lib/export/xlsx";
import { buildDocx } from "@/lib/export/docx";
import { getReport } from "@/lib/db/reports";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function safeName(name: string): string {
  return (
    name.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_") || "contract"
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const report = await getReport(id);
  if (!report) return jsonError("Report not found.", 404);

  let body: { format?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const format = body.format;
  const rows = report.dataPoints;

  if (rows.length === 0) return jsonError("No data points to export.", 400);
  if (rows.length > ragConfig.exportMaxRows) {
    return jsonError(`Too many rows (max ${ragConfig.exportMaxRows}).`, 413);
  }
  if (format !== "xlsx" && format !== "docx") {
    return jsonError("'format' must be 'xlsx' or 'docx'.", 400);
  }

  const base = safeName(report.filename);

  if (format === "xlsx") {
    const buf = await buildXlsx(report.filename, rows);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}-data-points.xlsx"`,
        "Content-Length": String(buf.length),
      },
    });
  }

  const buf = await buildDocx(report.filename, rows);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${base}-data-points.docx"`,
      "Content-Length": String(buf.length),
    },
  });
}
