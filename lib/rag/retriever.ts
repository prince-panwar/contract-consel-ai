import type { Chunk, RetrievedChunk } from "./types";

interface RetrievableDoc {
  chunks: Chunk[];
  embeddings: Float32Array[];
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

export function retrieve(
  doc: RetrievableDoc,
  queryEmbedding: Float32Array,
  k: number,
): RetrievedChunk[] {
  const scored: RetrievedChunk[] = doc.chunks.map((chunk, i) => ({
    ...chunk,
    score: dot(queryEmbedding, doc.embeddings[i]),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
