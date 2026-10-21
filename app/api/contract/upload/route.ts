import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { ragConfig, requireEmbedServiceConfig } from "@/lib/constants";
import { createReportShell, markProcessingError } from "@/lib/db/reports";
import { uploadPdf } from "@/lib/db/pdfBlob";
import { requireUser } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// The embed server answers 202 immediately and processes in its own process.
// Awaiting that 202 (not the processing) means a dispatch failure is written
// to the report instead of leaving it stuck on "processing" forever.
async function triggerProcessing(reportId: string): Promise<string | null> {
  try {
    const cfg = requireEmbedServiceConfig();
    const res = await fetch(`${cfg.url}/process-report`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({ reportId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 202) return `embed server answered ${res.status}`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "dispatch failed";
  }
}

export async function POST(request: NextRequest) {
  const g = await requireUser(request, "reviewer");
  if ("response" in g) return g.response;
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
  const reportId = nanoid(16);

  try {
    await uploadPdf(reportId, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF upload failed";
    return jsonError(`Could not store PDF: ${message}`, 500);
  }

  try {
    await createReportShell({ reportId, filename: file.name, ownerUid: g.user.uid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "report create failed";
    return jsonError(`Could not create report: ${message}`, 500);
  }

  const dispatchError = await triggerProcessing(reportId);
  if (dispatchError) {
    console.error(`[upload] ${reportId}: could not start processing: ${dispatchError}`);
    await markProcessingError(reportId, "Processing service unreachable. Try uploading again.");
    return jsonError("Processing service is unavailable. Please try again shortly.", 503);
  }

  await audit(request, g.user, "report.uploaded", { reportId, detail: { bytes: file.size } });
  return Response.json({
    reportId,
    filename: file.name,
    status: "processing",
    pageCount: 0,
    chunkCount: 0,
  });
}
