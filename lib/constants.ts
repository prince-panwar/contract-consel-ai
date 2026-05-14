export const ragConfig = {
  // Gemini 2.5 Flash: 1M context, generous free-tier TPM/RPM, strong JSON mode.
  // Flash-lite is cheaper/faster if quality is acceptable.
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  // Embeddings + PDF parsing live on a self-hosted Node service (Oracle).
  // See services/embed-server/. URL/key are required at runtime.
  embeddingServiceUrl: process.env.EMBED_SERVICE_URL ?? "",
  embeddingServiceApiKey: process.env.EMBED_SERVICE_API_KEY ?? "",
  // all-MiniLM-L6-v2 produces 384-dim sentence embeddings.
  embeddingDim: 384,
  chunkTargetChars: 2000,
  chunkOverlapChars: 320,
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
  // Raised to fit ~80-120 rows per window. Output at 16k tokens = ~64KB
  // JSON, still fast to stream and parse.
  extractionMaxOutputTokens: 16_384,
  extractionPacingMs: 800,
  // Allow up to 400 pages / 20-page windows = 20 passes.
  extractionMaxPasses: 20,
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
