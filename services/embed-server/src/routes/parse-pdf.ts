import type { FastifyInstance } from "fastify";
import pdfParse from "pdf-parse";
import type { Semaphore } from "../semaphore.js";

interface PdfPage {
  pageNumber: number;
  text: string;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function registerParsePdfRoute(app: FastifyInstance, gate: Semaphore): void {
  app.post("/parse-pdf", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Missing 'file' multipart field." });
    }
    const buffer = await file.toBuffer();

    const { pages, fullText } = await gate.run(async () => {
      const collected: string[] = [];
      // pdf-parse calls pagerender per page; capture text in order.
      const parsed = await pdfParse(buffer, {
        pagerender: async (pageData: {
          getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{ items: Array<{ str: string; hasEOL?: boolean }> }>;
        }) => {
          const content = await pageData.getTextContent({
            normalizeWhitespace: true,
            disableCombineTextItems: false,
          });
          let pageText = "";
          for (const item of content.items) {
            pageText += item.str;
            if (item.hasEOL) pageText += "\n";
          }
          collected.push(pageText);
          // Returning the page text also drives `parsed.text` for fullText.
          return pageText;
        },
      });

      const pages: PdfPage[] = collected.map((t, i) => ({
        pageNumber: i + 1,
        text: normalize(t),
      }));
      const fullText = parsed.text ? normalize(parsed.text) : pages.map((p) => p.text).join("\n\n");
      return { pages, fullText };
    });

    return reply.send({ pages, fullText });
  });
}
