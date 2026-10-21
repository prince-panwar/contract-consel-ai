import type { UpdateFilter } from "mongodb";
import { getReports as getReportsCollection } from "./mongo";
import { decryptText, encryptText } from "../crypto/content";
import type {
  Chunk,
  DataPoint,
  DataPointDefinition,
  ExtractionMode,
  ExtractionStatus,
  PlanPass,
  ProcessingStatus,
  Report,
  ReportSummary,
} from "@/lib/rag/types";
import type { PdfPage } from "@/lib/rag/pdf";

interface ReportDoc {
  reportId: string;
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddingsB64: string[];
  pages: PdfPage[];
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
  // processingStatus is undefined for legacy docs created before the async
  // pipeline; treat undefined as "ready" via the helper below.
  processingStatus?: ProcessingStatus;
  processingError?: string | null;
  extractionStatus: ExtractionStatus;
  // Absent on runs started before focused mode existed (they were thorough).
  extractionMode?: ExtractionMode;
  extractionPlan?: PlanPass[];
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number | null;
  // Set while a step request is running a pass; expired leases are reclaimable.
  extractionLeaseUntil?: number | null;
  // Absent on reports created before per-user access existed: admin-only.
  ownerUid?: string | null;
  sharedWith?: string[];
  createdAt: number;
  lastAccessAt: number;
}

const getReports = () => getReportsCollection<ReportDoc>();

// ---- Encryption at rest (see lib/crypto/content.ts). Contract text, findings
// and filenames are stored encrypted; ids, statuses, pages numbers, field
// names and embeddings are not. Plain-text legacy values read back unchanged.

function sealPoint(dp: DataPoint): DataPoint {
  return { ...dp, value: encryptText(dp.value), quote: encryptText(dp.quote) };
}

function openPoint(dp: DataPoint): DataPoint {
  return { ...dp, value: decryptText(dp.value), quote: decryptText(dp.quote) };
}

function openPages(pages: PdfPage[] | undefined): PdfPage[] {
  return (pages ?? []).map((p) => ({ ...p, text: decryptText(p.text) }));
}

function openChunks(chunks: Chunk[] | undefined): Chunk[] {
  return (chunks ?? []).map((c) => ({
    ...c,
    text: decryptText(c.text),
    heading: c.heading === null ? null : decryptText(c.heading),
  }));
}

function decodeEmbeddings(b64: string[]): Float32Array[] {
  return b64.map((s) => {
    const buf = Buffer.from(s, "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  });
}

function toReport(doc: Partial<ReportDoc> & Pick<ReportDoc, "reportId">): Report {
  return {
    reportId: doc.reportId,
    filename: decryptText(doc.filename ?? ""),
    pageCount: doc.pageCount ?? 0,
    chunks: openChunks(doc.chunks),
    embeddings: decodeEmbeddings(doc.embeddingsB64 ?? []),
    pages: openPages(doc.pages),
    targetFields: doc.targetFields ?? [],
    dataPoints: (doc.dataPoints ?? []).map(openPoint),
    processingStatus: doc.processingStatus ?? "ready",
    processingError: doc.processingError ?? null,
    extractionStatus: doc.extractionStatus ?? "awaiting-config",
    extractionMode: doc.extractionMode ?? "thorough",
    extractionPlan: doc.extractionPlan ?? [],
    extractionPassesDone: doc.extractionPassesDone ?? 0,
    extractionPassesTotal: doc.extractionPassesTotal ?? 0,
    extractionError: doc.extractionError ?? null,
    extractionStartedAt: doc.extractionStartedAt ?? null,
    createdAt: doc.createdAt ?? 0,
    lastAccessAt: doc.lastAccessAt ?? 0,
    ownerUid: doc.ownerUid ?? null,
    sharedWith: doc.sharedWith ?? [],
  };
}

export async function createReportShell(input: {
  reportId: string;
  filename: string;
  ownerUid: string;
}): Promise<void> {
  const now = Date.now();
  const doc: ReportDoc = {
    reportId: input.reportId,
    filename: encryptText(input.filename),
    pageCount: 0,
    chunks: [],
    embeddingsB64: [],
    pages: [],
    targetFields: [],
    dataPoints: [],
    processingStatus: "processing",
    processingError: null,
    extractionStatus: "awaiting-config",
    extractionPassesDone: 0,
    extractionPassesTotal: 0,
    extractionError: null,
    extractionStartedAt: null,
    createdAt: now,
    lastAccessAt: now,
    ownerUid: input.ownerUid,
    sharedWith: [],
  };
  const reports = await getReports();
  await reports.insertOne(doc);
}

export interface ReportAccess {
  ownerUid: string | null;
  sharedWith: string[];
}

/** Who may see a report (null = no such report). */
export async function getReportAccess(reportId: string): Promise<ReportAccess | null> {
  const reports = await getReports();
  const doc = await reports.findOne(
    { reportId },
    { projection: { ownerUid: 1, sharedWith: 1 } },
  );
  return doc ? { ownerUid: doc.ownerUid ?? null, sharedWith: doc.sharedWith ?? [] } : null;
}

export async function setReportSharing(reportId: string, sharedWith: string[]): Promise<boolean> {
  const reports = await getReports();
  const res = await reports.updateOne({ reportId }, { $set: { sharedWith } });
  return res.matchedCount > 0;
}

export async function markProcessingError(reportId: string, message: string): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    { $set: { processingStatus: "error", processingError: message, lastAccessAt: Date.now() } },
  );
}

// Heavy columns (multi-MB on long contracts) are only loaded when a caller
// asks for them; status polling and metadata reads stay small.
export type HeavyPart = "pages" | "chunks";

export async function getReport(
  reportId: string,
  parts: HeavyPart[] = [],
): Promise<Report | null> {
  const reports = await getReports();
  const projection: Record<string, 0> = {};
  if (!parts.includes("pages")) projection.pages = 0;
  if (!parts.includes("chunks")) {
    projection.chunks = 0;
    projection.embeddingsB64 = 0;
  }
  const doc = (await reports.findOne({ reportId }, { projection })) as ReportDoc | null;
  return doc ? toReport(doc) : null;
}

// Bump lastAccessAt so the history list orders by most-recently-viewed.
export async function touchReport(reportId: string): Promise<void> {
  const reports = await getReports();
  await reports.updateOne({ reportId }, { $set: { lastAccessAt: Date.now() } });
}

/** Reports visible to a user: admins see all; others their own + shared. */
export async function listReports(viewer: { uid: string; isAdmin: boolean }): Promise<ReportSummary[]> {
  const reports = await getReports();
  const visible = viewer.isAdmin
    ? {}
    : { $or: [{ ownerUid: viewer.uid }, { sharedWith: viewer.uid }] };
  // Count arrays server-side instead of shipping every data point.
  const docs = await reports
    .aggregate<ReportSummary>([
      { $match: visible },
      { $sort: { lastAccessAt: -1 } },
      {
        $project: {
          _id: 0,
          reportId: 1,
          filename: 1,
          pageCount: 1,
          dataPointCount: { $size: { $ifNull: ["$dataPoints", []] } },
          targetFieldCount: { $size: { $ifNull: ["$targetFields", []] } },
          processingStatus: { $ifNull: ["$processingStatus", "ready"] },
          extractionStatus: 1,
          createdAt: 1,
          lastAccessAt: 1,
          ownerUid: { $ifNull: ["$ownerUid", null] },
          sharedWith: { $ifNull: ["$sharedWith", []] },
        },
      },
    ])
    .toArray();
  return docs.map((d) => ({ ...d, filename: decryptText(d.filename) }));
}

export async function deleteReport(reportId: string): Promise<boolean> {
  const reports = await getReports();
  const result = await reports.deleteOne({ reportId });
  return result.deletedCount > 0;
}

export async function setTargetFields(
  reportId: string,
  targetFields: DataPointDefinition[],
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    { $set: { targetFields, lastAccessAt: Date.now() } },
  );
}

export async function startExtraction(
  reportId: string,
  mode: ExtractionMode,
  plan: PlanPass[],
  totalPasses: number,
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        extractionStatus: "pending",
        extractionMode: mode,
        extractionPlan: plan,
        extractionPassesTotal: totalPasses,
        extractionPassesDone: 0,
        extractionError: null,
        extractionStartedAt: Date.now(),
        extractionLeaseUntil: null,
        dataPoints: [],
        lastAccessAt: Date.now(),
      },
    },
  );
}

// Re-open a failed run from the first unfinished pass, keeping found points.
export async function resumeExtraction(reportId: string): Promise<boolean> {
  const reports = await getReports();
  const result = await reports.updateOne(
    {
      reportId,
      extractionStatus: "error",
      $expr: { $lt: ["$extractionPassesDone", "$extractionPassesTotal"] },
    },
    {
      $set: {
        extractionStatus: "running",
        extractionError: null,
        extractionLeaseUntil: null,
        lastAccessAt: Date.now(),
      },
    },
  );
  return result.modifiedCount > 0;
}

export interface ClaimedPass {
  pass: number; // 1-based
  passesTotal: number;
  pages: PdfPage[];
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
}

/**
 * Atomically take the lease on the next unfinished pass. Returns null when
 * nothing is runnable (finished, failed, or another request holds the lease).
 */
export async function claimNextPass(
  reportId: string,
  leaseMs: number,
  withPages: boolean,
): Promise<ClaimedPass | null> {
  const reports = await getReports();
  const now = Date.now();
  const doc = (await reports.findOneAndUpdate(
    {
      reportId,
      extractionStatus: { $in: ["pending", "running"] },
      $expr: { $lt: ["$extractionPassesDone", "$extractionPassesTotal"] },
      $or: [
        { extractionLeaseUntil: { $exists: false } },
        { extractionLeaseUntil: null },
        { extractionLeaseUntil: { $lt: now } },
      ],
    },
    { $set: { extractionStatus: "running", extractionLeaseUntil: now + leaseMs } },
    {
      returnDocument: "after",
      projection: {
        ...(withPages ? { pages: 1 } : {}),
        targetFields: 1,
        dataPoints: 1,
        extractionPassesDone: 1,
        extractionPassesTotal: 1,
      },
    },
  )) as Pick<
    ReportDoc,
    "pages" | "targetFields" | "dataPoints" | "extractionPassesDone" | "extractionPassesTotal"
  > | null;
  if (!doc) return null;
  return {
    pass: doc.extractionPassesDone + 1,
    passesTotal: doc.extractionPassesTotal,
    pages: openPages(doc.pages),
    targetFields: doc.targetFields,
    dataPoints: (doc.dataPoints ?? []).map(openPoint),
  };
}

/**
 * Runs interrupted by a restart: release their leases (this process is the
 * only runner) and return their ids so they can be resumed.
 */
export async function releaseInterruptedExtractions(): Promise<string[]> {
  const reports = await getReports();
  const filter = {
    extractionStatus: { $in: ["pending", "running"] as ExtractionStatus[] },
  };
  const docs = await reports.find(filter, { projection: { reportId: 1 } }).toArray();
  await reports.updateMany(filter, { $set: { extractionLeaseUntil: null } });
  return docs.map((d) => d.reportId);
}

/** Record a finished pass. The passesDone guard makes a retried step a no-op. */
export async function completePass(
  reportId: string,
  pass: number,
  passesTotal: number,
  newPoints: DataPoint[],
): Promise<void> {
  const reports = await getReports();
  const update = {
    ...(newPoints.length > 0
      ? { $push: { dataPoints: { $each: newPoints.map(sealPoint) } } }
      : {}),
    $set: {
      extractionPassesDone: pass,
      extractionLeaseUntil: null,
      extractionStatus: pass >= passesTotal ? "done" : "running",
      lastAccessAt: Date.now(),
    },
  } as unknown as UpdateFilter<ReportDoc>;
  await reports.updateOne({ reportId, extractionPassesDone: pass - 1 }, update);
}

export async function failPass(reportId: string, message: string): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        extractionStatus: "error",
        extractionError: message,
        extractionLeaseUntil: null,
        lastAccessAt: Date.now(),
      },
    },
  );
}

export async function addDataPoint(
  reportId: string,
  dp: DataPoint,
): Promise<DataPoint | null> {
  const reports = await getReports();
  const update = {
    $push: { dataPoints: sealPoint(dp) },
    $set: { lastAccessAt: Date.now() },
  } as unknown as UpdateFilter<ReportDoc>;
  const result = await reports.updateOne({ reportId }, update);
  return result.matchedCount > 0 ? dp : null;
}

export async function patchDataPoint(
  reportId: string,
  id: string,
  patch: Partial<Pick<DataPoint, "field" | "value" | "quote" | "page">>,
): Promise<DataPoint | null> {
  const reports = await getReports();
  const setOps: Record<string, unknown> = { lastAccessAt: Date.now() };
  if (patch.field !== undefined) setOps["dataPoints.$.field"] = patch.field;
  if (patch.value !== undefined) setOps["dataPoints.$.value"] = encryptText(patch.value);
  if (patch.quote !== undefined) setOps["dataPoints.$.quote"] = encryptText(patch.quote);
  if (patch.page !== undefined) setOps["dataPoints.$.page"] = patch.page;

  const result = await reports.findOneAndUpdate(
    { reportId, "dataPoints.id": id },
    { $set: setOps },
    { returnDocument: "after", projection: { dataPoints: 1 } },
  );
  if (!result) return null;
  const updated = (result.dataPoints as DataPoint[] | undefined)?.find(
    (p) => p.id === id,
  );
  return updated ? openPoint(updated) : null;
}

export async function removeDataPoint(
  reportId: string,
  id: string,
): Promise<boolean> {
  const reports = await getReports();
  const update = {
    $pull: { dataPoints: { id } },
    $set: { lastAccessAt: Date.now() },
  } as unknown as UpdateFilter<ReportDoc>;
  const result = await reports.updateOne({ reportId }, update);
  return result.modifiedCount > 0;
}
