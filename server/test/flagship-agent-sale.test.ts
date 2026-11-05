// Hardening (Tony's agreed plan, item 1): 006b agent access inside the actual configured child,
// across a Direct sale. The founder turns agent use of the offer on; the customer buys 100 with
// her own key (slot 0) and 10 more installing her agent's own key (slot 1); she grants the agent
// that slot, 5 uses, 7 days. The agent (no cookie, only the bearer token, its own key) prepares,
// signs, confirms, runs and reads a result over MCP 2026-07-28. The sale closes. The grant
// survives the sale (it is the customer's), the agent's next use is served under the buyer, the
// seller can no longer flip the switch, and when the buyer turns agent use off the agent is
// refused before anything is prepared while the customer's own use still works.
//
// SYNTHETIC chain, wallet and model (flagshipWorld.ts); fictional people and agent.

import { afterEach, describe, expect, it } from "vitest";
import { MCP_VERSION } from "../src/agentAccess.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  act,
  BUYER,
  type Cleanup,
  check,
  foundAndOffer,
  installation,
  invoice,
  ok,
  people,
  purchase,
  SALE_TERMS,
  serveOneUse,
  until,
  useKey,
} from "./flagshipWorld.ts";
import { FOUNDER } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe("hardening: agent access in the configured child across a Direct sale (SYNTHETIC chain, wallet and model)", () => {
  it("owner turns agents on; the agent uses its own key over MCP; the grant survives the sale; the buyer serves it, then turns agents off and only the agent is refused", async () => {
    const i = await installation(cleanups);
    const app = await i.start();
    const { ava, cara, noah } = await people(i);
    const { offer } = await foundAndOffer(i, ava);
    const offerId = offer.id as string;
    const switchPath = `/api/businesses/${i.biz}/customer-offers/${offerId}/agent-access`;
    // Off until the owner turns it on: the customer can't grant yet.
    const grantBody = {
      offer_id: offerId,
      key_slot: 1,
      label: "Fictional bookkeeping agent",
      max_uses: 5,
      expires_in_days: 7,
    };
    expect((await cara("/api/customer/agent-grants", "POST", grantBody)).body.code).toBe(
      "agent_access_off",
    );
    expect(ok(await ava(switchPath, "PUT", { enabled: true }), 200, "on").agents).toBe("on");

    const caraKey = useKey();
    const agentKey = useKey(); // the agent's own key; the server never holds it
    for (const [units, slot, key, k] of [
      [100, 0, caraKey, "agent-buy-0000001"],
      [10, 1, agentKey, "agent-buy-0000002"],
    ] as const) {
      const p = await purchase(i, cara, offerId, units, [{ slot, key }], k);
      ok(await cara(`/api/customer/purchases/${p.pid}/check`, "POST", { tx_hash: p.hash }), 200, k);
    }
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "110", consumed: "0" });
    const g = ok(await cara("/api/customer/agent-grants", "POST", grantBody), 201, "grant");
    const token = g.token as string;

    // The agent: plain HTTP to the child, no cookie.
    let n = 0;
    const mcp = async (method: string, params: Json = {}) => {
      const res = await fetch(`http://127.0.0.1:${i.port()}/api/agent/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_VERSION,
          "mcp-method": method,
          ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++n,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": MCP_VERSION,
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });
      return (await res.json()) as Json;
    };
    const tool = async (name: string, args: Json) => {
      const r = await mcp("tools/call", { name, arguments: args });
      return r.result as Json;
    };
    const agentUse = async (k: string, m: number) => {
      const prep = await tool("prepare_use", { idempotency_key: k, input: invoice(m) });
      expect(prep.isError, JSON.stringify(prep)).toBe(false);
      const use = prep.structuredContent.use as Json;
      const conf = await tool("confirm_use", {
        use_id: use.id,
        envelope_digest: use.envelope.envelope_digest,
        hold_signature: agentKey.signHex(use.envelope.hold.message_hex),
        use_signature: agentKey.signHex(use.envelope.use.message_hex),
      });
      expect(conf.structuredContent.use?.state, JSON.stringify(conf)).toBe("reserved");
      const run = await tool("run_use", { use_id: use.id });
      expect(run.structuredContent.use?.execution?.fulfilled, JSON.stringify(run)).toBe(true);
      await until(
        async () => (await cara(`/api/customer/uses/${use.id}/units/reconcile`, "POST")).body,
        (v) => v.use?.units?.unit === "charged",
        `agent use ${k} charged`,
      );
      const got = await tool("get_use", { use_id: use.id });
      expect(JSON.stringify(got.structuredContent.result)).toContain("SH-1042");
      return use.id as string;
    };
    expect((await mcp("server/discover")).result.supportedVersions).toEqual([MCP_VERSION]);
    const before = await agentUse("agent-sale-0001", 1);
    await serveOneUse(cara, offerId, 2, caraKey, 0);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "108", consumed: "2" });

    // The Direct sale closes.
    const proposed = await act(i, ava, FOUNDER, "propose", SALE_TERMS, "agent-propose-001");
    expect((await check(ava, proposed.id, "propose")).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"]) {
      const a = await act(i, noah, BUYER, k, {}, `agent-${k}-00001`);
      expect((await check(noah, a.id, k)).resolution.kind).toBe("confirmed");
    }
    const close = await act(i, ava, FOUNDER, "accept", {}, "agent-close-00001");
    expect((await check(ava, close.id, "close")).resolution).toMatchObject({ result: "closed" });

    // The grant survives; the agent's earlier result is still readable; its next use is served.
    expect((await cara("/api/customer/agent-grants")).body.grants[0]).toMatchObject({
      state: "active",
      used: 1,
    });
    expect(
      JSON.stringify((await tool("get_use", { use_id: before })).structuredContent.result),
    ).toContain("SH-1042");
    await agentUse("agent-sale-0002", 3);
    // The seller can't flip the switch any more; the buyer can.
    expect((await ava(switchPath, "PUT", { enabled: false })).status).toBeGreaterThanOrEqual(400);
    expect(ok(await noah(switchPath, "PUT", { enabled: false }), 200, "buyer off").agents).toBe(
      "off",
    );
    const refused = await tool("prepare_use", {
      idempotency_key: "agent-sale-0003",
      input: invoice(4),
    });
    expect(refused).toMatchObject({
      isError: true,
      structuredContent: { code: "agent_access_off" },
    });
    // Refused before anything was prepared: the customer's request count didn't move.
    const requests = i.read("SELECT COUNT(*) AS n FROM customer_requests")[0]?.n;
    expect(requests).toBe(3); // agent, customer, agent
    // The customer's own use still works under the buyer.
    await serveOneUse(cara, offerId, 5, caraKey, 0);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "106", consumed: "4" });
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
