"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataPointTable } from "./DataPointTable";
import { DefineDataPoints } from "./DefineDataPoints";
import type { PdfViewerHandle } from "./PdfViewer";
import { ExportMenu } from "./ExportMenu";
import type {
  DataPoint,
  DataPointDefinition,
  ExtractionStatus,
  ProcessingStatus,
} from "@/lib/rag/types";

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

const POLL_INTERVAL_MS = 2500;

interface ReportState {
  reportId: string;
  filename: string;
  pageCount: number;
  targetFields: DataPointDefinition[];
  dataPoints: DataPoint[];
  processingStatus: ProcessingStatus;
  processingError: string | null;
  extractionStatus: ExtractionStatus;
  extractionPassesDone: number;
  extractionPassesTotal: number;
  extractionError: string | null;
  extractionStartedAt: number | null;
}

interface StatusPayload {
  status: ExtractionStatus;
  passesDone: number;
  passesTotal: number;
  error: string | null;
  dataPoints: DataPoint[];
  targetFields: DataPointDefinition[];
  pageCount: number;
  filename: string;
  processingStatus: ProcessingStatus;
  processingError: string | null;
}

type PdfLoadState = "idle" | "loading" | "loaded" | "error-retry";

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

interface Props {
  reportId: string;
}

export function Workbench({ reportId }: Props) {
  const router = useRouter();
  const [report, setReport] = useState<ReportState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<PdfLoadState>("idle");
  const [pdfRetryNonce, setPdfRetryNonce] = useState(0);
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

  // ---- Initial fetch
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
        if (!res.ok) {
          if (cancelled) return;
          if (res.status === 404) {
            setLoadError("Report not found.");
          } else {
            setLoadError(`Could not load report (${res.status})`);
          }
          return;
        }
        const data = (await res.json()) as ReportState;
        if (cancelled) return;
        setReport(data);
      } catch {
        if (!cancelled) setLoadError("Network error loading report.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  // ---- Fetch PDF bytes (once per reportId; bump pdfRetryNonce to retry)
  useEffect(() => {
    let active = true;
    setPdfState("loading");
    (async () => {
      try {
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/pdf`);
        if (!active) return;
        if (!res.ok) {
          setPdfState("error-retry");
          return;
        }
        const blob = await res.blob();
        if (!active) return;
        if (blob.size === 0) {
          setPdfState("error-retry");
          return;
        }
        const url = URL.createObjectURL(blob);
        setPdfSrc(url);
        setPdfState("loaded");
      } catch {
        if (active) setPdfState("error-retry");
      }
    })();
    return () => {
      active = false;
    };
  }, [reportId, pdfRetryNonce]);

  useEffect(() => {
    return () => {
      if (pdfSrc) URL.revokeObjectURL(pdfSrc);
    };
  }, [pdfSrc]);

  // ---- Tick elapsed timer (only while extraction is running)
  useEffect(() => {
    const status = report?.extractionStatus;
    if (status !== "pending" && status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [report?.extractionStatus]);

  // ---- Poll status while embedding is processing OR extraction is running
  useEffect(() => {
    const processing = report?.processingStatus === "processing";
    const extracting =
      report?.extractionStatus === "pending" ||
      report?.extractionStatus === "running";
    if (!processing && !extracting) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/reports/${encodeURIComponent(reportId)}/status`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setReport((prev) =>
          prev
            ? {
                ...prev,
                pageCount: data.pageCount,
                dataPoints: data.dataPoints,
                targetFields: data.targetFields,
                processingStatus: data.processingStatus,
                processingError: data.processingError,
                extractionStatus: data.status,
                extractionPassesDone: data.passesDone,
                extractionPassesTotal: data.passesTotal,
                extractionError: data.error,
              }
            : prev,
        );
        if (data.status === "error") {
          flashToast(`Extraction failed: ${data.error || "unknown error"}`, "error", 12_000);
        }
        if (data.processingStatus === "error") {
          flashToast(
            `Processing failed: ${data.processingError || "unknown error"}`,
            "error",
            12_000,
          );
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
  }, [
    reportId,
    report?.processingStatus,
    report?.extractionStatus,
    flashToast,
  ]);

  const handleSelect = useCallback((dp: DataPoint) => {
    setSelectedId(dp.id);
    viewerRef.current?.jumpTo(dp.page, dp.quote);
  }, []);

  const handleEdit = useCallback(
    async (id: string, patch: Partial<Pick<DataPoint, "field" | "value">>) => {
      if (!report) return;
      const prev = report.dataPoints;
      const optimistic = prev.map((d) => (d.id === id ? { ...d, ...patch } : d));
      setReport({ ...report, dataPoints: optimistic });
      try {
        const res = await fetch(
          `/api/reports/${encodeURIComponent(reportId)}/datapoints`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, patch }),
          },
        );
        if (!res.ok) throw new Error();
      } catch {
        setReport({ ...report, dataPoints: prev });
      }
    },
    [report, reportId],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!report) return;
      const prev = report.dataPoints;
      setReport({ ...report, dataPoints: prev.filter((d) => d.id !== id) });
      if (selectedId === id) setSelectedId(null);
      try {
        const res = await fetch(
          `/api/reports/${encodeURIComponent(reportId)}/datapoints?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!res.ok && res.status !== 404) throw new Error();
      } catch {
        setReport({ ...report, dataPoints: prev });
      }
    },
    [report, reportId, selectedId],
  );

  const handleAdd = useCallback(
    (dp: DataPoint) => {
      if (!report) return;
      setReport({ ...report, dataPoints: [...report.dataPoints, dp] });
      setSelectedId(dp.id);
      viewerRef.current?.jumpTo(dp.page, dp.quote);
    },
    [report],
  );

  const handleDeleteReport = useCallback(async () => {
    if (!confirm("Delete this report permanently?")) return;
    try {
      await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    router.push("/history");
    router.refresh();
  }, [reportId, router]);

  const handleExtractionStarted = useCallback(() => {
    setReport((prev) =>
      prev
        ? {
            ...prev,
            extractionStatus: "pending",
            extractionPassesDone: 0,
            extractionStartedAt: Date.now(),
            dataPoints: [],
          }
        : prev,
    );
  }, []);

  const retryPdf = useCallback(() => {
    setPdfRetryNonce((n) => n + 1);
  }, []);

  if (loadError) {
    return (
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <p className="text-sm text-danger">{loadError}</p>
          <Link
            href="/history"
            className="inline-block mt-4 px-3 py-1.5 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
          >
            Back to history
          </Link>
        </div>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-text-muted">
        Loading report…
      </main>
    );
  }

  if (report.processingStatus === "processing") {
    return (
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-accent"></span>
          </span>
          <p className="text-sm text-foreground font-medium">
            Processing your contract…
          </p>
          <p className="text-xs text-text-muted">
            Extracting text and computing embeddings. This page will update
            automatically when it&apos;s ready.
          </p>
        </div>
      </main>
    );
  }

  if (report.processingStatus === "error") {
    return (
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <p className="text-sm text-danger font-medium">Processing failed.</p>
          {report.processingError && (
            <p className="text-xs text-text-muted break-words">
              {report.processingError}
            </p>
          )}
          <Link
            href="/history"
            className="inline-block mt-2 px-3 py-1.5 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
          >
            Back to history
          </Link>
        </div>
      </main>
    );
  }

  if (report.extractionStatus === "awaiting-config") {
    return (
      <DefineDataPoints
        reportId={report.reportId}
        filename={report.filename}
        pageCount={report.pageCount}
        initial={report.targetFields}
        onStarted={handleExtractionStarted}
      />
    );
  }

  const extractionRunning =
    report.extractionStatus === "pending" || report.extractionStatus === "running";
  const extractionError =
    report.extractionStatus === "error" ? report.extractionError : null;
  const elapsedMs =
    extractionRunning && report.extractionStartedAt
      ? now - report.extractionStartedAt
      : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-2.5 border-b border-border-subtle flex items-center justify-between gap-4 bg-bg-secondary/40 shrink-0">
        <div className="min-w-0">
          <p className="text-sm text-foreground truncate" title={report.filename}>
            {report.filename}
          </p>
          <p className="text-[0.7rem] text-text-muted">
            {report.pageCount} pages · {report.dataPoints.length} data points ·{" "}
            {report.targetFields.length} target fields
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu
            reportId={report.reportId}
            filename={report.filename}
            dataPoints={report.dataPoints}
            disabled={extractionRunning}
          />
          <button
            onClick={handleDeleteReport}
            className="text-sm text-text-muted hover:text-danger border border-border-visible hover:border-danger px-3 py-1.5 rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {extractionRunning && (
        <div className="bg-accent/10 border-b border-accent/30 text-foreground px-6 py-3 shrink-0 flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent"></span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Scanning your document
              {report.extractionPassesTotal > 0 && (
                <>
                  {" "}
                  — pass{" "}
                  <span className="text-accent">
                    {Math.min(
                      report.extractionPassesDone + 1,
                      report.extractionPassesTotal,
                    )}
                  </span>{" "}
                  of{" "}
                  <span className="text-accent">{report.extractionPassesTotal}</span>
                </>
              )}{" "}
              · <span className="tabular-nums">{formatElapsed(elapsedMs)}</span> elapsed
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {report.dataPoints.length} data point
              {report.dataPoints.length === 1 ? "" : "s"} found so far. Rows appear
              as each pass completes — safe to browse the PDF while you wait.
            </p>
          </div>
        </div>
      )}

      {extractionError && (
        <div className="bg-danger/10 border-b border-danger/40 text-danger text-sm px-6 py-2.5 shrink-0">
          <strong className="font-medium">Extraction failed:</strong> {extractionError}
        </div>
      )}

      <div className="flex-1 grid grid-cols-[minmax(340px,42%)_1fr] min-h-0">
        <section className="border-r border-border-subtle min-h-0">
          <DataPointTable
            reportId={report.reportId}
            dataPoints={report.dataPoints}
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
