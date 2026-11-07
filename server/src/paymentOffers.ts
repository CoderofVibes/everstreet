// HTTP 402 for customers who pay per use, people and agents alike. An agent with its own NEAR
// account signs in as its own customer (NEP-413, as a wallet does) and asks to use a product; with
// no units it gets 402 Payment Required and the exact purchase: the steps still needed, the
// `buy` call and its terms digest. It sends that call from its own account and has the existing
// purchase check read the transaction. Neither the offer nor any signature grants a unit: units
// exist only when the business contract's own receipt logged `units_bought` for that account.
//
// Each 402 is recorded with its terms digest, so the owner can see which offers led to purchases
// the contract confirmed (joined to customer_purchases by digest).

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import type { Person, Store } from "./store.ts";
import { tokenMetaOf } from "./tokenMeta.ts";

export function migratePaymentOffers(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_offers (
      id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, business_id TEXT NOT NULL,
      person_id TEXT NOT NULL REFERENCES people(id), account TEXT NOT NULL,
      reason TEXT NOT NULL, units INTEGER, amount TEXT, terms_digest TEXT,
      steps TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS payment_offers_business ON payment_offers (business_id, created_at);
  `);
}

/** The purchase picture `CustomerPurchases.setup` returns, as far as a 402 needs it. */
export interface PurchaseSetup {
  network: string;
  contract: string;
  asset: string;
  plan_id: number;
  customer: string;
  steps: string[];
  plan: { unit_price?: string; max_units_per_purchase?: number };
  token: { symbol?: string; decimals?: number; balance: string | null };
  shell: { needed: boolean; call: unknown };
  token_storage: { needed: boolean; call: unknown };
  preview:
    | null
    | { code: string; problem: string }
    | { units: number; amount: string; call: unknown; terms_digest: string };
}

export class PaymentOffers {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {
    migratePaymentOffers(db);
  }

  /** Records one 402 and returns its body. */
  issue(
    viewer: Person,
    o: { offerId: string; businessId: string },
    reason: string,
    setup: PurchaseSetup,
    message = "Payment required",
  ) {
    const p = setup.preview && "terms_digest" in setup.preview ? setup.preview : null;
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO payment_offers (id, offer_id, business_id, person_id, account, reason, units, amount, terms_digest, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        o.offerId,
        o.businessId,
        viewer.id,
        setup.customer,
        reason,
        p?.units ?? null,
        p?.amount ?? null,
        p?.terms_digest ?? null,
        JSON.stringify(setup.steps),
        new Date(this.now()).toISOString(),
      );
    return {
      error: message,
      code: "payment_required",
      reason,
      payment_offer: id,
      offer: {
        network: setup.network,
        contract: setup.contract,
        token: setup.asset,
        symbol: setup.token.symbol ?? null,
        decimals: setup.token.decimals ?? null,
        plan_id: setup.plan_id,
        unit_price: setup.plan.unit_price ?? null,
        payer: setup.customer,
      },
      /** What is still needed before the purchase, each with its exact call. */
      before: [
        ...(setup.shell.needed ? [{ step: "registration", call: setup.shell.call }] : []),
        ...(setup.token_storage.needed
          ? [{ step: "token_storage", call: setup.token_storage.call }]
          : []),
      ],
      purchase: p
        ? { units: p.units, amount: p.amount, call: p.call, terms_digest: p.terms_digest }
        : null,
      problem: setup.preview && "problem" in setup.preview ? setup.preview : null,
      next: {
        record: `POST /api/customer/offers/${o.offerId}/purchases`,
        check: "POST /api/customer/purchases/:id/check",
        grants_units: "the business contract's units_bought receipt for this account",
      },
    };
  }

  /** The owner's view: each 402 and what the contract confirmed for it. */
  forOwner(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare(
        `SELECT o.id, o.offer_id, o.account, o.reason, o.units, o.amount, o.terms_digest, o.created_at,
                p.id AS purchase_id, p.state AS purchase_state, p.units AS purchase_units, p.tx_hash,
                c.network, c.asset
           FROM payment_offers o
           JOIN customer_offers c ON c.id = o.offer_id
           LEFT JOIN customer_purchases p ON p.terms_digest = o.terms_digest AND p.customer_account = o.account
          WHERE o.business_id = ?
          ORDER BY o.created_at DESC, o.rowid DESC LIMIT 50`,
      )
      .all(businessId) as {
      id: string;
      offer_id: string;
      account: string;
      reason: string;
      units: number | null;
      amount: string | null;
      terms_digest: string | null;
      created_at: string;
      purchase_id: string | null;
      purchase_state: string | null;
      purchase_units: number | null;
      tx_hash: string | null;
      network: string;
      asset: string;
    }[];
    // Repeated 402s for unchanged terms share a digest, so one purchase can match several: it is
    // shown on the newest of them and counted once.
    const seen = new Set<string>();
    const offers = rows.map((r) => {
      const first = r.purchase_id !== null && !seen.has(r.purchase_id);
      if (r.purchase_id) seen.add(r.purchase_id);
      return {
        id: r.id,
        offer_id: r.offer_id,
        account: r.account,
        reason: r.reason,
        units: r.units,
        amount: r.amount,
        at: r.created_at,
        token: (() => {
          const m = tokenMetaOf(this.db, r.network, r.asset);
          return m ? { symbol: m.symbol, decimals: m.decimals } : null;
        })(),
        purchase: first
          ? {
              state: r.purchase_state,
              units_granted: r.purchase_state === "confirmed" ? (r.purchase_units ?? 0) : 0,
              tx_hash: r.tx_hash,
            }
          : null,
        repeat: r.purchase_id !== null && !first,
      };
    });
    const linked = offers.filter((o) => o.purchase);
    return {
      offers,
      totals: {
        offers: offers.length,
        units_granted: linked.reduce((n, o) => n + (o.purchase?.units_granted ?? 0), 0),
        pending: linked.filter((o) =>
          ["prepared", "requested", "unknown"].includes(String(o.purchase?.state)),
        ).length,
        // A 402 that only asked for the registration first offered no purchase yet.
        unpaid: offers.filter((o) => !o.purchase && !o.repeat && o.units !== null).length,
      },
    };
  }
}
