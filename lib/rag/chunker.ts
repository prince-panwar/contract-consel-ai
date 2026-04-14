import type { Chunk } from "./types";
import type { PdfPage } from "./pdf";
import { ragConfig } from "../constants";

const HEADING_RE =
  /^\s*(?:(?:ARTICLE|SECTION|CLAUSE|EXHIBIT|SCHEDULE|APPENDIX|PART)\s+[IVXLC0-9]+(?:[.:\s-][^\n]{0,120})?|\d+(?:\.\d+)*\s+[A-Z][^\n]{0,120})\s*$/m;

function findHeadings(text: string): Array<{ index: number; heading: string }> {
  const lines = text.split("\n");
  const out: Array<{ index: number; heading: string }> = [];
  let cursor = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 140 && HEADING_RE.test(trimmed)) {
      out.push({ index: cursor, heading: trimmed });
    }
    cursor += line.length + 1;
  }
  return out;
}

function pageAt(offset: number, pageOffsets: number[]): number {
  let lo = 0,
    hi = pageOffsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageOffsets[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}

function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z(\[])/);
  return parts.filter((p) => p.trim().length > 0);
}

function slidingWindow(
  text: string,
  baseOffset: number,
  target: number,
  overlap: number,
): Array<{ text: string; charStart: number; charEnd: number }> {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  const out: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let buf = "";
  let bufStart = 0;
  let pos = 0;
  for (const s of sentences) {
    const idx = text.indexOf(s, pos);
    if (idx < 0) continue;
    if (buf.length === 0) bufStart = idx;
    if (buf.length + s.length + 1 > target && buf.length > 0) {
      out.push({
        text: buf.trim(),
        charStart: baseOffset + bufStart,
        charEnd: baseOffset + bufStart + buf.length,
      });
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      const tailStart = bufStart + buf.length - tail.length;
      buf = tail + " " + s;
      bufStart = tailStart;
    } else {
      buf = buf.length === 0 ? s : buf + " " + s;
    }
    pos = idx + s.length;
  }
  if (buf.trim().length > 0) {
    out.push({
      text: buf.trim(),
      charStart: baseOffset + bufStart,
      charEnd: baseOffset + bufStart + buf.length,
    });
  }
  return out;
}

export function chunkContract(pages: PdfPage[]): Chunk[] {
  const pageOffsets: number[] = [];
  let full = "";
  for (const p of pages) {
    pageOffsets.push(full.length);
    full += p.text + "\n\n";
  }
  const cleaned = full.trim();
  if (!cleaned) return [];

  const headings = findHeadings(cleaned);
  const sections: Array<{
    heading: string | null;
    start: number;
    end: number;
  }> = [];

  if (headings.length === 0) {
    sections.push({ heading: null, start: 0, end: cleaned.length });
  } else {
    if (headings[0].index > 0) {
      sections.push({ heading: null, start: 0, end: headings[0].index });
    }
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index : cleaned.length;
      sections.push({ heading: headings[i].heading, start, end });
    }
  }

  const { chunkTargetChars, chunkOverlapChars } = ragConfig;
  const chunks: Chunk[] = [];
  let idx = 0;
  for (const sec of sections) {
    const sectionText = cleaned.slice(sec.start, sec.end).trim();
    if (!sectionText) continue;

    if (sectionText.length <= chunkTargetChars) {
      const charStart = sec.start;
      const charEnd = sec.start + sectionText.length;
      chunks.push({
        id: `c_${idx++}`,
        text: sectionText,
        heading: sec.heading,
        pageStart: pageAt(charStart, pageOffsets),
        pageEnd: pageAt(charEnd, pageOffsets),
        charStart,
        charEnd,
      });
      continue;
    }

    const pieces = slidingWindow(
      sectionText,
      sec.start,
      chunkTargetChars,
      chunkOverlapChars,
    );
    for (const p of pieces) {
      chunks.push({
        id: `c_${idx++}`,
        text: p.text,
        heading: sec.heading,
        pageStart: pageAt(p.charStart, pageOffsets),
        pageEnd: pageAt(p.charEnd, pageOffsets),
        charStart: p.charStart,
        charEnd: p.charEnd,
      });
    }
  }
  return chunks;
}
