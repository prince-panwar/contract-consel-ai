export const ragConfig = {
  // LLM provider/model are env-driven; see lib/llm/client.ts.
  // Embeddings + PDF parsing live on a self-hosted Node service (Oracle).
  // See services/embed-server/. URL/key are required at runtime.
  embeddingServiceUrl: process.env.EMBED_SERVICE_URL ?? "",
  embeddingServiceApiKey: process.env.EMBED_SERVICE_API_KEY ?? "",
  // all-MiniLM-L6-v2 produces 384-dim sentence embeddings.
  embeddingDim: 384,
  // MiniLM-L6 maxes at 256 input tokens (~1000 chars). Larger chunks were
  // silently truncated and burned tokenizer cycles on text the model never saw.
  chunkTargetChars: 1000,
  chunkOverlapChars: 160,
  topK: 6,
  maxContextChars: 8000,
  maxPdfBytes: 40 * 1024 * 1024,
  historyWindow: 10,
  // Extraction uses FIXED page-window chunks instead of "stuff the whole doc".
  // Per-call input stays small (~20-25k input tokens) and output stays small
  // (~30 rows fits in 8k output tokens with huge headroom). Small calls =
  // no output truncation, predictable TPM, failure isolation.
  // Smaller windows = tighter LLM focus, denser recall. 20 pages ≈ 40-50k
  // input chars (~10-12k tokens), well within any tier.
  extractionWindowPages: 20,
  // ~80-120 rows per window is ~16k tokens of JSON; the rest is headroom for
  // adaptive thinking, which counts against max_tokens.
  extractionMaxOutputTokens: 32_000,
  // Allow up to 400 pages / 20-page windows = 20 passes.
  extractionMaxPasses: 20,
  // Focused mode: at most this many passages per field (keyword matches
  // first; passages found only by meaning are capped lower), and the most
  // excerpt text packed into one LLM call (~10k tokens).
  focusedChunksPerField: 6,
  focusedSemanticOnlyPerField: 3,
  focusedPassChars: 40_000,
  // If the focused selection would send at least this share of what reading
  // every page costs, read every page instead: cheaper and complete.
  focusedFallbackRatio: 0.8,
  // Export
  exportMaxRows: 500,
} as const;

export function requireEmbedServiceConfig(): { url: string; apiKey: string } {
  if (!ragConfig.embeddingServiceUrl) {
    throw new Error("EMBED_SERVICE_URL is not set.");
  }
  if (!ragConfig.embeddingServiceApiKey) {
    throw new Error("EMBED_SERVICE_API_KEY is not set.");
  }
  return {
    url: ragConfig.embeddingServiceUrl.replace(/\/+$/, ""),
    apiKey: ragConfig.embeddingServiceApiKey,
  };
}
