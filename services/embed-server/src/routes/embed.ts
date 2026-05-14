import type { FastifyInstance } from "fastify";
import { embedTexts } from "../embedder.js";
import type { Semaphore } from "../semaphore.js";

interface EmbedBody {
  texts: unknown;
}

export function registerEmbedRoute(app: FastifyInstance, gate: Semaphore): void {
  app.post<{ Body: EmbedBody }>("/embed", async (request, reply) => {
    const { texts } = request.body ?? {};
    if (!Array.isArray(texts) || !texts.every((t) => typeof t === "string")) {
      return reply.code(400).send({ error: "Body must be { texts: string[] }" });
    }
    if (texts.length === 0) {
      return reply.send({ vectors: [] });
    }
    const vectors = await gate.run(() => embedTexts(texts));
    return reply.send({ vectors });
  });
}
