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

// Internal batch size — keeps tensor allocations bounded on a 1 GB box.
const INTERNAL_BATCH = 16;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += INTERNAL_BATCH) {
    const slice = texts.slice(i, i + INTERNAL_BATCH);
    const tensor = await extractor(slice, { pooling: "mean", normalize: true });
    // tensor.tolist() returns number[][] — one row per input.
    const rows = tensor.tolist() as number[][];
    out.push(...rows);
  }
  return out;
}
