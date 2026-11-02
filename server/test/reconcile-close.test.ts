// Job 003b: a sale reconciles once, including a lost response. Everstreet follows a close the
// contract finalized only when it matches this deal's recorded terms and the next generation,
// never overwrites a newer local owner, commits every record together, and converges to one
// ownership entry and one business-sold event across retries, tabs and restarts. The chain is
// the in-memory FakeChain; this is unit evidence, not testnet evidence.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb, ownershipConflicts } from "../src/db.ts";
import { Deals } from "../src/deals.ts";
import { count, fundedDeal, gate } from "./deal-world.ts";

type S = Awaited<ReturnType<typeof fundedDeal>>;

const owners = (s: S) =>
  count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id);
const sold = (s: S) =>
  count(s, "SELECT COUNT(*) AS n FROM events WHERE type = 'business.sold' AND subject = ?", s.id);
const localOwner = (s: S) =>
  (
    s.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(s.id) as {
      owner_id: string;
    }
  ).owner_id;
const status = (s: S) =>
  (s.store.db.prepare("SELECT status FROM deals WHERE id = ?").get(s.deal.id) as { status: string })
    .status;
const steps = (s: S, kind: string) =>
  count(s, "SELECT COUNT(*) AS n FROM deal_steps WHERE deal_id = ? AND kind = ?", s.deal.id, kind);
const accept = (s: S) =>
  s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });

/** A fresh Deals over the same database and chain, as a restarted process would build it.
 * Payments and Acquisitions are not used by reconciliation, which only reads the chain. */
const restarted = (s: S) => new Deals(s.store.db, s.store, {} as never, {} as never, s.chain);

/** Closes the sale on the (fake) chain while the app hears nothing. */
async function closeUnobserved(s: S) {
  s.chain.loseNextAcceptResponse = true;
  s.chain.failReads = 100;
  const r = await accept(s);
  s.chain.failReads = 0;
  return r;
}

describe("a lost acceptance response", () => {
  it("lost before it reached the chain: says so, and accepting again closes it once", async () => {
    const s = await fundedDeal();
    s.chain.dropNextAccept = true;
    const lost = await accept(s);
    expect(lost.status).toBe(409);
    expect(lost.body.error).toMatch(/wasn't recorded, so nothing changed. You can accept again/);
    expect(status(s)).toBe("open");
    const again = await accept(s);
    expect(again.body.deal.status).toBe("closed");
    expect([owners(s), sold(s)]).toEqual([1, 1]);
  });

  it("lost after the close with the contract unreadable: pending, never 'failed', no new funding", async () => {
    const s = await fundedDeal();
    const r = await closeUnobserved(s);
    expect(r.status).toBe(200);
    expect(r.body.confirmation).toMatchObject({ state: "unknown" });
    expect(r.body.confirmation.detail).toMatch(/Don't fund again/);
    expect(status(s)).toBe("open");
    expect([owners(s), sold(s)]).toEqual([0, 0]);
    expect(steps(s, "accept_unconfirmed")).toBe(1);
    // Once the contract can be read, a view reconciles it; nothing was re-sent or re-funded.
    const calls = s.chain.acceptCalls;
    const viewed = await s.ana(`/api/deals/${s.deal.id}`);
    expect(viewed.body.deal.status).toBe("closed");
    expect(s.chain.acceptCalls).toBe(calls);
    expect(steps(s, "funded")).toBe(1);
    expect([owners(s), sold(s)]).toEqual([1, 1]);
  });

  it("reports the final state when the contract becomes readable during the same request", async () => {
    // Astra's 003b early-review timing: the close lands, the response is lost, the catch-path
    // reconcile read and the explicit readback both fail, then the final view reads the close.
    const s = await fundedDeal();
    s.chain.loseNextAcceptResponse = true;
    s.chain.failDealReads = 2;
    const r = await accept(s);
    expect(r.status).toBe(200);
    expect(r.body.deal.status).toBe("closed");
    expect(r.body.confirmation).toBeNull();
    expect(r.body.reconciliation).toBeNull();
    expect([owners(s), sold(s)]).toEqual([1, 1]);
  });

  it("an unknown result survives a reload while the contract stays unreadable", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    s.chain.failReads = 100;
    const reload = (await s.mara(`/api/deals/${s.deal.id}`)).body;
    expect(reload.confirmation).toMatchObject({ state: "unknown" });
    // No chain state to act on, so the page offers no funding or accepting.
    expect(reload.chain).toBeNull();
    // Only the person who sent it is told it's unconfirmed.
    expect((await s.ana(`/api/deals/${s.deal.id}`)).body.confirmation).toBeNull();
    s.chain.failReads = 0;
    const later = (await s.mara(`/api/deals/${s.deal.id}`)).body;
    expect(later.deal.status).toBe("closed");
    expect(later.confirmation).toBeNull();
  });

  it("a retry checks the contract first and never sends an acceptance it already has", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    const calls = s.chain.acceptCalls;
    const retry = await accept(s);
    expect(retry.status).toBe(200);
    expect(retry.body.deal.status).toBe("closed");
    expect(s.chain.acceptCalls).toBe(calls);
    expect([owners(s), sold(s)]).toEqual([1, 1]);
  });
});

describe("converging to one transition", () => {
  it("an acceptance and a view that both see the close apply it once", async () => {
    const s = await fundedDeal();
    const g = gate();
    s.chain.controlGate = g.opened;
    const before = s.chain.controlReads;
    const waitFor = async (n: number) => {
      for (let i = 0; i < 50 && s.chain.controlReads < before + n; i++)
        await new Promise((r) => setTimeout(r, 1));
      expect(s.chain.controlReads).toBe(before + n);
    };
    // The seller's acceptance closes the sale and is held at its control read...
    const accepting = accept(s);
    await waitFor(1);
    // ...while the buyer's page reads the close and reaches the same point.
    const viewing = s.ana(`/api/deals/${s.deal.id}`);
    await waitFor(2);
    g.open();
    s.chain.controlGate = null;
    const [a, v] = await Promise.all([accepting, viewing]);
    expect([a.status, a.body.deal.status, v.body.deal.status]).toEqual([200, "closed", "closed"]);
    expect([owners(s), sold(s), steps(s, "closed"), steps(s, "reconcile_needed")]).toEqual([
      1, 1, 1, 0,
    ]);
  });

  it("repeat replays change nothing after the first", async () => {
    const s = await fundedDeal();
    await accept(s);
    for (let i = 0; i < 3; i++) await s.ana(`/api/deals/${s.deal.id}`);
    for (let i = 0; i < 2; i++) await accept(s);
    expect([owners(s), sold(s), steps(s, "closed")]).toEqual([1, 1, 1]);
  });

  it("after a restart, two processes racing over the same database apply the close once", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    // Two fresh instances over the same database and chain, as after a restart with a
    // second worker; both read the closed contract before either writes.
    const [a, b] = [restarted(s), restarted(s)];
    const g = gate();
    s.chain.controlGate = g.opened;
    const before = s.chain.controlReads;
    const both = Promise.all([a.reconcileOpen(5), b.reconcileOpen(5)]);
    for (let i = 0; i < 50 && s.chain.controlReads < before + 2; i++)
      await new Promise((r) => setTimeout(r, 1));
    expect(s.chain.controlReads).toBe(before + 2);
    g.open();
    s.chain.controlGate = null;
    const states = (await both)
      .flat()
      .map((r) => r.outcome.state)
      .sort();
    expect(states).toEqual(["already", "applied"]);
    // The original app then sees it closed and applies nothing more.
    expect((await s.ana(`/api/deals/${s.deal.id}`)).body.deal.status).toBe("closed");
    expect([owners(s), sold(s), steps(s, "closed")]).toEqual([1, 1, 1]);
  });

  it("rolls back every record when a write fails part-way, then applies once", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    const listingMode = () =>
      (
        s.store.db.prepare("SELECT mode FROM listings WHERE business_id = ?").get(s.id) as {
          mode: string;
        }
      ).mode;
    const before = { owner: localOwner(s), mode: listingMode() };
    s.store.db.exec(
      "CREATE TRIGGER fail_sale BEFORE INSERT ON events WHEN NEW.type = 'business.sold' BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    );
    const failed = await s.ana(`/api/deals/${s.deal.id}`);
    expect(failed.status).toBe(500);
    expect(status(s)).toBe("open");
    expect({ owner: localOwner(s), mode: listingMode() }).toEqual(before);
    expect([owners(s), sold(s), steps(s, "closed")]).toEqual([0, 0, 0]);
    s.store.db.exec("DROP TRIGGER fail_sale");
    expect((await s.ana(`/api/deals/${s.deal.id}`)).body.deal.status).toBe("closed");
    expect([owners(s), sold(s), steps(s, "closed")]).toEqual([1, 1, 1]);
    expect(listingMode()).toBe("closed");
  });

  it("leaves customer records as they were", async () => {
    const s = await fundedDeal();
    const customers = () =>
      [
        count(s, "SELECT COUNT(*) AS n FROM payments WHERE business_id = ?", s.id),
        count(s, "SELECT COUNT(*) AS n FROM bookings WHERE business_id = ?", s.id),
        count(s, "SELECT COUNT(*) AS n FROM inquiries WHERE business_id = ?", s.id),
      ].join(",");
    const before = customers();
    await accept(s);
    await s.ana(`/api/deals/${s.deal.id}`);
    expect(customers()).toBe(before);
  });
});

describe("refusing to apply what doesn't match", () => {
  it("a close with a different version than the recorded terms needs reconciling, once", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    const onChain = s.chain.businesses.get(s.account)?.deals.get(s.deal.id);
    if (!onChain) throw new Error("no deal");
    onChain.version = 7; // closed under terms Everstreet never recorded
    for (let i = 0; i < 2; i++) {
      const v = (await s.ana(`/api/deals/${s.deal.id}`)).body;
      expect(v.reconciliation).toMatchObject({ state: "needed" });
      expect(v.reconciliation.detail).toMatch(/doesn't match these recorded terms/);
    }
    expect(status(s)).toBe("open");
    expect(localOwner(s)).toBe(s.mara.id);
    expect(owners(s)).toBe(0);
    expect(steps(s, "reconcile_needed")).toBe(1);
  });

  it("a confirmed close with a lagging read of control waits instead of guessing", async () => {
    // Distinct from an unknown result: the contract is readable and shows the close, so the
    // sender's acceptance isn't "unconfirmed"; only Everstreet's records are behind.
    const s = await fundedDeal();
    await closeUnobserved(s);
    s.chain.staleControl = { owner: "mara.fake", generation: 1, operators: [] };
    const v = (await s.mara(`/api/deals/${s.deal.id}`)).body;
    expect(v.reconciliation).toMatchObject({ state: "pending" });
    expect(v.confirmation).toBeNull();
    expect(v.chain.status).toBe("Closed");
    expect([status(s), owners(s)]).toEqual(["open", 0]);
    s.chain.staleControl = null;
    expect((await s.mara(`/api/deals/${s.deal.id}`)).body.deal.status).toBe("closed");
  });

  it("an old deal does not regain authority when the same buyer owns the business again later", async () => {
    // The sale closed unobserved; then control moved on and came back to the same buyer
    // (generation 4). Owner equality alone would wrongly apply this old deal.
    const s = await fundedDeal();
    await closeUnobserved(s);
    const biz = s.chain.businesses.get(s.account);
    if (!biz) throw new Error("no business");
    expect(biz.generation).toBe(2);
    biz.generation = 4; // two more changes of control outside the app, back to the same buyer
    const v = (await s.ana(`/api/deals/${s.deal.id}`)).body;
    expect(v.reconciliation).toMatchObject({ state: "needed" });
    expect(v.reconciliation.detail).toMatch(/Control changed again/);
    expect([status(s), owners(s), localOwner(s)]).toEqual(["open", 0, s.mara.id]);
  });

  it("never replaces a newer local owner with an older close", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    // Everstreet already records a later change of hands (generation 3) for this business.
    s.store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, 3, ?)",
      )
      .run(s.id, s.mara.id, s.mara.id, new Date().toISOString());
    const v = (await s.ana(`/api/deals/${s.deal.id}`)).body;
    expect(v.reconciliation).toMatchObject({ state: "needed" });
    expect(v.reconciliation.detail).toMatch(/newer owner/);
    expect(status(s)).toBe("open");
    expect(owners(s)).toBe(1); // only the pre-existing later entry
    expect(sold(s)).toBe(0);
  });
});

describe("the bounded read-only reconciler", () => {
  it("settles unconfirmed closes on its own, once, without sending anything", async () => {
    const s = await fundedDeal();
    await closeUnobserved(s);
    const deals = restarted(s);
    const calls = s.chain.acceptCalls;
    const first = await deals.reconcileOpen(5);
    expect(first).toEqual([{ deal: s.deal.id, outcome: { state: "applied", detail: "" } }]);
    expect(await deals.reconcileOpen(5)).toEqual([]);
    expect(s.chain.acceptCalls).toBe(calls);
    expect([owners(s), sold(s)]).toEqual([1, 1]);
  });

  it("a deal that stays unresolved doesn't starve the next one", async () => {
    // Two sales in one database, both closed on the contract without Everstreet hearing.
    const s = await fundedDeal();
    const t = await fundedDeal(s);
    for (const x of [s, t]) await closeUnobserved(x);
    // The first in line can never be applied (its close doesn't match the recorded terms).
    const [stuck, next] = [s, t].sort((a, b) => (a.deal.id < b.deal.id ? -1 : 1)) as [S, S];
    const onChain = s.chain.businesses.get(stuck.account)?.deals.get(stuck.deal.id);
    if (!onChain) throw new Error("no deal");
    onChain.version = 7;
    const deals = restarted(s);
    const passes = [];
    for (let i = 0; i < 3; i++) passes.push(await deals.reconcileOpen(1));
    expect(passes.map((p) => p.map((r) => [r.deal, r.outcome.state]))).toEqual([
      [[stuck.deal.id, "needed"]],
      [[next.deal.id, "applied"]],
      [[stuck.deal.id, "needed"]],
    ]);
    expect(status(next)).toBe("closed");
    expect(status(stuck)).toBe("open");
  });
});

describe("ownership history storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "everstreet-ownership-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("adds a once-per-deal index only when existing data allows, and reports conflicts", () => {
    const clean = openDb(join(dir, "clean.db"));
    expect(
      clean.prepare("SELECT name FROM sqlite_master WHERE name = 'ownership_once_per_deal'").get(),
    ).toBeTruthy();
    clean.close();

    const path = join(dir, "duplicates.db");
    const db = openDb(path);
    db.exec(`PRAGMA foreign_keys = OFF;
      DROP INDEX ownership_once_per_deal;
      INSERT INTO ownership (business_id, from_id, to_id, deal_id, generation, at) VALUES ('b', 'p', 'q', 'd1', 2, 't');
      INSERT INTO ownership (business_id, from_id, to_id, deal_id, generation, at) VALUES ('b', 'p', 'q', 'd1', 2, 't');`);
    db.close();
    const reopened = openDb(path);
    // Nothing deleted, no index forced in, and the conflict is visible.
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM ownership").get()).toEqual({ n: 2 });
    expect(
      reopened
        .prepare("SELECT name FROM sqlite_master WHERE name = 'ownership_once_per_deal'")
        .get(),
    ).toBeUndefined();
    expect(ownershipConflicts(reopened)).toEqual([{ deal_id: "d1", entries: 2 }]);
    reopened.close();
  });
});
