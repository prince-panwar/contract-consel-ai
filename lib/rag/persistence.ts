import { promises as fs } from "fs";
import path from "path";
import type { SessionDoc } from "./types";

const SESSIONS_DIR = path.join(process.cwd(), ".sessions");

interface SerializedSession {
  sessionId: string;
  filename: string;
  pageCount: number;
  chunks: SessionDoc["chunks"];
  // embeddings encoded as base64 of the packed Float32Array buffers
  embeddingsB64: string[];
  pages: SessionDoc["pages"];
  // pdfBytes stored in a sidecar file to keep JSON small
  dataPoints: SessionDoc["dataPoints"];
  extractionStatus: SessionDoc["extractionStatus"];
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  createdAt: number;
  lastAccessAt: number;
}

function jsonPath(id: string) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}
function pdfPath(id: string) {
  return path.join(SESSIONS_DIR, `${id}.pdf`);
}

async function ensureDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

async function atomicWrite(target: string, data: Buffer | string): Promise<void> {
  await ensureDir();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
}

function serialize(doc: SessionDoc): SerializedSession {
  return {
    sessionId: doc.sessionId,
    filename: doc.filename,
    pageCount: doc.pageCount,
    chunks: doc.chunks,
    embeddingsB64: doc.embeddings.map((v) =>
      Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64"),
    ),
    pages: doc.pages,
    dataPoints: doc.dataPoints,
    extractionStatus: doc.extractionStatus,
    extractionPassesDone: doc.extractionPassesDone,
    extractionPassesTotal: doc.extractionPassesTotal,
    extractionError: doc.extractionError,
    createdAt: doc.createdAt,
    lastAccessAt: doc.lastAccessAt,
  };
}

function deserialize(s: SerializedSession, pdfBytes: Buffer): SessionDoc {
  return {
    sessionId: s.sessionId,
    filename: s.filename,
    pageCount: s.pageCount,
    chunks: s.chunks,
    embeddings: s.embeddingsB64.map((b64) => {
      const buf = Buffer.from(b64, "base64");
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }),
    pages: s.pages,
    pdfBytes,
    dataPoints: s.dataPoints,
    extractionStatus: s.extractionStatus,
    extractionPassesDone: s.extractionPassesDone,
    extractionPassesTotal: s.extractionPassesTotal,
    extractionError: s.extractionError,
    createdAt: s.createdAt,
    lastAccessAt: s.lastAccessAt,
  };
}

export async function persistSession(doc: SessionDoc): Promise<void> {
  try {
    await ensureDir();
    // Write PDF once (if not already there) — it never changes after create.
    try {
      await fs.access(pdfPath(doc.sessionId));
    } catch {
      await atomicWrite(pdfPath(doc.sessionId), doc.pdfBytes);
    }
    await atomicWrite(
      jsonPath(doc.sessionId),
      JSON.stringify(serialize(doc)),
    );
  } catch (err) {
    console.warn("[persistence] persistSession failed:", err);
  }
}

export async function loadSessionFromDisk(sessionId: string): Promise<SessionDoc | null> {
  try {
    const [jsonBuf, pdfBuf] = await Promise.all([
      fs.readFile(jsonPath(sessionId), "utf8"),
      fs.readFile(pdfPath(sessionId)),
    ]);
    const parsed = JSON.parse(jsonBuf) as SerializedSession;
    return deserialize(parsed, pdfBuf);
  } catch {
    return null;
  }
}

export async function deleteSessionFromDisk(sessionId: string): Promise<void> {
  await Promise.all([
    fs.unlink(jsonPath(sessionId)).catch(() => {}),
    fs.unlink(pdfPath(sessionId)).catch(() => {}),
  ]);
}
