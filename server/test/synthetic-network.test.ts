// Job 003wf3 (P-4, Astra 04:00): the synthetic network with two business contracts is ONE coherent
// network. With the clock fixed: both contracts read at one block share its identity and time; a
// real encoded, signed write to the SECOND contract (the production customer writer's open_hold)
// lands in a strictly newer network block; the older block still answers exactly what it showed
// before (its snapshots are immutable); both contracts at the new block share it.

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preimageOfHold } from "../src/customerSigning.ts";
import { OperatorKey, TestnetCustomerWriter, TestnetTxTransport } from "../src/customerWriter.ts";
import { openDb } from "../src/db.ts";
import { CUSTOMER, FixtureChain, type Json, keyFromSeed } from "./customer-world.ts";
import { BIZ2, nearKey, OP, RPC, SyntheticModel, SyntheticRpc } from "./lifecycleWorld.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("003wf3 two business contracts on one synthetic network", () => {
  it("a write to the second contract makes a new network block; old snapshots stay; both contracts share each block", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    const first = new FixtureChain();
    first.control = { ...first.control, operators: [[OP, 1, first.control.generation]] };
    const second = new FixtureChain();
    second.business = BIZ2;
    second.control = { ...second.control, operators: [[OP, 1, second.control.generation]] };
    const rpc = new SyntheticRpc(first);
    rpc.addChain(second);
    let id = 0;
    const call = async (method: string, params: Json = {}) =>
      JSON.parse(
        await rpc.answer(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })),
      ) as Json;
    const block = async () => (await call("block", { finality: "final" })).result.header as Json;
    const view = async (account: string, method: string, args: Json, hash: string) => {
      const r = (
        await call("query", {
          request_type: "call_function",
          account_id: account,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          block_id: hash,
        })
      ).result as Json;
      return {
        value: JSON.parse(Buffer.from(r.result as number[]).toString("utf8")),
        height: r.block_height,
        hash: r.block_hash,
      };
    };
    const ent = { customer: CUSTOMER, plan_id: 1 };
    const b1 = await block();
    const a1 = await view(first.business, "get_control", {}, b1.hash);
    const s1 = await view(BIZ2, "get_entitlement", ent, b1.hash);
    expect([a1.height, a1.hash]).toEqual([s1.height, s1.hash]);
    expect(s1.value.hold_active).toBe(false);
    // A real encoded write to the SECOND contract, through the production customer writer.
    const k = nearKey();
    rpc.keys.set(`${OP}|${k.id}`, 0n);
    const writer = new TestnetCustomerWriter(openDb(":memory:"), {
      network: "testnet",
      signer: OP,
      key: new OperatorKey(k.secret, k.id),
      rpc: new TestnetTxTransport(
        { network: "testnet", endpoint: RPC },
        SyntheticModel.rpcFetch(rpc) as never,
      ),
    });
    const e = second.ent(CUSTOMER) as Json;
    const slot = (e.keys as Json[]).findIndex((x) => x?.state === "active");
    const auth = {
      hold_seq: Number(e.hold_seq) + 1,
      units: 1,
      serve_until_ms: String(second.ts + 10n * 60_000n),
      key_slot: slot,
      key_epoch: Number((e.keys as Json[])[slot]?.epoch),
    };
    const message = createHash("sha256")
      .update(
        preimageOfHold(
          {
            business: BIZ2,
            plan_id: 1,
            customer: CUSTOMER,
            reg_id: String(e.reg_id),
            key_slot: auth.key_slot,
            key_epoch: auth.key_epoch,
          },
          auth,
        ),
      )
      .digest("hex");
    const answer = await writer.openHold({
      operation: "network-test-0001",
      network: "testnet",
      account: BIZ2,
      customer: CUSTOMER,
      plan_id: 1,
      auth,
      sig: keyFromSeed(1)(message),
      signal: new AbortController().signal,
    });
    expect(answer).toMatchObject({ status: "opened" });
    expect(rpc.applied.map((x) => [x.method, x.receiver])).toEqual([["open_hold", BIZ2]]);
    // A strictly newer network block; the old block still shows exactly the old state.
    const b2 = await block();
    expect(Number(b2.height)).toBeGreaterThan(Number(b1.height));
    expect(b2.hash).not.toBe(b1.hash);
    const s1again = await view(BIZ2, "get_entitlement", ent, b1.hash);
    expect(s1again.value).toEqual(s1.value);
    // Both contracts at the new block share it; the second shows the hold, the first is unchanged.
    const a2 = await view(first.business, "get_control", {}, b2.hash);
    const s2 = await view(BIZ2, "get_entitlement", ent, b2.hash);
    expect([a2.height, a2.hash]).toEqual([s2.height, s2.hash]);
    expect(s2.value.hold_active).toBe(true);
    expect(a2.value).toEqual(a1.value);
    expect(second.ts).toBe(first.ts); // one network clock
  });
});
