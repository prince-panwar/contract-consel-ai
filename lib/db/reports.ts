import type { UpdateFilter } from "mongodb";
import { getReports as getReportsCollection } from "./mongo";
import type {
  Chunk,
  DataPoint,
  DataPointDefinition,
  ExtractionStatus,
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
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number | null;
  createdAt: number;
  lastAccessAt: number;
}

const getReports = () => getReportsCollection<ReportDoc>();

function encodeEmbeddings(embeddings: Float32Array[]): string[] {
  return embeddings.map((v) =>
    Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64"),
  );
}

function decodeEmbeddings(b64: string[]): Float32Array[] {
  return b64.map((s) => {
    const buf = Buffer.from(s, "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  });
}

function toReport(doc: ReportDoc): Report {
  return {
    reportId: doc.reportId,
    filename: doc.filename,
    pageCount: doc.pageCount,
    chunks: doc.chunks,
    embeddings: decodeEmbeddings(doc.embeddingsB64),
    pages: doc.pages,
    targetFields: doc.targetFields,
    dataPoints: doc.dataPoints,
    processingStatus: doc.processingStatus ?? "ready",
    processingError: doc.processingError ?? null,
    extractionStatus: doc.extractionStatus,
    extractionPassesDone: doc.extractionPassesDone,
    extractionPassesTotal: doc.extractionPassesTotal,
    extractionError: doc.extractionError,
    extractionStartedAt: doc.extractionStartedAt,
    createdAt: doc.createdAt,
    lastAccessAt: doc.lastAccessAt,
  };
}

export interface CreateReportInput {
  reportId: string;
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddings: Float32Array[];
  pages: PdfPage[];
}

export async function createReport(input: CreateReportInput): Promise<Report> {
  const now = Date.now();
  const doc: ReportDoc = {
    reportId: input.reportId,
    filename: input.filename,
    pageCount: input.pageCount,
    chunks: input.chunks,
    embeddingsB64: encodeEmbeddings(input.embeddings),
    pages: input.pages,
    targetFields: [],
    dataPoints: [],
    processingStatus: "ready",
    processingError: null,
    extractionStatus: "awaiting-config",
    extractionPassesDone: 0,
    extractionPassesTotal: 0,
    extractionError: null,
    extractionStartedAt: null,
    createdAt: now,
    lastAccessAt: now,
  };
  const reports = await getReports();
  await reports.insertOne(doc);
  return toReport(doc);
}

export async function createReportShell(input: {
  reportId: string;
  filename: string;
}): Promise<void> {
  const now = Date.now();
  const doc: ReportDoc = {
    reportId: input.reportId,
    filename: input.filename,
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
  };
  const reports = await getReports();
  await reports.insertOne(doc);
}

export async function markReportReady(
  reportId: string,
  payload: {
    chunks: Chunk[];
    embeddingsB64: string[];
    pages: PdfPage[];
    pageCount: number;
  },
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        chunks: payload.chunks,
        embeddingsB64: payload.embeddingsB64,
        pages: payload.pages,
        pageCount: payload.pageCount,
        processingStatus: "ready",
        processingError: null,
        lastAccessAt: Date.now(),
      },
    },
  );
}

export async function markReportError(
  reportId: string,
  message: string,
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        processingStatus: "error",
        processingError: message,
        lastAccessAt: Date.now(),
      },
    },
  );
}

export async function getReport(reportId: string): Promise<Report | null> {
  const reports = await getReports();
  const doc = (await reports.findOne({ reportId })) as ReportDoc | null;
  if (!doc) return null;
  // Touch lastAccessAt so the history list orders by most-recently-viewed.
  await reports.updateOne({ reportId }, { $set: { lastAccessAt: Date.now() } });
  return toReport(doc);
}

export async function listReports(): Promise<ReportSummary[]> {
  const reports = await getReports();
  const docs = await reports
    .find(
      {},
      {
        projection: {
          reportId: 1,
          filename: 1,
          pageCount: 1,
          dataPoints: 1,
          targetFields: 1,
          extractionStatus: 1,
          createdAt: 1,
          lastAccessAt: 1,
        },
      },
    )
    .sort({ lastAccessAt: -1 })
    .toArray();
  return docs.map((raw) => {
    const d = raw as unknown as Pick<
      ReportDoc,
      | "reportId"
      | "filename"
      | "pageCount"
      | "dataPoints"
      | "targetFields"
      | "extractionStatus"
      | "createdAt"
      | "lastAccessAt"
    >;
    return {
      reportId: d.reportId,
      filename: d.filename,
      pageCount: d.pageCount,
      dataPointCount: d.dataPoints.length,
      targetFieldCount: d.targetFields.length,
      extractionStatus: d.extractionStatus,
      createdAt: d.createdAt,
      lastAccessAt: d.lastAccessAt,
    };
  });
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
  totalPasses: number,
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        extractionStatus: "pending",
        extractionPassesTotal: totalPasses,
        extractionPassesDone: 0,
        extractionError: null,
        extractionStartedAt: Date.now(),
        dataPoints: [],
        lastAccessAt: Date.now(),
      },
    },
  );
}

export async function setExtractionStatus(
  reportId: string,
  status: ExtractionStatus,
  error: string | null = null,
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    {
      $set: {
        extractionStatus: status,
        extractionError: error,
        lastAccessAt: Date.now(),
      },
    },
  );
}

export async function setExtractionPassesTotal(
  reportId: string,
  total: number,
): Promise<void> {
  const reports = await getReports();
  await reports.updateOne(
    { reportId },
    { $set: { extractionPassesTotal: total, lastAccessAt: Date.now() } },
  );
}

export async function appendExtractedPoints(
  reportId: string,
  newPoints: DataPoint[],
  passesDone: number,
): Promise<void> {
  const reports = await getReports();
  if (newPoints.length > 0) {
    const update = {
      $push: { dataPoints: { $each: newPoints } },
      $set: {
        extractionPassesDone: passesDone,
        lastAccessAt: Date.now(),
      },
    } as unknown as UpdateFilter<ReportDoc>;
    await reports.updateOne({ reportId }, update);
  } else {
    await reports.updateOne(
      { reportId },
      {
        $set: {
          extractionPassesDone: passesDone,
          lastAccessAt: Date.now(),
        },
      },
    );
  }
}

export async function addDataPoint(
  reportId: string,
  dp: DataPoint,
): Promise<DataPoint | null> {
  const reports = await getReports();
  const update = {
    $push: { dataPoints: dp },
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
  if (patch.value !== undefined) setOps["dataPoints.$.value"] = patch.value;
  if (patch.quote !== undefined) setOps["dataPoints.$.quote"] = patch.quote;
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
  return updated ?? null;
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
