"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { UserProvider, useCurrentUser } from "./UserContext";

interface Props {
  children: React.ReactNode;
  // Pin to the viewport so inner panes (PDF, side panel) scroll on their own
  // instead of the whole window. Used by the report workbench.
  fixedHeight?: boolean;
}

export function AppShell(props: Props) {
  return (
    <UserProvider>
      <Shell {...props} />
    </UserProvider>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg border transition-colors ${
        active
          ? "border-accent text-accent bg-accent/5"
          : "border-border-visible text-text-secondary hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </Link>
  );
}

function Shell({ children, fixedHeight = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, can } = useCurrentUser();
  const [loggingOut, setLoggingOut] = useState(false);
  const setupPending = !!user && (user.mustChangePassword || user.mfaSetupRequired);

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
    <div
      className={`relative z-10 flex flex-col ${
        fixedHeight ? "h-dvh overflow-hidden" : "min-h-screen"
      }`}
    >
      <header className="px-6 py-3 border-b border-border-subtle flex items-center justify-between gap-4 bg-bg-secondary/40 shrink-0">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-serif text-lg tracking-tight text-foreground">ContractConsel</span>
          <span className="text-accent text-lg leading-none">.</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {!setupPending && (
            <>
              {can("reviewer") && (
                <NavLink href="/" active={pathname === "/"}>
                  New
                </NavLink>
              )}
              <NavLink href="/history" active={pathname === "/history"}>
                History
              </NavLink>
              {can("admin") && (
                <NavLink href="/admin" active={pathname === "/admin"}>
                  Admin
                </NavLink>
              )}
            </>
          )}
          <NavLink href="/account" active={pathname === "/account"}>
            {user ? (
              <span className="flex items-center gap-1.5">
                <span className="max-w-40 truncate">{user.name || user.email}</span>
                <span className="text-[0.62rem] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">
                  {user.role}
                </span>
              </span>
            ) : (
              "Account"
            )}
          </NavLink>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="px-3 py-1.5 rounded-lg border border-border-visible text-text-muted hover:border-danger hover:text-danger transition-colors disabled:opacity-50"
          >
            {loggingOut ? "…" : "Logout"}
          </button>
        </nav>
      </header>
      <div className={`flex-1 min-h-0 flex flex-col ${fixedHeight ? "overflow-y-auto" : ""}`}>
        {children}
      </div>
    </div>
  );
}
