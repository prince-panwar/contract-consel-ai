"use client";

import { useEffect, useRef, useState } from "react";
import type { DataPoint } from "@/lib/rag/types";

interface Props {
  dp: DataPoint;
  selected: boolean;
  onSelect: (dp: DataPoint) => void;
  onEdit: (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}

export function DataPointRow({ dp, selected, onSelect, onEdit, onDelete, readOnly = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [fieldDraft, setFieldDraft] = useState(dp.field);
  const [valueDraft, setValueDraft] = useState(dp.value);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setFieldDraft(dp.field);
    setValueDraft(dp.value);
    setEditing(true);
  };

  const cancelEdit = () => {
    setFieldDraft(dp.field);
    setValueDraft(dp.value);
    setEditing(false);
  };

  const saveEdit = () => {
    const f = fieldDraft.trim();
    const v = valueDraft.trim();
    const patch: Partial<Pick<DataPoint, "field" | "value">> = {};
    if (f && f !== dp.field) patch.field = f;
    if (v && v !== dp.value) patch.value = v;
    if (Object.keys(patch).length > 0) onEdit(dp.id, patch);
    setEditing(false);
  };

  const sourceBadge =
    dp.source === "user-added"
      ? "You"
      : dp.source === "ai-found"
        ? "AI+"
        : null;

  return (
    <div
      onClick={(e) => {
        if (editing) return;
        if ((e.target as HTMLElement).closest("button, input, textarea")) return;
        onSelect(dp);
      }}
      className={`group relative rounded-lg border px-3 py-2.5 transition-colors ${
        editing ? "" : "cursor-pointer"
      } ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border-subtle bg-bg-secondary hover:border-accent/40 hover:bg-bg-tertiary"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={fieldRef}
              value={fieldDraft}
              onChange={(e) => setFieldDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              className="w-full bg-bg-tertiary border border-accent rounded px-2 py-1 text-sm font-medium text-foreground outline-none"
              placeholder="Field"
            />
          ) : (
            <p className="text-sm font-medium text-foreground leading-snug truncate">
              {dp.field}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sourceBadge && (
            <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent uppercase tracking-wide">
              {sourceBadge}
            </span>
          )}
          <span
            className={`text-[0.7rem] px-2 py-0.5 rounded-full border ${
              dp.verified
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
            title={dp.verified ? "Quote located in document" : "Quote could not be located"}
          >
            p.{dp.page}
          </span>
          {!editing && !readOnly && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent transition-opacity p-1"
                aria-label="Edit"
                title="Edit"
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(dp.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity p-1"
                aria-label="Delete"
                title="Delete"
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
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              saveEdit();
            }
            if (e.key === "Escape") cancelEdit();
          }}
          rows={3}
          className="mt-1.5 w-full bg-bg-tertiary border border-accent rounded px-2 py-1.5 text-sm text-text-secondary outline-none resize-y min-h-[3rem]"
          placeholder="Value"
        />
      ) : (
        <p className="mt-1 text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
          {dp.value}
        </p>
      )}
      {dp.quote && !editing && (
        <p className="mt-1.5 text-[0.72rem] text-text-muted italic leading-snug line-clamp-2">
          &ldquo;{dp.quote}&rdquo;
        </p>
      )}
      {editing && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={saveEdit}
            className="px-2.5 py-1 rounded bg-accent text-background text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="px-2.5 py-1 rounded border border-border-visible text-text-secondary text-xs hover:border-accent hover:text-accent transition-colors"
          >
            Cancel
          </button>
          <span className="text-[0.65rem] text-text-muted ml-auto">
            Ctrl+Enter to save · Esc to cancel
          </span>
        </div>
      )}
    </div>
  );
}
