"use client";

import { useEffect, useRef, useState } from "react";
import type { DataPoint } from "@/lib/rag/types";

interface Result {
  keyword: string;
  total: number;
  pages: Array<{ page: number; count: number; snippet: string }>;
}

interface Props {
  reportId: string;
  onJump: (page: number, term: string) => void;
  // Omitted for read-only users: hits can be viewed but not added.
  onAdd?: (dp: DataPoint) => void;
}

interface Draft {
  key: string;
  page: number;
  quote: string;
  field: string;
  value: string;
}

function cleanSnippet(s: string): string {
  return s.replace(/^…/, "").replace(/…$/, "").trim();
}

function fieldLabel(keyword: string): string {
  const k = keyword.replace(/\*$/, "").trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// Instant static text search (no AI): exact words/phrases, * for word forms.
export function KeywordSearch({ reportId, onJump, onAdd }: Props) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const formRef = useRef<HTMLDivElement>(null);
  const draftKey = draft?.key;

  // Bring the add form into view within the side panel (the page itself is
  // pinned, so "nearest" only moves the panel) and focus it.
  useEffect(() => {
    const form = formRef.current;
    if (!draftKey || !form) return;
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    form.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }, [draftKey]);

  const save = async () => {
    if (!draft || saving) return;
    const field = draft.field.trim();
    const value = draft.value.trim();
    if (!field || !value) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/datapoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value, quote: draft.quote, page: draft.page }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Add failed (${res.status})`);
      onAdd?.(payload.dataPoint as DataPoint);
      setAdded((prev) => new Set(prev).add(draft.key));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    const keywords = input.split(",").map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Search failed (${res.status})`);
      setResults(payload.results as Result[]);
      setDraft(null);
      setAdded(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Search text… e.g. terminat*, governing law"
          className="flex-1 bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-text-muted"
        />
        <button
          onClick={run}
          disabled={loading || !input.trim()}
          className="shrink-0 px-3 py-2 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
        >
          {loading ? "…" : "Search"}
        </button>
        {results && (
          <button
            onClick={() => setResults(null)}
            className="shrink-0 px-2 text-xs text-text-muted hover:text-accent"
            title="Clear results"
          >
            Clear
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {results && (
        <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-tertiary/60 p-2">
          {results.map((r) => (
            <div key={r.keyword}>
              <p className="text-xs font-medium text-foreground">
                {r.keyword}{" "}
                <span className="text-text-muted font-normal">
                  · {r.total} match{r.total === 1 ? "" : "es"} on {r.pages.length} page
                  {r.pages.length === 1 ? "" : "s"}
                </span>
              </p>
              {r.pages.map((p) => {
                const key = `${r.keyword}|${p.page}`;
                const editing = draft?.key === key;
                return (
                  <div key={p.page} className="mt-1">
                    <div className="flex items-start gap-1 rounded hover:bg-bg-secondary">
                      <button
                        onClick={() => onJump(p.page, r.keyword.replace(/\*$/, ""))}
                        className="flex-1 min-w-0 text-left px-2 py-1 text-[0.72rem] text-text-secondary"
                        title="Show in document"
                      >
                        <span className="text-accent mr-1.5">p.{p.page}</span>
                        {p.snippet}
                      </button>
                      {!onAdd ? null : added.has(key) ? (
                        <span className="shrink-0 px-2 py-1 text-[0.68rem] text-accent">Added</span>
                      ) : (
                        <button
                          onClick={() => {
                            onJump(p.page, r.keyword.replace(/\*$/, ""));
                            const quote = cleanSnippet(p.snippet);
                            setDraft(
                              editing
                                ? null
                                : { key, page: p.page, quote, field: fieldLabel(r.keyword), value: quote },
                            );
                          }}
                          className="shrink-0 px-2 py-1 text-[0.68rem] text-text-muted hover:text-accent"
                          title="Add to report"
                        >
                          {editing ? "Cancel" : "+ Add"}
                        </button>
                      )}
                    </div>
                    {editing && draft && (
                      <div
                        ref={formRef}
                        className="mx-2 mt-1 mb-2 space-y-1.5 rounded-md border border-accent/40 bg-accent/5 p-2"
                      >
                        <input
                          value={draft.field}
                          onChange={(e) => setDraft({ ...draft, field: e.target.value })}
                          placeholder="Field name"
                          className="w-full bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded px-2 py-1 text-xs text-foreground"
                        />
                        <textarea
                          value={draft.value}
                          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              save();
                            }
                          }}
                          rows={3}
                          placeholder="Value (trim it to the answer)"
                          className="w-full bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded px-2 py-1 text-xs text-foreground resize-y"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={save}
                            disabled={saving || !draft.field.trim() || !draft.value.trim()}
                            className="px-2.5 py-1 rounded bg-accent text-background text-xs font-medium hover:bg-accent-hover disabled:opacity-40"
                          >
                            {saving ? "Adding…" : "Add to report"}
                          </button>
                          <span className="text-[0.65rem] text-text-muted">
                            Quote from p.{draft.page} is kept as the source
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
