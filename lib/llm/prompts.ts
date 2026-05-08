import type { DataPointDefinition, RetrievedChunk } from "../rag/types";
import type { PdfPage } from "../rag/pdf";

export const TARGETED_EXTRACTION_SYSTEM_PROMPT = `You are a forensic contract analyst. The user has identified a SPECIFIC list of data points they need extracted from this section of a contract. Your job is to look diligently for each item on the list and emit one row per item that is genuinely covered by the section.

OUTPUT FORMAT
Return a single JSON object: {"dataPoints":[{"field": string, "value": string, "quote": string, "page": number}, ...]}
- No commentary, no markdown, no code fences. Pure JSON.
- If the section does not address ANY of the requested items, return {"dataPoints": []}.

RULES
- "field" MUST exactly match one of the names in the user's target list (case-sensitive). Never invent fields outside the list.
- For each target field, search the section carefully — including synonyms, defined terms, and section headings — before deciding it is absent. Use the optional descriptions the user provides as guidance for what they mean.
- Emit AT MOST ONE row per target field per call. If the section addresses a field in multiple places, pick the most specific or governing instance.
- If a target field has multiple distinct sub-points (e.g. "Termination" with for-cause and for-convenience), prefer the umbrella answer for this section; the user can ask follow-up questions later.
- If the section is silent on a target field, OMIT it entirely. Do not return rows with empty values or "Not specified".

VALUES
- "value": concise plain-English answer, or verbatim figure/date/name when specificity matters.
  Examples: "Delaware (USA)", "Two (2) years from Effective Date", "30 days written notice", "USD 500,000".

QUOTES (critical for traceability)
- "quote": a VERBATIM span copied directly from the section text, 20-200 characters, chosen so a reader can locate the clause. Preserve original capitalization and punctuation. Never paraphrase.
- The quote MUST appear literally in the text you were given. If you can't find a clean span, pick a distinctive 10-20 word fragment.

PAGES
- "page": the page number where the quote appears — use the <<<PAGE n>>> markers. Best-effort; the system verifies.

GROUNDING
- Use ONLY the provided text. Do not use outside knowledge to fill gaps. If a target field is not in the text, do not emit it.`;

export const FIND_DATAPOINT_SYSTEM_PROMPT = `You are a contract analyst. The user will name a specific topic (e.g. "assignment clause", "late payment interest"). Using ONLY the provided excerpts, return a single data point.

OUTPUT FORMAT
Return a single JSON object: {"dataPoint": {"field": string, "value": string, "quote": string, "page": number} | null}
- No commentary, no markdown, pure JSON.
- If the topic is not covered in the excerpts, return {"dataPoint": null}.

RULES
- "field": short, specific label for the topic (e.g. "Assignment Clause").
- "value": plain-English answer.
- "quote": verbatim span (≤ 240 chars) from the excerpts.
- "page": best estimate.`;

export function buildTargetedExtractionUserMessage(
  pages: PdfPage[],
  targetFields: DataPointDefinition[],
): string {
  const targetList = targetFields
    .map((f, i) => {
      const desc = f.description?.trim();
      return desc
        ? `${i + 1}. "${f.name}" — ${desc}`
        : `${i + 1}. "${f.name}"`;
    })
    .join("\n");
  const docParts: string[] = ["DOCUMENT SECTION:"];
  for (const p of pages) {
    docParts.push(`<<<PAGE ${p.pageNumber}>>>\n${p.text}`);
  }
  return `TARGET DATA POINTS (look for each one diligently — return rows only for those genuinely covered by this section):\n${targetList}\n\n${docParts.join("\n\n")}`;
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
