// Who is acting. One account can found businesses, ask for services and later buy; the header
// always shows the current person, and the local preview lets you switch between fictional people.
//
// Job 003w-e1: in verified mode the acting identity is (person, account) from the server's session,
// and signing in goes through the wallet controller (wallet.ts). Signing out, or any change of
// account, fences every sign-in still in flight so a late answer lands nowhere.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, type Person } from "./api.ts";
import {
  SignInController,
  type SignInOutcome,
  selectorWallet,
  type WalletBoundary,
  type WalletEnv,
} from "./wallet.ts";

interface SessionState {
  person: Person | null;
  /** Job 003w-e1: the account a verified session proved (null in preview). */
  account: string | null;
  ready: boolean;
  localPreview: boolean;
  /** Job 003w-b: preview sessions, or verified accounts only (no name-only join). */
  identity: "preview" | "verified";
  environment: string;
  /** Job 003w-e1: the wallet controller's configuration, or null (preview). */
  wallet: WalletEnv | null;
  refresh: () => Promise<void>;
  setPerson: (p: Person | null) => void;
  /** Opens the sign-in dialog; resolves with the person once they have joined. */
  requireSignIn: (reason: string, asNewPerson?: boolean) => Promise<Person | null>;
  signInReason: string | null;
  finishSignIn: (p: Person | null) => void;
  /** Job 003w-e1: proves an account through the wallet (verified mode). */
  walletSignIn: (destination: string) => Promise<SignInOutcome>;
  /** Job 003w-e1: completes a redirect-style wallet answer on the return page. */
  completeWalletReturn: (fragment: string) => Promise<SignInOutcome>;
  /** Ends the Everstreet session (never needs the wallet). */
  signOut: () => Promise<void>;
  /** Disconnects the wallet from this browser (the Everstreet session stays). */
  disconnectWallet: () => Promise<void>;
  /** The wallet boundary, loaded on first use (null in preview). */
  walletBoundary: () => Promise<WalletBoundary> | null;
}

const SessionContext = createContext<SessionState | null>(null);

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [env, setEnv] = useState<{
    environment: string;
    localPreview: boolean;
    identity?: "preview" | "verified";
    wallet?: WalletEnv | null;
  }>({ environment: "Local preview", localPreview: true });
  const [signInReason, setSignInReason] = useState<string | null>(null);
  const [resolver, setResolver] = useState<((p: Person | null) => void) | null>(null);
  const boundary = useRef<Promise<WalletBoundary> | null>(null);
  const controller = useRef<SignInController | null>(null);

  const refresh = useCallback(async () => {
    const [me, e] = await Promise.all([api.me(), api.env()]);
    setPerson(me.person);
    setAccount(me.account ?? null);
    setEnv(e);
    setReady(true);
  }, []);
  useEffect(() => {
    refresh().catch(() => setReady(true));
  }, [refresh]);

  const walletEnv = env.identity === "verified" ? (env.wallet ?? null) : null;
  const walletBoundary = useCallback(() => {
    if (!walletEnv) return null;
    if (!boundary.current) {
      boundary.current = selectorWallet(walletEnv);
      // A wallet-side account change or disconnect fences anything still in flight.
      boundary.current
        .then((w) => w.onChange(() => void controller.current?.abandon()))
        .catch(() => {
          boundary.current = null;
        });
    }
    return boundary.current;
  }, [walletEnv]);
  if (!controller.current && walletEnv)
    controller.current = new SignInController(
      {
        challenge: async () => (await api.signInChallenge()).challenge,
        verify: (b) => api.signInVerify(b),
        cancelAttempt: async () => {
          await api.cancelSignIn();
        },
      },
      () => walletBoundary() ?? Promise.reject(new Error("No wallet here.")),
      walletEnv,
      sessionStore(),
    );

  // Any change of who is acting fences sign-ins started under someone else.
  // biome-ignore lint/correctness/useExhaustiveDependencies: person/account are triggers
  useEffect(() => {
    controller.current?.fence();
  }, [person?.id, account]);

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
  const settle = async (out: SignInOutcome) => {
    if (out.kind === "signed_in") {
      setPerson(out.person);
      setAccount(out.account);
      await refresh().catch(() => {});
    }
    return out;
  };
  const unavailable = async (): Promise<SignInOutcome> => ({
    kind: "unavailable",
    message: "Signing in with a wallet isn't available here.",
  });

  return (
    <SessionContext.Provider
      value={{
        person,
        account,
        ready,
        localPreview: env.localPreview,
        identity: env.identity === "verified" ? "verified" : "preview",
        environment: env.environment,
        wallet: walletEnv,
        refresh,
        setPerson,
        requireSignIn,
        signInReason,
        finishSignIn,
        walletSignIn: (d) =>
          controller.current ? controller.current.start(d).then(settle) : unavailable(),
        completeWalletReturn: (f) =>
          controller.current ? controller.current.completeReturn(f).then(settle) : unavailable(),
        signOut: async () => {
          controller.current?.fence();
          await api.signOut();
          setPerson(null);
          setAccount(null);
        },
        disconnectWallet: async () => {
          await controller.current?.abandon();
          const w = boundary.current;
          if (w) await (await w).disconnect();
        },
        walletBoundary,
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
