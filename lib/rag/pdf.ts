import { PDFParse } from "pdf-parse";

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export async function extractPdf(buffer: Buffer): Promise<{
  pages: PdfPage[];
  fullText: string;
}> {
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
