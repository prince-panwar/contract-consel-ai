import type { PdfPage } from "../rag/pdf";

/**
 * The contract's defined terms, sent along with every partial read (a page
 * window or search excerpts) so the model interprets "Effective Date",
 * "Products" or "Territory" the way the contract defines them, even when the
 * definitions are 40 pages away from the clause being read.
 */

// A heading line that opens a definitions section: "1. DEFINITIONS",
// "ARTICLE 1 – DEFINITIONS AND INTERPRETATION", "Section 1.1 Defined Terms".
const DEFINITIONS_HEADING =
  /^\s*(?:(?:ARTICLE|Article|SECTION|Section|CLAUSE|Clause)\s+)?(?:[0-9IVX]+(?:\.[0-9]+)*\.?\s*)?[-–—:.]?\s*(?:DEFINITIONS?|Definitions?|DEFINED TERMS|Defined Terms|DEFINITIONS AND INTERPRETATION|Definitions and Interpretation|INTERPRETATION|Interpretation)\b[^\n]{0,60}$/gm;

function isDefinitionsHeading(line: string): boolean {
  DEFINITIONS_HEADING.lastIndex = 0;
  const hit = DEFINITIONS_HEADING.test(line);
  DEFINITIONS_HEADING.lastIndex = 0;
  return hit;
}

// The next top-level heading ends the section: "ARTICLE 2", "2. LICENSE GRANT".
const TOP_HEADING =
  /^\s*(?:(?:ARTICLE|Article|SECTION|Section)\s+[0-9IVX]+\b|[0-9]{1,2}\.?\s+[A-Z][A-Z ,;&'-]{3,80})\s*$/;

// "Affiliate" means ... / "Term" shall have the meaning ...
const MEANS =
  /[“"]([A-Z][^"”\n]{1,60})[”"]\s+(?:shall\s+)?(?:means?|has the meaning|have the meaning|shall have the meaning|refers to)\b[^.;\n]{0,260}/g;
// ... Acme Corp., a Delaware corporation ("Licensor") ...
const PAREN =
  /([^.;()\n]{0,160})\((?:the |each,? a |each |collectively,? the |collectively |hereinafter(?: referred to as)? )?[“"]([A-Z][^"”\n]{1,40})[”"]\)/g;

export interface DefinitionsContext {
  text: string;
  /** Pages the definitions section spans, so callers can skip windows that already contain it. */
  pages: number[];
}

function sectionFrom(
  pages: PdfPage[],
  maxChars: number,
): DefinitionsContext | null {
  for (let i = 0; i < pages.length; i++) {
    for (const m of pages[i].text.matchAll(DEFINITIONS_HEADING)) {
      // A table-of-contents line is not followed by actual definitions.
      if (
        !/\bmeans?\b|meaning|refers? to/i.test(
          pages[i].text.slice(m.index, m.index + 2_000),
        )
      )
        continue;
      const out: string[] = [];
      const used: number[] = [];
      let chars = 0;
      let done = false;
      for (let j = i; j < pages.length && !done; j++) {
        const text = j === i ? pages[i].text.slice(m.index) : pages[j].text;
        used.push(pages[j].pageNumber);
        for (const line of text.split("\n")) {
          const ends =
            chars > 400 &&
            TOP_HEADING.test(line) &&
            !isDefinitionsHeading(line);
          if (ends || chars >= maxChars) {
            done = true;
            break;
          }
          out.push(line);
          chars += line.length + 1;
        }
      }
      const body = out.join("\n").trim().slice(0, maxChars);
      // A table-of-contents entry or a cross-reference, not the section itself.
      if (body.length < 300 || !/\bmeans?\b|meaning|refers? to/i.test(body))
        continue;
      return { text: body, pages: used };
    }
  }
  return null;
}

function inlineDefinitions(
  pages: PdfPage[],
  maxChars: number,
  skip: Set<number>,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const p of pages) {
    if (skip.has(p.pageNumber)) continue;
    const found: Array<[string, string]> = [];
    for (const m of p.text.matchAll(MEANS)) found.push([m[1], m[0]]);
    for (const m of p.text.matchAll(PAREN)) found.push([m[2], m[0]]);
    for (const [term, snippet] of found) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const line = `- (p.${p.pageNumber}) ${snippet.replace(/\s+/g, " ").trim()}`;
      if (chars + line.length > maxChars) return out.join("\n");
      out.push(line);
      chars += line.length + 1;
    }
  }
  return out.join("\n");
}

export function findDefinitions(
  pages: PdfPage[],
  maxChars = 12_000,
): DefinitionsContext | null {
  const section = sectionFrom(pages, maxChars);
  const skip = new Set(section?.pages ?? []);
  const remaining = maxChars - (section?.text.length ?? 0);
  const inline =
    remaining > 500 ? inlineDefinitions(pages, remaining, skip) : "";
  if (!section && !inline) return null;
  const parts: string[] = [];
  if (section)
    parts.push(
      `Definitions section (from page ${section.pages[0]}):\n${section.text}`,
    );
  if (inline) parts.push(`Terms defined elsewhere in the contract:\n${inline}`);
  return { text: parts.join("\n\n"), pages: section?.pages ?? [] };
}
