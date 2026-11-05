// Reopen the actual earlier purchase schema from e6375d2; no persisted user database is read.
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { CustomerPurchases } from "../src/customerPurchase.ts";
import { customerWorld, FRESH } from "./customer-world.ts";

it("preserves and can recover a purchase created before wallet-ask tracking was added", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE customer_purchases (
        id TEXT PRIMARY KEY, person_id TEXT NOT NULL, customer_account TEXT NOT NULL,
        offer_id TEXT NOT NULL, business_id TEXT NOT NULL, network TEXT NOT NULL,
        contract TEXT NOT NULL, asset TEXT NOT NULL, plan_id INTEGER NOT NULL, reg_id TEXT NOT NULL,
        purchase_seq INTEGER NOT NULL, units INTEGER NOT NULL, amount TEXT NOT NULL, install TEXT,
        call TEXT NOT NULL, terms_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('prepared','requested','unknown','confirmed','returned','abandoned')),
        tx_hash TEXT, evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (person_id, idempotency_key)
      ) STRICT;
      CREATE UNIQUE INDEX customer_purchases_one_open
        ON customer_purchases (customer_account, contract, plan_id)
        WHERE state IN ('prepared', 'requested', 'unknown');
      INSERT INTO customer_purchases (
        id, person_id, customer_account, offer_id, business_id, network, contract, asset,
        plan_id, reg_id, purchase_seq, units, amount, call, terms_digest, idempotency_key,
        state, created_at, updated_at
      ) VALUES (
        'legacy-purchase', 'fictional-person', 'customer.testnet', 'offer', 'business',
        'testnet', 'business.testnet', 'token.testnet', 1, '1', 1, 100, '5000000',
        '{}', 'original-terms', 'original-idempotency', 'unknown',
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'
      );
    `);
    const service = new CustomerPurchases(db, null);
    const viewer = {
      id: "fictional-person",
      display_name: "Fictional Customer",
      headline: "",
      bio: "",
    };
    const answer = await service.requested(viewer, "legacy-purchase", { tx_hash: "1".repeat(44) });
    expect(answer.purchase).toMatchObject({
      id: "legacy-purchase",
      state: "unknown",
      amount: "5000000",
      terms_digest: "original-terms",
      idempotency_key: "original-idempotency",
    });
    expect(service.list(viewer).purchases).toHaveLength(1);
  } finally {
    db.close();
  }
});

it("does not offer a fresh payment while a migrated abandoned payment may still execute", async () => {
  const w = await customerWorld();
  try {
    const offer = await w.offer();
    const root = `/api/customer/offers/${offer}`;
    const setup = await w.dana(`${root}/purchase-setup`);
    w.chain.walletCall(FRESH, setup.body.shell.call);
    const quote = await w.dana(`${root}/purchase-setup?units=10`);
    const original = await w.dana(`${root}/purchases`, "POST", {
      idempotency_key: "old-abandoned-payment",
      units: 10,
      terms_digest: quote.body.preview.terms_digest,
    });
    expect(original.status).toBe(201);
    // The migration's documented result for an old abandoned row. This is fixture setup,
    // not an assertion that a new application may abandon a wallet-requested payment.
    w.rw.store.db
      .prepare("UPDATE customer_purchases SET state = 'legacy_abandoned', asks = 2 WHERE id = ?")
      .run(original.body.purchase.id);
    const renewed = await w.dana(`${root}/purchase-setup?units=10`);
    const replacement = await w.dana(`${root}/purchases`, "POST", {
      idempotency_key: "new-replacement-payment",
      units: 10,
      terms_digest: renewed.body.preview.terms_digest,
    });
    expect(replacement.status).toBe(409);
  } finally {
    w.rw.store.db.close();
  }
});
