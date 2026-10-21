import type { DataPoint, DataPointDefinition, ExtractionMode } from "../rag/types";

// One layout model shared by the PDF, Word and Excel exports so all three
// carry the same sections, ordering and wording.

export interface FindingGroup {
  field: string;
  description?: string;
  points: DataPoint[];
}

export interface ExportModel {
  title: string;
  subtitle: string;
  filename: string;
  generatedAt: Date;
  pageCount: number;
  method: string;
  total: number;
  verified: number;
  needsReview: number;
  groups: FindingGroup[];
  notLocated: DataPointDefinition[];
  notes: string[];
}

export const CONFIDENTIAL = "CONFIDENTIAL";

export const EXPORT_THEME = {
  navy: "1F3864",
  ink: "222222",
  muted: "595959",
  rule: "BFBFBF",
  headerFill: "1F3864",
  zebra: "F5F7FA",
  quoteFill: "F2F2F2",
  verified: "375623",
  review: "9C5700",
  reviewFill: "FFF2CC",
} as const;

export function statusLabel(dp: DataPoint): string {
  return dp.verified ? "Verified" : "Needs review";
}

export function sourceLabel(dp: DataPoint): string {
  if (dp.source === "user-added") return "Reviewer";
  if (dp.source === "ai-found") return "AI search";
  return "AI extraction";
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  });
}

export function buildExportModel(input: {
  filename: string;
  pageCount: number;
  mode: ExtractionMode;
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
}): ExportModel {
  const byField = new Map<string, DataPoint[]>();
  for (const dp of input.dataPoints) {
    const list = byField.get(dp.field) ?? [];
    list.push(dp);
    byField.set(dp.field, list);
  }
  for (const list of byField.values()) list.sort((a, b) => a.page - b.page);

  // Requested fields first, in the order the reviewer listed them; then any
  // fields added by hand or by AI search.
  const groups: FindingGroup[] = [];
  const notLocated: DataPointDefinition[] = [];
  const seen = new Set<string>();
  for (const f of input.targetFields) {
    seen.add(f.name);
    const points = byField.get(f.name);
    if (points?.length) groups.push({ field: f.name, description: f.description, points });
    else notLocated.push(f);
  }
  for (const [field, points] of byField) {
    if (!seen.has(field)) groups.push({ field, points });
  }

  const verified = input.dataPoints.filter((d) => d.verified).length;
  return {
    title: "Contract Review Report",
    subtitle: "Key Terms and Data Point Extraction",
    filename: input.filename,
    generatedAt: new Date(),
    pageCount: input.pageCount,
    method:
      input.mode === "focused"
        ? "Targeted search with AI-assisted extraction"
        : "Full-document AI-assisted review",
    total: input.dataPoints.length,
    verified,
    needsReview: input.dataPoints.length - verified,
    groups,
    notLocated,
    notes: [
      "Findings were extracted with AI assistance and must be confirmed against the source document before reliance.",
      "“Verified” means the quoted passage was located verbatim in the source document at the cited page. “Needs review” means it could not be matched automatically.",
      "“Not located” means no supporting passage was identified; it does not establish that the term is absent from the agreement.",
      "This report is a document analysis aid and does not constitute legal advice.",
    ],
  };
}

export function exportBaseName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_") || "contract";
}
