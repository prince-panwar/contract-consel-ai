export const ragConfig = {
  // Gemini 2.5 Flash: 1M context, generous free-tier TPM/RPM, strong JSON mode.
  // Flash-lite is cheaper/faster if quality is acceptable.
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingDim: 384,
  chunkTargetChars: 2000,
  chunkOverlapChars: 320,
  topK: 6,
  maxContextChars: 8000,
  sessionTtlMs: 30 * 60 * 1000,
  maxPdfBytes: 40 * 1024 * 1024,
  historyWindow: 10,
  cookieName: "cc_sid",
  // Extraction uses FIXED page-window chunks instead of "stuff the whole doc".
  // Per-call input stays small (~20-25k input tokens) and output stays small
  // (~30 rows fits in 8k output tokens with huge headroom). Small calls =
  // no output truncation, predictable TPM, failure isolation.
  extractionWindowPages: 40,
  extractionMaxOutputTokens: 8_192,
  extractionPacingMs: 1_000,
  extractionMaxPasses: 12,
  // Export
  exportMaxRows: 500,
} as const;
