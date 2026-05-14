import pdfParse from "pdf-parse";
import type { PdfPage } from "./chunker.js";

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

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
  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData: PdfPageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      let pageText = "";
      for (const item of content.items) {
        pageText += item.str;
        if (item.hasEOL) pageText += "\n";
      }
      collected.push(pageText);
      return pageText;
    },
  });

  const pages: PdfPage[] = collected.map((t, i) => ({
    pageNumber: i + 1,
    text: normalize(t),
  }));
  const fullText = parsed.text
    ? normalize(parsed.text)
    : pages.map((p) => p.text).join("\n\n");
  return { pages, fullText };
}
