import type { PdfPage } from "../rag/pdf";

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Letters and digits only. PDF text from tables often has no spaces between
// cells ("fee1.25%"), so a correct quote can only be matched this way.
function compact(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Pages are immutable once processed; normalize each page once per array
// instead of once per quote.
const normalizedCache = new WeakMap<
  PdfPage[],
  { spaced: Map<number, string>; compact: Map<number, string> }
>();

function normalizedPages(pages: PdfPage[]) {
  let entry = normalizedCache.get(pages);
  if (!entry) {
    entry = {
      spaced: new Map(pages.map((p) => [p.pageNumber, normalize(p.text)])),
      compact: new Map(pages.map((p) => [p.pageNumber, compact(p.text)])),
    };
    normalizedCache.set(pages, entry);
  }
  return entry;
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

  const { spaced: normalized, compact: compacted } = normalizedPages(pages);
  for (const pageNum of order) {
    const hay = normalized.get(pageNum);
    if (hay === undefined) continue;
    if (hay.includes(needle)) {
      return { page: pageNum, verified: true };
    }
  }

  const shortNeedle = needle.slice(0, 60);
  if (shortNeedle.length >= 12) {
    for (const pageNum of order) {
      const hay = normalized.get(pageNum);
      if (hay === undefined) continue;
      if (hay.includes(shortNeedle)) {
        return { page: pageNum, verified: true };
      }
    }
  }

  const compactNeedle = compact(quote).slice(0, 50);
  if (compactNeedle.length >= 20) {
    for (const pageNum of order) {
      if (compacted.get(pageNum)?.includes(compactNeedle)) {
        return { page: pageNum, verified: true };
      }
    }
  }

  return null;
}
