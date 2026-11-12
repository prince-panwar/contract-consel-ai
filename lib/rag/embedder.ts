import { requireEmbedServiceConfig } from "../constants";

// Embeddings live on a self-hosted Node service (services/embed-server/).
// It returns 384-dim vectors plus the id of the model that made them, so
// reports embedded with an older model can be re-embedded (lib/rag/vectors.ts).

export type EmbedKind = "query" | "passage";

// Chunks bundled into one /embed HTTP call. Default 24 is tuned for
// cross-region Vercel → Oracle latency; bump via EMBED_BATCH env var when
// pointing at a beefier embed server (e.g. local box via ngrok).
function readBatchSize(): number {
  const raw = process.env.EMBED_BATCH;
  if (!raw) return 24;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Invalid integer for EMBED_BATCH: ${raw}`);
  }
  return n;
}
const EMBED_BATCH = readBatchSize();
const FETCH_TIMEOUT_MS = 90_000;

async function postEmbed(
  texts: string[],
  kind: EmbedKind,
): Promise<{ vectors: Float32Array[]; model: string }> {
  if (texts.length === 0) return { vectors: [], model: "" };
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
      body: JSON.stringify({ texts, kind }),
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

  const data = (await response.json()) as { vectors?: unknown; model?: unknown };
  if (!Array.isArray(data.vectors) || data.vectors.length !== texts.length) {
    throw new Error(
      `embed-server returned ${Array.isArray(data.vectors) ? data.vectors.length : 0} vectors for ${texts.length} inputs.`,
    );
  }
  const vectors = data.vectors.map((v, i) => {
    if (!Array.isArray(v) || !v.every((n) => typeof n === "number")) {
      throw new Error(`embed-server returned non-numeric vector at index ${i}.`);
    }
    return new Float32Array(v as number[]);
  });
  // Servers before the model upgrade don't report one: that was MiniLM.
  return { vectors, model: typeof data.model === "string" ? data.model : LEGACY_EMBEDDING_MODEL };
}

/** The model every report was embedded with before reports recorded it. */
export const LEGACY_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export async function embedWithModel(
  texts: string[],
  kind: EmbedKind = "passage",
): Promise<{ vectors: Float32Array[]; model: string }> {
  const out: Float32Array[] = [];
  let model = "";
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = await postEmbed(texts.slice(i, i + EMBED_BATCH), kind);
    out.push(...res.vectors);
    model = res.model;
  }
  return { vectors: out, model };
}

export async function embed(texts: string[], kind: EmbedKind = "passage"): Promise<Float32Array[]> {
  return (await embedWithModel(texts, kind)).vectors;
}

export async function embedOne(text: string, kind: EmbedKind = "query"): Promise<Float32Array> {
  const [v] = await embed([text], kind);
  return v;
}
