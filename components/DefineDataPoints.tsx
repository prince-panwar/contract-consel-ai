"use client";

import { useCallback, useState } from "react";
import type { DataPointDefinition } from "@/lib/rag/types";

interface Props {
  reportId: string;
  filename: string;
  pageCount: number;
  initial?: DataPointDefinition[];
  onStarted: () => void;
}

const SUGGESTIONS = [
  "Parties",
  "Effective Date",
  "Term Length",
  "Auto-Renewal Terms",
  "Termination for Convenience",
  "Indemnity Cap",
  "Governing Law",
  "Payment Terms",
  "Confidentiality Duration",
];

export function DefineDataPoints({
  reportId,
  filename,
  pageCount,
  initial,
  onStarted,
}: Props) {
  const [fields, setFields] = useState<DataPointDefinition[]>(initial ?? []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addField = useCallback(
    (rawName: string, rawDesc?: string) => {
      const n = rawName.trim();
      if (!n) return;
      const lower = n.toLowerCase();
      if (fields.some((f) => f.name.toLowerCase() === lower)) {
        setError(`"${n}" is already in the list.`);
        return;
      }
      const desc = rawDesc?.trim();
      setFields((prev) => [...prev, desc ? { name: n, description: desc } : { name: n }]);
      setName("");
      setDescription("");
      setError(null);
    },
    [fields],
  );

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
        body: JSON.stringify({ targetFields: fields }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Could not start extraction (${res.status})`);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start extraction.");
    } finally {
      setSubmitting(false);
    }
  };

  const remainingSuggestions = SUGGESTIONS.filter(
    (s) => !fields.some((f) => f.name.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest text-text-muted">Configure</p>
        <h1 className="font-serif text-3xl text-foreground mt-1">
          What should we extract from <span className="text-accent">{filename}</span>?
        </h1>
        <p className="text-sm text-text-secondary mt-2">
          List the data points you want. The AI will look for each one specifically across all{" "}
          {pageCount} pages. Add a short description to clarify what you mean by a label.
        </p>
      </div>

      <div className="bg-bg-secondary border border-border-subtle rounded-xl p-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addField(name, description);
              }
            }}
            placeholder="Field name (e.g. Indemnity Cap)"
            className="bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-text-muted"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addField(name, description);
              }
            }}
            placeholder="Optional note (e.g. dollar amount of liability cap)"
            className="bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => addField(name, description)}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
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
                key={s}
                type="button"
                onClick={() => addField(s)}
                className="text-xs px-2 py-1 rounded-full border border-border-subtle text-text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                + {s}
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
              {fields.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-start gap-3 bg-bg-tertiary border border-border-subtle rounded-lg px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{f.name}</p>
                    {f.description && (
                      <p className="text-xs text-text-muted mt-0.5">{f.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-text-muted hover:text-danger transition-colors p-1"
                    aria-label="Remove"
                    title="Remove"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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
