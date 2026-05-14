"use client";

import { useCallback, useRef, useState } from "react";

export interface UploadResult {
  reportId: string;
  filename: string;
  pageCount: number;
  chunkCount: number;
}

interface Props {
  onUploaded: (result: UploadResult) => void;
}

const PROGRESS_STEPS = [
  "Uploading PDF…",
  "Storing on server…",
  "Queuing for processing…",
];

export function UploadDropzone({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Only PDF files are supported.");
        return;
      }
      setUploading(true);
      setStepIdx(0);

      const stepInterval = setInterval(() => {
        setStepIdx((i) => Math.min(PROGRESS_STEPS.length - 1, i + 1));
      }, 6000);

      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/contract/upload", {
          method: "POST",
          body: form,
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || `Upload failed (${res.status})`);
        onUploaded(payload as UploadResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        clearInterval(stepInterval);
        setUploading(false);
        setStepIdx(0);
      }
    },
    [onUploaded],
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      <label
        htmlFor="contract-file"
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (uploading) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`block cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent/5"
            : "border-border-visible hover:border-accent/60 hover:bg-bg-secondary"
        } ${uploading ? "opacity-80 pointer-events-none" : ""}`}
      >
        <input
          ref={inputRef}
          id="contract-file"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full border border-accent/40 flex items-center justify-center text-accent">
            {uploading ? (
              <div className="flex items-center gap-1">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
              </div>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v12" />
                <path d="m7 8 5-5 5 5" />
                <path d="M5 21h14" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-serif text-xl text-foreground">
              {uploading ? PROGRESS_STEPS[stepIdx] : "Drop your contract PDF"}
            </p>
            <p className="text-sm text-text-muted mt-1">
              {uploading
                ? "Just a moment — we'll send you to the configure step."
                : "or click to browse. PDF only, up to 40 MB."}
            </p>
          </div>
        </div>
      </label>
      {error && <p className="mt-4 text-sm text-danger text-center">{error}</p>}
      <p className="mt-6 text-xs text-text-muted text-center">
        Stored in your private MongoDB. Only the admin can access uploaded contracts.
      </p>
    </div>
  );
}
