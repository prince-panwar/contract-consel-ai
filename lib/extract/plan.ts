import { ragConfig } from "../constants";
import { embed } from "../rag/embedder";
import type { Chunk, DataPointDefinition, PlanPass } from "../rag/types";
import { dot } from "../rag/retriever";
import { hybridRank } from "../search/keywords";

export function keywordsFor(field: DataPointDefinition): string[] {
  return field.keywords && field.keywords.length > 0 ? field.keywords : [field.name];
}

/**
 * Plan a focused extraction: for each field pick the passages that keyword
 * search (BM25) and embedding similarity agree matter most, then pack fields
 * into as few LLM calls as fit the per-call budget. Passages shared between
 * fields in the same call are sent once. Returns null when the selection
 * would cost about as much as reading the whole document.
 */
export async function planFocusedExtraction(
  chunks: Chunk[],
  embeddings: Float32Array[],
  fields: DataPointDefinition[],
): Promise<PlanPass[] | null> {
  const queries = fields.map((f) =>
    [f.name, f.description, keywordsFor(f).join(", ")].filter(Boolean).join(". "),
  );
  const queryVectors = await embed(queries);
  const charsById = new Map(chunks.map((c) => [c.id, c.text.length]));

  const perField = fields.map((field, i) => {
    const semantic = new Map(chunks.map((c, j) => [c.id, dot(queryVectors[i], embeddings[j])]));
    const ranked = hybridRank(chunks, keywordsFor(field), semantic, ragConfig.focusedChunksPerField);
    // Keyword matches are strong evidence; meaning-only matches fill in for
    // differently worded clauses but are capped so they don't flood the call.
    const picked = ranked.filter(
      (r, rank) => r.keywordScore > 0 || rank < ragConfig.focusedSemanticOnlyPerField,
    );
    return { name: field.name, chunkIds: picked.map((r) => r.id) };
  });

  const order = new Map(chunks.map((c, i) => [c.id, i]));
  const passes: PlanPass[] = [];
  let current: { fields: string[]; ids: Set<string>; chars: number } | null = null;
  for (const f of perField) {
    const added = f.chunkIds.filter((id) => !current?.ids.has(id));
    const addedChars = added.reduce((n, id) => n + (charsById.get(id) ?? 0), 0);
    if (!current || current.chars + addedChars > ragConfig.focusedPassChars) {
      if (current) passes.push(finish(current));
      current = { fields: [], ids: new Set(), chars: 0 };
    }
    current.fields.push(f.name);
    for (const id of f.chunkIds) {
      if (!current.ids.has(id)) {
        current.ids.add(id);
        current.chars += charsById.get(id) ?? 0;
      }
    }
  }
  if (current) passes.push(finish(current));

  // Not worth it when search can't narrow the document down (short contracts,
  // or many broad fields): signal the caller to read every page instead.
  const docChars = chunks.reduce((n, c) => n + c.text.length, 0);
  const sentChars = passes.reduce(
    (n, p) => n + p.chunkIds.reduce((m, id) => m + (charsById.get(id) ?? 0), 0),
    0,
  );
  if (sentChars >= docChars * ragConfig.focusedFallbackRatio) return null;
  return passes;

  function finish(p: { fields: string[]; ids: Set<string> }): PlanPass {
    // Document order reads more naturally than relevance order.
    const chunkIds = [...p.ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return { fields: p.fields, chunkIds };
  }
}
