export interface PdfPage {
  pageNumber: number;
  text: string;
}

let canvasPolyfilled: Promise<void> | null = null;

/**
 * pdfjs-dist (loaded by pdf-parse) references DOMMatrix / ImageData / Path2D
 * at module-load time. On Node serverless runtimes those globals don't exist,
 * so the import throws. We pull them from @napi-rs/canvas and stick them on
 * globalThis BEFORE we dynamic-import pdf-parse.
 */
async function ensureCanvasGlobals(): Promise<void> {
  if (canvasPolyfilled) return canvasPolyfilled;
  canvasPolyfilled = (async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.DOMMatrix && g.ImageData && g.Path2D) return;
    const canvas = await import("@napi-rs/canvas");
    if (!g.DOMMatrix) g.DOMMatrix = canvas.DOMMatrix;
    if (!g.ImageData) g.ImageData = canvas.ImageData;
    if (!g.Path2D) g.Path2D = canvas.Path2D;
  })();
  return canvasPolyfilled;
}

export async function extractPdf(buffer: Buffer): Promise<{
  pages: PdfPage[];
  fullText: string;
}> {
  await ensureCanvasGlobals();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages: PdfPage[] = result.pages.map((p) => ({
      pageNumber: p.num,
      text: normalize(p.text),
    }));
    const fullText = pages.map((p) => p.text).join("\n\n");
    return { pages, fullText };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
