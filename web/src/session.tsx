// Who is acting. One account can found businesses, ask for services and later buy; the header
// always shows the current person, and the local preview lets you switch between fictional people.
//
// Job 003w-e1: in verified mode the acting identity is (person, account) from the server's session,
// and signing in goes through the wallet controller (wallet.ts).
// Job 003wea: the identity state machine is SessionModel (sessionModel.ts), whose orderings are
// tested: an old /me answer never restores an ended or replaced identity, a delayed logout answer
// never clears a newer one, and sign-out settles a pending prompt. Every change of who is acting
// fences sign-ins still in flight; private pages remount per person (App.tsx keys).

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type Person } from "./api.ts";
import { SessionModel } from "./sessionModel.ts";
import {
  SignInController,
  type SignInOutcome,
  selectorWallet,
  type WalletBoundary,
  type WalletEnv,
} from "./wallet.ts";

interface SessionState {
  person: Person | null;
  /** 006b2: this session's identity epoch (changes on every sign-out, sign-in or switch). */
  sessionEpoch: number;
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
  const controller = useRef<SignInController | null>(null);
  const [model] = useState(
    () =>
      new SessionModel(
        { me: () => api.me(), env: () => api.env(), signOut: () => api.signOut() },
        () => controller.current?.fence(),
      ),
  );
  const s = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const boundary = useRef<Promise<WalletBoundary> | null>(null);

  useEffect(() => {
    model.refresh().catch(() => model.setReadyAfterFailure());
  }, [model]);

  const walletEnv = s.env.identity === "verified" ? (s.env.wallet ?? null) : null;
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

  const unavailable = async (): Promise<SignInOutcome> => ({
    kind: "unavailable",
    message: "Signing in with a wallet isn't available here.",
  });

  return (
    <SessionContext.Provider
      value={{
        person: s.person,
        sessionEpoch: s.epoch,
        account: s.account,
        ready: s.ready,
        localPreview: s.env.localPreview,
        identity: s.env.identity === "verified" ? "verified" : "preview",
        environment: s.env.environment,
        wallet: walletEnv,
        refresh: model.refresh,
        setPerson: model.setPerson,
        requireSignIn: model.requireSignIn,
        signInReason: s.signInReason,
        finishSignIn: model.finishSignIn,
        walletSignIn: (d) =>
          controller.current ? controller.current.start(d).then(model.settle) : unavailable(),
        completeWalletReturn: (f) =>
          controller.current
            ? controller.current.completeReturn(f).then(model.settle)
            : unavailable(),
        signOut: model.signOut,
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
