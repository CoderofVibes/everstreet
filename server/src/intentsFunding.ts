// Funding a sale's escrow from another token, through NEAR's intents verifier (NEAR's own
// contract, built from its published source; contracts/intents-funding tests it on a local node).
//
// Everstreet acts as the solver, labelled as one: it quotes, signs its own side of the swap with
// its own key and its own tokens, and submits both signed sides. The buyer's wallet signs the
// buyer's side (NEP-413) and sends the buyer's own deposit and withdrawal. Nothing here touches
// the sale: the buyer funds escrow with the existing fund request, and escrow counts as funded only
// when the business contract shows it.
//
// Stages, each read live: quoted → deposited (the buyer's token is in the verifier) → swapped (the
// buyer's signed nonce is spent) → delivered (the tUSD left the verifier for the buyer's own
// account) → funded (the business contract holds the price). Failures: expired, underpaid,
// refused by the verifier, refunded (an unswapped deposit withdrawn back), and a lost response,
// which resolves from the verifier's nonce record.

import { randomBytes, randomUUID } from "node:crypto";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import type { Db } from "./db.ts";
import { nep413Digest, verifyNep413 } from "./identity.ts";
import { toB58 } from "./lightClient.ts";
import { HttpError } from "./store.ts";
import type { BlockRef } from "./v3read.ts";

/** Everstreet's solver: its account, its signing key, and its own submission of a matched pair. */
export interface SolverPort {
  readonly account: string;
  /** ed25519:<base58> */
  readonly publicKey: string;
  /** "synthetic" (the demo's double) or "testnet". */
  readonly source: "synthetic" | "testnet";
  /** A 64-byte ed25519 signature over a NEP-413 digest. */
  sign(digest: Buffer): Buffer;
  /**
   * Sends `execute_intents` as the solver. Resolves with its hash; rejects with IntentsRefused
   * (the verifier refused: nothing moved) or with any other error (the outcome isn't known).
   */
  execute(verifier: string, signed: unknown[]): Promise<{ hash: string }>;
}

export class IntentsRefused extends Error {}

export interface IntentsOffer {
  /** The token the buyer gives (NEP-141 account). */
  token: string;
  symbol: string;
  decimals: number;
  /** Base units of `token` per base unit of the sale's token, as a fraction. */
  rate_num: string;
  rate_den: string;
}

export interface IntentsBinding {
  business_id: string;
  network: string;
  /** The business contract's account. */
  account: string;
  /** The sale's token (NEP-141 account). */
  asset: string;
  verifier: string;
  offers: IntentsOffer[];
}

export interface IntentsOptions {
  bindings: IntentsBinding[];
  solver: SolverPort | null;
  quoteTtlMs?: number;
  readTimeoutMs?: number;
  now?: () => number;
}

type Stored = "quoted" | "swapping" | "swapped" | "refused" | "unknown";

interface Row {
  id: string;
  business_id: string;
  person_id: string;
  account: string;
  deal_seq: string;
  version: number;
  verifier: string;
  give_token: string;
  give_amount: string;
  get_token: string;
  get_amount: string;
  deadline_ms: number;
  nonce: string;
  state: Stored;
  deposit_seen: number;
  exec_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type IntentsStage =
  | "quoted"
  | "deposited"
  | "swapped"
  | "delivered"
  | "funded"
  | "expired"
  | "refused"
  | "refunded"
  | "unknown";

export function migrateIntents(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intent_fundings (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
      person_id TEXT NOT NULL REFERENCES people(id), account TEXT NOT NULL,
      deal_seq TEXT NOT NULL, version INTEGER NOT NULL, verifier TEXT NOT NULL,
      give_token TEXT NOT NULL, give_amount TEXT NOT NULL,
      get_token TEXT NOT NULL, get_amount TEXT NOT NULL,
      deadline_ms INTEGER NOT NULL, nonce TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('quoted','swapping','swapped','refused','unknown')),
      deposit_seen INTEGER NOT NULL DEFAULT 0,
      exec_hash TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
  `);
}

const bad = (status: 400 | 403 | 404 | 409 | 503, message: string, code: string): never => {
  throw new HttpError(status, message, code);
};

/** The verifier's versioned nonce: magic prefix, version 0, salt, deadline (ns), 15 random bytes. */
export function versionedNonce(saltHex: string, deadlineMs: number, random = randomBytes(15)) {
  if (!/^[0-9a-f]{8}$/.test(saltHex)) throw new Error("the salt is 4 bytes of hex");
  const out = Buffer.alloc(32);
  Buffer.from("5628f6c6", "hex").copy(out, 0);
  out[4] = 0;
  Buffer.from(saltHex, "hex").copy(out, 5);
  out.writeBigInt64LE(BigInt(deadlineMs) * 1_000_000n, 9);
  random.copy(out, 17, 0, 15);
  return out;
}

/** The NEP-413 message one side signs: a token diff, positive for what it receives. */
export function intentMessage(p: {
  signer: string;
  deadlineMs: number;
  give: { token: string; amount: string };
  get: { token: string; amount: string };
}) {
  return JSON.stringify({
    signer_id: p.signer,
    deadline: new Date(p.deadlineMs).toISOString(),
    intents: [
      {
        intent: "token_diff",
        diff: {
          [`nep141:${p.give.token}`]: `-${p.give.amount}`,
          [`nep141:${p.get.token}`]: p.get.amount,
        },
      },
    ],
  });
}

/** One signed side, as the verifier's `execute_intents` takes it. */
export function signedPayload(p: {
  message: string;
  nonce: Buffer;
  recipient: string;
  callbackUrl?: string | null;
  publicKey: string;
  signature: Buffer;
}) {
  return {
    standard: "nep413",
    payload: {
      message: p.message,
      nonce: p.nonce.toString("base64"),
      recipient: p.recipient,
      ...(typeof p.callbackUrl === "string" ? { callback_url: p.callbackUrl } : {}),
    },
    public_key: p.publicKey,
    signature: `ed25519:${toB58(p.signature)}`,
  };
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export class IntentsFunding {
  constructor(
    private readonly db: Db,
    private readonly reader: CustomerViewTransport | null,
    private readonly opts: IntentsOptions,
  ) {
    migrateIntents(db);
  }

  binding(businessId: string) {
    return this.opts.bindings.find((b) => b.business_id === businessId) ?? null;
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private async reads(network: string, calls: [string, string, Record<string, unknown>][]) {
    const reader = this.reader ?? bad(503, "NEAR isn't connected here.", "unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.readTimeoutMs ?? 10_000);
    try {
      const block = (await reader.finalBlock(network, controller.signal)) as PinnedBlock;
      return await Promise.all(
        calls.map(async ([account, method, args]) => {
          const r = await reader.view({
            network,
            account,
            method,
            args,
            block: block as BlockRef,
            signal: controller.signal,
          });
          return JSON.parse(r.result) as unknown;
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private row(personId: string, id: string) {
    const r = this.db
      .prepare("SELECT * FROM intent_fundings WHERE id = ? AND person_id = ?")
      .get(id, personId) as Row | undefined;
    return r ?? bad(404, "No such funding.", "no_funding");
  }

  private set(id: string, fields: Partial<Row>) {
    const keys = Object.keys(fields);
    this.db
      .prepare(
        `UPDATE intent_fundings SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      )
      .run(
        ...keys.map((k) => (fields as Record<string, string | number | null>)[k] ?? null),
        new Date(this.now()).toISOString(),
        id,
      );
  }

  /** The live deal, as the business contract shows it now. */
  private async deal(b: IntentsBinding) {
    const [control] = await this.reads(b.network, [[b.account, "get_control", {}]]);
    const d = (control as { live_deal: Record<string, unknown> | null }).live_deal;
    return d
      ? {
          seq: String(d.seq),
          version: Number(d.version),
          buyer: String(d.buyer),
          price: String(d.price),
          escrow: String(d.escrow),
          state: String(d.state),
        }
      : null;
  }

  /**
   * A quote for the live deal's buyer: `offer.token` for exactly the price, for a short time. The
   * solver's side is signed now; the buyer signs theirs with their wallet.
   */
  async quote(who: { person_id: string; account: string }, businessId: string, token: string) {
    const b =
      this.binding(businessId) ?? bad(404, "Intents funding isn't set up here.", "no_intents");
    if (!this.opts.solver) bad(503, "No solver is connected here.", "no_solver");
    const offer =
      b.offers.find((o) => o.token === token) ?? bad(400, "That token isn't offered.", "bad_token");
    // Permissions review 3, finding 4: one answer whether there is no deal or someone else's.
    const d0 = await this.deal(b);
    if (d0 === null || d0.buyer !== who.account)
      bad(409, "There is no live deal for you to fund.", "no_deal");
    const d = d0 as NonNullable<typeof d0>;
    if (d.escrow !== "0") bad(409, "The escrow is already funded.", "funded");
    const price = BigInt(d.price);
    const give = ceilDiv(price * BigInt(offer.rate_num), BigInt(offer.rate_den));
    const deadlineMs = this.now() + (this.opts.quoteTtlMs ?? 120_000);
    const [salt] = (await this.reads(b.network, [[b.verifier, "current_salt", {}]])) as [string];
    const nonce = versionedNonce(salt, deadlineMs);
    const id = randomUUID();
    const at = new Date(this.now()).toISOString();
    this.db
      .prepare(
        "INSERT INTO intent_fundings (id, business_id, person_id, account, deal_seq, version, verifier, give_token, give_amount, get_token, get_amount, deadline_ms, nonce, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?)",
      )
      .run(
        id,
        businessId,
        who.person_id,
        who.account,
        d.seq,
        d.version,
        b.verifier,
        offer.token,
        String(give),
        b.asset,
        d.price,
        deadlineMs,
        nonce.toString("base64"),
        at,
        at,
      );
    return this.status(who.person_id, id);
  }

  /** What the buyer's wallet signs for this funding (NEP-413). */
  private buyerMessage(r: Row) {
    return intentMessage({
      signer: r.account,
      deadlineMs: r.deadline_ms,
      give: { token: r.give_token, amount: r.give_amount },
      get: { token: r.get_token, amount: r.get_amount },
    });
  }

  /** The solver's opposite side, signed with the solver's own key and its own nonce. */
  private async solverSide(r: Row, b: IntentsBinding, solver: SolverPort) {
    const [salt] = (await this.reads(b.network, [[b.verifier, "current_salt", {}]])) as [string];
    const message = intentMessage({
      signer: solver.account,
      deadlineMs: r.deadline_ms,
      give: { token: r.get_token, amount: r.get_amount },
      get: { token: r.give_token, amount: r.give_amount },
    });
    const nonce = versionedNonce(salt, r.deadline_ms);
    const signature = solver.sign(nep413Digest({ message, nonce, recipient: r.verifier }));
    return signedPayload({
      message,
      nonce,
      recipient: r.verifier,
      publicKey: solver.publicKey,
      signature,
    });
  }

  /**
   * The buyer's signed side arrived: checked here (signature, key registered with the verifier,
   * deadline, deposit, a dry run), then both sides go to the verifier in one call.
   */
  async sign(
    personId: string,
    id: string,
    input: { public_key: string; signature: string; callback_url?: string | null },
  ) {
    const r = this.row(personId, id);
    const b =
      this.binding(r.business_id) ?? bad(404, "Intents funding isn't set up here.", "no_intents");
    const solver = this.opts.solver ?? bad(503, "No solver is connected here.", "no_solver");
    if (r.state !== "quoted") return this.status(personId, id);
    if (this.now() >= r.deadline_ms) bad(409, "The quote expired.", "expired");
    // Permissions reviews 2 and 3: the solver fills a deal once. The rule is decided against the
    // verifier's own record (every other quote of this deal is asked whether its nonce was spent,
    // whatever this server remembers about it), and this quote claims the deal in one synchronous
    // write before any further await, so two signs at the same instant can't both pass.
    const refuseFilled = () => {
      this.set(id, { state: "refused", error: "another quote for this deal was filled" });
      return bad(
        409,
        "This sale's price was already swapped under another quote; nothing moved.",
        "already_filled",
      );
    };
    const others = this.db
      .prepare(
        "SELECT id, account, nonce, state, deadline_ms FROM intent_fundings WHERE business_id = ? AND deal_seq = ? AND id != ? AND state IN ('swapped','swapping','unknown')",
      )
      .all(r.business_id, r.deal_seq, id) as Pick<
      Row,
      "id" | "account" | "nonce" | "state" | "deadline_ms"
    >[];
    for (const o of others) {
      if (o.state === "swapped") refuseFilled();
      const [used] = (await this.reads(b.network, [
        [r.verifier, "is_nonce_used", { account_id: o.account, nonce: o.nonce }],
      ]).catch(() => [null])) as [boolean | null];
      if (used === true) {
        this.set(o.id, { state: "swapped" });
        refuseFilled();
      }
      // Still in flight (or unreadable) and not past its deadline: it may yet land.
      if (used === null || o.deadline_ms > this.now()) refuseFilled();
    }
    const claim = this.db
      .prepare(
        "UPDATE intent_fundings SET state = 'swapping', updated_at = ? WHERE id = ? AND state = 'quoted' AND NOT EXISTS (SELECT 1 FROM intent_fundings o WHERE o.business_id = ? AND o.deal_seq = ? AND o.id != ? AND (o.state = 'swapped' OR (o.state IN ('swapping','unknown') AND o.deadline_ms > ?)))",
      )
      .run(new Date(this.now()).toISOString(), id, r.business_id, r.deal_seq, id, this.now());
    if (claim.changes !== 1) {
      const again = this.row(personId, id);
      if (again.state !== "quoted") return this.status(personId, id);
      refuseFilled();
    }
    // The claim is held from here. A precondition the buyer can fix returns the quote to them;
    // one that can't be fixed refuses it; the verifier's answer decides the rest.
    const back = () => this.set(id, { state: "quoted" });
    const refuse = (error: string, text: string, code: string) => {
      this.set(id, { state: "refused", error });
      return bad(409, text, code);
    };
    // The quote's conditions, read again from the business contract at the moment of the fill: the
    // same deal at the same version and price, this buyer, escrow still empty.
    const d0 = await this.deal(b).catch((e: unknown) => {
      back();
      throw e;
    });
    if (d0 === null || d0.seq !== r.deal_seq)
      refuse(
        "no live deal for this quote",
        "There is no live deal for this quote; nothing moved.",
        "no_deal",
      );
    const d = d0 as NonNullable<typeof d0>;
    if (d.buyer !== r.account)
      refuse(
        "the deal names another buyer",
        "The deal names another buyer; nothing moved.",
        "not_buyer",
      );
    if (d.escrow !== "0")
      refuse(
        "the escrow is already funded",
        "The escrow is already funded; nothing moved.",
        "funded",
      );
    if (d.version !== r.version || d.price !== r.get_amount)
      refuse(
        "the deal was revised after the quote",
        "The deal was revised since this quote; take a new quote.",
        "revised",
      );
    const message = this.buyerMessage(r);
    const nonce = Buffer.from(r.nonce, "base64");
    // A wallet may sign with or without the callback URL it was given: whichever it signed.
    const callbacks = [input.callback_url ?? null, null].filter((v, i, a) => a.indexOf(v) === i);
    const callbackUrl = callbacks.find((cb) =>
      verifyNep413({
        message,
        nonce,
        recipient: r.verifier,
        callbackUrl: cb,
        publicKey: input.public_key,
        signature: input.signature,
      }),
    );
    if (callbackUrl === undefined) {
      back();
      bad(400, "The signature isn't over this quote.", "bad_signature");
    }
    const [hasKey, inside] = (await this.reads(b.network, [
      [r.verifier, "has_public_key", { account_id: r.account, public_key: input.public_key }],
      [r.verifier, "mt_balance_of", { account_id: r.account, token_id: `nep141:${r.give_token}` }],
    ]).catch((e: unknown) => {
      back();
      throw e;
    })) as [boolean, string];
    if (!hasKey) {
      back();
      bad(409, "Register your signing key with the verifier first.", "key_not_registered");
    }
    if (BigInt(inside) < BigInt(r.give_amount)) {
      back();
      bad(409, "The deposit is short of the quote.", "underpaid");
    }
    const buyer = signedPayload({
      message,
      nonce,
      recipient: r.verifier,
      callbackUrl,
      publicKey: input.public_key,
      signature: Buffer.from(input.signature, "base64"),
    });
    const signed = [
      buyer,
      await this.solverSide(r, b, solver).catch((e: unknown) => {
        back();
        throw e;
      }),
    ];
    const [sim] = (await this.reads(b.network, [
      [r.verifier, "simulate_intents", { signed }],
    ]).catch((e: unknown) => {
      this.set(id, {
        state: "refused",
        error: e instanceof Error ? e.message.slice(0, 300) : "refused",
      });
      return bad(409, "The verifier refused the swap; nothing moved.", "refused");
    })) as [{ invariant_violated?: unknown }];
    if (sim?.invariant_violated) {
      this.set(id, { state: "refused", error: "invariant violated" });
      bad(409, "The two sides don't match; nothing moved.", "refused");
    }
    try {
      const out = await solver.execute(r.verifier, signed);
      // Permissions review 2, finding 6: the solver's own answer is not the record. The swap is
      // "swapped" only once the verifier shows the buyer's nonce spent; until then it is unknown,
      // and status() keeps asking the verifier.
      const [used] = (await this.reads(b.network, [
        [r.verifier, "is_nonce_used", { account_id: r.account, nonce: r.nonce }],
      ]).catch(() => [false])) as [boolean];
      this.set(id, { state: used ? "swapped" : "unknown", exec_hash: out.hash });
    } catch (e) {
      if (e instanceof IntentsRefused) {
        this.set(id, { state: "refused", error: e.message.slice(0, 300) });
      } else {
        // The response was lost: the verifier's nonce record decides (status() reads it).
        this.set(id, {
          state: "unknown",
          error: e instanceof Error ? e.message.slice(0, 300) : null,
        });
      }
    }
    return this.status(personId, id);
  }

  /** The newest funding of this person's for the business's live deal, if any. */
  latest(personId: string, businessId: string) {
    const r = this.db
      .prepare(
        "SELECT id FROM intent_fundings WHERE person_id = ? AND business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(personId, businessId) as { id: string } | undefined;
    return r ? this.status(personId, r.id) : null;
  }

  /** The funding's stage, read live from the verifier, the tokens and the business contract. */
  async status(personId: string, id: string) {
    const r = this.row(personId, id);
    const b =
      this.binding(r.business_id) ?? bad(404, "Intents funding isn't set up here.", "no_intents");
    const [used, insideGive, insideGet, own, control] = (await this.reads(b.network, [
      [r.verifier, "is_nonce_used", { account_id: r.account, nonce: r.nonce }],
      [r.verifier, "mt_balance_of", { account_id: r.account, token_id: `nep141:${r.give_token}` }],
      [r.verifier, "mt_balance_of", { account_id: r.account, token_id: `nep141:${r.get_token}` }],
      [r.get_token, "ft_balance_of", { account_id: r.account }],
      [b.account, "get_control", {}],
    ])) as [boolean, string, string, string, { live_deal: Record<string, unknown> | null }];
    let state = r.state;
    if (used && state !== "swapped") {
      // The swap happened even though its response didn't arrive here.
      state = "swapped";
      this.set(id, { state });
    }
    const covered = BigInt(insideGive) >= BigInt(r.give_amount);
    if (covered && !r.deposit_seen && state !== "swapped") this.set(id, { deposit_seen: 1 });
    const depositSeen = Boolean(r.deposit_seen) || covered;
    const deal = control.live_deal;
    const funded = Boolean(
      deal && String(deal.seq) === r.deal_seq && String(deal.escrow) === r.get_amount,
    );
    const expired = this.now() >= r.deadline_ms;
    let stage: IntentsStage;
    if (state === "swapped") {
      // The swap credited the buyer's tUSD inside the verifier; once less than the swapped amount
      // is left inside, the buyer withdrew it (their total balance elsewhere proves nothing).
      if (funded) stage = "funded";
      else if (BigInt(insideGet) === 0n) stage = "delivered";
      else stage = "swapped";
    } else if ((state === "unknown" || state === "swapping") && !expired) {
      stage = "unknown";
    } else if (state === "quoted" && !expired) {
      stage = covered ? "deposited" : "quoted";
    } else if (depositSeen && BigInt(insideGive) === 0n) {
      // Not swapped, and the buyer's deposit went back to them.
      stage = "refunded";
    } else {
      stage = state === "refused" ? "refused" : "expired";
    }
    const offer = b.offers.find((o) => o.token === r.give_token);
    return {
      id: r.id,
      stage,
      deal_seq: r.deal_seq,
      version: r.version,
      verifier: r.verifier,
      solver: this.opts.solver
        ? { account: this.opts.solver.account, source: this.opts.solver.source }
        : null,
      give: {
        token: r.give_token,
        symbol: offer?.symbol ?? null,
        decimals: offer?.decimals ?? null,
        amount: r.give_amount,
        inside: insideGive,
      },
      get: { token: r.get_token, amount: r.get_amount, inside: insideGet, own },
      deadline_ms: r.deadline_ms,
      exec_hash: r.exec_hash,
      error: stage === "refused" ? r.error : null,
      /** What the buyer's wallet signs (NEP-413), while the quote is open. */
      sign:
        state === "quoted" && !expired
          ? { message: this.buyerMessage(r), nonce: r.nonce, recipient: r.verifier }
          : null,
    };
  }

  /** The configured offers and the solver's label, for the buyer's panel. */
  offers(businessId: string) {
    const b = this.binding(businessId);
    if (!b) return null;
    return {
      verifier: b.verifier,
      asset: b.asset,
      offers: b.offers,
      solver: this.opts.solver
        ? { account: this.opts.solver.account, source: this.opts.solver.source }
        : null,
    };
  }
}
