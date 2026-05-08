import { ragConfig } from "../constants";
import { getGenAI } from "../llm/client";

// Gemini embedding API. Pure HTTP — no native deps, serverless-clean.
// Each request can embed up to 100 inputs and ~2k tokens per input.
const BATCH_SIZE = 50;

async function embedBatch(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const ai = getGenAI();
  const response = await ai.models.embedContent({
    model: ragConfig.embeddingModel,
    contents: texts,
    config: { taskType, outputDimensionality: ragConfig.embeddingDim },
  });
  const list = response.embeddings;
  if (!Array.isArray(list) || list.length !== texts.length) {
    throw new Error(
      `Gemini embedContent returned ${list?.length ?? 0} vectors for ${texts.length} inputs.`,
    );
  }
  return list.map((e) => {
    const values = e.values;
    if (!Array.isArray(values)) {
      throw new Error("Gemini embedding response missing values array.");
    }
    return new Float32Array(values);
  });
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch, "RETRIEVAL_DOCUMENT");
    out.push(...vectors);
  }
  return out;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await embedBatch([text], "RETRIEVAL_QUERY");
  return v;
}
