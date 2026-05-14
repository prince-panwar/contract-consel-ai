import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { warmup } from "./embedder.js";
import { Semaphore } from "./semaphore.js";
import { registerEmbedRoute } from "./routes/embed.js";
import { registerParsePdfRoute } from "./routes/parse-pdf.js";
import { registerProcessReportRoute } from "./routes/process-report.js";

async function main() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
    bodyLimit: config.maxUploadBytes,
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
    },
  });

  // API key gate. /health is the only public endpoint.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const provided = request.headers["x-api-key"];
    if (provided !== config.apiKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true, model: config.modelId }));

  const gate = new Semaphore(config.maxConcurrency);
  registerEmbedRoute(app, gate);
  registerParsePdfRoute(app, gate);
  registerProcessReportRoute(app);

  app.log.info("Pre-loading embedding model...");
  await warmup();
  app.log.info("Model loaded.");

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`embed-server listening on :${config.port} (max concurrency ${config.maxConcurrency})`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
