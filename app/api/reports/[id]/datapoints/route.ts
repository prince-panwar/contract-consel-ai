import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import {
  addDataPoint,
  getReport,
  patchDataPoint,
  removeDataPoint,
} from "@/lib/db/reports";
import type { DataPoint } from "@/lib/rag/types";
import { locateQuote } from "@/lib/extract/verify";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "reviewer");
  if ("response" in g) return g.response;
  const report = await getReport(id, ["pages"]);
  if (!report) return jsonError("Report not found.", 404);

  let body: {
    field?: string;
    value?: string;
    quote?: string;
    page?: number;
    source?: DataPoint["source"];
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const field = (body.field ?? "").trim();
  const value = (body.value ?? "").trim();
  const quote = (body.quote ?? "").trim();
  if (!field || !value) return jsonError("'field' and 'value' are required.", 400);

  const located = quote ? locateQuote(quote, report.pages, body.page) : null;
  const page = located?.page ?? (typeof body.page === "number" ? body.page : 1);
  const verified = located?.verified ?? false;

  const dp: DataPoint = {
    id: nanoid(10),
    field,
    value,
    quote,
    page: Math.max(1, Math.floor(page)),
    verified,
    source: body.source === "ai-found" ? "ai-found" : "user-added",
  };

  const result = await addDataPoint(id, dp);
  if (!result) return jsonError("Report not found.", 404);
  await audit(request, g.user, "datapoint.added", { reportId: id, detail: { id: dp.id, source: dp.source } });
  return Response.json({ dataPoint: result });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "reviewer");
  if ("response" in g) return g.response;

  let body: {
    id?: string;
    patch?: Partial<Pick<DataPoint, "field" | "value" | "quote" | "page">>;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (!body.id || !body.patch) return jsonError("'id' and 'patch' required.", 400);

  const updated = await patchDataPoint(id, body.id, body.patch);
  if (!updated) return jsonError("Data point not found.", 404);
  await audit(request, g.user, "datapoint.edited", { reportId: id, detail: { id: body.id } });
  return Response.json({ dataPoint: updated });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "reviewer");
  if ("response" in g) return g.response;
  const dpId = request.nextUrl.searchParams.get("id");
  if (!dpId) return jsonError("Missing 'id' query param.", 400);
  const ok = await removeDataPoint(id, dpId);
  if (!ok) return jsonError("Data point not found.", 404);
  await audit(request, g.user, "datapoint.deleted", { reportId: id, detail: { id: dpId } });
  return new Response(null, { status: 204 });
}
