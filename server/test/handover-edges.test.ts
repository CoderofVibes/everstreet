// Job 003wf3, Astra's 01:47 follow-through and D2: the composed stop with a coordinator blocked in
// a send, a lease lapsing during the system reconcile's awaited read, and a journal already full.
// The actual composition in one process (handoverWorld.ts); synthetic RPC, fictional people.

import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, type HandoverWorld, handoverWorld } from "./handoverWorld.ts";
import { appBrowser, barrier, composeIn, FOUNDER, signInAs } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async (o: Parameters<typeof handoverWorld>[0] = {}) => {
  const w = await handoverWorld(o);
  worlds.push(w);
  return w;
};
const closingNow = async (w: HandoverWorld) => {
  await w.toBuyerAccepted();
  const c = await w.act(w.seller, FOUNDER, "accept");
  expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
};
const count = (w: HandoverWorld, table: string) =>
  Number((w.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0] as Json).n);
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("003wf3 the composed stop with a coordinator step blocked in its send", () => {
  it("the stop waits under its one budget, reports the step still running (not quiescent), and the late answer writes nothing; the attempt stays for recovery by its own hash", async () => {
    const w = await world({ handover: { op_deadline_ms: 300, pass_budget_ms: 1_000 } });
    await closingNow(w);
    const held = w.b.rpc.holdNextSend();
    const pass = w.coordinator.pass();
    await held.entered;
    expect((await pass)[w.biz]).toBe("deadline");
    const before = {
      journal: count(w, "handover_journal"),
      events: count(w, "events"),
      orders: count(w, "close_orders"),
    };
    expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "signed" }]);
    const t0 = Date.now();
    await w.composed.stop();
    // Bounded by the configured stop budget (5 s here), not by the blocked send.
    expect(Date.now() - t0).toBeLessThan(6_500);
    // The drain budget ran out with the send still blocked (forced); closing the gates then cut
    // that call, so the step ended there, its writes refused.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4_500);
    expect(w.composed.lastStop()).toMatchObject({
      forced: true,
      owners_running: 0,
      handover_running: 0,
    });
    // The broadcast was already durably admitted: it may still land on the contract.
    held.open();
    await settle(300);
    expect(w.b.rpc.applied.filter((a) => a.method === "close_sale")).toHaveLength(1);
    // Nothing more was written by the stopped process: its gates and storage are closed.
    expect({
      journal: count(w, "handover_journal"),
      events: count(w, "events"),
      orders: count(w, "close_orders"),
    }).toEqual(before);
    expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "signed" }]);
    expect(w.handoverRow()?.state).toBe("ordering");
  }, 60_000);
});

describe("003wf3 the composed stop with a coordinator step blocked where the gates can't cut it", () => {
  it("the step is reported still running at the deadline (not quiescent), and writes nothing when it finally returns", async () => {
    const w = await world({ handover: { op_deadline_ms: 300, pass_budget_ms: 1_000 } });
    await closingNow(w);
    // An in-process wait (not a transport call): the coordinator's read awaits this barrier.
    const c = w.coordinator as unknown as { read: (b: unknown) => Promise<unknown> };
    const real = c.read.bind(w.coordinator);
    const gate = barrier();
    c.read = async (b: unknown) => {
      gate.arrive();
      await gate.release;
      return real(b);
    };
    const pass = w.coordinator.pass();
    await gate.entered;
    expect((await pass)[w.biz]).toBe("deadline");
    const before = { journal: count(w, "handover_journal"), orders: count(w, "close_orders") };
    await w.composed.stop();
    expect(w.composed.lastStop()).toMatchObject({
      forced: true,
      owners_running: 1,
      handover_running: 1,
    });
    gate.open();
    await settle(300);
    expect({ journal: count(w, "handover_journal"), orders: count(w, "close_orders") }).toEqual(
      before,
    );
    expect(w.rows("SELECT 1 FROM closer_tx_attempts")).toHaveLength(0);
    expect(w.b.rpc.applied.filter((a) => a.method === "close_sale")).toHaveLength(0);
  }, 60_000);
});

describe("003wf3 the system reconcile is fenced by the coordinator's lease and operation (Astra 01:47)", () => {
  it("a step whose deadline passes during reconcile's awaited read writes nothing there; the next pass reconciles exactly once", async () => {
    const w = await world({ handover: { op_deadline_ms: 400, pass_budget_ms: 2_000 } });
    await closingNow(w);
    expect((await w.coordinator.pass())[w.biz]).toBe("dispatched:applied");
    // Hold the reconcile's own fresh read (the coordinator's step read before it isn't held).
    const intents = (w.coordinator as unknown as { intents: { obs: Json } }).intents;
    const obs = intents.obs as { readFresh: (b: unknown) => Promise<unknown> };
    const real = obs.readFresh.bind(obs);
    const gate = barrier();
    let holdOnce = true;
    obs.readFresh = async (b: unknown) => {
      if (holdOnce) {
        holdOnce = false;
        gate.arrive();
        await gate.release;
      }
      return real(b);
    };
    const pass = w.coordinator.pass();
    await gate.entered;
    expect((await pass)[w.biz]).toBe("deadline");
    gate.open();
    await settle(200);
    expect(w.rows("SELECT status FROM v3_intents WHERE status = 'applied'")).toHaveLength(0);
    expect(
      w.rows("SELECT 1 FROM ownership WHERE business_id = ? AND v3_intent_id IS NOT NULL", w.biz),
    ).toHaveLength(0);
    expect(w.rows("SELECT 1 FROM events WHERE type = 'v3.reconciled_by_handover'")).toHaveLength(0);
    expect(w.handoverRow()?.state).toBe("closed_observed");
    // The next pass (the dead step has finished) reconciles through the same system entry.
    let r = await w.coordinator.pass();
    for (let i = 0; i < 10 && r[w.biz] === "busy"; i++) {
      await settle(100);
      r = await w.coordinator.pass();
    }
    expect(r[w.biz]).toMatch(/^reconcile_(applied|already)$/);
    expect(w.handoverRow()?.state).toBe("released_to_buyer");
    expect(w.rows("SELECT 1 FROM events WHERE type = 'v3.reconciled_by_handover'")).toHaveLength(1);
    expect(w.rows("SELECT owner_id FROM businesses WHERE id = ?", w.biz)[0]?.owner_id).toBe(
      "person-noah",
    );
  }, 60_000);
});

describe("003wf3 a journal already full (D2) never costs the authoritative evidence or the release", () => {
  it("with every journal slot used by required entries, the order, attempt, outcome evidence and the buyer's release are still recorded", async () => {
    const w = await world();
    await closingNow(w);
    await w.coordinator.pass(); // arms; order 1 is sent and closes
    const h = w.handoverRow() as Json;
    // Fill the rest of the default journal (256) with required-kind entries.
    const db = w.composed.store.db;
    const n = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM handover_journal WHERE handover_id = ?")
          .get(h.id) as Json
      ).n,
    );
    const ins = db.prepare(
      "INSERT INTO handover_journal (handover_id, seq, kind, code, at_ms) VALUES (?, ?, 'attention', 'synthetic_fill', ?)",
    );
    for (let s = n + 1; s <= 256; s++) ins.run(h.id, s, Date.now());
    for (let i = 0; i < 6 && w.handoverRow()?.state !== "released_to_buyer"; i++)
      await w.coordinator.pass();
    expect(w.handoverRow()?.state).toBe("released_to_buyer");
    expect(count(w, "handover_journal")).toBe(256);
    expect(w.rows("SELECT n FROM close_orders")).toHaveLength(1);
    expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    expect(w.rows("SELECT kind FROM handover_evidence").length).toBeGreaterThan(0);
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
  }, 60_000);
});

describe("003wf3 service readiness after the handover is configured state, re-derived at each start (D4)", () => {
  it("a restart with a changed model config, a used-up budget, or no model each say why customers can't be served; administration stays the buyer's", async () => {
    const w = await world();
    await closingNow(w);
    for (let i = 0; i < 6 && w.handoverRow()?.state !== "released_to_buyer"; i++)
      await w.coordinator.pass();
    expect(w.handoverRow()?.state).toBe("released_to_buyer");
    const service = async (composed: ReturnType<typeof composeIn>) => {
      const br = appBrowser(composed.app);
      await signInAs(br, BUYER, w.noah);
      const s = (await br(`/api/sales/${w.biz}`)).body;
      expect(s.handover?.state).toBe("released_to_buyer");
      expect(s.roles?.new_owner).toBe(true);
      return s.handover.service as { eligible: boolean; reasons: string[] };
    };
    expect(await service(w.composed)).toMatchObject({ eligible: true, reasons: [] });
    await w.composed.stop();
    const restart = async (config: Json) => {
      const c = composeIn(w.b, { config: { handover: w.handoverConfig, ...config } });
      try {
        return await service(c);
      } finally {
        await c.stop();
      }
    };
    // 1. The provider is present but its configuration changed: the release needs a recheck.
    const aiFile = String((w.b.config.model as Json).ai_config_file);
    const ai = readFileSync(aiFile, "utf8");
    writeFileSync(
      aiFile,
      JSON.stringify({
        ...JSON.parse(ai),
        config_version: "lifecycle-test-2",
        model: "claude-sonnet-5-5",
      }),
    );
    const changed = await restart({});
    expect(changed.eligible).toBe(false);
    expect(changed.reasons).toContain("release_release_needs_recheck");
    expect(changed.reasons.some((r) => r.startsWith("runtime_unavailable"))).toBe(false);
    writeFileSync(aiFile, ai);
    // 2. The same provider, but the running budget can't cover one request's worst case.
    // (separate connections: the composition is stopped)
    const d = openDb(w.b.db);
    const limit = (
      d.prepare("SELECT limit_cents FROM runtime_budgets WHERE business_id = ?").get(w.biz) as
        | Json
        | undefined
    )?.limit_cents;
    d.prepare("UPDATE runtime_budgets SET limit_cents = 0 WHERE business_id = ?").run(w.biz);
    d.close();
    const broke = await restart({});
    expect(broke.eligible).toBe(false);
    expect(broke.reasons).toEqual(["runtime_budget_exhausted"]);
    const d2 = openDb(w.b.db);
    d2.prepare("UPDATE runtime_budgets SET limit_cents = ? WHERE business_id = ?").run(
      Number(limit),
      w.biz,
    );
    d2.close();
    // 3. No model configured at all: the runtime is unavailable (and the release can't resolve).
    const none = await restart({ model: undefined });
    expect(none.eligible).toBe(false);
    expect(none.reasons.some((r) => r.startsWith("runtime_unavailable"))).toBe(true);
    // Back to the original configuration: eligible again (a next use is still what proves it).
    expect((await restart({})).eligible).toBe(true);
  }, 120_000);
});

describe("003wf3 away and back (D1): the second handover is bound to its own generation, not to the same person", () => {
  it("sold to the buyer, then sold back to the founder: each release follows its own reconciled ownership row at its own generation", async () => {
    const w = await world();
    await closingNow(w);
    for (let i = 0; i < 6 && w.handoverRow()?.state !== "released_to_buyer"; i++)
      await w.coordinator.pass();
    expect(w.handoverRow()).toMatchObject({ state: "released_to_buyer", deal_seq: "1" });
    // The new owner sells it back, Gated again, to the founder.
    w.b.w.chain.balances.set(FOUNDER, 1_000_000_000n);
    const back = await w.act(w.buyer, BUYER, "propose", w.terms({ buyer_account: FOUNDER }));
    expect(back.check?.body.resolution, JSON.stringify(back.p.body)).toMatchObject({
      kind: "confirmed",
    });
    for (const k of ["register", "fund", "accept"]) {
      const r = await w.act(w.seller, FOUNDER, k);
      expect(r.check?.body.resolution?.kind, `${k}: ${JSON.stringify(r.p.body)}`).toBe("confirmed");
    }
    const c = await w.act(w.buyer, BUYER, "accept");
    expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
    // While deal 2 closes, the founder is the chain's buyer but not yet the owner here.
    const done2 = () => {
      const h = w.handoverRow();
      return h?.deal_seq === "2" && h.state === "released_to_buyer";
    };
    for (let i = 0; i < 8 && !done2(); i++) await w.coordinator.pass();
    const h2 = w.handoverRow() as Json;
    expect(h2).toMatchObject({ state: "released_to_buyer", deal_seq: "2" });
    expect(w.sale.controlView()).toMatchObject({ owner: FOUNDER, generation: 3 });
    const own = w.rows(
      "SELECT from_id, to_id, generation, v3_intent_id FROM ownership WHERE business_id = ? ORDER BY generation",
      w.biz,
    );
    expect(own.map((o) => [o.from_id, o.to_id, o.generation])).toEqual([
      [w.b.w.f.ava.id, "person-noah", 2],
      ["person-noah", w.b.w.f.ava.id, 3],
    ]);
    expect(own.every((o) => o.v3_intent_id)).toBe(true);
    // Each handover names its own intent; the founder owns it here again, administration reopened.
    const hs = w.rows(
      "SELECT deal_seq, state, intent_id FROM business_handovers WHERE business_id = ? ORDER BY created_ms",
      w.biz,
    );
    expect(hs.map((h) => [h.deal_seq, h.state])).toEqual([
      ["1", "released_to_buyer"],
      ["2", "released_to_buyer"],
    ]);
    expect(hs[0]?.intent_id).not.toBe(hs[1]?.intent_id);
    expect(own.map((o) => o.v3_intent_id)).toEqual(hs.map((h) => h.intent_id));
    expect(
      (await w.seller(`/api/businesses/${w.biz}`, "PATCH", { name: "Home again" })).status,
    ).toBe(200);
  }, 120_000);
});
