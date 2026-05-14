import type { FastifyInstance } from "fastify";
import type { Semaphore } from "../semaphore.js";
import { extractPdfBuffer } from "../pdf.js";

export function registerParsePdfRoute(app: FastifyInstance, gate: Semaphore): void {
  app.post("/parse-pdf", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Missing 'file' multipart field." });
    }
    const buffer = await file.toBuffer();
    const { pages, fullText } = await gate.run(() => extractPdfBuffer(buffer));
    return reply.send({ pages, fullText });
  });
}
