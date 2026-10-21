"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Role = "viewer" | "reviewer" | "admin";

export interface CurrentUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  // Server policy: 2FA must be set up before the app can be used.
  mfaSetupRequired: boolean;
}

const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };

interface Ctx {
  user: CurrentUser | null;
  refresh: () => Promise<void>;
  can: (min: Role) => boolean;
}

const UserCtx = createContext<Ctx>({ user: null, refresh: async () => {}, can: () => false });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.ok) setUser((await res.json()) as CurrentUser);
    } catch {
      /* keep last known */
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Account setup (forced password change, 2FA enrolment) blocks everything else.
  useEffect(() => {
    if (user && (user.mustChangePassword || user.mfaSetupRequired) && pathname !== "/account") {
      router.replace("/account");
    }
  }, [user, pathname, router]);

  const can = (min: Role) => !!user && RANK[user.role] >= RANK[min];
  return <UserCtx.Provider value={{ user, refresh, can }}>{children}</UserCtx.Provider>;
}

export function useCurrentUser(): Ctx {
  return useContext(UserCtx);
}
