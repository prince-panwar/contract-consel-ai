import { requireEmbedServiceConfig } from "../constants";

// Embeddings live on a self-hosted Node service (services/embed-server/), not
// on Vercel. See that directory's README for deployment. The service returns
// 384-dim MiniLM vectors.

// Keep batches small so each HTTP call finishes well under the per-request
// timeout. On a 1 OCPU Oracle box, ~24 sequences ≈ 2 internal batches of 16
// ≈ 3-5 s, which leaves comfortable headroom for cross-region latency.
const EMBED_BATCH = 24;
const FETCH_TIMEOUT_MS = 90_000;

async function postEmbed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const { url, apiKey } = requireEmbedServiceConfig();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${url}/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `embed-server /embed timed out after ${FETCH_TIMEOUT_MS / 1000}s (${texts.length} chunks). Box may be overloaded.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`embed-server ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { vectors?: unknown };
  if (!Array.isArray(data.vectors) || data.vectors.length !== texts.length) {
    throw new Error(
      `embed-server returned ${Array.isArray(data.vectors) ? data.vectors.length : 0} vectors for ${texts.length} inputs.`,
    );
  }
  return data.vectors.map((v, i) => {
    if (!Array.isArray(v) || !v.every((n) => typeof n === "number")) {
      throw new Error(`embed-server returned non-numeric vector at index ${i}.`);
    }
    return new Float32Array(v as number[]);
  });
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const vectors = await postEmbed(batch);
    out.push(...vectors);
  }
  return out;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await postEmbed([text]);
  return v;
}
