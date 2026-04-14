"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PdfViewerHandle {
  jumpTo(page: number, quote?: string): void;
}

interface Props {
  src: string;
  onLoaded?: (pageCount: number) => void;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { src, onLoaded },
  ref,
) {
  const [numPages, setNumPages] = useState<number>(0);
  const [width, setWidth] = useState<number>(700);
  const [activePage, setActivePage] = useState<number>(1);
  const [highlight, setHighlight] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, e.contentRect.width - 32);
        setWidth(Math.min(w, 1000));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      jumpTo(page: number, quote?: string) {
        const clamped = Math.max(1, Math.min(numPages || 1, Math.floor(page)));
        setActivePage(clamped);
        setHighlight(quote ? normalize(quote).slice(0, 80) : null);
        const el = pageRefs.current.get(clamped);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
    }),
    [numPages],
  );

  const handleLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      onLoaded?.(n);
    },
    [onLoaded],
  );

  const renderTextLayer = useCallback(
    ({ str }: { str: string }): string => {
      if (!highlight) return escapeHtml(str);
      const lower = str.toLowerCase();
      const idx = lower.indexOf(highlight);
      if (idx < 0) return escapeHtml(str);
      const before = escapeHtml(str.slice(0, idx));
      const hit = escapeHtml(str.slice(idx, idx + highlight.length));
      const after = escapeHtml(str.slice(idx + highlight.length));
      return `${before}<mark class="pdf-highlight">${hit}</mark>${after}`;
    },
    [highlight],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto bg-bg-tertiary"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-bg-secondary/90 backdrop-blur border-b border-border-subtle">
        <span className="text-xs text-text-muted">
          Page {activePage}
          {numPages ? ` / ${numPages}` : ""}
        </span>
        {highlight && (
          <button
            onClick={() => setHighlight(null)}
            className="text-xs text-accent hover:text-accent-hover underline-offset-4 hover:underline"
          >
            clear highlight
          </button>
        )}
      </div>
      <div className="flex flex-col items-center py-4 gap-4">
        <Document
          file={src}
          onLoadSuccess={handleLoadSuccess}
          loading={
            <div className="text-text-muted text-sm py-16">Loading PDF…</div>
          }
          error={
            <div className="text-danger text-sm py-16">Failed to load PDF.</div>
          }
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            return (
              <div
                key={pageNum}
                ref={(node) => {
                  if (node) pageRefs.current.set(pageNum, node);
                  else pageRefs.current.delete(pageNum);
                }}
                data-page={pageNum}
                className={`shadow-lg mb-3 ${
                  activePage === pageNum
                    ? "ring-2 ring-accent/60"
                    : "ring-1 ring-border-subtle"
                }`}
              >
                <Page
                  pageNumber={pageNum}
                  width={width}
                  customTextRenderer={renderTextLayer}
                />
              </div>
            );
          })}
        </Document>
      </div>
      <style jsx global>{`
        .pdf-highlight {
          background: rgba(232, 184, 74, 0.55);
          color: inherit;
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
    </div>
  );
});
