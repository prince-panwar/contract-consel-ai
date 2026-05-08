import { ragConfig } from "../constants";

type Pipeline = (
  texts: string | string[],
  opts?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

// globalThis-backed so the embedder pipeline (and its 25MB model) survives
// Next.js dev HMR re-evaluation of this module.
const globalForEmbedder = globalThis as unknown as {
  __ccEmbedderPromise?: Promise<Pipeline>;
};

async function getPipeline(): Promise<Pipeline> {
  if (!globalForEmbedder.__ccEmbedderPromise) {
    globalForEmbedder.__ccEmbedderPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = false;
      // On Vercel/serverless, the package directory is read-only. The model
      // download (~25 MB) needs to land in /tmp, the only writable path.
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        env.cacheDir = "/tmp/xenova-cache";
      }
      return (await pipeline(
        "feature-extraction",
        ragConfig.embeddingModel,
      )) as unknown as Pipeline;
    })();
  }
  return globalForEmbedder.__ccEmbedderPromise;
}

function toVectors(data: Float32Array, count: number, dim: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    out.push(data.slice(i * dim, (i + 1) * dim));
  }
  return out;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getPipeline();
  const results: Float32Array[] = [];
  const batchSize = 16;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await pipe(batch, { pooling: "mean", normalize: true });
    const dim = output.dims[output.dims.length - 1];
    results.push(...toVectors(output.data, batch.length, dim));
  }
  return results;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await embed([text]);
  return v;
}

export async function warmEmbedder(): Promise<void> {
  await getPipeline();
}
