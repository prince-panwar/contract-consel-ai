import type { PdfPage } from "./pdf";

export interface Chunk {
  id: string;
  text: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
}

export interface DataPoint {
  id: string;
  field: string;
  value: string;
  quote: string;
  page: number;
  verified: boolean;
  source: "extracted" | "user-added" | "ai-found";
}

/**
 * One field the user wants the AI to extract from the contract.
 * `name` is the canonical label (must be unique within a report).
 * `description` is optional guidance shown to the LLM.
 */
export interface DataPointDefinition {
  name: string;
  description?: string;
}

export type ExtractionStatus =
  | "awaiting-config"
  | "pending"
  | "running"
  | "done"
  | "error";

export interface Report {
  reportId: string;
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddings: Float32Array[];
  pages: PdfPage[];
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
  extractionStatus: ExtractionStatus;
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number | null;
  createdAt: number;
  lastAccessAt: number;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

/** Lightweight summary for the history list. */
export interface ReportSummary {
  reportId: string;
  filename: string;
  pageCount: number;
  dataPointCount: number;
  targetFieldCount: number;
  extractionStatus: ExtractionStatus;
  createdAt: number;
  lastAccessAt: number;
}
