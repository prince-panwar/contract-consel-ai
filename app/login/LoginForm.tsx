"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Sign-in failed.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
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
