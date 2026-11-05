// Job 003wea: the acting identity's state machine behind SessionProvider (session.tsx), as a plain
// class so its asynchronous orderings can be tested without a DOM. The provider renders from it
// (useSyncExternalStore) and calls nothing else for identity.

import type { Person } from "./api.ts";
import type { SignInOutcome, WalletEnv } from "./wallet.ts";

export interface SessionEnv {
  environment: string;
  localPreview: boolean;
  identity?: "preview" | "verified";
  wallet?: WalletEnv | null;
}

export interface SessionApi {
  me(): Promise<{ person: Person | null; account?: string | null }>;
  env(): Promise<SessionEnv>;
  signOut(): Promise<unknown>;
}

export interface SessionSnapshot {
  person: Person | null;
  account: string | null;
  ready: boolean;
  env: SessionEnv;
  signInReason: string | null;
  /**
   * 006b2: bumped by every change of who is acting, including signing out and back in as the
   * same account. Anything started in one session compares this before it shows or frees anything.
   */
  epoch: number;
}

export class SessionModel {
  private state: SessionSnapshot = {
    person: null,
    account: null,
    ready: false,
    env: { environment: "Local preview", localPreview: true },
    signInReason: null,
    epoch: 0,
  };
  private listeners = new Set<() => void>();
  private resolver: ((p: Person | null) => void) | null = null;
  /**
   * Bumped by every change of who is acting (sign-out, sign-in, a switch). A /me answer started
   * under an older generation, or overtaken by a newer refresh, never changes who is acting.
   */
  private generation = 0;
  private refreshes = 0;

  constructor(
    private readonly api: SessionApi,
    /** Called whenever who is acting changes (fences sign-ins started under someone else). */
    private readonly onIdentityChange: () => void = () => {},
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(patch: Partial<SessionSnapshot>) {
    const before = this.state;
    this.state = { ...this.state, ...patch };
    if (before.person?.id !== this.state.person?.id || before.account !== this.state.account) {
      this.state = { ...this.state, epoch: before.epoch + 1 };
      this.onIdentityChange();
    }
    for (const l of this.listeners) l();
  }

  refresh = async () => {
    const gen = this.generation;
    const seq = ++this.refreshes;
    const [me, e] = await Promise.all([this.api.me(), this.api.env()]);
    if (gen !== this.generation || seq !== this.refreshes) {
      // Overtaken: the environment still applies; who is acting does not.
      this.set({ env: e, ready: true });
      return;
    }
    this.set({ person: me.person, account: me.account ?? null, env: e, ready: true });
  };

  /** The first read failed: the page still becomes usable (signed out until a refresh works). */
  setReadyAfterFailure = () => this.set({ ready: true });

  setPerson = (p: Person | null) => {
    this.generation++;
    this.set({ person: p });
  };

  requireSignIn = (reason: string, asNewPerson = false) => {
    if (this.state.person && !asNewPerson) return Promise.resolve(this.state.person);
    this.set({ signInReason: reason });
    this.resolver?.(null); // an earlier prompt is replaced, never left unsettled
    return new Promise<Person | null>((resolve) => {
      this.resolver = resolve;
    });
  };
  finishSignIn = (p: Person | null) => {
    if (p) {
      this.generation++;
      this.set({ person: p });
    }
    this.set({ signInReason: null });
    this.resolver?.(p);
    this.resolver = null;
  };

  /** Applies a wallet sign-in's outcome. */
  settle = async (out: SignInOutcome) => {
    if (out.kind === "signed_in") {
      const gen = ++this.generation;
      this.set({ person: out.person, account: out.account });
      await this.refresh().catch(() => {});
      // Astra's session-model probe: a sign-out or a newer account while this refresh was on its
      // way makes this completion stale, so the dialog never restores its person.
      if (gen !== this.generation) return { kind: "stale" } as SignInOutcome;
    }
    return out;
  };

  /**
   * Ends the Everstreet session. Who is acting is cleared AT ONCE (a newer sign-in made while the
   * answer is on its way is never cleared by it), and a pending sign-in prompt is settled with no
   * one. If the server couldn't be told, a refresh reads what it says.
   */
  signOut = async () => {
    this.generation++;
    this.onIdentityChange();
    const prompt = this.resolver;
    this.resolver = null;
    this.set({ person: null, account: null, signInReason: null });
    prompt?.(null);
    try {
      await this.api.signOut();
    } catch {
      await this.refresh().catch(() => {});
    }
  };
}
