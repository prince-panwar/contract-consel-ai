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
import { ScrollTopButton } from "./ScrollTopButton";

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

// Normalize aggressively: lowercase, strip all non-alphanumeric (including
// punctuation, quotes, dashes), collapse whitespace. Matches across PDF's
// typical text fragmentation.
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { src, onLoaded },
  ref,
) {
  const [numPages, setNumPages] = useState<number>(0);
  const [width, setWidth] = useState<number>(700);
  const [activePage, setActivePage] = useState<number>(1);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("");
  // Pages near the viewport; others render as sized placeholders so long
  // contracts don't mount hundreds of canvases and text layers at once.
  const [nearby, setNearby] = useState<Set<number>>(() => new Set([1, 2, 3]));
  const [pageRatio, setPageRatio] = useState(1.294); // US Letter until measured

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setNearby((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root: containerRef.current, rootMargin: "1500px 0px" },
    );
    observerRef.current = observer;
    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

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

  // Scroll only the viewer pane. scrollIntoView would also scroll every
  // ancestor (the window included) and shove the side panel around.
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(numPages || 1, Math.floor(page)));
      setActivePage(clamped);
      const el = pageRefs.current.get(clamped);
      const container = containerRef.current;
      if (el && container) {
        const header = container.querySelector<HTMLElement>("[data-viewer-header]");
        const top =
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          (header?.offsetHeight ?? 0) -
          8;
        container.scrollTo({ top, behavior: "smooth" });
      }
    },
    [numPages],
  );

  useImperativeHandle(
    ref,
    () => ({
      jumpTo(page: number, quote?: string) {
        // Store the FULL normalized quote. The renderer checks whether each
        // small text run is a substring of it (PDFs fracture text into
        // single-word runs).
        setHighlight(quote ? normalize(quote) : null);
        goToPage(page);
      },
    }),
    [goToPage],
  );

  const handleLoadSuccess = useCallback(
    async (pdf: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number } }> }) => {
      setNumPages(pdf.numPages);
      onLoaded?.(pdf.numPages);
      try {
        const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (vp.width > 0) setPageRatio(vp.height / vp.width);
      } catch {
        /* keep the default ratio */
      }
    },
    [onLoaded],
  );

  const renderTextLayer = useCallback(
    ({ str }: { str: string }): string => {
      if (!highlight || !str) return escapeHtml(str);
      const runNorm = normalize(str);
      // Skip very short or noise runs to avoid false positives from words
      // like "the" / "of" that happen to be in the quote.
      if (runNorm.length < 4) return escapeHtml(str);
      // Match run as a substring of the full normalized quote.
      if (highlight.includes(runNorm)) {
        return `<mark class="pdf-highlight">${escapeHtml(str)}</mark>`;
      }
      // Fallback: maybe the run is longer than the quote (rare — quote got
      // truncated) — check reverse direction.
      if (runNorm.length >= 10 && runNorm.includes(highlight)) {
        return `<mark class="pdf-highlight">${escapeHtml(str)}</mark>`;
      }
      return escapeHtml(str);
    },
    [highlight],
  );

  return (
    <div className="relative h-full">
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto bg-bg-tertiary"
    >
      <div data-viewer-header className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-bg-secondary/90 backdrop-blur border-b border-border-subtle">
        <form
          className="flex items-center gap-2 text-xs text-text-muted"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number.parseInt(pageInput, 10);
            if (Number.isFinite(n)) goToPage(n);
            setPageInput("");
          }}
        >
          <span>
            Page {activePage}
            {numPages ? ` / ${numPages}` : ""}
          </span>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="#"
            aria-label="Page number"
            className="w-12 bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded px-1.5 py-0.5 text-center text-foreground"
          />
          <button
            type="submit"
            disabled={!pageInput}
            className="px-2 py-0.5 rounded border border-border-visible hover:border-accent hover:text-accent disabled:opacity-40"
          >
            Go to page
          </button>
        </form>
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
                  const prev = pageRefs.current.get(pageNum);
                  if (prev && prev !== node) observerRef.current?.unobserve(prev);
                  if (node) {
                    pageRefs.current.set(pageNum, node);
                    observerRef.current?.observe(node);
                  } else {
                    pageRefs.current.delete(pageNum);
                  }
                }}
                data-page={pageNum}
                className={`shadow-lg mb-3 ${
                  activePage === pageNum
                    ? "ring-2 ring-accent/60"
                    : "ring-1 ring-border-subtle"
                }`}
              >
                {nearby.has(pageNum) || activePage === pageNum ? (
                  <Page
                    pageNumber={pageNum}
                    width={width}
                    // Only the cited page gets highlights; short runs that
                    // happen to occur in the quote would light up everywhere.
                    customTextRenderer={activePage === pageNum ? renderTextLayer : undefined}
                  />
                ) : (
                  <div style={{ width, height: Math.round(width * pageRatio) }} className="bg-white/90" />
                )}
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
    <ScrollTopButton target={containerRef} />
    </div>
  );
});
