// Job 003web: upgrading the earlier customer_purchases table (e6375d2: no ask count, an 'abandoned'
// state the old code allowed after the wallet was asked). Fictional rows; in-memory database.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migratePurchases } from "../src/customerPurchase.ts";

const OLD = `
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
    WHERE state IN ('prepared', 'requested', 'unknown');`;
const row = (id: string, state: string, seq: number) =>
  `INSERT INTO customer_purchases (id, person_id, customer_account, offer_id, business_id, network, contract, asset, plan_id, reg_id, purchase_seq, units, amount, call, terms_digest, idempotency_key, state, created_at, updated_at)
   VALUES ('${id}', 'p', 'c.testnet', 'o', 'b', 'testnet', 'b.testnet', 't.testnet', 1, '1', ${seq}, 1, '1', '{}', 'd', 'k-${id}', '${state}', 'x', 'x');`;

describe("003web upgrading the earlier purchase table", () => {
  it("keeps every row; old asks are uncounted; an old set-aside stays checkable", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        OLD +
          row("a", "abandoned", 1) +
          row("b", "abandoned", 1) +
          row("c", "unknown", 1) +
          row("d", "confirmed", 0),
      );
      migratePurchases(db as never);
      const rows = db.prepare("SELECT id, state, asks FROM customer_purchases ORDER BY id").all();
      expect(rows).toEqual([
        { id: "a", state: "legacy_abandoned", asks: 2 },
        { id: "b", state: "legacy_abandoned", asks: 2 },
        { id: "c", state: "unknown", asks: 2 },
        { id: "d", state: "confirmed", asks: 0 },
      ]);
      // The index's one-open rule still holds for the open row (the old set-asides are kept out of
      // the index; the service refuses a fresh payment while one may still execute).
      expect(() => db.exec(row("e", "prepared", 2))).toThrow(/UNIQUE/);
      // Reopening runs nothing again.
      migratePurchases(db as never);
      expect(db.prepare("SELECT COUNT(*) AS n FROM customer_purchases").get()).toEqual({ n: 4 });
    } finally {
      db.close();
    }
  });

  it("the table with asks gains the registration_replaced state; not_accepted rows and counts stay as they are", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const withAsks = OLD.replace(
        "'abandoned'))",
        "'not_accepted','set_aside','legacy_abandoned'))",
      ).replace("tx_hash TEXT,", "tx_hash TEXT, asks INTEGER NOT NULL DEFAULT 0,");
      db.exec(withAsks + row("a", "not_accepted", 1) + row("b", "unknown", 2));
      db.exec(
        "UPDATE customer_purchases SET asks = 1, evidence = '{\"kind\":\"not_accepted\"}' WHERE id = 'a'",
      );
      migratePurchases(db as never);
      expect(
        db.prepare("SELECT id, state, asks, evidence FROM customer_purchases ORDER BY id").all(),
      ).toEqual([
        { id: "a", state: "not_accepted", asks: 1, evidence: '{"kind":"not_accepted"}' },
        { id: "b", state: "unknown", asks: 0, evidence: null },
      ]);
      db.exec("UPDATE customer_purchases SET state = 'registration_replaced' WHERE id = 'b'");
      // The one-open index is rebuilt (a registration_replaced row is outside it).
      db.exec(row("c", "prepared", 3));
      expect(() => db.exec(row("d", "prepared", 4))).toThrow(/UNIQUE/);
      migratePurchases(db as never);
      expect(db.prepare("SELECT COUNT(*) AS n FROM customer_purchases").get()).toEqual({ n: 3 });
    } finally {
      db.close();
    }
  });
});
