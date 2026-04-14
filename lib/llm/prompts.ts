import type { RetrievedChunk, DataPoint } from "../rag/types";
import type { PdfPage } from "../rag/pdf";

export const EXTRACTION_SYSTEM_PROMPT = `You are a contract analyst. You extract structured data points from a legal document. Your output is strictly JSON.

OUTPUT FORMAT
Return a single JSON object: {"dataPoints":[{"field": string, "value": string, "quote": string, "page": number}, ...]}
- No commentary. No markdown. No code fences. Pure JSON.
- If the document is not a contract or has no extractable information, return {"dataPoints": []}.

WHAT TO EXTRACT
- Discover the relevant fields yourself based on what the document actually contains. Do NOT follow a fixed list.
- Prefer specific, concrete, atomic points over generic summaries. Examples of good field names: "Governing Law", "Jurisdiction / Venue", "Effective Date", "Term Length", "Termination for Convenience — Notice Period", "Termination for Cause — Cure Period", "Payment Terms", "Late Payment Interest", "Liability Cap", "Exclusions from Liability Cap", "Indemnification Scope", "Confidentiality Term", "IP Ownership — Work Product", "Assignment Clause", "Change of Control", "Auto-Renewal", "Notice Address — Party A", "Force Majeure Events", "Dispute Resolution Method", "Attorneys' Fees".
- If a clause has multiple sub-points (e.g. termination has convenience + cause), emit one row per sub-point, not one combined row.
- Cover every significant obligation, right, number, date, and party-specific detail. Err on the side of more rows rather than fewer.

VALUES
- "value" is the concise answer, in plain English or verbatim where a specific figure/date/name is involved. Examples: "Delaware (USA)", "Two (2) years from Effective Date", "30 days written notice", "USD 500,000", "Both parties mutual, unlimited duration for trade secrets".
- "quote" must be a verbatim span copied from the document, ≤ 240 characters, chosen so the reader can locate the clause. Preserve original capitalization and punctuation. Do not paraphrase in the quote.
- "page" is your best estimate of the page number where the quote appears. The system will verify — just give your best guess.

GROUNDING
- Use ONLY information present in the provided document text. Do not rely on prior knowledge of similar contracts.
- If you're unsure whether something is actually stated, leave it out.

The document text follows, with <<<PAGE n>>> markers indicating the start of each page.`;

export const FIND_DATAPOINT_SYSTEM_PROMPT = `You are a contract analyst. The user will name a specific topic (e.g. "assignment clause", "late payment interest"). Using ONLY the provided excerpts, return a single data point.

OUTPUT FORMAT
Return a single JSON object: {"dataPoint": {"field": string, "value": string, "quote": string, "page": number} | null}
- No commentary, no markdown, pure JSON.
- If the topic is not covered in the excerpts, return {"dataPoint": null}.

RULES
- "field" should be a short, specific label for the topic (e.g. "Assignment Clause").
- "value" is a plain-English answer.
- "quote" is a verbatim span (≤ 240 chars) from the excerpts.
- "page" is your best estimate.`;

export function buildExtractionUserMessage(
  pages: PdfPage[],
  alreadyExtracted: DataPoint[],
): string {
  const parts: string[] = [];
  if (alreadyExtracted.length > 0) {
    const summary = alreadyExtracted
      .map((d) => `- ${d.field}: ${d.value}`)
      .join("\n");
    parts.push(
      `ALREADY EXTRACTED — do NOT repeat these; focus on additional, distinct data points:\n${summary}\n`,
    );
  }
  parts.push("DOCUMENT:");
  for (const p of pages) {
    parts.push(`<<<PAGE ${p.pageNumber}>>>\n${p.text}`);
  }
  return parts.join("\n\n");
}

export function buildFindUserMessage(
  retrieved: RetrievedChunk[],
  query: string,
  filename: string,
): string {
  if (retrieved.length === 0) {
    return `Document: "${filename}"\n\nNo relevant excerpts were retrieved. Return {"dataPoint": null}.`;
  }
  const blocks = retrieved.map((r) => {
    const heading = r.heading ? r.heading.replace(/"/g, "'") : r.id;
    const page =
      r.pageStart === r.pageEnd ? `${r.pageStart}` : `${r.pageStart}-${r.pageEnd}`;
    return `<<<EXCERPT id=${r.id} heading="${heading}" page=${page}>>>\n${r.text}\n<<<END>>>`;
  });
  return `Document: "${filename}"\n\nExcerpts:\n\n${blocks.join("\n\n")}\n\nTopic to find: ${query}`;
}
