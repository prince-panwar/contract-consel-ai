"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./UserContext";

const input =
  "w-full bg-bg-tertiary border border-border-visible focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-foreground";
const primary =
  "px-4 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg-secondary border border-border-subtle rounded-xl p-5 space-y-4">
      <h2 className="font-serif text-xl text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function AccountSettings() {
  const { user, refresh } = useCurrentUser();
  const router = useRouter();
  if (!user) return <p className="text-sm text-text-muted">Loading…</p>;
  const setupPending = user.mustChangePassword || user.mfaSetupRequired;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-text-muted">Account</p>
        <h1 className="font-serif text-3xl text-foreground mt-1">{user.name || user.email}</h1>
        <p className="text-sm text-text-secondary mt-1">
          {user.email} · <span className="capitalize">{user.role}</span>
        </p>
      </div>

      {setupPending && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
          <strong className="font-medium">Finish setting up your account.</strong>{" "}
          {user.mustChangePassword
            ? "First choose your own password, then set up two-factor authentication."
            : "Set up two-factor authentication to start using ContractConsel."}
        </div>
      )}

      <PasswordCard mustChange={user.mustChangePassword} onDone={refresh} />
      {!user.mustChangePassword && (
        <TwoFactorCard enabled={user.totpEnabled} required={user.mfaSetupRequired || user.totpEnabled} onDone={refresh} />
      )}

      {!setupPending && (
        <button onClick={() => router.push("/history")} className="text-sm text-accent hover:underline">
          ← Back to reports
        </button>
      )}
    </div>
  );
}

function PasswordCard({ mustChange, onDone }: { mustChange: boolean; onDone: () => Promise<void> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: "New passwords don't match." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change password.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
      await onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not change password." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={mustChange ? "Choose your password" : "Change password"}>
      <form onSubmit={submit} className="space-y-3">
        <input type="password" autoComplete="current-password" placeholder={mustChange ? "Temporary password" : "Current password"} value={current} onChange={(e) => setCurrent(e.target.value)} className={input} required />
        <input type="password" autoComplete="new-password" placeholder="New password (12+ characters, letters and numbers)" value={next} onChange={(e) => setNext(e.target.value)} className={input} required />
        <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} required />
        {msg && <p className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </Card>
  );
}

function TwoFactorCard({ enabled, required, onDone }: { enabled: boolean; required: boolean; onDone: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const call = async (body: object) => {
    const res = await fetch("/api/account/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="6-digit code"
      aria-label="Authentication code"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className={`${input} max-w-40 text-center tracking-[0.3em]`}
    />
  );

  if (enabled) {
    return (
      <Card title="Two-factor authentication">
        <p className="text-sm text-accent">On. You&apos;ll be asked for a code from your authenticator app at each sign-in.</p>
        {required ? (
          <p className="text-xs text-text-muted">
            Two-factor authentication is required for all accounts. Lost your phone? Ask an administrator to reset it; you&apos;ll set it up again at your next sign-in.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">To turn it off, confirm your password and a current code.</p>
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            <div className="flex gap-2">
              {codeInput}
              <button
                disabled={busy || code.length !== 6 || !password}
                onClick={() => run(async () => { await call({ action: "disable", password, code }); setMsg({ ok: true, text: "Two-factor authentication is off." }); await onDone(); })}
                className="px-4 py-2 rounded-lg border border-border-visible text-sm text-text-secondary hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Turn off
              </button>
            </div>
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
      </Card>
    );
  }

  return (
    <Card title="Set up two-factor authentication">
      {!setup ? (
        <>
          <p className="text-sm text-text-secondary">
            Use an authenticator app such as Google Authenticator, Microsoft Authenticator, Authy or 1Password.
          </p>
          <button disabled={busy} onClick={() => run(async () => setSetup(await call({ action: "setup" })))} className={primary}>
            {busy ? "Preparing…" : "Start setup"}
          </button>
        </>
      ) : (
        <div className="space-y-4">
          <ol className="text-sm text-text-secondary list-decimal list-inside space-y-1">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code (or enter the key below).</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg bg-white p-2" />
            <div className="space-y-1 min-w-0">
              <p className="text-xs text-text-muted">Can&apos;t scan? Enter this key:</p>
              <code className="block text-sm text-foreground break-all select-all bg-bg-tertiary rounded px-2 py-1">
                {setup.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
              <p className="text-xs text-text-muted">Type: time-based · 6 digits · 30 seconds</p>
            </div>
          </div>
          <div className="flex gap-2">
            {codeInput}
            <button
              disabled={busy || code.length !== 6}
              onClick={() => run(async () => { await call({ action: "enable", code }); setSetup(null); setCode(""); setMsg({ ok: true, text: "Two-factor authentication is on." }); await onDone(); })}
              className={primary}
            >
              {busy ? "Checking…" : "Verify and turn on"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
    </Card>
  );
}
