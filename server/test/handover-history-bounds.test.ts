// Job 003wf3 (Astra 04:06): the history recovery's local work is bounded. Selection-level test:
// finished handovers with an unknown close attempt are seeded as rows (a backlog larger than one
// page) to exercise HandoverCoordinator.pickHistory directly; no chain outcome is simulated or
// claimed here (the real lost-answer and resale paths are in handover-orders.test.ts).

import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { type CloserKey, HandoverCoordinator } from "../src/handoverCoordinator.ts";

const BLOCK = 2_000_000_000_000n; // the read block's time (ms)
const AGED = Number(BLOCK) - 30 * 60_000; // orders issued 30 minutes before it: past 20
const YOUNG = Number(BLOCK) - 60_000;

function world(n: number, young: number[] = [], cap = 6) {
  const db = openDb(":memory:");
  db.exec(
    "INSERT INTO people (id, display_name, created_at) VALUES ('seller', 'Seller', '2026-11-05')",
  );
  db.exec(
    "INSERT INTO businesses (id, slug, owner_id, name, family, stage, created_at, updated_at) VALUES ('b', 'b', 'seller', 'B', 'software', 'grow', '2026-11-05', '2026-11-05')",
  );
  const ids: string[] = [];
  for (let k = 1; k <= n; k++) {
    const id = `h-${String(k).padStart(3, "0")}`;
    ids.push(id);
    db.prepare(
      `INSERT INTO business_handovers (id, business_id, network, account, deal_seq, version, digest, expected_generation,
         closing_control_seq, closing_started_ms, deadline_ms, manifest, manifest_seq, price, available_floor, grants,
         seller_account, buyer_account, armed_block, armed_source, evidence_height, state, created_ms, updated_ms)
       VALUES (?, 'b', 'testnet', 'biz.testnet', ?, 1, 'd', 1, '1', '0', '0', 'm', '0', '1', '0', '[]',
         's.near', 'b.near', '{}', 'test', '1', 'released_to_buyer', ?, ?)`,
    ).run(id, String(k), k, k);
    const issued = young.includes(k) ? YOUNG : AGED;
    db.prepare(
      "INSERT INTO close_orders (handover_id, n, order_json, order_digest, read_height, read_hash, created_ms) VALUES (?, 1, ?, 'x', '1', 'h', ?)",
    ).run(id, JSON.stringify({ issued_at_ms: String(issued) }), k);
    db.prepare(
      `INSERT INTO closer_tx_attempts (operation, attempt, payload_digest, method, receiver, signer, public_key, nonce,
         block_hash, block_height, tx_hash, signed_tx, state, created_ms, updated_ms)
       VALUES (?, 1, 'p', 'close_sale', 'biz.testnet', 'closer.testnet', 'ed25519:x', ?, 'bh', '1', ?, 's', 'signed', 1, 1)`,
    ).run(`close-${id}-1|close_sale`, String(k), `tx-${id}`);
  }
  const clock = { now: 1_000_000 };
  const make = () =>
    new HandoverCoordinator(
      db,
      {} as never,
      {} as never,
      null,
      {} as never,
      new Map([["b", {} as CloserKey]]),
      {
        holder: "history",
        intervalMs: 1_000,
        batch: 1,
        passBudgetMs: 1_000,
        opDeadlineMs: 500,
        dispatchMarginMs: 60_000,
        maxOrders: 2,
        now: () => clock.now,
        history: { page: 4, cap },
      },
    );
  return { db, ids, clock, make };
}

describe("003wf3 history recovery: bounded local work, fair over any backlog", () => {
  it("a backlog larger than a page: every handover is picked in creation order, each pass reading at most one page", () => {
    const { ids, make } = world(10);
    const c = make();
    const picked: string[] = [];
    for (let k = 0; k < 10; k++) {
      const before = c.historyScanned;
      const h = c.pickHistory("b", BLOCK);
      expect(c.historyScanned - before).toBeLessThanOrEqual(4);
      if (h) picked.push(h.id);
    }
    expect(picked).toEqual(ids);
  });

  it("all not yet due: each pass reads at most a page and picks nothing, the cursor still advancing and wrapping; once due, it starts again from the oldest", () => {
    // (A cap above the backlog: with a smaller cap an evicted backoff entry is read earlier,
    // which the cap test below covers.)
    const { ids, clock, make } = world(10, [], 32);
    const c = make();
    for (let k = 0; k < 10; k++) c.pickHistory("b", BLOCK); // every one read once
    const scans: number[] = [];
    for (let k = 0; k < 4; k++) {
      const before = c.historyScanned;
      expect(c.pickHistory("b", BLOCK)).toBeNull();
      scans.push(c.historyScanned - before);
    }
    expect(Math.max(...scans)).toBeLessThanOrEqual(4);
    clock.now += 61_000; // a minute later: all due again
    const again: string[] = [];
    for (let k = 0; k < 3; k++) {
      const h = c.pickHistory("b", BLOCK);
      if (h) again.push(h.id);
    }
    expect(again[0]).toBe(ids[0]);
  });

  it("an older handover whose order is still young is passed over (the cursor advances); a resolved one leaves the backlog; a restart starts from the oldest, still bounded", () => {
    const { db, ids, clock, make } = world(9, [2]);
    const c = make();
    const picked: string[] = [];
    for (let k = 0; k < 9; k++) {
      const h = c.pickHistory("b", BLOCK);
      if (h) picked.push(h.id);
    }
    expect(picked).not.toContain(ids[1]); // young: resolved by its own rules
    expect(picked).toEqual(ids.filter((_, k) => k !== 1));
    // The oldest's original result was found (by status, elsewhere): it leaves the backlog.
    db.prepare("UPDATE closer_tx_attempts SET state = 'success' WHERE tx_hash = ?").run(
      `tx-${ids[0]}`,
    );
    clock.now += 61_000;
    const restarted = make(); // no memory: cursor and backoff start empty
    const before = restarted.historyScanned;
    const first = restarted.pickHistory("b", BLOCK);
    expect(first?.id).toBe(ids[2]); // the oldest still unknown and aged
    expect(restarted.historyScanned - before).toBeLessThanOrEqual(4);
  });

  it("the cursor and backoff bookkeeping stay within their cap over a backlog larger than it", () => {
    const { make } = world(12);
    const c = make();
    for (let k = 0; k < 30; k++) c.pickHistory("b", BLOCK);
    const sizes = c.historyBookkeeping();
    expect(sizes.backoff).toBeLessThanOrEqual(6);
    expect(sizes.cursors).toBeLessThanOrEqual(6);
  });
});
