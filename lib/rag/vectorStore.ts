import type { Chunk, DataPoint, ExtractionStatus, SessionDoc } from "./types";
import type { PdfPage } from "./pdf";
import { ragConfig } from "../constants";
import {
  deleteSessionFromDisk,
  loadSessionFromDisk,
  persistSession,
} from "./persistence";

// globalThis-backed singleton so the Map survives Next.js dev HMR re-evaluation
// of this module.
const globalForStore = globalThis as unknown as {
  __ccSessionStore?: Map<string, SessionDoc>;
  __ccHydrating?: Map<string, Promise<SessionDoc | null>>;
};
const store =
  globalForStore.__ccSessionStore ??
  (globalForStore.__ccSessionStore = new Map<string, SessionDoc>());
const hydrating =
  globalForStore.__ccHydrating ??
  (globalForStore.__ccHydrating = new Map<string, Promise<SessionDoc | null>>());

function schedulePersist(doc: SessionDoc): void {
  // Fire-and-forget disk write — don't block callers.
  void persistSession(doc);
}

interface CreateSessionPayload {
  filename: string;
  pageCount: number;
  chunks: Chunk[];
  embeddings: Float32Array[];
  pages: PdfPage[];
  pdfBytes: Buffer;
  dataPoints?: DataPoint[];
  extractionStatus?: ExtractionStatus;
  extractionPassesTotal?: number;
}

export function createSession(
  sessionId: string,
  payload: CreateSessionPayload,
): SessionDoc {
  const now = Date.now();
  const doc: SessionDoc = {
    sessionId,
    filename: payload.filename,
    pageCount: payload.pageCount,
    chunks: payload.chunks,
    embeddings: payload.embeddings,
    pages: payload.pages,
    pdfBytes: payload.pdfBytes,
    dataPoints: payload.dataPoints ?? [],
    extractionStatus: payload.extractionStatus ?? "pending",
    extractionPassesDone: 0,
    extractionPassesTotal: payload.extractionPassesTotal ?? 0,
    extractionError: null,
    createdAt: now,
    lastAccessAt: now,
  };
  store.set(sessionId, doc);
  schedulePersist(doc);
  return doc;
}

export function setExtractionStatus(
  sessionId: string,
  status: ExtractionStatus,
  error?: string | null,
): void {
  const doc = store.get(sessionId);
  if (!doc) return;
  doc.extractionStatus = status;
  if (error !== undefined) doc.extractionError = error;
  doc.lastAccessAt = Date.now();
  schedulePersist(doc);
}

export function setExtractionPassesTotal(sessionId: string, total: number): void {
  const doc = store.get(sessionId);
  if (!doc) return;
  doc.extractionPassesTotal = total;
  doc.lastAccessAt = Date.now();
  schedulePersist(doc);
}

export function appendExtractedPoints(
  sessionId: string,
  points: DataPoint[],
  passesDone: number,
): void {
  const doc = store.get(sessionId);
  if (!doc) return;
  doc.dataPoints.push(...points);
  doc.extractionPassesDone = passesDone;
  doc.lastAccessAt = Date.now();
  schedulePersist(doc);
}

export function getSession(sessionId: string | null | undefined): SessionDoc | null {
  if (!sessionId) return null;
  const doc = store.get(sessionId);
  if (!doc) return null;
  if (Date.now() - doc.lastAccessAt > ragConfig.sessionTtlMs) {
    store.delete(sessionId);
    void deleteSessionFromDisk(sessionId);
    return null;
  }
  doc.lastAccessAt = Date.now();
  return doc;
}

/**
 * Get a session, hydrating from disk if the in-memory Map misses.
 * Use this in route handlers so that a process-restart crash-recovers.
 */
export async function getSessionAsync(
  sessionId: string | null | undefined,
): Promise<SessionDoc | null> {
  if (!sessionId) return null;
  const existing = getSession(sessionId);
  if (existing) return existing;

  // Deduplicate concurrent hydrations for the same session id.
  let pending = hydrating.get(sessionId);
  if (!pending) {
    pending = loadSessionFromDisk(sessionId).then((doc) => {
      if (doc) {
        if (Date.now() - doc.lastAccessAt > ragConfig.sessionTtlMs) {
          void deleteSessionFromDisk(sessionId);
          return null;
        }
        store.set(sessionId, doc);
        doc.lastAccessAt = Date.now();
        return doc;
      }
      return null;
    });
    hydrating.set(sessionId, pending);
    pending.finally(() => hydrating.delete(sessionId));
  }
  return pending;
}

export function deleteSession(sessionId: string): boolean {
  const removed = store.delete(sessionId);
  void deleteSessionFromDisk(sessionId);
  return removed;
}

export function addDataPoint(sessionId: string, dp: DataPoint): DataPoint | null {
  const doc = getSession(sessionId);
  if (!doc) return null;
  doc.dataPoints.push(dp);
  schedulePersist(doc);
  return dp;
}

export function patchDataPoint(
  sessionId: string,
  id: string,
  patch: Partial<Pick<DataPoint, "field" | "value" | "quote" | "page">>,
): DataPoint | null {
  const doc = getSession(sessionId);
  if (!doc) return null;
  const dp = doc.dataPoints.find((p) => p.id === id);
  if (!dp) return null;
  if (patch.field !== undefined) dp.field = patch.field;
  if (patch.value !== undefined) dp.value = patch.value;
  if (patch.quote !== undefined) dp.quote = patch.quote;
  if (patch.page !== undefined) dp.page = patch.page;
  schedulePersist(doc);
  return dp;
}

export function removeDataPoint(sessionId: string, id: string): boolean {
  const doc = getSession(sessionId);
  if (!doc) return false;
  const before = doc.dataPoints.length;
  doc.dataPoints = doc.dataPoints.filter((p) => p.id !== id);
  const changed = doc.dataPoints.length < before;
  if (changed) schedulePersist(doc);
  return changed;
}

export function sweepStale(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, doc] of store.entries()) {
    if (now - doc.lastAccessAt > ragConfig.sessionTtlMs) {
      store.delete(id);
      void deleteSessionFromDisk(id);
      removed += 1;
    }
  }
  return removed;
}

export function sessionCount(): number {
  return store.size;
}
