"use client";

import { useEffect, useRef, useState } from "react";
import type { DataPoint } from "@/lib/rag/types";

interface Props {
  dp: DataPoint;
  selected: boolean;
  onSelect: (dp: DataPoint) => void;
  onEdit: (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => void;
  onDelete: (id: string) => void;
}

export function DataPointRow({ dp, selected, onSelect, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState<null | "field" | "value">(null);
  const [fieldDraft, setFieldDraft] = useState(dp.field);
  const [valueDraft, setValueDraft] = useState(dp.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setFieldDraft(dp.field), [dp.field]);
  useEffect(() => setValueDraft(dp.value), [dp.value]);

  useEffect(() => {
    if (editing === "field") inputRef.current?.focus();
    if (editing === "value") textareaRef.current?.focus();
  }, [editing]);

  const commitField = () => {
    const v = fieldDraft.trim();
    if (v && v !== dp.field) onEdit(dp.id, { field: v });
    setEditing(null);
  };
  const commitValue = () => {
    const v = valueDraft.trim();
    if (v && v !== dp.value) onEdit(dp.id, { value: v });
    setEditing(null);
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
        if ((e.target as HTMLElement).closest("button, input, textarea")) return;
        onSelect(dp);
      }}
      className={`group relative rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border-subtle bg-bg-secondary hover:border-accent/40 hover:bg-bg-tertiary"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editing === "field" ? (
            <input
              ref={inputRef}
              value={fieldDraft}
              onChange={(e) => setFieldDraft(e.target.value)}
              onBlur={commitField}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitField();
                if (e.key === "Escape") {
                  setFieldDraft(dp.field);
                  setEditing(null);
                }
              }}
              className="w-full bg-bg-tertiary border border-accent rounded px-2 py-1 text-sm font-medium text-foreground outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing("field")}
              className="text-left text-sm font-medium text-foreground leading-snug truncate w-full"
              title="Click to edit field"
            >
              {dp.field}
            </button>
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
        </div>
      </div>
      {editing === "value" ? (
        <textarea
          ref={textareaRef}
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitValue();
            }
            if (e.key === "Escape") {
              setValueDraft(dp.value);
              setEditing(null);
            }
          }}
          rows={2}
          className="mt-1.5 w-full bg-bg-tertiary border border-accent rounded px-2 py-1.5 text-sm text-text-secondary outline-none resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("value")}
          className="mt-1 text-left text-sm text-text-secondary leading-relaxed w-full whitespace-pre-wrap"
          title="Click to edit value"
        >
          {dp.value}
        </button>
      )}
      {dp.quote && (
        <p className="mt-1.5 text-[0.72rem] text-text-muted italic leading-snug line-clamp-2">
          &ldquo;{dp.quote}&rdquo;
        </p>
      )}
    </div>
  );
}
