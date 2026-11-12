import { generateJson } from "../llm/client";
import type { DataPoint, DataPointDefinition } from "../rag/types";

/**
 * After every window or excerpt batch has been read, a field can carry several
 * different answers (the original term and its amendment, the general rule and
 * its exception). Reviewers saw them side by side with nothing saying which
 * one governs. This step leaves one answer per field: identical readings are
 * merged without an LLM call, real disagreements go to one LLM call that picks
 * the governing provision. Rows added by reviewers or AI search are never touched.
 */

export const RECONCILE_SYSTEM_PROMPT = `You are a senior contract analyst reviewing a junior's extraction. For each field below, the same contract was read in parts and produced several candidate answers, each with a verbatim quote and page. Decide which candidate states what governs this contract.

RULES
- Prefer, in order: an amendment or later-dated provision over the original; a "notwithstanding" clause or specific exception over the general rule; an operative clause over a recital, definition, summary, heading or table of contents; a verified quote over an unverified one.
- Pick exactly ONE candidate per field by its number. Its quote is kept as the citation.
- Write "value" as the final plain-English answer. You may fold in material details from the other candidates (e.g. "30 days' notice; 10 days for non-payment (s.12.3)"), but never state anything the candidates don't support.
- Use the contract definitions, when given, to interpret terms.

OUTPUT: a single JSON object {"decisions":[{"field": string, "candidate": integer, "value": string}]}, one decision per field listed. No commentary.`;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface Conflict {
  field: string;
  candidates: DataPoint[];
}

/**
 * Collapse duplicate readings and return the fields that still disagree.
 * `kept` is every point that survives without needing an LLM decision.
 */
export function collapseDuplicates(points: DataPoint[]): { kept: DataPoint[]; conflicts: Conflict[] } {
  const byField = new Map<string, DataPoint[]>();
  const kept: DataPoint[] = [];
  for (const p of points) {
    if (p.source !== "extracted") {
      kept.push(p);
      continue;
    }
    const list = byField.get(p.field) ?? [];
    list.push(p);
    byField.set(p.field, list);
  }
  const conflicts: Conflict[] = [];
  for (const [field, list] of byField) {
    // Same quote twice (overlapping windows) is the same reading.
    const unique: DataPoint[] = [];
    for (const p of list) {
      const dup = unique.find((u) => norm(u.quote) === norm(p.quote) || norm(u.value) === norm(p.value));
      if (!dup) unique.push(p);
      else if (!dup.verified && p.verified) unique[unique.indexOf(dup)] = p;
    }
    if (unique.length === 1) kept.push(unique[0]);
    else conflicts.push({ field, candidates: unique });
  }
  return { kept, conflicts };
}

export function buildReconcileMessage(
  conflicts: Conflict[],
  fields: DataPointDefinition[],
  definitions?: string,
): string {
  const desc = new Map(fields.map((f) => [f.name, f.description?.trim()]));
  const blocks = conflicts.map((c) => {
    const d = desc.get(c.field);
    const cands = c.candidates
      .map(
        (p, i) =>
          `  [${i}] page ${p.page}${p.verified ? "" : " (quote not found verbatim)"}: ${p.value}\n      quote: "${p.quote}"`,
      )
      .join("\n");
    return `FIELD "${c.field}"${d ? ` — ${d}` : ""}\n${cands}`;
  });
  const defs = definitions ? `CONTRACT DEFINITIONS:\n${definitions}\n\n` : "";
  return `${defs}${blocks.join("\n\n")}`;
}

interface Decision {
  field?: unknown;
  candidate?: unknown;
  value?: unknown;
}

export function applyDecisions(conflicts: Conflict[], decisions: Decision[]): DataPoint[] {
  const out: DataPoint[] = [];
  for (const c of conflicts) {
    const d = decisions.find((x) => x.field === c.field);
    const idx = typeof d?.candidate === "number" ? d.candidate : Number.NaN;
    const chosen = Number.isInteger(idx) ? c.candidates[idx] : undefined;
    if (!chosen) {
      // No usable decision: keep every reading rather than drop one silently.
      out.push(...c.candidates);
      continue;
    }
    const value = typeof d?.value === "string" && d.value.trim() ? d.value.trim() : chosen.value;
    out.push({ ...chosen, value, reconciled: true });
  }
  return out;
}

export async function reconcile(
  points: DataPoint[],
  fields: DataPointDefinition[],
  definitions?: string,
): Promise<DataPoint[]> {
  const { kept, conflicts } = collapseDuplicates(points);
  if (conflicts.length === 0) return kept;
  const names = conflicts.map((c) => c.field);
  try {
    const res = await generateJson<{ decisions: Decision[] }>({
      system: RECONCILE_SYSTEM_PROMPT,
      userMessage: buildReconcileMessage(conflicts, fields, definitions),
      schema: {
        type: "object",
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", enum: names },
                candidate: { type: "integer" },
                value: { type: "string" },
              },
              required: ["field", "candidate", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["decisions"],
        additionalProperties: false,
      },
      maxTokens: 16_000,
      effort: "medium",
    });
    const decisions = Array.isArray(res.data?.decisions) ? res.data.decisions : [];
    console.log(`[extract]   reconciled ${conflicts.length} field(s) with conflicting readings`);
    return [...kept, ...applyDecisions(conflicts, decisions)];
  } catch (err) {
    // Reconciling is an improvement, not a requirement: keep all readings.
    console.warn(`[extract]   reconcile failed, keeping all readings: ${err instanceof Error ? err.message : err}`);
    return [...kept, ...conflicts.flatMap((c) => c.candidates)];
  }
}
