// Static (non-LLM) search over contract text: keyword/phrase matching with
// BM25 ranking, fused with embedding similarity for hybrid retrieval.
//
// Keyword syntax: plain words or phrases ("governed by"), case-insensitive,
// matched on word boundaries regardless of line breaks or punctuation.
// A trailing * matches word prefixes ("terminat*" → terminate, termination).

export interface SearchDoc {
  id: string;
  text: string;
}

interface IndexedDoc {
  id: string;
  words: string[];
}

interface Index {
  docs: IndexedDoc[];
  avgLen: number;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’.][\p{L}\p{N}]+)*/gu;

function tokenize(text: string): string[] {
  // PDF table text often glues cells together ("SameGraduation", "fee1.25%");
  // split before a Capitalized word that follows 3+ letters (keeps "McDonald",
  // "iPhone" intact) and at letter→digit boundaries.
  const separated = text
    .replace(/(?<=\p{L}\p{Ll}{2})(?=\p{Lu}\p{Ll})/gu, " ")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2");
  return (separated.toLowerCase().match(WORD_RE) ?? []).map((w) => w.replace(/’/g, "'"));
}

// Documents are immutable once processed; index each array once.
const indexCache = new WeakMap<SearchDoc[], Index>();

function getIndex(docs: SearchDoc[]): Index {
  let index = indexCache.get(docs);
  if (!index) {
    const indexed = docs.map((d) => ({ id: d.id, words: tokenize(d.text) }));
    const total = indexed.reduce((n, d) => n + d.words.length, 0);
    index = { docs: indexed, avgLen: indexed.length ? total / indexed.length : 0 };
    indexCache.set(docs, index);
  }
  return index;
}

interface Pattern {
  raw: string;
  terms: string[];
  prefix: boolean; // last term is a prefix (trailing *)
}

export function parseKeyword(raw: string): Pattern | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefix = trimmed.endsWith("*");
  const terms = tokenize(prefix ? trimmed.slice(0, -1) : trimmed);
  if (terms.length === 0) return null;
  return { raw: trimmed, terms, prefix };
}

function termMatches(word: string, term: string, isPrefix: boolean): boolean {
  return isPrefix ? word.startsWith(term) : word === term;
}

/** Start offsets (word index) of every occurrence of the pattern. */
function occurrences(words: string[], p: Pattern): number[] {
  const out: number[] = [];
  const n = p.terms.length;
  const last = n - 1;
  for (let i = 0; i + n <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (!termMatches(words[i + j], p.terms[j], p.prefix && j === last)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export interface KeywordHit {
  docId: string;
  count: number;
}

/** Per-keyword document hits, for display and for BM25. */
export function findKeyword(docs: SearchDoc[], keyword: string): KeywordHit[] {
  const p = parseKeyword(keyword);
  if (!p) return [];
  const { docs: indexed } = getIndex(docs);
  const hits: KeywordHit[] = [];
  for (const d of indexed) {
    const count = occurrences(d.words, p).length;
    if (count > 0) hits.push({ docId: d.id, count });
  }
  return hits;
}

const K1 = 1.2;
const B = 0.75;

/** BM25 score per document for a set of keywords (phrases count as one term). */
export function bm25(docs: SearchDoc[], keywords: string[]): Map<string, number> {
  const { docs: indexed, avgLen } = getIndex(docs);
  const scores = new Map<string, number>();
  const N = indexed.length;
  const lengths = new Map(indexed.map((d) => [d.id, d.words.length]));
  for (const kw of keywords) {
    const hits = findKeyword(docs, kw);
    if (hits.length === 0) continue;
    const idf = Math.log(1 + (N - hits.length + 0.5) / (hits.length + 0.5));
    for (const h of hits) {
      const len = lengths.get(h.docId) ?? avgLen;
      const tf = (h.count * (K1 + 1)) / (h.count + K1 * (1 - B + (B * len) / (avgLen || 1)));
      scores.set(h.docId, (scores.get(h.docId) ?? 0) + idf * tf);
    }
  }
  return scores;
}

/**
 * Reciprocal-rank fusion of keyword (BM25) and semantic rankings. Keyword
 * hits dominate when present; semantic similarity catches clauses phrased
 * differently from the user's keywords.
 */
export function hybridRank(
  docs: SearchDoc[],
  keywords: string[],
  semanticScores: Map<string, number> | null,
  limit: number,
): Array<{ id: string; score: number; keywordScore: number }> {
  const RRF_K = 60;
  const kw = bm25(docs, keywords);
  const fused = new Map<string, number>();
  [...kw.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([id], rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank)));
  if (semanticScores) {
    [...semanticScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(limit * 3, 20))
      .forEach(([id], rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank)));
  }
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score, keywordScore: kw.get(id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Short snippet around the first occurrence of any keyword, for the UI. */
export function snippet(text: string, keyword: string, radius = 90): string {
  const p = parseKeyword(keyword);
  const flat = text.replace(/\s+/g, " ");
  if (!p) return flat.slice(0, radius * 2);
  const first = p.terms[0];
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "iu",
  );
  const m = re.exec(flat);
  if (!m) return flat.slice(0, radius * 2);
  // Widen to word boundaries so snippets (and quotes built from them) don't
  // start or end mid-word.
  let start = Math.max(0, m.index - radius);
  let end = Math.min(flat.length, m.index + radius);
  if (start > 0) {
    const space = flat.lastIndexOf(" ", start);
    start = space < 0 ? 0 : space + 1;
  }
  if (end < flat.length) {
    const space = flat.indexOf(" ", end);
    end = space < 0 ? flat.length : space;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
