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
  // Words/phrases to locate the clause with static search (see lib/search).
  keywords?: string[];
}

// focused: static + semantic search picks the passages the LLM reads.
// thorough: the LLM reads every page in fixed windows.
export type ExtractionMode = "focused" | "thorough";

/** One LLM call in a focused run: these fields, read from these chunks. */
export interface PlanPass {
  fields: string[];
  chunkIds: string[];
}

export type ExtractionStatus =
  | "awaiting-config"
  | "pending"
  | "running"
  | "done"
  | "error";

export type ProcessingStatus = "processing" | "ready" | "error";

export interface Report {
  reportId: string;
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddings: Float32Array[];
  pages: PdfPage[];
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
  processingStatus: ProcessingStatus;
  processingError: string | null;
  extractionStatus: ExtractionStatus;
  extractionMode: ExtractionMode;
  extractionPlan: PlanPass[];
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number | null;
  createdAt: number;
  lastAccessAt: number;
  // Visibility: the uploader, plus users an admin shared it with. Admins see all.
  ownerUid: string | null;
  sharedWith: string[];
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
  processingStatus: ProcessingStatus;
  extractionStatus: ExtractionStatus;
  createdAt: number;
  lastAccessAt: number;
  ownerUid: string | null;
  sharedWith: string[];
}
