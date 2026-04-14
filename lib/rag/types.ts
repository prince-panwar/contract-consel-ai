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

export type ExtractionStatus = "pending" | "running" | "done" | "error";

export interface SessionDoc {
  sessionId: string;
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddings: Float32Array[];
  pages: PdfPage[];
  pdfBytes: Buffer;
  dataPoints: DataPoint[];
  extractionStatus: ExtractionStatus;
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  createdAt: number;
  lastAccessAt: number;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}
