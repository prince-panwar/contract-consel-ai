// Scores extracted data points against lawyer-labelled gold spans (CUAD format:
// for each field, the clause texts a lawyer highlighted, or none if absent).
// Pure functions, so the scoring itself is unit-tested (tests/score.test.ts).

export interface ScoredPoint {
  field: string;
  quote: string;
  value: string;
  verified: boolean;
  /** "not-found" rows are the extractor saying the field is absent. */
  source?: string;
}

export type CellOutcome =
  | "hit" // gold present, a prediction cites a gold span
  | "wrong" // gold present, predictions cite other text
  | "missed" // gold present, nothing predicted
  | "false-alarm" // gold absent, something predicted
  | "correct-absent"; // gold absent, nothing predicted

export interface FieldScore {
  field: string;
  outcome: CellOutcome;
}

export interface Totals {
  hit: number;
  wrong: number;
  missed: number;
  falseAlarm: number;
  correctAbsent: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of all cells (present and absent) judged correctly. */
  accuracy: number;
  predictions: number;
  unverifiedQuotes: number;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

function bag(ts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Share of `a`'s tokens that also occur in `b` (multiset). */
function coverage(a: string[], b: Map<string, number>): number {
  if (a.length === 0) return 0;
  const left = new Map(b);
  let n = 0;
  for (const t of a) {
    const c = left.get(t) ?? 0;
    if (c > 0) {
      n += 1;
      left.set(t, c - 1);
    }
  }
  return n / a.length;
}

/**
 * True when a quote and a gold span point at the same clause: most of the
 * quote lies inside the span (quote is a fragment of a long clause), or most
 * of the span lies inside the quote (span is a short date or name).
 */
export function quoteMatchesSpan(quote: string, span: string, threshold = 0.6): boolean {
  const q = tokens(quote);
  const s = tokens(span);
  if (q.length === 0 || s.length === 0) return false;
  return coverage(q, bag(s)) >= threshold || coverage(s, bag(q)) >= threshold;
}

export function scoreField(field: string, gold: string[], predicted: ScoredPoint[]): FieldScore {
  const preds = predicted.filter((p) => p.field === field && p.source !== "not-found");
  const present = gold.some((g) => g.trim().length > 0);
  if (!present) return { field, outcome: preds.length > 0 ? "false-alarm" : "correct-absent" };
  if (preds.length === 0) return { field, outcome: "missed" };
  const hit = preds.some((p) => gold.some((g) => quoteMatchesSpan(p.quote, g)));
  return { field, outcome: hit ? "hit" : "wrong" };
}

export function scoreDocument(
  gold: Record<string, string[]>,
  predicted: ScoredPoint[],
): FieldScore[] {
  return Object.keys(gold).map((f) => scoreField(f, gold[f], predicted));
}

export function totals(scores: FieldScore[], predicted: ScoredPoint[]): Totals {
  const count = (o: CellOutcome) => scores.filter((s) => s.outcome === o).length;
  const hit = count("hit");
  const wrong = count("wrong");
  const missed = count("missed");
  const falseAlarm = count("false-alarm");
  const correctAbsent = count("correct-absent");
  // A wrong citation is both a bad prediction and a missed clause.
  const precision = hit + wrong + falseAlarm === 0 ? 0 : hit / (hit + wrong + falseAlarm);
  const recall = hit + wrong + missed === 0 ? 0 : hit / (hit + wrong + missed);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const real = predicted.filter((p) => p.source !== "not-found");
  return {
    hit,
    wrong,
    missed,
    falseAlarm,
    correctAbsent,
    precision,
    recall,
    f1,
    accuracy: scores.length === 0 ? 0 : (hit + correctAbsent) / scores.length,
    predictions: real.length,
    unverifiedQuotes: real.filter((p) => !p.verified).length,
  };
}

export function sumTotals(all: Totals[]): Totals {
  const sum = (k: keyof Totals) => all.reduce((n, t) => n + (t[k] as number), 0);
  const hit = sum("hit");
  const wrong = sum("wrong");
  const missed = sum("missed");
  const falseAlarm = sum("falseAlarm");
  const correctAbsent = sum("correctAbsent");
  const precision = hit + wrong + falseAlarm === 0 ? 0 : hit / (hit + wrong + falseAlarm);
  const recall = hit + wrong + missed === 0 ? 0 : hit / (hit + wrong + missed);
  const cells = hit + wrong + missed + falseAlarm + correctAbsent;
  return {
    hit,
    wrong,
    missed,
    falseAlarm,
    correctAbsent,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    accuracy: cells === 0 ? 0 : (hit + correctAbsent) / cells,
    predictions: sum("predictions"),
    unverifiedQuotes: sum("unverifiedQuotes"),
  };
}
