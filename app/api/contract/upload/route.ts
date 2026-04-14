import type { NextRequest } from "next/server";
import { ragConfig } from "@/lib/constants";
import { extractPdf } from "@/lib/rag/pdf";
import { chunkContract } from "@/lib/rag/chunker";
import { embed } from "@/lib/rag/embedder";
import {
  appendExtractedPoints,
  createSession,
  setExtractionPassesTotal,
  setExtractionStatus,
} from "@/lib/rag/vectorStore";
import {
  buildSessionCookie,
  newSessionId,
  resolveSessionId,
} from "@/lib/rag/session";
import { extractDataPoints } from "@/lib/extract/extractor";
import type { PdfPage } from "@/lib/rag/pdf";

export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Fire-and-forget background extraction — decoupled from the request
// lifecycle so it survives `after()` runtime quirks and platform freezes.
function runExtractionInBackground(sessionId: string, pages: PdfPage[]): void {
  void (async () => {
    const started = Date.now();
    const totalPasses = Math.min(
      Math.ceil(pages.length / ragConfig.extractionWindowPages),
      ragConfig.extractionMaxPasses,
    );
    console.log(
      `[extract] ${sessionId} starting — ${pages.length} pages, ${totalPasses} windows`,
    );
    setExtractionPassesTotal(sessionId, totalPasses);
    setExtractionStatus(sessionId, "running");
    try {
      await extractDataPoints(pages, async ({ pass, newPoints, firstPage, lastPage }) => {
        console.log(
          `[extract] ${sessionId} pass ${pass}/${totalPasses} done — pages ${firstPage}-${lastPage}, +${newPoints.length} points`,
        );
        appendExtractedPoints(sessionId, newPoints, pass);
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[extract] ${sessionId} done in ${elapsed}s`);
      setExtractionStatus(sessionId, "done", null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "extraction failed";
      console.error(`[extract] ${sessionId} failed:`, message);
      setExtractionStatus(sessionId, "error", message);
    }
  })().catch((err) => {
    console.error(`[extract] ${sessionId} background task crashed:`, err);
    try {
      setExtractionStatus(
        sessionId,
        "error",
        err instanceof Error ? err.message : "background task crashed",
      );
    } catch {
      /* ignore */
    }
  });
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

  const existingId = await resolveSessionId(request);
  const sessionId = existingId ?? newSessionId();

  const totalPasses = Math.min(
    Math.ceil(pages.length / ragConfig.extractionWindowPages),
    ragConfig.extractionMaxPasses,
  );

  createSession(sessionId, {
    filename: file.name,
    pageCount: pages.length,
    chunks,
    embeddings,
    pages,
    pdfBytes: buffer,
    dataPoints: [],
    extractionStatus: "pending",
    extractionPassesTotal: totalPasses,
  });

  runExtractionInBackground(sessionId, pages);

  return new Response(
    JSON.stringify({
      sessionId,
      filename: file.name,
      pageCount: pages.length,
      chunkCount: chunks.length,
      extractionStatus: "pending",
      extractionPassesTotal: totalPasses,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildSessionCookie(sessionId),
      },
    },
  );
}
