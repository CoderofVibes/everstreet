// Promise 2: a customer sees only their own purchases, requests, results, cases, device keys and
// 402 offers.
import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr08: one customer against another's records", () => {
  it("another customer, the owner and a stranger get 404 on Cara's request", async () => {
    const w = await reviewWorld({ product: "relaydesk" });
    const use = await w.customerUse();
    expect(use.unit).toBe("charged");
    const id = use.id as string;
    const mine = await w.cara(`/api/customer/uses/${id}`);
    expect(mine.status).toBe(200);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    expect((await w.cara(`/api/customer/uses/${id}/case`)).body.case).not.toBeNull();
    const reads = [
      `/api/customer/uses/${id}`,
      `/api/customer/uses/${id}/result`,
      `/api/customer/uses/${id}/case`,
      "/api/customer/requests/by-key/sale-world-use-0001",
    ];
    const writes = [
      `/api/customer/uses/${id}/confirm`,
      `/api/customer/uses/${id}/cancel`,
      `/api/customer/uses/${id}/reconcile`,
      `/api/customer/uses/${id}/execute`,
      `/api/customer/uses/${id}/execution/cancel`,
      `/api/customer/uses/${id}/units/reconcile`,
      `/api/customer/uses/${id}/release`,
    ];
    const failures: string[] = [];
    for (const [name, who] of [
      ["dana", w.dana],
      ["owner", w.ava],
      ["stranger", w.stranger],
    ] as const) {
      for (const path of reads) {
        const r = await who(path);
        if (r.status !== 404) failures.push(`${name} GET ${path} -> ${r.status}`);
      }
      for (const path of writes) {
        const r = await who(path, "POST", {});
        if (r.status !== 404) failures.push(`${name} POST ${path} -> ${r.status}`);
      }
    }
    expect(failures).toEqual([]);
    // Lists are the caller's own.
    expect((await w.dana("/api/customer/uses")).body.uses).toEqual([]);
    expect(
      (await w.cara("/api/customer/uses")).body.uses.map((u: { id: string }) => u.id),
    ).toContain(id);
  });

  it("device keys and purchases are read for the caller's own account only", async () => {
    const w = await reviewWorld();
    const caraKeys = await w.cara(`/api/customer/offers/${w.offerId}/keys`);
    expect(caraKeys.status).toBe(200);
    const danaKeys = await w.dana(`/api/customer/offers/${w.offerId}/keys`);
    expect(danaKeys.status).toBe(200);
    expect(JSON.stringify(danaKeys.body)).not.toContain("cara.near");
    expect(JSON.stringify(caraKeys.body)).not.toContain("dana.near");
    // Dana's purchase picture names Dana's account only.
    const setup = await w.dana(`/api/customer/offers/${w.offerId}/purchase-setup?units=1`);
    expect(setup.status).toBe(200);
    expect(setup.body.customer).toBe("dana.near");
    expect((await w.cara("/api/customer/purchases")).body.purchases).toEqual([]);
  });

  it("agent grants belong to the customer who made them", async () => {
    const w = await reviewWorld();
    expect(
      (
        await w.ava(`/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`, "PUT", {
          enabled: true,
        })
      ).status,
    ).toBe(200);
    const g = await w.cara("/api/customer/agent-grants", "POST", {
      offer_id: w.offerId,
      key_slot: 0,
      max_uses: 3,
      label: "Cara's agent",
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const id = g.body.grant.id as string;
    expect((await w.dana(`/api/customer/agent-grants/${id}/revoke`, "POST")).status).toBe(404);
    expect((await w.ava(`/api/customer/agent-grants/${id}/revoke`, "POST")).status).toBe(404);
    expect((await w.dana("/api/customer/agent-grants")).body.grants).toEqual([]);
    // The grant's token is shown once; the list never repeats it.
    expect(JSON.stringify((await w.cara("/api/customer/agent-grants")).body)).not.toContain(
      g.body.token,
    );
  });
});
