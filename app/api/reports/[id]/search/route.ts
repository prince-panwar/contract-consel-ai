import type { NextRequest } from "next/server";
import { getReport } from "@/lib/db/reports";
import { findKeyword, snippet } from "@/lib/search/keywords";
import { requireReport } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_KEYWORDS = 20;
const MAX_PAGES_PER_KEYWORD = 50;

// Static keyword search over the contract's pages. No LLM involved.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const g = await requireReport(request, id, "viewer");
  if ("response" in g) return g.response;
  let body: { keywords?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const keywords = Array.isArray(body.keywords)
    ? body.keywords
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim().slice(0, 80))
        .slice(0, MAX_KEYWORDS)
    : [];
  if (keywords.length === 0) {
    return Response.json({ error: "'keywords' must be a non-empty array of strings." }, { status: 400 });
  }

  const report = await getReport(id, ["pages"]);
  if (!report) return Response.json({ error: "Report not found." }, { status: 404 });

  // Terms aren't logged: they can reveal what the client is looking for.
  await audit(request, g.user, "report.searched", { reportId: id, detail: { terms: keywords.length } });
  const docs = report.pages.map((p) => ({ id: String(p.pageNumber), text: p.text }));
  const textByPage = new Map(report.pages.map((p) => [String(p.pageNumber), p.text]));
  const results = keywords.map((keyword) => {
    const hits = findKeyword(docs, keyword);
    return {
      keyword,
      total: hits.reduce((n, h) => n + h.count, 0),
      pages: hits.slice(0, MAX_PAGES_PER_KEYWORD).map((h) => ({
        page: Number(h.docId),
        count: h.count,
        snippet: snippet(textByPage.get(h.docId) ?? "", keyword),
      })),
    };
  });
  return Response.json({ results });
}
