import pdfParse from "pdf-parse";
import type { PdfPage } from "./chunker.js";
import { assemblePageText, type PdfTextItem } from "./text-layout.js";
import { needsOcr, ocrPages } from "./ocr.js";

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPageData {
  getTextContent: (opts: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<PdfTextContent>;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfBuffer(buffer: Buffer): Promise<{
  pages: PdfPage[];
  fullText: string;
}> {
  const collected: string[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: PdfPageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const pageText = assemblePageText(content.items);
      collected.push(pageText);
      return pageText;
    },
  });

  const pages: PdfPage[] = collected.map((t, i) => ({
    pageNumber: i + 1,
    text: normalize(t),
  }));

  // Scanned pages have no text layer: read them with OCR.
  const scanned = pages.filter((p) => needsOcr(p.text)).map((p) => p.pageNumber);
  if (scanned.length > 0) {
    const ocr = await ocrPages(buffer, scanned);
    for (const p of pages) {
      const text = ocr.get(p.pageNumber);
      if (text) p.text = normalize(text);
    }
    console.log(`[pdf] ${scanned.length} page(s) without a text layer, ${ocr.size} recovered by OCR`);
  }
  // Built from the pages so it includes OCR'd text and the line/space fixes.
  const fullText = pages.map((p) => p.text).join("\n\n");
  return { pages, fullText };
}
