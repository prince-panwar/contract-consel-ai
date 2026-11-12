"use client";

import { useMemo, useRef, useState } from "react";
import type { DataPoint, DataPointDefinition } from "@/lib/rag/types";
import { DataPointRow } from "./DataPointRow";
import { FindDataPoint } from "./FindDataPoint";
import { KeywordSearch } from "./KeywordSearch";
import { ScrollTopButton } from "./ScrollTopButton";
import { useCurrentUser } from "./UserContext";

interface Props {
  reportId: string;
  dataPoints: DataPoint[];
  selectedId: string | null;
  onSelect: (dp: DataPoint) => void;
  onEdit: (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => void;
  onDelete: (id: string) => void;
  onAdd: (dp: DataPoint) => void;
  onJump: (page: number, term: string) => void;
  extractionRunning?: boolean;
  /** Requested fields; those without any data point are listed as not located. */
  targetFields?: DataPointDefinition[];
  /** True when the AI read every page (not only search excerpts). */
  readInFull?: boolean;
}

export function DataPointTable({
  reportId,
  dataPoints,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
  onJump,
  extractionRunning,
  targetFields = [],
  readInFull = false,
}: Props) {
  const { can } = useCurrentUser();
  const canEdit = can("reviewer");
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

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

  // Requested fields with no answer. Shown so a reviewer can tell "not in the
  // contract" (or not found) from a row that silently went missing.
  const notLocated = useMemo(() => {
    const found = new Set(dataPoints.map((d) => d.field));
    return targetFields.filter((f) => !found.has(f.name));
  }, [dataPoints, targetFields]);

  return (
    // One scroll area for the whole panel: search results, AI find and the
    // data points flow in a single column instead of nested scroll boxes.
    <div className="relative h-full">
    <div ref={listRef} className="h-full overflow-y-auto">
      <div className="px-4 py-3 border-b border-border-subtle space-y-3 bg-bg-secondary/40">
        <KeywordSearch reportId={reportId} onJump={onJump} onAdd={canEdit ? onAdd : undefined} />
        {canEdit && <FindDataPoint reportId={reportId} onAccept={onAdd} />}
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

      <div className="px-3 py-3 space-y-2">
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
              readOnly={!canEdit}
            />
          ))
        )}
        {!extractionRunning && dataPoints.length > 0 && notLocated.length > 0 && (
          <details className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs">
            <summary className="cursor-pointer text-text-muted">
              Not located ({notLocated.length}) — {readInFull ? "every page was read" : "only search matches were read"}
            </summary>
            <p className="mt-2 text-text-muted">
              {readInFull
                ? "The AI read the whole contract and found no clause for these fields. That usually means the contract does not cover them; use AI find or keyword search above to double-check."
                : "The AI read only the passages search selected. These fields may still be in the contract: try AI find above, or re-run the extraction in Thorough mode."}
            </p>
            <ul className="mt-2 space-y-1">
              {notLocated.map((f) => (
                <li key={f.name} className="text-foreground">
                  {f.name}
                  {f.description && <span className="text-text-muted"> — {f.description}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
    <ScrollTopButton target={listRef} threshold={400} />
    </div>
  );
}
