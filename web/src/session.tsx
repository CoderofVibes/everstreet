// Who is acting. One account can found businesses, ask for services and later buy; the header
// always shows the current person, and the local preview lets you switch between fictional people.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, type Person } from "./api.ts";

interface SessionState {
  person: Person | null;
  ready: boolean;
  localPreview: boolean;
  /** Job 003w-b: preview sessions, or verified accounts only (no name-only join). */
  identity: "preview" | "verified";
  environment: string;
  refresh: () => Promise<void>;
  setPerson: (p: Person | null) => void;
  /** Opens the sign-in dialog; resolves with the person once they have joined. */
  requireSignIn: (reason: string, asNewPerson?: boolean) => Promise<Person | null>;
  signInReason: string | null;
  finishSignIn: (p: Person | null) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [ready, setReady] = useState(false);
  const [env, setEnv] = useState<{
    environment: string;
    localPreview: boolean;
    identity?: "preview" | "verified";
  }>({ environment: "Local preview", localPreview: true });
  const [signInReason, setSignInReason] = useState<string | null>(null);
  const [resolver, setResolver] = useState<((p: Person | null) => void) | null>(null);

  const refresh = useCallback(async () => {
    const [{ person }, e] = await Promise.all([api.me(), api.env()]);
    setPerson(person);
    setEnv(e);
    setReady(true);
  }, []);
  useEffect(() => {
    refresh().catch(() => setReady(true));
  }, [refresh]);

  const requireSignIn = (reason: string, asNewPerson = false) => {
    if (person && !asNewPerson) return Promise.resolve(person);
    setSignInReason(reason);
    return new Promise<Person | null>((resolve) => setResolver(() => resolve));
  };
  const finishSignIn = (p: Person | null) => {
    if (p) setPerson(p);
    setSignInReason(null);
    resolver?.(p);
    setResolver(null);
  };

  return (
    <SessionContext.Provider
      value={{
        person,
        ready,
        localPreview: env.localPreview,
        identity: env.identity === "verified" ? "verified" : "preview",
        environment: env.environment,
        refresh,
        setPerson,
        requireSignIn,
        signInReason,
        finishSignIn,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}
