"use client";

import { useEffect, useRef, useState } from "react";
import type { DataPoint } from "@/lib/rag/types";

type Format = "pdf" | "docx" | "xlsx";

const OPTIONS: Array<{ format: Format; label: string }> = [
  { format: "pdf", label: "PDF report (.pdf)" },
  { format: "docx", label: "Word report (.docx)" },
  { format: "xlsx", label: "Excel workbook (.xlsx)" },
];

interface Props {
  reportId: string;
  filename: string;
  dataPoints: DataPoint[];
  disabled?: boolean;
}

export function ExportMenu({ reportId, filename, dataPoints, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const doExport = async (format: Format) => {
    if (busy || dataPoints.length === 0) return;
    setBusy(format);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const base = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_");
      a.href = url;
      a.download = `${base || "contract"}-contract-review.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking synchronously can cancel the download in Firefox/Safari.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || dataPoints.length === 0}
        className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
      >
        Export
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-border-visible bg-bg-secondary shadow-xl z-20 overflow-hidden">
          {OPTIONS.map((o, i) => (
            <button
              key={o.format}
              onClick={() => doExport(o.format)}
              disabled={busy !== null}
              className={`w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary hover:text-foreground disabled:opacity-50 ${
                i > 0 ? "border-t border-border-subtle" : ""
              }`}
            >
              {busy === o.format ? "Building…" : o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
