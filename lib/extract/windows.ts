import type { PdfPage } from "../rag/pdf";

export interface PageWindow {
  /** 1-based, inclusive page numbers. */
  pageStart: number;
  pageEnd: number;
}

/**
 * Split a document into consecutive page windows of at most `maxChars` text
 * each, so a contract that fits the model's budget is read in ONE call (the
 * model then sees definitions, amendments and cross-references together),
 * and a longer one in as few calls as possible. A single page larger than
 * the budget gets a window of its own.
 */
export function pageWindows(pages: PdfPage[], maxChars: number): PageWindow[] {
  const out: PageWindow[] = [];
  let start: number | null = null;
  let end = 0;
  let chars = 0;
  for (const p of pages) {
    const n = p.text.length;
    if (start !== null && chars + n > maxChars) {
      out.push({ pageStart: start, pageEnd: end });
      start = null;
      chars = 0;
    }
    if (start === null) start = p.pageNumber;
    end = p.pageNumber;
    chars += n;
  }
  if (start !== null) out.push({ pageStart: start, pageEnd: end });
  return out;
}

export function documentChars(pages: PdfPage[]): number {
  return pages.reduce((n, p) => n + p.text.length, 0);
}
