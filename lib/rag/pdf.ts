import { requireEmbedServiceConfig } from "../constants";

// PDF parsing happens on the self-hosted Node service (services/embed-server/)
// so we can use pdf-parse without serverless-runtime workarounds.

const FETCH_TIMEOUT_MS = 90_000;

export interface PdfPage {
  pageNumber: number;
  text: string;
}

interface ParseResponse {
  pages?: unknown;
  fullText?: unknown;
}

export async function extractPdf(buffer: Buffer): Promise<{
  pages: PdfPage[];
  fullText: string;
}> {
  const { url, apiKey } = requireEmbedServiceConfig();

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
    "upload.pdf",
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${url}/parse-pdf`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `embed-server /parse-pdf timed out after ${FETCH_TIMEOUT_MS / 1000}s. Box may be overloaded.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`embed-server ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as ParseResponse;
  if (!Array.isArray(data.pages)) {
    throw new Error("embed-server /parse-pdf returned no pages array.");
  }

  const pages: PdfPage[] = data.pages.map((p, i) => {
    if (
      p &&
      typeof p === "object" &&
      typeof (p as { text?: unknown }).text === "string"
    ) {
      const pageNumber =
        typeof (p as { pageNumber?: unknown }).pageNumber === "number"
          ? (p as { pageNumber: number }).pageNumber
          : i + 1;
      return { pageNumber, text: (p as { text: string }).text };
    }
    throw new Error(`embed-server /parse-pdf returned malformed page at index ${i}.`);
  });

  const fullText =
    typeof data.fullText === "string"
      ? data.fullText
      : pages.map((p) => p.text).join("\n\n");

  return { pages, fullText };
}
