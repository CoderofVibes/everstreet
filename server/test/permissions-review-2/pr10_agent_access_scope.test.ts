// Promise 11 (agent access): an agent can't exceed its grant or outlive its revocation.
import { describe, expect, it } from "vitest";
import type { Json } from "../customer-world.ts";
import { reviewWorld } from "./world.ts";

describe("pr10: an AI agent's grant", () => {
  it("is scoped to one customer, one offer, its uses and its life", async () => {
    const w = await reviewWorld();
    const app = w.w.state.app;
    const agent = async (token: string, path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
    // Off by default: no grant can be made.
    const early = await w.cara("/api/customer/agent-grants", "POST", {
      offer_id: w.offerId,
      key_slot: 0,
      max_uses: 1,
      label: "Early",
    });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe("agent_access_off");
    expect(
      (
        await w.ava(`/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`, "PUT", {
          enabled: true,
        })
      ).status,
    ).toBe(200);
    // A customer can't flip the owner's switch.
    expect(
      (
        await w.cara(`/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`, "PUT", {
          enabled: false,
        })
      ).status,
    ).toBe(404);
    const g = await w.cara("/api/customer/agent-grants", "POST", {
      offer_id: w.offerId,
      key_slot: 0,
      max_uses: 1,
      label: "Cara's agent",
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const token = g.body.token as string;
    expect(
      (await agent("evs_agent_not-a-real-token-at-all-0000000", "/api/agent/v1/uses", "POST", {}))
        .status,
    ).toBe(401);
    const prep = await agent(token, "/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-use-0001",
      input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
    });
    expect(prep.status, JSON.stringify(prep.body)).toBe(201);
    const useId = prep.body.use.id as string;
    expect(prep.body.use.customer_account ?? prep.body.use.envelope?.customer_account).toBe(
      "cara.near",
    );
    // The use is the customer's: Cara sees it; Dana doesn't.
    expect((await w.cara(`/api/customer/uses/${useId}`)).status).toBe(200);
    expect((await w.dana(`/api/customer/uses/${useId}`)).status).toBe(404);
    const confirmed = await agent(
      token,
      `/api/agent/v1/uses/${useId}/confirm`,
      "POST",
      w.w.signed(prep.body.use.envelope),
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await agent(token, `/api/agent/v1/uses/${useId}/execute`, "POST")).status).toBe(200);
    // Its one use is spent: another preparation is refused; a retry of the same key is not new.
    const again = await agent(token, "/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-use-0002",
      input: "Fictional invoice NA-4410 from Northwind AI Ops, total 48.00 USD",
    });
    expect(again.status).toBe(403);
    expect(again.body.code).toBe("agent_used_up");
    const retry = await agent(token, "/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-use-0001",
      input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
    });
    expect(retry.status).toBe(200);
    expect(retry.body.use.id).toBe(useId);
    // Another customer's agent can't read this use.
    const g2 = await w.dana("/api/customer/agent-grants", "POST", {
      offer_id: w.offerId,
      key_slot: 0,
      max_uses: 1,
      label: "Dana's agent",
    });
    expect(g2.status).toBe(201);
    expect((await agent(g2.body.token, `/api/agent/v1/uses/${useId}`)).status).toBe(404);
    expect((await agent(g2.body.token, `/api/agent/v1/uses/${useId}/result`)).status).toBe(404);
    // Revoked: everything stops, including reading what it already did.
    expect(
      (await w.cara(`/api/customer/agent-grants/${g.body.grant.id}/revoke`, "POST")).status,
    ).toBe(200);
    const after = await agent(token, `/api/agent/v1/uses/${useId}`);
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("agent_revoked");
    // The owner's switch off refuses new preparations even for live grants.
    await w.ava(`/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`, "PUT", {
      enabled: false,
    });
    const off = await agent(g2.body.token, "/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-dana-0001",
      input: "x",
    });
    expect(off.status).toBe(403);
    expect(off.body.code).toBe("agent_access_off");
    // An agent token opens no cookie route.
    const res = await app.request(`/api/customer/uses/${useId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});
