import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api";

type AuthCtx = {
  user: api.User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.User | null>(null);
  const [loading, setLoading] = useState(true);

  // On startup: if a token exists, validate it against a token-protected
  // endpoint (/api/auth/me) and only then decide whether the user is
  // logged in. A missing or rejected token → logged out.
  useEffect(() => {
    let cancelled = false;
    api
      .getCurrentUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value: AuthCtx = useMemo(
    () => ({
      user,
      loading,
      signIn: async (e, p) => setUser(await api.signIn(e, p)),
      signUp: async (e, p) => setUser(await api.signUp(e, p)),
      signOut: async () => {
        await api.signOut();
        setUser(null);
      },
    }),
    [user, loading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
