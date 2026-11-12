import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";
import { config } from "./config.js";

// Honor TRANSFORMERS_CACHE for the model directory so Docker images can
// bake the model in at build time. In local dev, fall back to the package
// default. Remote downloads are allowed (needed for first run).
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}
env.allowRemoteModels = true;
env.allowLocalModels = true;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", config.modelId) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

// Pre-load at startup so the first /embed call isn't slow.
export async function warmup(): Promise<void> {
  await getExtractor();
}

// Texts per ONNX inference call. ONNX runtime parallelises across the batch
// dimension across cores, so one fat call beats many small ones — but each
// item costs ~30 MB transient RAM during the forward pass. Configure via the
// INTERNAL_BATCH env var; default 64 fits the 4 OCPU / 24 GB Ampere A1 target.

export type EmbedKind = "query" | "passage";

// BGE models are trained with an instruction on the QUERY side only and with
// CLS pooling; MiniLM-style sentence models use mean pooling and no prefix.
const isBge = /bge/i.test(config.modelId);
const QUERY_PREFIX = isBge ? "Represent this sentence for searching relevant passages: " : "";
const POOLING: "cls" | "mean" = isBge ? "cls" : "mean";

export function prepareTexts(texts: string[], kind: EmbedKind): string[] {
  return kind === "query" && QUERY_PREFIX ? texts.map((t) => QUERY_PREFIX + t) : texts;
}

export async function embedTexts(rawTexts: string[], kind: EmbedKind = "passage"): Promise<number[][]> {
  if (rawTexts.length === 0) return [];
  const texts = prepareTexts(rawTexts, kind);
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += config.internalBatch) {
    const slice = texts.slice(i, i + config.internalBatch);
    const tensor = await extractor(slice, { pooling: POOLING, normalize: true });
    // tensor.tolist() returns number[][] — one row per input.
    const rows = tensor.tolist() as number[][];
    out.push(...rows);
  }
  return out;
}
