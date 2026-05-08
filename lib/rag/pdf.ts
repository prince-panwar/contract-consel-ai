import { extractText, getDocumentProxy } from "unpdf";

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export async function extractPdf(buffer: Buffer): Promise<{
  pages: PdfPage[];
  fullText: string;
}> {
  // unpdf ships a serverless-friendly pdfjs build with the worker bundled
  // inline, so it works on Vercel/Cloudflare/Bun without DOM/canvas globals.
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  // unpdf returns string[] when mergePages is false.
  const perPage = Array.isArray(text) ? text : [text];
  const pages: PdfPage[] = perPage.map((t, i) => ({
    pageNumber: i + 1,
    text: normalize(typeof t === "string" ? t : ""),
  }));
  const fullText = pages.map((p) => p.text).join("\n\n");
  return { pages, fullText };
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
