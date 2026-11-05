// Job 003wf3 (MANAGED_HANDOVER.md §10.3 S-10, S-12, S-19, S-20): close orders and outcomes through
// the production coordinator, the real closer writer and V3Intents, over the configured composition
// (handoverWorld.ts) and the coherent encoded-call synthetic chain (SaleChain's close_sale in
// lib.rs order). Fictional accounts, ephemeral keys.

import { afterEach, describe, expect, it } from "vitest";
import { OperatorKey, TestnetCloserWriter, TestnetTxTransport } from "../src/customerWriter.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, type HandoverWorld, handoverWorld, PRICE } from "./handoverWorld.ts";
import { BIZ, FOUNDER, nearKey, SyntheticModel } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async (o: Parameters<typeof handoverWorld>[0] = {}) => {
  const w = await handoverWorld(o);
  worlds.push(w);
  return w;
};
const closing = async (w: HandoverWorld) => {
  await w.toBuyerAccepted();
  const c = await w.act(w.seller, FOUNDER, "accept");
  expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
};
async function passUntil(w: HandoverWorld, done: (state: string) => boolean, max = 40) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await w.coordinator.pass();
    seen.push(r[w.biz] as string);
    if (r[w.biz] === "busy") await new Promise((d) => setTimeout(d, 100));
    if (done(String(w.handoverRow()?.state))) return seen;
  }
  throw new Error(`still ${w.handoverRow()?.state} after ${max} passes: ${seen.join(", ")}`);
}
type Seam = {
  dispatch: (...a: unknown[]) => Promise<string>;
  keys: Map<string, { writer: TestnetCloserWriter }>;
};
/** One coordinator pass that persists the order but stops before the writer runs. */
async function persistOrderOnly(w: HandoverWorld, blocks: string[] = []) {
  const seam = w.coordinator as unknown as Seam;
  const dispatch = seam.dispatch;
  seam.dispatch = async () => "cut_before_writer";
  // Every block header the RPC serves during this pass, read at the RPC itself.
  const rpc = w.b.rpc as unknown as { answer: (raw: string) => Promise<string> };
  const answer = rpc.answer.bind(w.b.rpc);
  rpc.answer = async (raw: string) => {
    const out = await answer(raw);
    if ((JSON.parse(raw) as { method?: string }).method === "block")
      blocks.push(String(BigInt(JSON.parse(out).result.header.timestamp_nanosec) / 1_000_000n));
    return out;
  };
  try {
    expect((await w.coordinator.pass())[w.biz]).toBe("cut_before_writer");
  } finally {
    seam.dispatch = dispatch;
    rpc.answer = answer;
  }
  const row = w.rows("SELECT n, order_json FROM close_orders")[0] as Json;
  return JSON.parse(String(row.order_json)) as Json;
}
const closes = (w: HandoverWorld) => w.b.rpc.applied.filter((a) => a.method === "close_sale");

describe("003wf3 S-10: the close order's exact fields", () => {
  it("the order is the contract's fields at the read block; each wrong field, an early or late time, or another signer is refused with the contract's own code; the handover stays gated; then the original order closes", async () => {
    const w = await world();
    await closing(w);
    const blocks: string[] = [];
    const order = await persistOrderOnly(w, blocks);
    const h = w.handoverRow() as Json;
    // issued_at_ms is the coordinator's own pinned read: a block timestamp the RPC served then.
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks).toContain(String(order.issued_at_ms));
    const live = w.sale.controlView().live_deal as Json;
    expect(order).toEqual({
      deal_seq: live.seq,
      version: live.version,
      digest: live.digest,
      expected_generation: 1,
      closing_control_seq: h.closing_control_seq,
      manifest: h.manifest,
      manifest_seq: h.manifest_seq,
      issued_at_ms: order.issued_at_ms,
    });
    expect(BigInt(order.issued_at_ms as string) >= BigInt(live.closing_started_ms as string)).toBe(
      true,
    );
    const writer = (w.coordinator as unknown as Seam).keys.get(w.biz)
      ?.writer as TestnetCloserWriter;
    const now = BigInt(w.b.w.chain.ts);
    const started = BigInt(live.closing_started_ms as string);
    const variants: [string, Json, string][] = [
      ["version", { ...order, version: Number(order.version) + 1 }, "E_VERSION"],
      ["generation", { ...order, expected_generation: 2 }, "E_GENERATION"],
      ["digest", { ...order, digest: "ab".repeat(32) }, "E_TERMS"],
      ["manifest", { ...order, manifest: "cd".repeat(32) }, "E_MANIFEST"],
      [
        "manifest seq",
        { ...order, manifest_seq: String(Number(order.manifest_seq) + 1) },
        "E_MANIFEST",
      ],
      [
        "closing control seq",
        { ...order, closing_control_seq: String(BigInt(order.closing_control_seq as string) + 1n) },
        "E_CLOSE_SEQ",
      ],
      ["future", { ...order, issued_at_ms: String(now + 120_000n) }, "E_ISSUED_FUTURE"],
      ["too old", { ...order, issued_at_ms: String(now - 21n * 60_000n) }, "E_ISSUE_AGE"],
      ["before closing", { ...order, issued_at_ms: String(started - 1_000n) }, "E_ISSUED_BEFORE"],
    ];
    for (const [name, bad, code] of variants) {
      const a = await writer.closeSale({
        operation: `s10-${name.replace(/ /g, "-")}`,
        account: BIZ,
        order: bad,
        signal: new AbortController().signal,
      });
      expect(a, name).toMatchObject({ status: "refused", code });
    }
    // Another account, with a function-call key for close_sale: not the configured closer.
    const other = nearKey();
    const account = "other-closer.testnet";
    w.b.rpc.keys.set(`${account}|${other.id}`, 0n);
    w.b.rpc.permissions.set(`${account}|${other.id}`, {
      FunctionCall: { receiver_id: BIZ, method_names: ["close_sale"], allowance: null },
    });
    const rpc = new TestnetTxTransport(
      { network: "testnet", endpoint: String((w.b.config.rpc as Json).endpoint) },
      SyntheticModel.rpcFetch(w.b.rpc) as never,
    );
    const stranger = new TestnetCloserWriter(w.composed.store.db, {
      network: "testnet",
      signer: account,
      key: new OperatorKey(other.secret, other.id),
      rpc,
    });
    const s = await stranger.closeSale({
      operation: "s10-stranger",
      account: BIZ,
      order,
      signal: new AbortController().signal,
    });
    expect(s).toMatchObject({ status: "refused", code: "E_NOT_CLOSER" });
    expect(closes(w)).toHaveLength(0);
    expect(w.handoverRow()?.state).toBe("ordering");
    expect(w.sale.controlView()).toMatchObject({ owner: FOUNDER, generation: 1 });
    // The coordinator resumes its own durable order 1 (never a replacement) and it closes.
    await passUntil(w, (st) => st === "released_to_buyer");
    expect(w.rows("SELECT n FROM close_orders")).toEqual([{ n: 1 }]);
    expect(closes(w)).toHaveLength(1);
  }, 90_000);
});

describe("003wf3 S-12: an aged order is replaced; the late original can't close", () => {
  it("order 1 sent with no answer stays unknown (never failed by a timeout); once past its usable age (before its absolute 20-minute expiry) a replacement closes; the original arriving later is refused by the network for its used nonce (not by its age) and stays unknown on its own record; exactly one close", async () => {
    const w = await world({ handover: { op_deadline_ms: 400, pass_budget_ms: 2_000 } });
    // A transport that ends its wait when the step's deadline aborts it, as a real fetch does.
    w.b.rpc.honorAbort = true;
    await closing(w);
    const held = w.b.rpc.holdNextSend("close_sale");
    const first = w.coordinator.pass();
    await held.entered;
    expect((await first)[w.biz]).toBe("deadline");
    // Every later broadcast of order 1's exact transaction is lost in transit.
    const order1 = JSON.parse(String(w.rows("SELECT order_json FROM close_orders")[0]?.order_json));
    w.b.rpc.dropSend = (method, args) =>
      method === "close_sale" &&
      String((args.order as Json | undefined)?.issued_at_ms) === String(order1.issued_at_ms);
    const attempt1 = () =>
      w.rows("SELECT state FROM closer_tx_attempts WHERE operation LIKE ?", "%-1|close_sale")[0];
    // While order 1 is young: outstanding; its attempt stays unknown (signed), never failed.
    for (let i = 0; i < 3; i++) {
      const r = (await w.coordinator.pass())[w.biz];
      expect(r).toMatch(/^(busy|order_outstanding|reconcile_|dispatched)/);
      if (r === "busy") await new Promise((d) => setTimeout(d, 50));
    }
    expect(attempt1()).toMatchObject({ state: "signed" });
    expect(w.rows("SELECT n FROM close_orders")).toEqual([{ n: 1 }]);
    // The contract's clock passes order 1's usable age (20 min − the dispatch margin).
    w.b.w.chain.tick(19n * 60_000n + 30_000n);
    await passUntil(w, (st) => st === "released_to_buyer");
    expect(w.rows("SELECT n FROM close_orders ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }]);
    expect(closes(w)).toHaveLength(1);
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    // The original finally arrives: its nonce is already used by order 2, so it never executes.
    held.open();
    await new Promise((d) => setTimeout(d, 300));
    expect(closes(w)).toHaveLength(1);
    // The network delivers again: a resend of order 1's bytes now meets its own known outcome.
    w.b.rpc.dropSend = null;
    const after: string[] = [];
    for (let i = 0; i < 5 && attempt1()?.state === "signed"; i++) {
      after.push(String((await w.coordinator.pass())[w.biz]));
      await new Promise((d) => setTimeout(d, 100));
    }
    expect(w.handoverRow()?.state).toBe("released_to_buyer");
    // Order 1's attempt is never recorded as the close nor as failed by a timeout: with more
    // than one broadcast on record, an invalid-nonce answer can't prove anything for every copy,
    // so it stays unknown on its own record (customerWriter's send rule).
    expect(["signed", "invalid"]).toContain(attempt1()?.state);
    expect(after.every((r) => r === "attempts_resolved")).toBe(true);
    // Bounded: once every order is past the contract's 20-minute limit none can execute, so the
    // coordinator stops sending. It only reads the original's own status (Astra 03:30), at most
    // once a minute; with no final status shown, the attempt stays unknown on its own record.
    w.b.w.chain.tick(21n * 60_000n);
    const sends = w.b.rpc.sends;
    expect((await w.coordinator.pass())[w.biz]).toBe("attempts_status_unknown");
    expect((await w.coordinator.pass())[w.biz]).toBe("idle"); // not again within the minute
    expect(w.b.rpc.sends).toBe(sends);
    expect(["signed", "invalid"]).toContain(attempt1()?.state);
    expect(w.rows("SELECT 1 FROM ownership WHERE business_id = ?", w.biz)).toHaveLength(1);
  }, 120_000);
});

describe("003wf3 S-19: races at the end", () => {
  it("close and abort both sent after the deadline: the contract decides one outcome; the gate follows it (to the seller); the late close is refused", async () => {
    const w = await world();
    await closing(w);
    const held = w.b.rpc.holdNextSend("close_sale");
    const first = w.coordinator.pass();
    await held.entered;
    w.b.w.chain.tick(31n * 60_000n); // past the 30-minute window
    const ab = await w.act(w.buyer, BUYER, "abort");
    expect(ab.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "aborted" });
    held.open();
    await first;
    await passUntil(w, (st) => st === "released_to_seller");
    expect(closes(w)).toHaveLength(0);
    const outcomes = w.sale.outcomesView() as Json[];
    expect(outcomes.map((o) => o.status)).toEqual(["aborted"]);
    expect(w.sale.controlView()).toMatchObject({ owner: FOUNDER, generation: 1 });
    expect((await w.buyer(`/api/sales/${w.biz}`)).body.party.escrow_return_claim).toBe(PRICE);
  }, 90_000);

  it("the close lands but local reconciliation can't apply it (a divergent local history): attention, the gate stays closed for both people, nothing reopened", async () => {
    const w = await world();
    await closing(w);
    const order = await persistOrderOnly(w);
    expect(order.deal_seq).toBe("1");
    // A local history that moved on since the intent was recorded (the S-20 shape, injected to
    // force the conflict; this is not how any close is applied).
    const db = w.composed.store.db;
    db.prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)").run(
      w.biz,
      w.b.w.f.ava.id,
      w.b.w.f.ava.id,
      new Date().toISOString(),
    );
    await passUntil(w, (st) => st === "attention", 20);
    expect(closes(w)).toHaveLength(1); // the contract closed it
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    expect(w.rows("SELECT owner_id FROM businesses WHERE id = ?", w.biz)[0]?.owner_id).toBe(
      w.b.w.f.ava.id,
    );
    for (const who of [w.seller, w.buyer]) {
      const r = await who(`/api/businesses/${w.biz}`, "PATCH", { name: "Not now" });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(
      (await w.seller(`/api/businesses/${w.biz}`, "PATCH", { name: "Not now" })).body.code,
    ).toBe("handover_in_progress");
    for (let i = 0; i < 3; i++) await w.coordinator.pass();
    expect(w.handoverRow()?.state).toBe("attention");
    expect(String(w.handoverRow()?.attention_reason)).toMatch(/reconcile_/);
  }, 90_000);
});

describe("003wf3 S-20: imported local history is bound separately from the contract generation", () => {
  it("a business with two imported local ownership records (local epoch 2) at contract generation 1 closes with each bound to its own source", async () => {
    const w = await world();
    const db = w.composed.store.db;
    const t = new Date().toISOString();
    // Imported history (as an earlier, non-v3 record of this business): two local transfers.
    db.prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)").run(
      w.biz,
      w.b.w.f.ava.id,
      w.b.w.f.ava.id,
      t,
    );
    db.prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)").run(
      w.biz,
      w.b.w.f.ava.id,
      w.b.w.f.ava.id,
      t,
    );
    await closing(w);
    await w.coordinator.pass();
    const h = w.handoverRow() as Json;
    expect(h).toMatchObject({ local_epoch: 2, expected_generation: 1 });
    await passUntil(w, (st) => st === "released_to_buyer");
    const own = w.rows(
      "SELECT generation, v3_intent_id FROM ownership WHERE business_id = ? ORDER BY rowid",
      w.biz,
    );
    expect(own).toHaveLength(3);
    expect(own.at(-1)).toMatchObject({ generation: 2 });
    expect(own.at(-1)?.v3_intent_id).toBeTruthy();
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
  }, 90_000);
});
