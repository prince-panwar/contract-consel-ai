import type { Chunk } from "./types";
import { embedWithModel, LEGACY_EMBEDDING_MODEL } from "./embedder";

export interface EmbeddedDoc {
  chunks: Chunk[];
  embeddings: Float32Array[];
  /** Model the stored embeddings came from; unset on reports from before it was recorded. */
  embeddingModel?: string;
}

export type SaveEmbeddings = (vectors: Float32Array[], model: string) => Promise<void>;

/**
 * Embed search queries and return them with chunk vectors from the SAME model.
 * Vectors from different models can't be compared, so a report embedded with
 * an older model (e.g. MiniLM before the bge upgrade) is re-embedded once, and
 * `save` stores the new vectors so the next search is instant.
 */
export async function queryAndChunkVectors(
  doc: EmbeddedDoc,
  queries: string[],
  save?: SaveEmbeddings,
): Promise<{ queryVectors: Float32Array[]; chunkVectors: Float32Array[] }> {
  const q = await embedWithModel(queries, "query");
  const stored = doc.embeddingModel ?? LEGACY_EMBEDDING_MODEL;
  if (q.model === stored && doc.embeddings.length === doc.chunks.length) {
    return { queryVectors: q.vectors, chunkVectors: doc.embeddings };
  }
  console.log(`[embed] re-embedding ${doc.chunks.length} chunks: ${stored} -> ${q.model}`);
  const re = await embedWithModel(
    doc.chunks.map((c) => c.text),
    "passage",
  );
  if (save) await save(re.vectors, re.model);
  return { queryVectors: q.vectors, chunkVectors: re.vectors };
}
