"use client";

import { useMemo, useState } from "react";
import type { DataPoint } from "@/lib/rag/types";
import { DataPointRow } from "./DataPointRow";
import { FindDataPoint } from "./FindDataPoint";

interface Props {
  reportId: string;
  dataPoints: DataPoint[];
  selectedId: string | null;
  onSelect: (dp: DataPoint) => void;
  onEdit: (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => void;
  onDelete: (id: string) => void;
  onAdd: (dp: DataPoint) => void;
  extractionRunning?: boolean;
}

export function DataPointTable({
  reportId,
  dataPoints,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
  extractionRunning,
}: Props) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return dataPoints;
    return dataPoints.filter(
      (d) =>
        d.field.toLowerCase().includes(q) ||
        d.value.toLowerCase().includes(q) ||
        d.quote.toLowerCase().includes(q),
    );
  }, [dataPoints, filter]);

  const verifiedCount = dataPoints.filter((d) => d.verified).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border-subtle space-y-3 bg-bg-secondary/40">
        <FindDataPoint reportId={reportId} onAccept={onAdd} />
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter data points…"
            className="flex-1 bg-bg-tertiary border border-border-subtle focus:border-accent/60 focus:outline-none rounded-md px-2.5 py-1.5 text-xs text-foreground placeholder:text-text-muted"
          />
          <span className="text-xs text-text-muted shrink-0">
            {filtered.length} / {dataPoints.length}
            {dataPoints.length > 0 && ` · ${verifiedCount} verified`}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {extractionRunning && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 flex items-center gap-2 text-xs text-accent">
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span>
              Scanning the document — new data points appear as they&apos;re found.
            </span>
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">
            {extractionRunning
              ? "Extraction in progress…"
              : dataPoints.length === 0
                ? "No data points extracted yet."
                : "No rows match the filter."}
          </p>
        ) : (
          filtered.map((dp) => (
            <DataPointRow
              key={dp.id}
              dp={dp}
              selected={selectedId === dp.id}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
