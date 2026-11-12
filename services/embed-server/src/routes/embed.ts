import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { embedTexts } from "../embedder.js";
import type { Semaphore } from "../semaphore.js";

interface EmbedBody {
  texts: unknown;
  /** "query" for search queries, "passage" (default) for document text. */
  kind?: unknown;
}

export function registerEmbedRoute(app: FastifyInstance, gate: Semaphore): void {
  app.post<{ Body: EmbedBody }>("/embed", async (request, reply) => {
    const { texts, kind } = request.body ?? {};
    if (!Array.isArray(texts) || !texts.every((t) => typeof t === "string")) {
      return reply.code(400).send({ error: "Body must be { texts: string[] }" });
    }
    if (texts.length === 0) {
      return reply.send({ vectors: [], model: config.modelId });
    }
    const k = kind === "query" ? "query" : "passage";
    const vectors = await gate.run(() => embedTexts(texts, k));
    // The model id lets the app spot reports embedded with an older model.
    return reply.send({ vectors, model: config.modelId });
  });
}
