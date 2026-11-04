// Job 001f2: one private read that belongs to the signed-in account. Home's "Continue building",
// Build's project list and the composer's business choices each showed whatever answer arrived
// last, so a slow answer for Ava could replace Bea's own projects after a switch. Here every
// answer is bound to the account that asked: switching or signing out drops what was shown at
// once (before the next account's answer), a late success or failure for anyone else changes
// nothing, reads are sequenced (latestLoader), a retry re-reads for the same account, and losing
// access (401/403/404) drops the data. The server's own ownership checks are unchanged.

import { useEffect, useReducer, useState } from "react";
import { initialLoad, type LoadState, latestLoader } from "./latestLoad.ts";

/** What was loaded, and for whom. */
export interface ActorSlot<T> {
  who: string | null;
  state: LoadState<T>;
}

/** The slot's state only when it was loaded for this account; anyone else starts from nothing. */
export function stateFor<T>(slot: ActorSlot<T>, who: string | null): LoadState<T> {
  return slot.who !== null && slot.who === who ? slot.state : initialLoad<T>();
}

export class ActorRead<T> {
  private who: string | null = null;
  private slot: ActorSlot<T> = { who: null, state: initialLoad<T>() };
  private loader: ReturnType<typeof latestLoader<T>> | null = null;
  private readonly listeners = new Set<() => void>();
  private closed = false;

  constructor(private readonly get: (who: string) => Promise<T>) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** What to show for this account now (nothing for anyone the data wasn't read for). */
  snapshot(who: string | null): LoadState<T> {
    return stateFor(this.slot, who);
  }

  /** The signed-in account changed (or is first known): drop the old answer and read anew. */
  setActor(who: string | null) {
    if (this.closed || (who === this.who && (who === null || this.loader))) return;
    this.loader?.close();
    this.loader = null;
    this.who = who;
    this.slot = { who, state: initialLoad<T>() };
    this.emit();
    if (who !== null) this.start(who);
  }

  /** Read again for the same account (after a failure, or on request). */
  retry() {
    if (this.closed || this.who === null || !this.loader) return;
    this.slot = { who: this.who, state: { ...this.slot.state, error: null, status: "loading" } };
    this.emit();
    void this.loader.load();
  }

  /** Mounted (again): reads may start. */
  open() {
    this.closed = false;
  }

  /** Unmounted: any answer still in flight changes nothing; a later open reads afresh. */
  close() {
    this.closed = true;
    this.loader?.close();
    this.loader = null;
    this.who = null;
  }

  private start(who: string) {
    const loader = latestLoader(
      () => this.get(who),
      (patch) => {
        if (this.closed || this.slot.who !== who) return;
        this.slot = { who, state: { ...this.slot.state, ...patch } };
        this.emit();
      },
    );
    this.loader = loader;
    void loader.load();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/**
 * The React side: `who` is the signed-in account's id (null when signed out or not wanted).
 * `get` is read once per account and retry; it receives the account it is reading for.
 */
export function useActorRead<T>(
  who: string | null,
  get: (who: string) => Promise<T>,
): { state: LoadState<T>; retry: () => void } {
  const [read] = useState(() => new ActorRead(get));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    read.open();
    const off = read.subscribe(rerender);
    return () => {
      off();
      read.close();
    };
  }, [read]);
  useEffect(() => {
    read.setActor(who);
  }, [read, who]);
  return { state: read.snapshot(who), retry: () => read.retry() };
}

/** A public read (no account) that settles into data or an honest retry. */
export function usePublicRead<T>(get: () => Promise<T>): {
  state: LoadState<T>;
  retry: () => void;
} {
  const [state, setState] = useState<LoadState<T>>(initialLoad);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger; get is fixed per mount.
  useEffect(() => {
    setState((s) => ({ ...s, error: null, status: "loading" }));
    const l = latestLoader(get, (p) => setState((s) => ({ ...s, ...p })));
    void l.load();
    return () => l.close();
  }, [attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}
