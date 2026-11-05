// Astra: bounded history bookkeeping must not starve older attempts when several businesses
// take turns. Selection-level rows only; no contract outcome or live transaction is claimed.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { type CloserKey, HandoverCoordinator } from "../src/handoverCoordinator.ts";

describe("historical recovery across more businesses than the cursor cache", () => {
  it("eventually visits both unresolved handovers of every business under round-robin service", () => {
    const db = openDb(":memory:");
    try {
      db.exec(
        "INSERT INTO people (id, display_name, created_at) VALUES ('seller', 'Seller', '2026-11-05')",
      );
      const businesses = ["a", "b", "c"];
      const expected: string[] = [];
      for (const business of businesses) {
        db.prepare(
          "INSERT INTO businesses (id, slug, owner_id, name, family, stage, created_at, updated_at) VALUES (?, ?, 'seller', ?, 'software', 'grow', '2026-11-05', '2026-11-05')",
        ).run(business, business, business);
        for (let n = 1; n <= 2; n++) {
          const id = `${business}-${n}`;
          expected.push(id);
          db.prepare(
            `INSERT INTO business_handovers (id, business_id, network, account, deal_seq, version, digest, expected_generation,
               closing_control_seq, closing_started_ms, deadline_ms, manifest, manifest_seq, price, available_floor, grants,
               seller_account, buyer_account, armed_block, armed_source, evidence_height, state, created_ms, updated_ms)
             VALUES (?, ?, 'testnet', 'biz.testnet', ?, 1, 'd', 1, '1', '0', '0', 'm', '0', '1', '0', '[]',
               's.near', 'b.near', '{}', 'test', '1', 'released_to_buyer', ?, ?)`,
          ).run(id, business, String(n), n, n);
          db.prepare(
            "INSERT INTO close_orders (handover_id, n, order_json, order_digest, read_height, read_hash, created_ms) VALUES (?, 1, ?, 'x', '1', 'h', ?)",
          ).run(id, JSON.stringify({ issued_at_ms: "1" }), n);
          db.prepare(
            `INSERT INTO closer_tx_attempts (operation, attempt, payload_digest, method, receiver, signer, public_key, nonce,
               block_hash, block_height, tx_hash, signed_tx, state, created_ms, updated_ms)
             VALUES (?, 1, 'p', 'close_sale', 'biz.testnet', 'closer.testnet', 'ed25519:x', ?, 'bh', '1', ?, 's', 'signed', 1, 1)`,
          ).run(`close-${id}-1|close_sale`, String(expected.length), `tx-${id}`);
        }
      }
      let now = 2_000_000_000_000;
      const coordinator = new HandoverCoordinator(
        db,
        {} as never,
        {} as never,
        null,
        {} as never,
        new Map(businesses.map((id) => [id, {} as CloserKey])),
        {
          holder: "astra-history-cap",
          intervalMs: 1_000,
          batch: 1,
          passBudgetMs: 1_000,
          opDeadlineMs: 500,
          dispatchMarginMs: 60_000,
          maxOrders: 2,
          now: () => now,
          history: { page: 2, cap: 2 },
        },
      );
      const visited = new Set<string>();
      for (let round = 0; round < 6; round++) {
        for (const business of businesses) {
          const chosen = coordinator.pickHistory(business, BigInt(now));
          if (chosen) visited.add(chosen.id);
        }
        now += 61_000; // eligibility never relies on an evicted backoff entry
      }
      expect([...visited].sort()).toEqual(expected.sort());
    } finally {
      db.close();
    }
  });
});
