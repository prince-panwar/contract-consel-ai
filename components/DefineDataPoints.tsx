"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataPointDefinition, ExtractionMode } from "@/lib/rag/types";

interface Props {
  reportId: string;
  filename: string;
  pageCount: number;
  initial?: DataPointDefinition[];
  onStarted: (mode: ExtractionMode) => void;
}

// Quick-add fields with keywords that usually locate the clause.
const SUGGESTIONS: DataPointDefinition[] = [
  { name: "Parties", keywords: ["by and between", "parties", "party"] },
  { name: "Effective Date", keywords: ["effective date", "dated as of", "commencement date"] },
  { name: "Term Length", keywords: ["initial term", "term of", "duration"] },
  { name: "Auto-Renewal Terms", keywords: ["renew*", "automatic*"] },
  { name: "Termination for Convenience", keywords: ["terminat*", "for convenience", "without cause"] },
  { name: "Indemnity Cap", keywords: ["indemnif*", "limitation of liability", "aggregate liability"] },
  { name: "Governing Law", keywords: ["governing law", "governed by", "laws of", "jurisdiction"] },
  { name: "Payment Terms", keywords: ["payment*", "invoice*", "fees"] },
  { name: "Confidentiality Duration", keywords: ["confidential*", "non-disclosure", "surviv*"] },
];

function parseKeywordInput(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
}

function keywordsOf(f: DataPointDefinition): string[] {
  return f.keywords?.length ? f.keywords : [f.name];
}

export function DefineDataPoints({ reportId, filename, pageCount, initial, onStarted }: Props) {
  const [fields, setFields] = useState<DataPointDefinition[]>(initial ?? []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mode, setMode] = useState<ExtractionMode>("focused");
  const [hitCounts, setHitCounts] = useState<Record<string, { total: number; pages: number }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live static-search preview: how often each keyword occurs in the contract.
  useEffect(() => {
    const all = [...new Set(fields.flatMap(keywordsOf))].filter((k) => !(k in hitCounts));
    if (all.length === 0) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: all.slice(0, 20) }),
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          results: Array<{ keyword: string; total: number; pages: unknown[] }>;
        };
        setHitCounts((prev) => {
          const next = { ...prev };
          for (const r of payload.results) next[r.keyword] = { total: r.total, pages: r.pages.length };
          return next;
        });
      } catch {
        /* preview is best-effort */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [fields, hitCounts, reportId]);

  const addField = useCallback(
    (def: DataPointDefinition) => {
      const n = def.name.trim();
      if (!n) return;
      if (fields.some((f) => f.name.toLowerCase() === n.toLowerCase())) {
        setError(`"${n}" is already in the list.`);
        return;
      }
      const desc = def.description?.trim();
      const keywords = def.keywords?.length ? def.keywords : undefined;
      setFields((prev) => [
        ...prev,
        { name: n, ...(desc ? { description: desc } : {}), ...(keywords ? { keywords } : {}) },
      ]);
      setName("");
      setDescription("");
      setKeywordInput("");
      setError(null);
    },
    [fields],
  );

  const addFromInputs = () =>
    addField({ name, description, keywords: parseKeywordInput(keywordInput) });

  const removeField = useCallback((idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const start = async () => {
    if (fields.length === 0) {
      setError("Add at least one data point before starting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetFields: fields, mode }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Could not start extraction (${res.status})`);
      // The server may switch focused → thorough when search can't narrow
      // the document down enough to save anything.
      onStarted(payload.extractionMode === "thorough" ? "thorough" : mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start extraction.");
    } finally {
      setSubmitting(false);
    }
  };

  const remainingSuggestions = SUGGESTIONS.filter(
    (s) => !fields.some((f) => f.name.toLowerCase() === s.name.toLowerCase()),
  );
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInputs();
    }
  };
  const inputClass =
    "bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-text-muted";

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest text-text-muted">Configure</p>
        <h1 className="font-serif text-3xl text-foreground mt-1">
          What should we extract from <span className="text-accent">{filename}</span>?
        </h1>
        <p className="text-sm text-text-secondary mt-2">
          List the data points you want across all {pageCount} pages. Keywords locate each
          clause by fast text search first, so the AI only reads the passages that matter.
        </p>
      </div>

      <div className="bg-bg-secondary border border-border-subtle rounded-xl p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
            placeholder="Field name (e.g. Indemnity Cap)"
            className={inputClass}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onEnter}
            placeholder="Optional note (e.g. dollar amount of liability cap)"
            className={inputClass}
          />
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={onEnter}
            placeholder="Keywords, comma-separated (e.g. indemnif*, liability cap)"
            className={`${inputClass} sm:col-span-2`}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.7rem] text-text-muted">
            Phrases match whole words in any case; end a word with * to match its forms
            (terminat* → terminate, termination). Empty = the field name.
          </p>
          <button
            type="button"
            onClick={addFromInputs}
            disabled={!name.trim()}
            className="shrink-0 px-4 py-2 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {remainingSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[0.7rem] uppercase tracking-wider text-text-muted self-center mr-1">
              Quick add:
            </span>
            {remainingSuggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => addField(s)}
                className="text-xs px-2 py-1 rounded-full border border-border-subtle text-text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                + {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-border-subtle pt-4">
          {fields.length === 0 ? (
            <p className="text-sm text-text-muted italic">
              No data points yet. Add at least one to start extraction.
            </p>
          ) : (
            <ul className="space-y-2">
              {fields.map((f, i) => {
                const kws = keywordsOf(f);
                const anyHit = kws.some((k) => (hitCounts[k]?.total ?? 0) > 0);
                const checked = kws.every((k) => k in hitCounts);
                return (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-start gap-3 bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{f.name}</p>
                      {f.description && (
                        <p className="text-xs text-text-muted mt-0.5">{f.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {kws.map((k) => {
                          const hit = hitCounts[k];
                          return (
                            <span
                              key={k}
                              className={`text-[0.68rem] px-1.5 py-0.5 rounded border ${
                                hit && hit.total > 0
                                  ? "border-accent/40 text-accent"
                                  : "border-border-subtle text-text-muted"
                              }`}
                              title={
                                hit ? `${hit.total} match(es) on ${hit.pages} page(s)` : "Checking…"
                              }
                            >
                              {k}
                              {hit ? ` · ${hit.total}` : ""}
                            </span>
                          );
                        })}
                      </div>
                      {checked && !anyHit && (
                        <p className="text-[0.68rem] text-text-muted mt-1">
                          No exact matches. The AI will rely on meaning-based search; adding
                          the contract&apos;s own wording as a keyword helps.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(i)}
                      className="text-text-muted hover:text-danger transition-colors p-1"
                      aria-label="Remove"
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
        {(
          [
            ["focused", "Focused", "Search first; the AI reads only the matching passages. Fast and low cost. Short contracts are read in full automatically."],
            ["thorough", "Thorough", "The AI reads every page. Slower and uses more tokens; use when nothing may be missed."],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
              mode === value ? "border-accent bg-accent/5" : "border-border-subtle hover:border-accent/40"
            }`}
          >
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="sr-only"
            />
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="block text-xs text-text-muted mt-0.5">{hint}</span>
          </label>
        ))}
      </fieldset>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-xs text-text-muted">
          {fields.length} field{fields.length === 1 ? "" : "s"} defined
        </span>
        <button
          type="button"
          onClick={start}
          disabled={submitting || fields.length === 0}
          className="px-5 py-2.5 rounded-lg bg-accent text-background font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start extraction"}
        </button>
      </div>
    </div>
  );
}
