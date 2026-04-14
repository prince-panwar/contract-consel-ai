import type { PdfPage } from "../rag/pdf";

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface LocateResult {
  page: number;
  verified: boolean;
}

export function locateQuote(
  quote: string,
  pages: PdfPage[],
  hint?: number,
): LocateResult | null {
  if (!quote || pages.length === 0) return null;
  const needle = normalize(quote).slice(0, 200);
  if (needle.length < 8) return null;

  const order =
    hint && hint >= 1 && hint <= pages.length
      ? [hint, ...pages.map((p) => p.pageNumber).filter((n) => n !== hint)]
      : pages.map((p) => p.pageNumber);

  for (const pageNum of order) {
    const page = pages.find((p) => p.pageNumber === pageNum);
    if (!page) continue;
    const hay = normalize(page.text);
    if (hay.includes(needle)) {
      return { page: pageNum, verified: true };
    }
  }

  const shortNeedle = needle.slice(0, 60);
  if (shortNeedle.length >= 12) {
    for (const pageNum of order) {
      const page = pages.find((p) => p.pageNumber === pageNum);
      if (!page) continue;
      const hay = normalize(page.text);
      if (hay.includes(shortNeedle)) {
        return { page: pageNum, verified: true };
      }
    }
  }

  return null;
}
