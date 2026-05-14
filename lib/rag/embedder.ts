import { requireEmbedServiceConfig } from "../constants";

// Embeddings live on a self-hosted Node service (services/embed-server/), not
// on Vercel. See that directory's README for deployment. The service returns
// 384-dim MiniLM vectors.

const EMBED_BATCH = 64;
const FETCH_TIMEOUT_MS = 30_000;

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
