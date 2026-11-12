/**
 * Accuracy benchmark on CUAD (lawyer-labelled public contracts).
 *
 *   tsx --env-file=<env> bin/eval-cuad.ts --data cuad-eval.json --set dev \
 *       --mode focused --out results.json [--model gemini-2.5-flash] [--only 2] [--cache dir]
 *
 * <env> needs LLM_PROVIDER / LLM_API_KEY and EMBED_SERVICE_URL / EMBED_SERVICE_API_KEY
 * (a local embed-server). The data file comes from bin/eval-cuad-prepare.py.
 * Each contract runs through the same parse → chunk → embed → plan → extract code
 * as the app; only the database and the job queue are skipped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { extractPdfBuffer } from "../services/embed-server/src/pdf";
import { chunkContract } from "../services/embed-server/src/chunker";
import { embedWithModel } from "../lib/rag/embedder";
import type { Chunk, DataPoint, DataPointDefinition, ExtractionMode } from "../lib/rag/types";
import type { PdfPage } from "../lib/rag/pdf";
import { planExtraction, runPlannedPass, finishExtraction } from "../lib/extract/engine";
import { scoreDocument, sumTotals, totals, type FieldScore, type Totals } from "../lib/eval/score";
import { __setLlmForTests } from "../lib/llm/client";
import { claudeCliDispatcher, spend } from "./claude-cli-llm";

interface EvalContract {
  id: string;
  pdf: string;
  pages: number;
  gold: Record<string, string[]>;
}

interface EvalData {
  fields: DataPointDefinition[];
  [set: string]: EvalContract[] | DataPointDefinition[];
}

interface Processed {
  pages: PdfPage[];
  chunks: Chunk[];
  embeddings: number[][];
  embeddingModel: string;
}

const { values: args } = parseArgs({
  options: {
    data: { type: "string" },
    set: { type: "string", default: "dev" },
    mode: { type: "string", default: "focused" },
    model: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
    cache: { type: "string" },
    concurrency: { type: "string", default: "2" },
    // claude-cli:<model> runs the benchmark through headless Claude Code (public data only).
    llm: { type: "string" },
  },
});

if (!args.data) throw new Error("--data is required");
if (args.model) process.env.LLM_MODEL = args.model;
if (args.llm?.startsWith("claude-cli:")) {
  __setLlmForTests(claudeCliDispatcher(args.llm.slice("claude-cli:".length)));
}

async function processPdf(file: string, cacheDir: string | undefined): Promise<Processed> {
  const key = cacheDir ? path.join(cacheDir, path.basename(file).replace(/[^a-z0-9]+/gi, "_") + ".json") : null;
  if (key && existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  const { pages } = await extractPdfBuffer(readFileSync(file));
  const chunks = chunkContract(pages) as Chunk[];
  const { vectors, model } = await embedWithModel(chunks.map((c) => c.text), "passage");
  const out: Processed = { pages, chunks, embeddings: vectors.map((v) => Array.from(v)), embeddingModel: model };
  if (key) {
    mkdirSync(path.dirname(key), { recursive: true });
    writeFileSync(key, JSON.stringify(out));
  }
  return out;
}

async function runContract(c: EvalContract, fields: DataPointDefinition[]) {
  const started = Date.now();
  const doc = await processPdf(c.pdf, args.cache);
  const embeddings = doc.embeddings.map((v) => Float32Array.from(v));
  const { mode, plan, passesTotal } = await planExtraction(
    { pages: doc.pages, chunks: doc.chunks, embeddings, embeddingModel: doc.embeddingModel },
    fields,
    args.mode as ExtractionMode,
  );
  let points: DataPoint[] = [];
  for (let pass = 1; pass <= passesTotal; pass++) {
    const added = await runPlannedPass(
      { pages: doc.pages, chunks: doc.chunks },
      { mode, plan },
      pass,
      fields,
      points,
    );
    points = points.concat(added);
  }
  points = await finishExtraction(doc.pages, fields, points);
  const scores = scoreDocument(c.gold, points);
  return {
    id: c.id,
    pages: c.pages,
    mode,
    passes: passesTotal,
    seconds: Math.round((Date.now() - started) / 1000),
    totals: totals(scores, points),
    scores,
    points: points.map(({ field, value, quote, page, verified, source }) => ({
      field,
      value,
      quote,
      page,
      verified,
      source,
    })),
  };
}

async function main() {
  const data = JSON.parse(readFileSync(args.data!, "utf8")) as EvalData;
  let contracts = data[args.set!] as EvalContract[];
  if (!Array.isArray(contracts)) throw new Error(`no set "${args.set}" in ${args.data}`);
  if (args.only) contracts = contracts.slice(0, Number(args.only));

  const results: Awaited<ReturnType<typeof runContract>>[] = [];
  const failures: { id: string; error: string }[] = [];
  const queue = [...contracts];
  const workers = Array.from({ length: Number(args.concurrency) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const r = await runContract(c, data.fields);
        results.push(r);
        const t = r.totals;
        console.log(
          `${r.id.slice(0, 50).padEnd(50)} ${String(r.pages).padStart(4)}p ${r.mode.padEnd(8)} ` +
            `F1 ${t.f1.toFixed(2)} P ${t.precision.toFixed(2)} R ${t.recall.toFixed(2)} acc ${t.accuracy.toFixed(2)} ${r.seconds}s`,
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ id: c.id, error });
        console.error(`FAILED ${c.id}: ${error}`);
      }
    }
  });
  await Promise.all(workers);

  const all: Totals = sumTotals(results.map((r) => r.totals));
  const byField = new Map<string, Record<string, number>>();
  for (const r of results) {
    for (const s of r.scores as FieldScore[]) {
      const m = byField.get(s.field) ?? {};
      m[s.outcome] = (m[s.outcome] ?? 0) + 1;
      byField.set(s.field, m);
    }
  }
  console.log(
    `\nTOTAL ${results.length} contracts (${failures.length} failed): F1 ${all.f1.toFixed(3)} ` +
      `P ${all.precision.toFixed(3)} R ${all.recall.toFixed(3)} acc ${all.accuracy.toFixed(3)} ` +
      `hit ${all.hit} wrong ${all.wrong} missed ${all.missed} falseAlarm ${all.falseAlarm} ` +
      `unverified ${all.unverifiedQuotes}/${all.predictions}` +
      (spend.calls ? ` | ${spend.calls} calls, list-price equivalent $${spend.usd.toFixed(3)}` : ""),
  );
  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify(
        {
          set: args.set,
          mode: args.mode,
          model: args.llm ?? process.env.LLM_MODEL ?? "(default)",
          spendUsd: spend.usd,
          totals: all,
          byField: Object.fromEntries(byField),
          failures,
          results,
        },
        null,
        1,
      ),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
