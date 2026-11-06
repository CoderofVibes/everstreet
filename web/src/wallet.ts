// Job 003w-e1 (docs/design/APPLICATION_COMPOSITION.md §9.1–9.3): the wallet boundary and the
// account sign-in controller.
//
// The boundary is the pinned NEAR Wallet Selector (10.1.4) with ONE module: MyNearWallet (10.1.4)
// on testnet, or, only when the server says it is the review harness, the harness's synthetic
// module (which implements the same official WalletModule interface). Everything else in this file
// is the production controller, whatever module is behind it.
//
// Signing in proves control of an account (NEP-413): the server issues the challenge (message,
// nonce, recipient and the EXACT callback URL), the wallet signs it, the server verifies it. A
// wallet's answer is never an identity by itself, and nothing here authorizes customer uses.

import type { SignedMessage, WalletModuleFactory } from "@near-wallet-selector/core";
import type { Person } from "./api.ts";

export interface WalletEnv {
  network: "testnet";
  /** False: the server has no return address configured, so wallet sign-in can't verify. */
  available: boolean;
  /** The review harness's label; null in every real composition. */
  harness: string | null;
}

/** Where contracts run, in words: the review harness's synthetic chain, or NEAR's network. */
export const chainWords = (wallet: WalletEnv | null | undefined, network = "testnet") =>
  wallet?.harness ? "the synthetic chain" : `NEAR ${network}`;

/** One FunctionCall for the customer's wallet (§9.5): every field is shown before approving. */
export interface WalletFunctionCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  /** Decimal strings. */
  gas: string;
  deposit: string;
}

/** What the controllers need from a wallet; the pinned Wallet Selector implements it. */
export interface WalletBoundary {
  readonly label: string;
  readonly synthetic: boolean;
  signMessage(p: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    callbackUrl: string;
    state: string;
  }): Promise<SignedMessage | undefined>;
  /** The wallet's connected account for transactions (connects WITHOUT adding a contract key). */
  connect(): Promise<string | null>;
  accounts(): Promise<string[]>;
  /**
   * Asks the wallet to sign and send ONE FunctionCall. The answer is never treated as an outcome:
   * at most it carries the transaction's hash (job 003web), for the server to read and verify.
   */
  send(call: WalletFunctionCall): Promise<{ txHash: string | null } | undefined>;
  /** Disconnects the wallet from this browser (never ends the Everstreet session). */
  disconnect(): Promise<void>;
  onChange(fn: () => void): () => void;
}

const HARNESS_GLOBAL = "__everstreetHarnessWallet";

/** Job 003web: a transaction hash from a wallet's answer, only if it is a well-formed one. */
export function txHashOf(out: unknown): string | null {
  const h = (out as { transaction?: { hash?: unknown } } | null | undefined)?.transaction?.hash;
  return typeof h === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h) ? h : null;
}

/** The real boundary: the pinned Wallet Selector with one module. Loaded only when used. */
export async function selectorWallet(env: WalletEnv): Promise<WalletBoundary> {
  await import("./bufferGlobal.ts");
  const core = await import("@near-wallet-selector/core");
  let module: WalletModuleFactory;
  let label: string;
  if (env.harness) {
    const injected = (globalThis as Record<string, unknown>)[HARNESS_GLOBAL];
    if (typeof injected !== "function")
      throw new Error("The review harness's wallet isn't loaded on this page.");
    module = injected as WalletModuleFactory;
    label = env.harness;
  } else {
    const { setupMyNearWallet } = await import("@near-wallet-selector/my-near-wallet");
    module = setupMyNearWallet();
    label = "MyNearWallet";
  }
  const selector = await core.setupWalletSelector({ network: env.network, modules: [module] });
  const id = selector.store.getState().modules[0]?.id;
  if (!id) throw new Error("No wallet is available in this browser.");
  const wallet = await selector.wallet(id);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  selector.on("accountsChanged", notify);
  selector.on("signedOut", notify);
  selector.on("signedIn", notify);
  return {
    label,
    synthetic: env.harness !== null,
    async signMessage(p) {
      if (!wallet.signMessage) throw new Error("This wallet can't sign messages.");
      const r = await wallet.signMessage({
        message: p.message,
        recipient: p.recipient,
        nonce: globalThis.Buffer.from(p.nonce),
        callbackUrl: p.callbackUrl,
        state: p.state,
      });
      return r ?? undefined;
    },
    async connect() {
      // No contractId: the wallet adds no function-call (or any) key to the account (§9.5).
      const accounts = await wallet.signIn({});
      return accounts[0]?.accountId ?? null;
    },
    async accounts() {
      return (await wallet.getAccounts()).map((a: { accountId: string }) => a.accountId);
    },
    async send(call) {
      // Job 003web: the pinned adapter answers a FinalExecutionOutcome (or nothing for a
      // redirect-style wallet); only its transaction hash is kept, never a claimed result.
      const out = (await wallet.signAndSendTransaction({
        receiverId: call.receiverId,
        actions: [
          core.actionCreators.functionCall(
            call.methodName,
            call.args,
            BigInt(call.gas),
            BigInt(call.deposit),
          ),
        ],
      })) as { transaction?: { hash?: unknown } } | undefined;
      return { txHash: txHashOf(out) };
    },
    async disconnect() {
      await wallet.signOut();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------- the sign-in controller ----------

export interface SignInPort {
  challenge(): Promise<{
    message: string;
    nonce: string;
    recipient: string;
    callback_url: string | null;
    expires_at: string;
  }>;
  verify(body: {
    account_id: string;
    public_key: string;
    signature: string;
    nonce: string;
  }): Promise<{ person: Person }>;
  /**
   * Cancels THIS browser's pending attempt on the server (its binding), keeping the current
   * session; a verification still in flight then issues nothing. Never ends another session.
   */
  cancelAttempt(): Promise<void>;
}

export type SignInOutcome =
  | { kind: "signed_in"; person: Person; account: string; destination: string }
  | { kind: "cancelled"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string }
  /** The wallet is completing through the return page (a redirect-style wallet). */
  | { kind: "redirecting" }
  /** An older attempt's answer after a newer one, a sign-out or an account switch: dropped. */
  | { kind: "stale" };

export const SIGN_IN_TEXT = {
  cancelled: "You closed the wallet before approving. Nothing changed.",
  blocked: "Your browser blocked the wallet's window. Allow pop-ups for this site, then try again.",
  notConfigured:
    "Signing in with a wallet isn't set up on this server: it has no return address configured. Nothing was sent to a wallet.",
  unsupported: "This wallet can't sign a sign-in message here, so nothing was sent.",
  refused: "That sign-in couldn't be verified; start again.",
  mismatch: "That answer isn't for the sign-in you started here; start again.",
} as const;

const PENDING = "everstreet.signin";

/** A same-origin path to return to; anything else (or the return page itself) is home. */
export function safeDestination(d: unknown): string {
  if (typeof d !== "string" || !d.startsWith("/") || d.startsWith("//") || d.includes("\\"))
    return "/";
  if (d.length > 512 || [...d].some((c) => c.charCodeAt(0) < 32)) return "/";
  if (d === "/signin/return" || d.startsWith("/signin/return?") || d.startsWith("/signin/return#"))
    return "/";
  return d;
}

const randomState = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const nonceBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

interface Pending {
  state: string;
  nonce: string;
  destination: string;
  expires_ms: number;
}

/**
 * One sign-in at a time per page. `fence()` (sign-out, account switch, a newer attempt) makes every
 * answer still in flight land nowhere here: it is never posted to verify, or, if its verify was
 * already in flight, its result is dropped. The server ends that attempt itself: a newer challenge
 * or a sign-out from this browser cancels it by binding. `abandon()` (a wallet-side change, with
 * the Everstreet session kept) fences and asks the server to cancel the attempt.
 */
export class SignInController {
  private generation = 0;
  constructor(
    private readonly port: SignInPort,
    private readonly wallet: () => Promise<WalletBoundary>,
    private readonly env: WalletEnv | null,
    private readonly storage: Storage | null,
    private readonly now: () => number = Date.now,
  ) {}

  fence() {
    this.generation++;
  }

  /** Fences, and cancels this browser's pending attempt on the server (the session stays). */
  async abandon() {
    this.fence();
    this.writePending(null);
    await this.port.cancelAttempt().catch(() => {});
  }

  private readPending(): Pending | null {
    try {
      const raw = this.storage?.getItem(PENDING);
      const p = raw ? (JSON.parse(raw) as Pending) : null;
      return p && typeof p.state === "string" && typeof p.nonce === "string" ? p : null;
    } catch {
      return null;
    }
  }
  private writePending(p: Pending | null) {
    try {
      if (p) this.storage?.setItem(PENDING, JSON.stringify(p));
      else this.storage?.removeItem(PENDING);
    } catch {
      // Storage denied: a popup answer still completes; a redirect answer can't (it is refused).
    }
  }

  /** Starts a sign-in that returns to `destination` (a same-origin path). */
  async start(destination: string): Promise<SignInOutcome> {
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    if (!this.env) return { kind: "unavailable", message: SIGN_IN_TEXT.notConfigured };
    if (!this.env.available) return { kind: "unavailable", message: SIGN_IN_TEXT.notConfigured };
    let ch: Awaited<ReturnType<SignInPort["challenge"]>>;
    try {
      ch = await this.port.challenge();
    } catch (e) {
      return { kind: "failed", message: (e as Error).message };
    }
    if (stale()) return { kind: "stale" };
    if (!ch.callback_url) return { kind: "unavailable", message: SIGN_IN_TEXT.notConfigured };
    const state = randomState();
    this.writePending({
      state,
      nonce: ch.nonce,
      destination: safeDestination(destination),
      expires_ms: Date.parse(ch.expires_at),
    });
    let answer: SignedMessage | undefined;
    try {
      const w = await this.wallet();
      if (stale()) return { kind: "stale" };
      answer = await w.signMessage({
        message: ch.message,
        recipient: ch.recipient,
        nonce: nonceBytes(ch.nonce),
        callbackUrl: ch.callback_url,
        state,
      });
    } catch (e) {
      if (stale()) return { kind: "stale" };
      this.writePending(null);
      const m = (e as Error)?.message ?? "";
      if (/closed the window|cancel|reject/i.test(m))
        return { kind: "cancelled", message: SIGN_IN_TEXT.cancelled };
      if (/popup.*blocked|blocked.*popup/i.test(m))
        return { kind: "blocked", message: SIGN_IN_TEXT.blocked };
      if (/can't sign messages/.test(m))
        return { kind: "unavailable", message: SIGN_IN_TEXT.unsupported };
      return { kind: "failed", message: m || "The wallet didn't answer; try again." };
    }
    if (stale()) return { kind: "stale" };
    if (!answer) return { kind: "redirecting" };
    if (answer.state !== undefined && answer.state !== state) {
      this.writePending(null);
      return { kind: "refused", message: SIGN_IN_TEXT.mismatch };
    }
    return this.finish(gen, answer, ch.nonce, safeDestination(destination));
  }

  /**
   * The return page: a NEP-413 answer in the URL fragment, accepted only for THIS browser's
   * stored, unexpired attempt with the same state; used at most once.
   */
  async completeReturn(fragment: string): Promise<SignInOutcome> {
    const gen = ++this.generation;
    const p = this.readPending();
    this.writePending(null);
    const q = new URLSearchParams(fragment.replace(/^#/, ""));
    if (!p || q.get("state") !== p.state || this.now() >= p.expires_ms)
      return { kind: "refused", message: SIGN_IN_TEXT.mismatch };
    if (q.get("error") || q.get("errorCode"))
      return { kind: "cancelled", message: SIGN_IN_TEXT.cancelled };
    const accountId = q.get("accountId");
    const publicKey = q.get("publicKey");
    const signature = q.get("signature");
    if (!accountId || !publicKey || !signature)
      return { kind: "refused", message: SIGN_IN_TEXT.mismatch };
    return this.finish(gen, { accountId, publicKey, signature }, p.nonce, p.destination);
  }

  private async finish(
    gen: number,
    a: SignedMessage,
    nonce: string,
    destination: string,
  ): Promise<SignInOutcome> {
    this.writePending(null);
    let person: Person;
    try {
      ({ person } = await this.port.verify({
        account_id: a.accountId,
        public_key: a.publicKey,
        signature: a.signature,
        nonce,
      }));
    } catch (e) {
      if (gen !== this.generation) return { kind: "stale" };
      return { kind: "refused", message: (e as Error).message || SIGN_IN_TEXT.refused };
    }
    // Verified after a newer attempt, a sign-out or a wallet change: dropped here, and the SERVER
    // has already ended that attempt by this browser's binding (a newer challenge, the sign-out,
    // or `abandon`). Nothing is ended from here: the session now current may be a newer account's
    // (Astra's controller review reproduced exactly that).
    if (gen !== this.generation) return { kind: "stale" };
    return { kind: "signed_in", person, account: a.accountId, destination };
  }
}
