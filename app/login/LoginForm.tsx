"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set after a correct password when the account has 2FA on.
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function finish(data: { mustChangePassword?: boolean }) {
    router.replace(data.mustChangePassword ? "/account" : "/");
    router.refresh();
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        if (res.status === 401 && /expired/i.test(data.error ?? "")) setTicket(null);
        setCode("");
        return;
      }
      finish(data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed.");
        return;
      }
      if (data.mfaRequired) {
        setTicket(data.ticket);
        setPassword("");
        return;
      }
      finish(data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (ticket) {
    return (
      <form onSubmit={onSubmitCode} className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Enter the 6-digit code from your authenticator app.
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          aria-label="Authentication code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          className="bg-bg-secondary border border-border-visible rounded-lg px-3 py-2.5 text-center text-2xl tracking-[0.5em] text-foreground focus:outline-none focus:border-accent"
        />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          className="bg-accent text-background font-medium rounded-lg px-4 py-2.5 hover:bg-accent-hover transition-colors disabled:opacity-60"
        >
          {submitting ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          onClick={() => {
            setTicket(null);
            setCode("");
            setError(null);
          }}
          className="text-xs text-text-muted hover:text-accent"
        >
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-text-muted">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-bg-secondary border border-border-visible rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-text-muted">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bg-bg-secondary border border-border-visible rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="mt-2 bg-accent text-background font-medium rounded-lg px-4 py-2.5 hover:bg-accent-hover transition-colors disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
