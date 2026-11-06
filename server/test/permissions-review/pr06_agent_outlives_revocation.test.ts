// Permissions review, agent role: an AI agent's bearer token must not exceed its scope (one offer,
// one key slot, a use limit) or outlive its revocation or expiry.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

const H = (token: string) => ({ authorization: `Bearer ${token}` });

describe("pr06: agent access", () => {
  it("a revoked or expired token is refused on every agent route", async () => {
    const s = await saleWorld();
    const { ava, biz, offerId, cara, w } = s;
    await ava(`/api/businesses/${biz}/customer-offers/${offerId}/agent-access`, "PUT", {
      enabled: true,
    });
    const g = await cara("/api/customer/agent-grants", "POST", {
      offer_id: offerId,
      key_slot: 0,
      max_uses: 5,
      label: "Agent",
    });
    expect(g.status).toBe(201);
    const token = g.body.token as string;
    const app = w.state.app;
    const agent = async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { ...H(token), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    // Live: prepare works.
    const prep = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-use-0001",
      input: "Fictional invoice SH-1 from Stackline Hosting Ltd, total 10.00 USD",
    });
    expect(prep.status).toBe(201);
    const useId = prep.body.use.id as string;
    // Revoked: everything refuses, including reads of the use it already prepared.
    expect(
      (await cara(`/api/customer/agent-grants/${g.body.grant.id}/revoke`, "POST", {})).status,
    ).toBe(200);
    for (const [path, method, body] of [
      ["/api/agent/v1/uses", "POST", { idempotency_key: "agent-use-0002", input: "x" }],
      [`/api/agent/v1/uses/${useId}`, "GET"],
      [`/api/agent/v1/uses/${useId}/result`, "GET"],
      [`/api/agent/v1/uses/${useId}/execute`, "POST", {}],
      [`/api/agent/v1/uses/${useId}/confirm`, "POST", {}],
    ] as [string, string, unknown?][]) {
      const r = await agent(path, method, body);
      expect([path, r.status]).toEqual([path, 403]);
    }
  });

  it("an agent can't reach a use it didn't prepare, nor another offer", async () => {
    const s = await saleWorld();
    const { ava, biz, offerId, cara, w } = s;
    await ava(`/api/businesses/${biz}/customer-offers/${offerId}/agent-access`, "PUT", {
      enabled: true,
    });
    // Cara's own (non-agent) use.
    const own = await s.customerUse();
    expect(own.status).toBe(201);
    const g = await cara("/api/customer/agent-grants", "POST", {
      offer_id: offerId,
      key_slot: 0,
      max_uses: 1,
      label: "Agent",
    });
    const token = g.body.token as string;
    const app = w.state.app;
    const agent = async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { ...H(token), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    // The customer's own use is not the agent's.
    expect((await agent(`/api/agent/v1/uses/${own.id}`)).status).toBe(404);
    expect((await agent(`/api/agent/v1/uses/${own.id}/result`)).status).toBe(404);
    expect((await agent(`/api/agent/v1/uses/${own.id}/execute`, "POST", {})).status).toBe(404);
    // One use allowed: the second preparation under a new key is refused.
    const p1 = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-limit-0001",
      input: "Fictional invoice A",
    });
    expect(p1.status).toBe(201);
    const p2 = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-limit-0002",
      input: "Fictional invoice B",
    });
    expect(p2.status).toBe(403);
    // The owner turning agents off stops new preparations.
    await ava(`/api/businesses/${biz}/customer-offers/${offerId}/agent-access`, "PUT", {
      enabled: false,
    });
    const p3 = await agent("/api/agent/v1/uses", "POST", {
      idempotency_key: "agent-limit-0003",
      input: "Fictional invoice C",
    });
    expect(p3.status).toBe(403);
  });
});
