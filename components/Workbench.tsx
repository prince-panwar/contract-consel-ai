"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { UploadDropzone, type UploadResult } from "./UploadDropzone";
import { DataPointTable } from "./DataPointTable";
import type { PdfViewerHandle } from "./PdfViewer";
import { ExportMenu } from "./ExportMenu";
import type { DataPoint, ExtractionStatus } from "@/lib/rag/types";

const PdfViewer = dynamic(
  () => import("./PdfViewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Loading viewer…
      </div>
    ),
  },
);

const STORAGE_KEY = "cc:session";
const POLL_INTERVAL_MS = 2500;

interface StoredSession {
  sessionId: string;
  filename: string;
  pageCount: number;
  chunkCount: number;
  dataPoints: DataPoint[];
  extractionStatus: ExtractionStatus;
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number;
}

interface StatusPayload {
  status: ExtractionStatus;
  passesDone: number;
  passesTotal: number;
  error: string | null;
  dataPoints: DataPoint[];
  pageCount: number;
  filename: string;
}

type PdfLoadState = "idle" | "loading" | "loaded" | "error-retry";

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function Workbench() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<PdfLoadState>("idle");
  const [toast, setToast] = useState<{ kind: "info" | "error"; message: string } | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  const viewerRef = useRef<PdfViewerHandle>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashToast = useCallback(
    (message: string, kind: "info" | "error" = "info", ms = 10_000) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ kind, message });
      toastTimerRef.current = setTimeout(() => setToast(null), ms);
    },
    [],
  );

  // ---- Hydrate from localStorage (basic shape only — server is source of truth)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredSession>;
        if (parsed.sessionId && parsed.filename) {
          setSession({
            sessionId: parsed.sessionId,
            filename: parsed.filename,
            pageCount: parsed.pageCount ?? 0,
            chunkCount: parsed.chunkCount ?? 0,
            dataPoints: Array.isArray(parsed.dataPoints) ? parsed.dataPoints : [],
            extractionStatus: parsed.extractionStatus ?? "pending",
            extractionPassesDone: parsed.extractionPassesDone ?? 0,
            extractionPassesTotal: parsed.extractionPassesTotal ?? 0,
            extractionError: parsed.extractionError ?? null,
            extractionStartedAt: parsed.extractionStartedAt ?? Date.now(),
          });
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  const persistSession = useCallback((next: StoredSession | null) => {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
    setSession(next);
  }, []);

  // ---- After hydrate, verify session with server via /status FIRST (then fetch PDF)
  useEffect(() => {
    if (!hydrated || !session?.sessionId) return;
    // Only verify on mount — subsequent status changes handled by the poll loop below.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contract/datapoints/status", {
          headers: { "x-session-id": session.sessionId },
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 410) {
            localStorage.removeItem(STORAGE_KEY);
            setSession(null);
            flashToast(
              "Session lost — the server was restarted or the 30-minute TTL expired. Please re-upload.",
              "error",
              15_000,
            );
          }
          return;
        }
        const data = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setSession((prev) =>
          prev
            ? {
                ...prev,
                dataPoints: data.dataPoints,
                extractionStatus: data.status,
                extractionPassesDone: data.passesDone,
                extractionPassesTotal: data.passesTotal,
                extractionError: data.error,
              }
            : prev,
        );
      } catch {
        /* ignore — transient network */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only runs on first hydrate (and on explicit session swap).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session?.sessionId]);

  // ---- Fetch PDF bytes (runs alongside the status check above; 410 handled there)
  useEffect(() => {
    if (!session?.sessionId) {
      setPdfSrc(null);
      setPdfState("idle");
      return;
    }
    let active = true;
    setPdfState("loading");
    (async () => {
      try {
        const res = await fetch("/api/contract/pdf", {
          headers: { "x-session-id": session.sessionId },
        });
        if (!active) return;
        if (!res.ok) {
          if (res.status === 410) {
            // Status effect handles the toast + session clear; stay idle here.
            setPdfState("idle");
          } else {
            setPdfState("error-retry");
          }
          return;
        }
        const blob = await res.blob();
        if (!active) return;
        setPdfSrc(URL.createObjectURL(blob));
        setPdfState("loaded");
      } catch {
        if (active) setPdfState("error-retry");
      }
    })();
    return () => {
      active = false;
    };
  }, [session?.sessionId]);

  useEffect(() => {
    return () => {
      if (pdfSrc) URL.revokeObjectURL(pdfSrc);
    };
  }, [pdfSrc]);

  // ---- Tick elapsed timer (only while extraction is running)
  useEffect(() => {
    if (!session) return;
    if (
      session.extractionStatus !== "pending" &&
      session.extractionStatus !== "running"
    ) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.extractionStatus, session]);

  // ---- Poll status while extraction is running/pending
  useEffect(() => {
    if (!session?.sessionId) return;
    if (session.extractionStatus === "done" || session.extractionStatus === "error") {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/contract/datapoints/status", {
          headers: { "x-session-id": session.sessionId },
        });
        if (!res.ok) {
          if (res.status === 410) {
            localStorage.removeItem(STORAGE_KEY);
            setSession(null);
            flashToast(
              "Session lost mid-extraction (likely server restart). Please re-upload.",
              "error",
              15_000,
            );
          }
          return;
        }
        const data = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setSession((prev) => {
          if (!prev) return prev;
          const next: StoredSession = {
            ...prev,
            dataPoints: data.dataPoints,
            extractionStatus: data.status,
            extractionPassesDone: data.passesDone,
            extractionPassesTotal: data.passesTotal,
            extractionError: data.error,
          };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
        if (data.status === "error") {
          flashToast(`Extraction failed: ${data.error || "unknown error"}`, "error", 12_000);
        }
      } catch {
        /* ignore */
      }
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session?.sessionId, session?.extractionStatus, flashToast]);

  const handleUploaded = useCallback(
    (result: UploadResult) => {
      const next: StoredSession = {
        sessionId: result.sessionId,
        filename: result.filename,
        pageCount: result.pageCount,
        chunkCount: result.chunkCount,
        dataPoints: result.dataPoints ?? [],
        extractionStatus: result.extractionStatus ?? "pending",
        extractionPassesDone: 0,
        extractionPassesTotal: result.extractionPassesTotal ?? 0,
        extractionError: null,
        extractionStartedAt: Date.now(),
      };
      persistSession(next);
      setSelectedId(null);
    },
    [persistSession],
  );

  const handleSelect = useCallback((dp: DataPoint) => {
    setSelectedId(dp.id);
    viewerRef.current?.jumpTo(dp.page, dp.quote);
  }, []);

  const handleEdit = useCallback(
    async (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => {
      if (!session) return;
      const prev = session.dataPoints;
      const optimistic = prev.map((d) => (d.id === id ? { ...d, ...patch } : d));
      persistSession({ ...session, dataPoints: optimistic });
      try {
        const res = await fetch("/api/contract/datapoints", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": session.sessionId,
          },
          body: JSON.stringify({ id, patch }),
        });
        if (!res.ok) throw new Error();
      } catch {
        persistSession({ ...session, dataPoints: prev });
      }
    },
    [session, persistSession],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!session) return;
      const prev = session.dataPoints;
      persistSession({ ...session, dataPoints: prev.filter((d) => d.id !== id) });
      if (selectedId === id) setSelectedId(null);
      try {
        const res = await fetch(`/api/contract/datapoints?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "x-session-id": session.sessionId },
        });
        if (!res.ok && res.status !== 404) throw new Error();
      } catch {
        persistSession({ ...session, dataPoints: prev });
      }
    },
    [session, selectedId, persistSession],
  );

  const handleAdd = useCallback(
    (dp: DataPoint) => {
      if (!session) return;
      persistSession({ ...session, dataPoints: [...session.dataPoints, dp] });
      setSelectedId(dp.id);
      viewerRef.current?.jumpTo(dp.page, dp.quote);
    },
    [session, persistSession],
  );

  const handleNewContract = useCallback(async () => {
    if (!session) return;
    try {
      await fetch("/api/contract/session", {
        method: "DELETE",
        headers: { "x-session-id": session.sessionId },
      });
    } catch {
      /* ignore */
    }
    persistSession(null);
    setSelectedId(null);
  }, [session, persistSession]);

  const retryPdf = useCallback(() => {
    if (!session) return;
    // Trigger the effect by setting pdfState back to loading via session no-op.
    setPdfState("loading");
    // Force the fetch-PDF effect to re-run by touching session reference.
    setSession((prev) => (prev ? { ...prev } : prev));
  }, [session]);

  if (!hydrated) return <div className="min-h-screen" />;

  if (!session) {
    return (
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="px-8 py-6 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <span className="font-serif text-2xl tracking-tight text-foreground">
              ContractCounsel
            </span>
            <span className="text-accent text-2xl leading-none">.</span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            AI-powered contract data extraction.
          </p>
        </header>
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <div className="w-full max-w-2xl">
            <div className="text-center mb-10">
              <h1 className="font-serif text-4xl sm:text-5xl text-foreground leading-tight">
                Upload a contract.
                <br />
                <span className="text-accent">Get every data point.</span>
              </h1>
              <p className="mt-4 text-text-secondary max-w-lg mx-auto">
                We scan the whole document, surface every key clause, and let you
                edit, search, or ask the AI for anything it missed.
              </p>
            </div>
            <UploadDropzone onUploaded={handleUploaded} />
          </div>
        </main>
        <footer className="px-8 py-4 border-t border-border-subtle text-xs text-text-muted text-center">
          Document analysis, not legal advice. Consult an attorney for decisions.
        </footer>
        {toast && <Toast kind={toast.kind}>{toast.message}</Toast>}
      </div>
    );
  }

  const extractionRunning =
    session.extractionStatus === "pending" || session.extractionStatus === "running";
  const extractionError =
    session.extractionStatus === "error" ? session.extractionError : null;
  const elapsedMs = extractionRunning ? now - session.extractionStartedAt : 0;

  return (
    <div className="relative z-10 h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-border-subtle flex items-center justify-between gap-4 bg-bg-secondary/40 shrink-0">
        <div className="min-w-0 flex items-center gap-3">
          <span className="font-serif text-lg tracking-tight text-foreground">
            ContractCounsel<span className="text-accent">.</span>
          </span>
          <span className="text-text-muted">·</span>
          <div className="min-w-0">
            <p className="text-sm text-foreground truncate" title={session.filename}>
              {session.filename}
            </p>
            <p className="text-[0.7rem] text-text-muted">
              {session.pageCount} pages · {session.dataPoints.length} data points
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu
            filename={session.filename}
            dataPoints={session.dataPoints}
            disabled={extractionRunning}
          />
          <button
            onClick={handleNewContract}
            className="text-sm text-text-secondary hover:text-accent border border-border-visible hover:border-accent px-3 py-2 rounded-lg transition-colors"
          >
            New
          </button>
        </div>
      </header>

      {/* Persistent scanning banner — unmissable while extraction runs */}
      {extractionRunning && (
        <div className="bg-accent/10 border-b border-accent/30 text-foreground px-6 py-3 shrink-0 flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent"></span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Scanning your document
              {session.extractionPassesTotal > 0 && (
                <>
                  {" "}
                  — pass{" "}
                  <span className="text-accent">
                    {Math.min(
                      session.extractionPassesDone + 1,
                      session.extractionPassesTotal,
                    )}
                  </span>{" "}
                  of{" "}
                  <span className="text-accent">{session.extractionPassesTotal}</span>
                </>
              )}{" "}
              · <span className="tabular-nums">{formatElapsed(elapsedMs)}</span> elapsed
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {session.dataPoints.length} data point
              {session.dataPoints.length === 1 ? "" : "s"} found so far. Rows appear
              as each pass completes — safe to browse the PDF while you wait.
            </p>
          </div>
        </div>
      )}

      {extractionError && (
        <div className="bg-danger/10 border-b border-danger/40 text-danger text-sm px-6 py-2.5 shrink-0">
          <strong className="font-medium">Extraction failed:</strong>{" "}
          {extractionError}{" "}
          <button
            onClick={handleNewContract}
            className="underline underline-offset-2 hover:text-accent ml-2"
          >
            Re-upload
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-[minmax(340px,42%)_1fr] min-h-0">
        <section className="border-r border-border-subtle min-h-0">
          <DataPointTable
            sessionId={session.sessionId}
            dataPoints={session.dataPoints}
            selectedId={selectedId}
            onSelect={handleSelect}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAdd={handleAdd}
            extractionRunning={extractionRunning}
          />
        </section>
        <section className="min-h-0">
          {pdfState === "loaded" && pdfSrc ? (
            <PdfViewer ref={viewerRef} src={pdfSrc} />
          ) : pdfState === "error-retry" ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted text-sm">
              <p>Could not load the PDF.</p>
              <button
                onClick={retryPdf}
                className="px-3 py-1.5 rounded-lg border border-border-visible hover:border-accent hover:text-accent transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Loading PDF…
            </div>
          )}
        </section>
      </div>
      {toast && <Toast kind={toast.kind}>{toast.message}</Toast>}
    </div>
  );
}

function Toast({
  kind,
  children,
}: {
  kind: "info" | "error";
  children: React.ReactNode;
}) {
  const base =
    kind === "error"
      ? "bg-danger/10 border-danger text-danger"
      : "bg-bg-secondary border-accent/50 text-foreground";
  return (
    <div
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg border text-sm shadow-xl z-50 max-w-lg text-center ${base}`}
    >
      {children}
    </div>
  );
}
