"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReportSummary } from "@/lib/rag/types";
import { useCurrentUser } from "./UserContext";

interface DirectoryUser {
  uid: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
}

// Admin-only: choose which users can see a report (owner always can).
function SharePanel({
  report,
  users,
  onSaved,
}: {
  report: ReportSummary;
  users: DirectoryUser[];
  onSaved: (sharedWith: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(report.sharedWith));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = users.filter((u) => u.uid !== report.ownerUid && u.role !== "admin" && !u.disabled);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(report.reportId)}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedWith: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      onSaved(data.sharedWith as string[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border-subtle bg-bg-tertiary/60 p-3 space-y-2">
      <p className="text-xs text-text-muted">
        Visible to its uploader and all admins. Also share with:
      </p>
      {candidates.length === 0 ? (
        <p className="text-xs text-text-muted italic">No other reviewers or viewers yet. Add users in Admin.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {candidates.map((u) => (
            <label key={u.uid} className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={selected.has(u.uid)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(u.uid);
                    else next.delete(u.uid);
                    return next;
                  })
                }
              />
              {u.name || u.email} <span className="text-xs text-text-muted">({u.role})</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="px-3 py-1 rounded bg-accent text-background text-xs font-medium hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save access"}
      </button>
    </div>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(r: ReportSummary) {
  if (r.processingStatus === "processing") return { text: "Processing", tone: "accent" as const };
  if (r.processingStatus === "error") return { text: "Processing failed", tone: "danger" as const };
  switch (r.extractionStatus) {
    case "awaiting-config":
      return { text: "Awaiting setup", tone: "muted" as const };
    case "pending":
    case "running":
      return { text: "Running", tone: "accent" as const };
    case "done":
      return { text: "Complete", tone: "good" as const };
    case "error":
      return { text: "Error", tone: "danger" as const };
  }
}

export function HistoryList() {
  const { can } = useCurrentUser();
  const isAdmin = can("admin");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [sharing, setSharing] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/reports");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Load failed (${res.status})`);
      setReports(payload.reports as ReportSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users as DirectoryUser[]))
      .catch(() => {});
  }, [isAdmin]);

  const userLabel = (uid: string | null) => {
    if (!uid) return "admins only";
    const u = users.find((x) => x.uid === uid);
    return u ? u.name || u.email : "unknown user";
  };

  const remove = async (reportId: string) => {
    if (!confirm("Delete this report? The PDF and all data points are permanently removed.")) {
      return;
    }
    setDeleting(reportId);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Delete failed (${res.status})`);
      }
      setReports((prev) => prev?.filter((r) => r.reportId !== reportId) ?? prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(null);
    }
  };

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-sm text-danger">{error}</p>
        <button
          onClick={load}
          className="mt-3 px-3 py-1.5 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (reports === null) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-sm text-text-muted">Loading history…</p>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="font-serif text-3xl text-foreground">No reports yet</h1>
        <p className="text-sm text-text-secondary mt-2">
          {can("reviewer")
            ? "Upload your first contract to get started."
            : "No reports have been shared with you yet. Ask an administrator for access."}
        </p>
        {can("reviewer") && (
          <Link
            href="/"
            className="inline-block mt-6 px-4 py-2 rounded-lg bg-accent text-background font-medium hover:bg-accent-hover transition-colors"
          >
            Upload a contract
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-text-muted">History</p>
          <h1 className="font-serif text-3xl text-foreground mt-1">
            {reports.length} report{reports.length === 1 ? "" : "s"}
          </h1>
        </div>
      </header>
      <ul className="space-y-2">
        {reports.map((r) => {
          const label = statusLabel(r);
          const toneClass =
            label.tone === "good"
              ? "border-accent/40 bg-accent/10 text-accent"
              : label.tone === "accent"
                ? "border-accent/40 bg-accent/10 text-accent"
                : label.tone === "danger"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border-subtle bg-bg-tertiary text-text-muted";
          return (
            <li
              key={r.reportId}
              className="flex items-start gap-4 bg-bg-secondary border border-border-subtle rounded-xl px-4 py-3 hover:border-accent/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/report/${encodeURIComponent(r.reportId)}`}
                  className="block"
                >
                  <p className="text-sm font-medium text-foreground truncate" title={r.filename}>
                    {r.filename}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {r.pageCount} page{r.pageCount === 1 ? "" : "s"} ·{" "}
                    {r.dataPointCount} data point{r.dataPointCount === 1 ? "" : "s"} ·{" "}
                    {r.targetFieldCount} target field{r.targetFieldCount === 1 ? "" : "s"} ·{" "}
                    {formatDate(r.lastAccessAt)}
                  </p>
                </Link>
                {isAdmin && (
                  <p className="text-[0.7rem] text-text-muted mt-0.5">
                    Owner: {userLabel(r.ownerUid)}
                    {r.sharedWith.length > 0 &&
                      ` · Shared with ${r.sharedWith.map(userLabel).join(", ")}`}
                  </p>
                )}
                {isAdmin && sharing === r.reportId && (
                  <SharePanel
                    report={r}
                    users={users}
                    onSaved={(sharedWith) => {
                      setReports((prev) =>
                        prev?.map((x) => (x.reportId === r.reportId ? { ...x, sharedWith } : x)) ?? prev,
                      );
                      setSharing(null);
                    }}
                  />
                )}
              </div>
              <span className={`shrink-0 text-[0.7rem] px-2 py-0.5 rounded-full border ${toneClass}`}>
                {label.text}
              </span>
              <Link
                href={`/report/${encodeURIComponent(r.reportId)}`}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
              >
                Open
              </Link>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setSharing(sharing === r.reportId ? null : r.reportId)}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-border-visible text-text-secondary text-sm hover:border-accent hover:text-accent transition-colors"
                >
                  {sharing === r.reportId ? "Close" : "Share"}
                </button>
              )}
              {isAdmin && (
              <button
                type="button"
                onClick={() => remove(r.reportId)}
                disabled={deleting === r.reportId}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-border-visible text-text-muted text-sm hover:border-danger hover:text-danger transition-colors disabled:opacity-50"
              >
                {deleting === r.reportId ? "…" : "Delete"}
              </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
