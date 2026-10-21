import { Readable } from "stream";
import { getPdfBucket } from "./mongo";
import { decryptBuffer, encryptBuffer } from "../crypto/content";

/**
 * Upload (or replace) the PDF for a report. We delete any existing files for
 * this reportId first so re-uploads don't accumulate.
 */
export async function uploadPdf(
  reportId: string,
  buffer: Buffer,
): Promise<void> {
  const bucket = await getPdfBucket();
  const existing = await bucket.find({ filename: reportId }).toArray();
  for (const f of existing) {
    await bucket.delete(f._id).catch(() => {});
  }
  const { data, encrypted } = encryptBuffer(buffer);
  await new Promise<void>((resolve, reject) => {
    const upload = bucket.openUploadStream(reportId, {
      metadata: { contentType: "application/pdf", encrypted },
    });
    Readable.from(data).pipe(upload).on("error", reject).on("finish", () => resolve());
  });
}

/**
 * Read the entire PDF for a report into memory and return it as a Buffer.
 * The route handler can then send the bytes; size is bounded by ragConfig.maxPdfBytes.
 */
export async function readPdf(reportId: string): Promise<Buffer | null> {
  const bucket = await getPdfBucket();
  const files = await bucket.find({ filename: reportId }).toArray();
  if (files.length === 0) return null;
  const file = files[0];
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const stream = bucket.openDownloadStream(file._id);
    const parts: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => parts.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(parts)));
  });
  return file.metadata?.encrypted ? decryptBuffer(raw) : raw;
}

export async function deletePdf(reportId: string): Promise<void> {
  const bucket = await getPdfBucket();
  const files = await bucket.find({ filename: reportId }).toArray();
  for (const f of files) {
    await bucket.delete(f._id).catch(() => {});
  }
}
