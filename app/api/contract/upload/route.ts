import type { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { ragConfig, requireEmbedServiceConfig } from "@/lib/constants";
import { createReportShell } from "@/lib/db/reports";
import { uploadPdf } from "@/lib/db/pdfBlob";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function triggerProcessing(reportId: string): void {
  let cfg: { url: string; apiKey: string };
  try {
    cfg = requireEmbedServiceConfig();
  } catch (err) {
    console.error(
      `[upload] ${reportId}: embed-service config missing — can't trigger processing`,
      err,
    );
    return;
  }
  // Fire-and-forget. The Oracle box responds 202 immediately and does the
  // real work in its own process. We don't await; the upload route returns
  // to the user as soon as the PDF + report shell are in MongoDB.
  void fetch(`${cfg.url}/process-report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
    },
    body: JSON.stringify({ reportId }),
    // Keep the connection budget tight; we only need the 202 to fly out.
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    console.error(`[upload] ${reportId}: failed to dispatch /process-report`, err);
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
  const reportId = nanoid(16);

  try {
    await uploadPdf(reportId, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF upload failed";
    return jsonError(`Could not store PDF: ${message}`, 500);
  }

  try {
    await createReportShell({ reportId, filename: file.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "report create failed";
    return jsonError(`Could not create report: ${message}`, 500);
  }

  triggerProcessing(reportId);

  return Response.json({
    reportId,
    filename: file.name,
    status: "processing",
    pageCount: 0,
    chunkCount: 0,
  });
}
