"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser, type Role } from "./UserContext";

interface AdminUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

interface AuditEntry {
  ts: number;
  action: string;
  uid: string | null;
  email: string | null;
  reportId?: string;
  detail?: Record<string, string | number | boolean>;
  ip: string;
}

const ROLES: Role[] = ["viewer", "reviewer", "admin"];
const ROLE_HELP: Record<Role, string> = {
  viewer: "View, search and export reports shared with them",
  reviewer: "Also upload contracts, run extraction and edit findings",
  admin: "Everything, plus users, sharing, deletion and the audit log",
};

const field =
  "bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground";
const small =
  "px-2 py-1 rounded border border-border-visible text-xs text-text-secondary hover:border-accent hover:text-accent disabled:opacity-40";

const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function AdminPanel() {
  const { can } = useCurrentUser();
  const [tab, setTab] = useState<"users" | "audit">("users");
  if (!can("admin")) return <p className="px-6 py-10 text-sm text-text-muted">Admins only.</p>;
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <p className="text-xs uppercase tracking-widest text-text-muted">Administration</p>
      <div className="mt-2 mb-6 flex gap-2">
        {(["users", "audit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg border text-sm ${
              tab === t ? "border-accent text-accent bg-accent/5" : "border-border-visible text-text-secondary hover:border-accent"
            }`}
          >
            {t === "users" ? "Users" : "Audit log"}
          </button>
        ))}
      </div>
      {tab === "users" ? <Users /> : <Audit />}
    </div>
  );
}

function Secret({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-accent/50 bg-accent/10 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="flex items-center gap-2">
        <code className="text-base bg-bg-tertiary rounded px-2 py-1 text-foreground select-all">{value}</code>
        <button
          className={small}
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-text-muted">
        Shown once. Send it to the user privately; at first sign-in they choose their own password and set up their authenticator app.
      </p>
      <button className={small} onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function Users() {
  const { user: me } = useCurrentUser();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", role: "reviewer" as Role });
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: AdminUser[] }>("/api/admin/users")).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const patch = (body: object) => api<{ user: AdminUser; temporaryPassword?: string }>("/api/admin/users", { method: "PATCH", body: JSON.stringify(body) });

  return (
    <div className="space-y-6">
      <form
        className="bg-bg-secondary border border-border-subtle rounded-xl p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act("create", async () => {
            const res = await api<{ user: AdminUser; temporaryPassword: string }>("/api/admin/users", {
              method: "POST",
              body: JSON.stringify(form),
            });
            setSecret({ title: `Temporary password for ${res.user.email}`, value: res.temporaryPassword });
            setForm({ email: "", name: "", role: "reviewer" });
          });
        }}
      >
        <h2 className="font-serif text-xl text-foreground">Add a user</h2>
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto_auto]">
          <input className={field} type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} aria-label="Role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button disabled={busy === "create"} className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover disabled:opacity-50">
            {busy === "create" ? "Adding…" : "Add user"}
          </button>
        </div>
        <p className="text-xs text-text-muted">{ROLE_HELP[form.role]}.</p>
      </form>

      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-left text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">2FA</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users === null ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const self = u.uid === me?.uid;
                return (
                  <tr key={u.uid} className="border-t border-border-subtle">
                    <td className="px-3 py-2">
                      <p className="text-foreground">{u.name || "—"}{self && <span className="text-text-muted"> (you)</span>}</p>
                      <p className="text-xs text-text-muted">{u.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`${field} py-1`}
                        value={u.role}
                        disabled={self || busy !== null}
                        aria-label={`Role for ${u.email}`}
                        onChange={(e) => act(`role-${u.uid}`, async () => void (await patch({ uid: u.uid, role: e.target.value })))}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {u.totpEnabled ? <span className="text-accent">On</span> : <span className="text-text-muted">Not set up</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">{when(u.lastLoginAt)}</td>
                    <td className="px-3 py-2 text-xs">
                      {u.disabled ? (
                        <span className="text-danger">Disabled</span>
                      ) : u.mustChangePassword ? (
                        <span className="text-text-muted">Invited</span>
                      ) : (
                        <span className="text-accent">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className={small}
                          disabled={busy !== null}
                          onClick={() =>
                            confirm(`Reset the password for ${u.email}? They will be signed out.`) &&
                            act(`pw-${u.uid}`, async () => {
                              const r = await patch({ uid: u.uid, resetPassword: true });
                              if (r.temporaryPassword) setSecret({ title: `New temporary password for ${u.email}`, value: r.temporaryPassword });
                            })
                          }
                        >
                          Reset password
                        </button>
                        {u.totpEnabled && (
                          <button
                            className={small}
                            disabled={busy !== null}
                            onClick={() =>
                              confirm(`Reset 2FA for ${u.email}? They'll set up a new authenticator at next sign-in.`) &&
                              act(`2fa-${u.uid}`, async () => void (await patch({ uid: u.uid, reset2fa: true })))
                            }
                          >
                            Reset 2FA
                          </button>
                        )}
                        {!self && (
                          <button
                            className={small}
                            disabled={busy !== null}
                            onClick={() =>
                              (u.disabled || confirm(`Disable ${u.email}? They'll be signed out immediately.`)) &&
                              act(`dis-${u.uid}`, async () => void (await patch({ uid: u.uid, disabled: !u.disabled })))
                            }
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACTION_GROUPS = [
  ["", "All actions"],
  ["auth", "Sign-ins"],
  ["account", "Account changes"],
  ["user", "User management"],
  ["report", "Reports"],
  ["extraction", "Extraction"],
  ["datapoint", "Data points"],
] as const;

function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [uid, setUid] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (before?: number) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        if (uid) q.set("uid", uid);
        if (action) q.set("action", action);
        if (before) q.set("before", String(before));
        const { entries: page } = await api<{ entries: AuditEntry[] }>(`/api/admin/audit?${q}`);
        setEntries((prev) => (before ? [...prev, ...page] : page));
        setDone(page.length < 100);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the audit log.");
      } finally {
        setLoading(false);
      }
    },
    [uid, action],
  );

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);
  useEffect(() => {
    api<{ users: AdminUser[] }>("/api/admin/users").then((r) => setUsers(r.users)).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={field} value={uid} onChange={(e) => setUid(e.target.value)} aria-label="Filter by user">
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.uid} value={u.uid}>
              {u.email}
            </option>
          ))}
        </select>
        <select className={field} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
          {ACTION_GROUPS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted ml-auto">Kept for 400 days. Contract text, filenames and search terms are never logged.</p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-left text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.ts}-${i}`} className="border-t border-border-subtle align-top">
                <td className="px-3 py-1.5 text-xs text-text-muted whitespace-nowrap">{when(e.ts)}</td>
                <td className="px-3 py-1.5 text-xs">{e.email ?? "—"}</td>
                <td className={`px-3 py-1.5 text-xs font-mono ${/failed/.test(e.action) ? "text-danger" : "text-foreground"}`}>{e.action}</td>
                <td className="px-3 py-1.5 text-xs">
                  {e.reportId ? (
                    <a className="text-accent hover:underline" href={`/report/${encodeURIComponent(e.reportId)}`}>
                      {e.reportId.slice(0, 8)}…
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-text-muted">
                  {e.detail ? Object.entries(e.detail).map(([k, v]) => `${k}: ${v}`).join(" · ") : ""}
                </td>
                <td className="px-3 py-1.5 text-xs text-text-muted">{e.ip}</td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-text-muted text-sm">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!done && entries.length > 0 && (
        <button className={small} disabled={loading} onClick={() => fetchPage(entries[entries.length - 1].ts)}>
          {loading ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}
