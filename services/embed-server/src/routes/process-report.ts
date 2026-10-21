import type { FastifyInstance } from "fastify";
import { downloadPdfBuffer, getReports } from "../db.js";
import { extractPdfBuffer } from "../pdf.js";
import { chunkContract } from "../chunker.js";
import { embedTexts } from "../embedder.js";
import { config } from "../config.js";
import { Semaphore } from "../semaphore.js";
import { encryptText } from "../crypto.js";

// One ingestion at a time: each job already fans out across all cores, and
// two concurrent jobs can exceed the container's memory limit.
const ingestQueue = new Semaphore(1);
const queued = new Set<string>();

function enqueue(reportId: string): void {
  if (queued.has(reportId)) return;
  queued.add(reportId);
  void ingestQueue
    .run(() => processInBackground(reportId))
    .catch((err) => console.error(`[process-report] ${reportId} background task crashed:`, err))
    .finally(() => queued.delete(reportId));
}

/** Re-queue uploads a restart interrupted (still "processing" in Mongo). */
export async function resumeStuckReports(): Promise<void> {
  const reports = await getReports();
  const stuck = await reports
    .find({ processingStatus: "processing" }, { projection: { reportId: 1 } })
    .toArray();
  if (stuck.length > 0) console.log(`[process-report] resuming ${stuck.length} stuck report(s)`);
  for (const d of stuck) enqueue(String(d.reportId));
}

interface ProcessBody {
  reportId: unknown;
}

function encodeEmbedding(vector: number[]): string {
  const f32 = new Float32Array(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString("base64");
}

function partition<T>(items: T[], shards: number): T[][] {
  const out: T[][] = Array.from({ length: shards }, () => []);
  items.forEach((item, i) => {
    out[i % shards].push(item);
  });
  return out;
}

async function processInBackground(reportId: string): Promise<void> {
  const reports = await getReports();
  const startedAt = Date.now();
  console.log(`[process-report] ${reportId} starting`);
  try {
    const pdfBuffer = await downloadPdfBuffer(reportId);
    console.log(
      `[process-report] ${reportId} downloaded ${pdfBuffer.length} bytes from GridFS`,
    );

    const { pages } = await extractPdfBuffer(pdfBuffer);
    console.log(`[process-report] ${reportId} parsed ${pages.length} pages`);

    const chunks = chunkContract(pages);
    if (chunks.length === 0) {
      throw new Error(
        "No readable text found. Scanned/image-only PDFs need OCR and aren't supported yet.",
      );
    }
    console.log(`[process-report] ${reportId} ${chunks.length} chunks`);

    // Fan out chunks across config.fanout shards (FANOUT env var, default 4).
    // Roughly one shard per CPU core keeps the model cache hot per core.
    const indexed = chunks.map((c, i) => ({ idx: i, text: c.text }));
    const shards = partition(indexed, Math.min(config.fanout, indexed.length));
    const shardResults = await Promise.all(
      shards.map(async (shard) => {
        const vectors = await embedTexts(shard.map((s) => s.text));
        return shard.map((s, i) => ({ idx: s.idx, vector: vectors[i] }));
      }),
    );
    const merged = shardResults.flat();
    merged.sort((a, b) => a.idx - b.idx);
    const embeddingsB64 = merged.map((m) => encodeEmbedding(m.vector));

    // Contract text is encrypted at rest; embeddings (opaque vectors) are not.
    await reports.updateOne(
      { reportId },
      {
        $set: {
          chunks: chunks.map((c) => ({
            ...c,
            text: encryptText(c.text),
            heading: c.heading === null ? null : encryptText(c.heading),
          })),
          embeddingsB64,
          pages: pages.map((p) => ({ ...p, text: encryptText(p.text) })),
          pageCount: pages.length,
          processingStatus: "ready",
          processingError: null,
          lastAccessAt: Date.now(),
        },
      },
    );

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[process-report] ${reportId} done in ${elapsed}s (${chunks.length} chunks)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "processing failed";
    console.error(`[process-report] ${reportId} failed:`, message);
    try {
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
    } catch (writeErr) {
      console.error(
        `[process-report] ${reportId} could not write error state:`,
        writeErr,
      );
    }
  }
}

export function registerProcessReportRoute(app: FastifyInstance): void {
  app.post<{ Body: ProcessBody }>("/process-report", async (request, reply) => {
    const { reportId } = request.body ?? {};
    if (typeof reportId !== "string" || reportId.length === 0) {
      return reply.code(400).send({ error: "Body must be { reportId: string }" });
    }
    // 202 first, work next. Ingestion has its own queue, separate from the
    // query-side semaphore, so a long ingestion doesn't block query embeds.
    reply.code(202).send({ accepted: true, reportId });
    enqueue(reportId);
  });
}
