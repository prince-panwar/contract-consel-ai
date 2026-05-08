"use client";

import { useState } from "react";
import type { DataPoint } from "@/lib/rag/types";

interface Props {
  reportId: string;
  onAccept: (dp: DataPoint) => void;
}

export function FindDataPoint({ reportId, onAccept }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidate, setCandidate] = useState<DataPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const submit = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setCandidate(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Find failed (${res.status})`);
      if (!payload.dataPoint) {
        setNotFound(true);
      } else {
        setCandidate(payload.dataPoint as DataPoint);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Find failed.");
    } finally {
      setLoading(false);
    }
  };

  const accept = async () => {
    if (!candidate) return;
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/datapoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: candidate.field,
          value: candidate.value,
          quote: candidate.quote,
          page: candidate.page,
          source: "ai-found",
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Add failed (${res.status})`);
      onAccept(payload.dataPoint as DataPoint);
      setCandidate(null);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          disabled={loading}
          placeholder="Ask AI to find… e.g. assignment clause"
          className="flex-1 bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-text-muted"
        />
        <button
          onClick={submit}
          disabled={loading || !query.trim()}
          className="shrink-0 px-3 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "…" : "Find"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {notFound && (
        <p className="text-xs text-text-muted italic">
          Nothing on that topic was found in the document.
        </p>
      )}
      {candidate && (
        <div className="border border-accent/40 bg-accent/5 rounded-lg p-3 space-y-2">
          <div>
            <p className="text-xs uppercase tracking-widest text-accent/80">
              Proposed · p.{candidate.page}
            </p>
            <p className="text-sm font-medium text-foreground mt-1">{candidate.field}</p>
            <p className="text-sm text-text-secondary mt-1">{candidate.value}</p>
            {candidate.quote && (
              <p className="text-xs italic text-text-muted mt-1.5">
                &ldquo;{candidate.quote}&rdquo;
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={accept}
              className="px-3 py-1.5 rounded bg-accent text-background text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              Add to list
            </button>
            <button
              onClick={() => setCandidate(null)}
              className="px-3 py-1.5 rounded border border-border-visible text-text-secondary text-xs hover:border-accent hover:text-accent transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
