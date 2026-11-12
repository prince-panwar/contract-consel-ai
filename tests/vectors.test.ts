import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

process.env.EMBED_SERVICE_URL = "http://embed.test";
process.env.EMBED_SERVICE_API_KEY = "test";

type Vectors = typeof import("../lib/rag/vectors");
let queryAndChunkVectors: Vectors["queryAndChunkVectors"];

interface Posted {
  texts: string[];
  kind: string;
}
let posted: Posted[] = [];
let serverModel: string | undefined = "Xenova/bge-small-en-v1.5";
const realFetch = globalThis.fetch;

before(async () => {
  ({ queryAndChunkVectors } = await import("../lib/rag/vectors"));
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Posted;
    posted.push(body);
    const vectors = body.texts.map((t) => [t.length, body.kind === "query" ? 1 : 0, 0]);
    return new Response(JSON.stringify(serverModel ? { vectors, model: serverModel } : { vectors }), { status: 200 });
  }) as unknown as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  posted = [];
  serverModel = "Xenova/bge-small-en-v1.5";
});

const chunk = (id: string, text: string) => ({
  id,
  text,
  heading: null,
  pageStart: 1,
  pageEnd: 1,
  charStart: 0,
  charEnd: text.length,
});
const chunks = [chunk("a", "alpha clause"), chunk("b", "beta")];
const stored = [Float32Array.from([9, 9, 9]), Float32Array.from([8, 8, 8])];

describe("queryAndChunkVectors", () => {
  test("same model: stored chunk vectors are reused, only the query is embedded (as a query)", async () => {
    let saved = false;
    const r = await queryAndChunkVectors(
      { chunks, embeddings: stored, embeddingModel: "Xenova/bge-small-en-v1.5" },
      ["governing law"],
      async () => {
        saved = true;
      },
    );
    assert.equal(posted.length, 1);
    assert.equal(posted[0].kind, "query");
    assert.equal(r.chunkVectors, stored);
    assert.equal(saved, false);
  });

  test("a report from before the upgrade (no model recorded) is re-embedded once and saved", async () => {
    let savedModel = "";
    let savedCount = 0;
    const r = await queryAndChunkVectors({ chunks, embeddings: stored }, ["term"], async (v, model) => {
      savedModel = model;
      savedCount = v.length;
    });
    assert.deepEqual(posted.map((p) => p.kind), ["query", "passage"]);
    assert.deepEqual(posted[1].texts, ["alpha clause", "beta"]);
    assert.equal(r.chunkVectors.length, 2);
    assert.notEqual(r.chunkVectors, stored);
    assert.equal(savedModel, "Xenova/bge-small-en-v1.5");
    assert.equal(savedCount, 2);
  });

  test("an old embed-server that reports no model is treated as MiniLM, matching legacy reports", async () => {
    serverModel = undefined;
    const r = await queryAndChunkVectors({ chunks, embeddings: stored }, ["term"]);
    assert.equal(posted.length, 1);
    assert.equal(r.chunkVectors, stored);
  });

  test("a vector count that doesn't match the chunks forces a re-embed", async () => {
    const r = await queryAndChunkVectors(
      { chunks, embeddings: [stored[0]], embeddingModel: "Xenova/bge-small-en-v1.5" },
      ["term"],
    );
    assert.equal(posted.length, 2);
    assert.equal(r.chunkVectors.length, 2);
  });
});
