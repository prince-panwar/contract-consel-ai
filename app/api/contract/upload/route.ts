import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { ragConfig } from "@/lib/constants";
import { extractPdf } from "@/lib/rag/pdf";
import { chunkContract } from "@/lib/rag/chunker";
import { embed } from "@/lib/rag/embedder";
import { createReport } from "@/lib/db/reports";
import { uploadPdf } from "@/lib/db/pdfBlob";

export const runtime = "nodejs";
// Embedding + PDF parse run on a remote Oracle box; allow plenty of headroom
// for large contracts (each embed batch can take several seconds).
export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Invalid multipart body.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("Missing 'file' field.", 400);
  }

  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return jsonError("Only PDF uploads are supported.", 415);
  }

  if (file.size > ragConfig.maxPdfBytes) {
    return jsonError(
      `File too large. Max ${Math.round(ragConfig.maxPdfBytes / 1024 / 1024)} MB.`,
      413,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pages: Awaited<ReturnType<typeof extractPdf>>["pages"] = [];
  try {
    ({ pages } = await extractPdf(buffer));
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF parse failed.";
    return jsonError(`Could not parse PDF: ${message}`, 422);
  }

  const chunks = chunkContract(pages);
  if (chunks.length === 0) {
    return jsonError(
      "No readable text found. Scanned/image-only PDFs need OCR and aren't supported yet.",
      422,
    );
  }

  let embeddings: Float32Array[];
  try {
    embeddings = await embed(chunks.map((c) => c.text));
  } catch (err) {
    const message = err instanceof Error ? err.message : "embedding failed";
    return jsonError(`Embedding failed: ${message}`, 500);
  }

  const reportId = nanoid(16);

  try {
    await uploadPdf(reportId, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF upload failed";
    return jsonError(`Could not store PDF: ${message}`, 500);
  }

  await createReport({
    reportId,
    filename: file.name,
    pageCount: pages.length,
    chunks,
    embeddings,
    pages,
  });

  return Response.json({
    reportId,
    filename: file.name,
    pageCount: pages.length,
    chunkCount: chunks.length,
  });
}
