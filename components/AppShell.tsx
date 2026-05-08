"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  children: React.ReactNode;
}

export function AppShell({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  const isHistory = pathname === "/history";

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-border-subtle flex items-center justify-between gap-4 bg-bg-secondary/40 shrink-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-serif text-lg tracking-tight text-foreground">
            ContractConsel
          </span>
          <span className="text-accent text-lg leading-none">.</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              !isHistory
                ? "border-accent text-accent bg-accent/5"
                : "border-border-visible text-text-secondary hover:border-accent hover:text-accent"
            }`}
          >
            New
          </Link>
          <Link
            href="/history"
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              isHistory
                ? "border-accent text-accent bg-accent/5"
                : "border-border-visible text-text-secondary hover:border-accent hover:text-accent"
            }`}
          >
            History
          </Link>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="px-3 py-1.5 rounded-lg border border-border-visible text-text-muted hover:border-danger hover:text-danger transition-colors disabled:opacity-50"
          >
            {loggingOut ? "…" : "Logout"}
          </button>
        </nav>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
