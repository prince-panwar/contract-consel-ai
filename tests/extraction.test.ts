import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { JsonRequest } from "../lib/llm/client";
import type { DataPoint } from "../lib/rag/types";

// Small budgets so a few short pages exercise windows, focused search and
// definitions; set before the modules read their config.
process.env.EXTRACTION_FULL_CONTEXT_CHARS = "3000";
process.env.EXTRACTION_WINDOW_CHARS = "1500";
process.env.EMBED_SERVICE_URL = "http://embed.test";
process.env.EMBED_SERVICE_API_KEY = "test";
process.env.PRIVACY_MASK_PII = "false";

type Client = typeof import("../lib/llm/client");
type Engine = typeof import("../lib/extract/engine");
type Reconcile = typeof import("../lib/extract/reconcile");
type Prompts = typeof import("../lib/llm/prompts");
let __setLlmForTests: Client["__setLlmForTests"];
let geminiBackoffMs: Client["geminiBackoffMs"];
let planExtraction: Engine["planExtraction"];
let runPlannedPass: Engine["runPlannedPass"];
let finishExtraction: Engine["finishExtraction"];
let applyDecisions: Reconcile["applyDecisions"];
let buildReconcileMessage: Reconcile["buildReconcileMessage"];
let collapseDuplicates: Reconcile["collapseDuplicates"];
let reconcile: Reconcile["reconcile"];
let buildTargetedExtractionUserMessage: Prompts["buildTargetedExtractionUserMessage"];

before(async () => {
  ({ __setLlmForTests, geminiBackoffMs } = await import("../lib/llm/client"));
  ({ planExtraction, runPlannedPass, finishExtraction } = await import("../lib/extract/engine"));
  ({ applyDecisions, buildReconcileMessage, collapseDuplicates, reconcile } = await import("../lib/extract/reconcile"));
  ({ buildTargetedExtractionUserMessage } = await import("../lib/llm/prompts"));
});

const page = (pageNumber: number, text: string) => ({ pageNumber, text });
const pt = (field: string, value: string, quote: string, extra: Partial<DataPoint> = {}): DataPoint => ({
  id: `${field}-${value}`,
  field,
  value,
  quote,
  page: 1,
  verified: true,
  source: "extracted",
  ...extra,
});

const DEFINITIONS =
  'ARTICLE 1\nDEFINITIONS\n1.1 "Effective Date" means the date on which the last Party signs this Agreement, as set out on the signature page.\n1.2 "Territory" means the United States of America and Canada, together with their territories and possessions, as amended by the Parties in writing from time to time.\n1.3 "Products" means the products listed in Exhibit A.\nARTICLE 2\nTERM';

type Call = JsonRequest;
let calls: Call[] = [];
let respond: (req: Call) => unknown = () => ({ dataPoints: [] });

beforeEach(() => {
  calls = [];
  respond = () => ({ dataPoints: [] });
  __setLlmForTests(async (req) => {
    calls.push(req);
    return { data: respond(req), model: "test", stopReason: "stop" };
  });
});
after(() => __setLlmForTests(null));

const doc = (pages: { pageNumber: number; text: string }[]) => ({ pages, chunks: [], embeddings: [] });
const fields = [{ name: "Governing Law" }, { name: "Term" }];

describe("planExtraction", () => {
  test("a contract that fits the budget is read in one call, whatever mode was asked", async () => {
    const pages = [page(1, "a".repeat(1000)), page(2, "b".repeat(1000))];
    for (const mode of ["focused", "thorough"] as const) {
      const p = await planExtraction(doc(pages), fields, mode);
      assert.equal(p.mode, "thorough");
      assert.equal(p.passesTotal, 1);
      assert.deepEqual([p.plan[0].pageStart, p.plan[0].pageEnd], [1, 2]);
    }
  });

  test("a long contract in thorough mode is split into page windows covering every page", async () => {
    const pages = Array.from({ length: 6 }, (_, i) => page(i + 1, "x".repeat(700)));
    const p = await planExtraction(doc(pages), fields, "thorough");
    assert.equal(p.mode, "thorough");
    assert.deepEqual(
      p.plan.map((s) => [s.pageStart, s.pageEnd]),
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    );
    assert.equal(p.passesTotal, 3);
  });

  test("a long contract in focused mode uses search and falls back to windows when it can't narrow down", async () => {
    const pages = Array.from({ length: 6 }, (_, i) => page(i + 1, "governing law ".repeat(50)));
    const chunks = pages.map((p, i) => ({
      id: `c${i}`,
      text: p.text,
      heading: null,
      pageStart: p.pageNumber,
      pageEnd: p.pageNumber,
      charStart: 0,
      charEnd: p.text.length,
    }));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const { texts } = JSON.parse(init.body) as { texts: string[] };
      return new Response(JSON.stringify({ vectors: texts.map(() => [1, 0, 0]) }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const embeddings = chunks.map(() => Float32Array.from([1, 0, 0]));
      // Every chunk matches, so search would send everything: read in windows instead.
      const p = await planExtraction({ pages, chunks, embeddings }, fields, "focused");
      assert.equal(p.mode, "thorough");
      assert.ok(p.plan.every((s) => s.pageStart !== undefined));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("an empty document has no passes", async () => {
    const p = await planExtraction(doc([]), fields, "thorough");
    assert.equal(p.passesTotal, 0);
  });
});

describe("runPlannedPass", () => {
  const longPages = [
    page(1, DEFINITIONS + "\n" + "filler text ".repeat(80)),
    page(2, "ARTICLE 9\nGOVERNING LAW\nThis Agreement is governed by the laws of the State of New York. " + "filler ".repeat(120)),
    page(3, "ARTICLE 10\nTERM\nThe Term begins on the Effective Date and lasts five years. " + "filler ".repeat(120)),
  ];

  test("a window without the definitions gets them attached; quotes are verified against the whole document", async () => {
    const planned = await planExtraction(doc(longPages), fields, "thorough");
    assert.ok(planned.passesTotal >= 2);
    respond = () => ({
      dataPoints: [
        { field: "Governing Law", value: "New York", quote: "governed by the laws of the State of New York", page: 2 },
      ],
    });
    const second = planned.plan.findIndex((s) => (s.pageStart ?? 0) >= 2) + 1;
    const pts = await runPlannedPass(doc(longPages), planned, second, fields, []);
    assert.match(calls[0].userMessage, /CONTRACT DEFINITIONS/);
    assert.match(calls[0].userMessage, /"Effective Date" means/);
    assert.equal(pts.length, 1);
    assert.equal(pts[0].verified, true);
    assert.equal(pts[0].page, 2);
  });

  test("the window that holds the whole contract is sent without a duplicate definitions block", async () => {
    const short = [page(1, DEFINITIONS), page(2, "governed by the laws of the State of New York")];
    const planned = await planExtraction(doc(short), fields, "focused");
    await runPlannedPass(doc(short), planned, 1, fields, []);
    assert.doesNotMatch(calls[0].userMessage, /CONTRACT DEFINITIONS/);
  });

  test("an invented field or a quote the document doesn't contain is handled", async () => {
    const short = [page(1, "governed by the laws of the State of New York")];
    const planned = await planExtraction(doc(short), fields, "thorough");
    respond = () => ({
      dataPoints: [
        { field: "Made Up Field", value: "x", quote: "x", page: 1 },
        { field: "Term", value: "ten years", quote: "this sentence is not in the contract at all", page: 1 },
      ],
    });
    const pts = await runPlannedPass(doc(short), planned, 1, fields, []);
    assert.deepEqual(pts.map((p) => p.field), ["Term"]);
    assert.equal(pts[0].verified, false);
  });

  test("a legacy plan without page windows still runs (20-page windows by pass)", async () => {
    const short = [page(1, "governed by the laws of the State of New York")];
    await runPlannedPass(doc(short), { mode: "thorough", plan: [] }, 1, fields, []);
    assert.equal(calls.length, 1);
  });
});

describe("reconcile", () => {
  test("identical readings collapse without an LLM call, preferring a verified quote", async () => {
    const a = pt("Term", "Five years", "lasts five years", { verified: false });
    const b = pt("Term", "five years", "lasts five years from the Effective Date");
    const out = await reconcile([a, b], fields);
    assert.equal(calls.length, 0);
    assert.equal(out.length, 1);
    assert.equal(out[0].verified, true);
  });

  test("different readings go to one LLM call and the chosen one is kept, marked reconciled", async () => {
    const original = pt("Term", "Three years", "initial term of three years", { page: 3 });
    const amended = pt("Term", "Five years (amended)", "Section 9.1 is amended to read five years", { page: 40 });
    const law = pt("Governing Law", "New York", "laws of the State of New York");
    respond = () => ({ decisions: [{ field: "Term", candidate: 1, value: "Five years (as amended by s.9.1)" }] });
    const out = await reconcile([original, amended, law], fields);
    assert.equal(calls.length, 1);
    assert.match(calls[0].userMessage, /initial term of three years/);
    assert.match(calls[0].userMessage, /amended to read five years/);
    const term = out.filter((p) => p.field === "Term");
    assert.equal(term.length, 1);
    assert.equal(term[0].quote, amended.quote);
    assert.equal(term[0].value, "Five years (as amended by s.9.1)");
    assert.equal(term[0].reconciled, true);
    assert.ok(out.some((p) => p.field === "Governing Law"));
  });

  test("if the LLM call fails, every reading is kept", async () => {
    respond = () => {
      throw new Error("boom");
    };
    const out = await reconcile([pt("Term", "Three years", "q1"), pt("Term", "Five years", "q2")], fields);
    assert.equal(out.length, 2);
  });

  test("reviewer-added and AI-search rows are never merged away", async () => {
    const mine = pt("Term", "Four years", "q3", { source: "user-added" });
    const found = pt("Term", "Six years", "q4", { source: "ai-found" });
    const out = await reconcile([mine, found, pt("Term", "Three years", "q1")], fields);
    assert.equal(calls.length, 0);
    assert.equal(out.length, 3);
  });

  test("a decision with a bad candidate number keeps all readings for that field", () => {
    const c = [{ field: "Term", candidates: [pt("Term", "a", "q1"), pt("Term", "b", "q2")] }];
    assert.equal(applyDecisions(c, [{ field: "Term", candidate: 7, value: "x" }]).length, 2);
    assert.equal(applyDecisions(c, []).length, 2);
  });

  test("collapseDuplicates reports only real disagreements", () => {
    const { kept, conflicts } = collapseDuplicates([
      pt("Term", "a", "same quote"),
      pt("Term", "b", "Same  Quote!"),
      pt("Governing Law", "NY", "x"),
      pt("Governing Law", "Delaware", "y"),
    ]);
    assert.equal(kept.length, 1);
    assert.deepEqual(conflicts.map((c) => c.field), ["Governing Law"]);
  });

  test("the reconcile message carries descriptions, pages, verification and definitions", () => {
    const msg = buildReconcileMessage(
      [{ field: "Term", candidates: [pt("Term", "a", "q1", { page: 4, verified: false }), pt("Term", "b", "q2")] }],
      [{ name: "Term", description: "How long the agreement lasts" }],
      '"Term" means the Initial Term and any Renewal Term.',
    );
    assert.match(msg, /How long the agreement lasts/);
    assert.match(msg, /\[0\] page 4 \(quote not found verbatim\)/);
    assert.match(msg, /CONTRACT DEFINITIONS/);
  });

  test("finishExtraction reconciles with the contract's definitions attached", async () => {
    respond = () => ({ decisions: [{ field: "Term", candidate: 0, value: "Three years" }] });
    const out = await finishExtraction([page(1, DEFINITIONS)], fields, [pt("Term", "Three years", "q1"), pt("Term", "Five years", "q2")]);
    assert.equal(out.length, 1);
    assert.match(calls[0].userMessage, /"Territory" means/);
  });
});

describe("prompt and client details", () => {
  test("definitions are placed before the document text", () => {
    const msg = buildTargetedExtractionUserMessage([page(5, "BODY TEXT")], [{ name: "Term" }], false, "DEFS TEXT");
    assert.ok(msg.indexOf("DEFS TEXT") < msg.indexOf("BODY TEXT"));
    assert.match(msg, /<<<PAGE 5>>>/);
  });

  test("Gemini backoff grows to a minute and honours retry-after", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((a) => geminiBackoffMs(a, null)), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    assert.equal(geminiBackoffMs(3, 1_234), 1_234);
  });
});
