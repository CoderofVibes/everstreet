// Permissions review, promise 2: a customer sees only their own purchases, requests, results,
// cases and device keys. Cara prepares and runs a use; Dana (another customer), the owner and a
// stranger try to read or act on it.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

async function caraUse() {
  const s = await saleWorld();
  const use = await s.customerUse();
  expect(use.status).toBe(201);
  return { ...s, useId: use.id as string };
}

describe("pr04: another customer's records", () => {
  it("Dana, the owner and a stranger get 404 on Cara's use everywhere", async () => {
    const s = await caraUse();
    const { useId, w, ava, stranger } = s;
    const others = { dana: w.dana, owner: ava, stranger };
    for (const [who, call] of Object.entries(others)) {
      const reads = await Promise.all([
        call(`/api/customer/uses/${useId}`),
        call(`/api/customer/uses/${useId}/result`),
        call(`/api/customer/uses/${useId}/case`),
      ]);
      for (const r of reads) expect([who, r.status]).toEqual([who, 404]);
      const writes = await Promise.all([
        call(`/api/customer/uses/${useId}/cancel`, "POST", {}),
        call(`/api/customer/uses/${useId}/execute`, "POST", {}),
        call(`/api/customer/uses/${useId}/execution/cancel`, "POST", {}),
        call(`/api/customer/uses/${useId}/reconcile`, "POST", {}),
        call(`/api/customer/uses/${useId}/units/reconcile`, "POST", {}),
        call(`/api/customer/uses/${useId}/release`, "POST", {}),
        call(`/api/customer/uses/${useId}/confirm`, "POST", {
          envelope_digest: "x",
          hold_signature: "0".repeat(128),
          use_signature: "0".repeat(128),
        }),
      ]);
      for (const r of writes) expect([who, r.status]).toEqual([who, 404]);
    }
  });

  it("Cara's own list never includes Dana's requests, and by-key finds only the caller's", async () => {
    const s = await caraUse();
    const mine = (await s.cara("/api/customer/uses")).body.uses as { id: string }[];
    expect(mine.map((u) => u.id)).toContain(s.useId);
    const theirs = (await s.w.dana("/api/customer/uses")).body.uses as { id: string }[];
    expect(theirs.map((u) => u.id)).not.toContain(s.useId);
    const key = (
      s.w.state.store.db
        .prepare("SELECT idempotency_key FROM customer_requests WHERE id = ?")
        .get(s.useId) as { idempotency_key: string }
    ).idempotency_key;
    expect((await s.w.dana(`/api/customer/requests/by-key/${key}`)).status).toBe(404);
    expect((await s.cara(`/api/customer/requests/by-key/${key}`)).status).toBe(200);
  });

  it("a customer's agent grant can't be read or revoked by another customer", async () => {
    const s = await caraUse();
    const { ava, biz, offerId, cara, w } = s;
    expect(
      (
        await ava(`/api/businesses/${biz}/customer-offers/${offerId}/agent-access`, "PUT", {
          enabled: true,
        })
      ).status,
    ).toBe(200);
    const g = await cara("/api/customer/agent-grants", "POST", {
      offer_id: offerId,
      key_slot: 1,
      max_uses: 5,
      label: "Cara's agent",
    });
    expect(g.status).toBe(201);
    const id = g.body.grant.id as string;
    const list = (await w.dana("/api/customer/agent-grants")).body.grants as { id: string }[];
    expect(list.map((x) => x.id)).not.toContain(id);
    expect((await w.dana(`/api/customer/agent-grants/${id}/revoke`, "POST", {})).status).toBe(404);
    expect((await ava(`/api/customer/agent-grants/${id}/revoke`, "POST", {})).status).toBe(404);
  });

  it("a customer can't act on a business they never bought from", async () => {
    const s = await caraUse();
    // Dana has tokens but no entitlement on this offer: a prepare is refused, not admitted.
    const r = await s.w.dana(`/api/customer/offers/${s.offerId}/prepare`, "POST", {
      idempotency_key: "dana-never-bought-0001",
      input: "Fictional invoice from nobody",
    });
    expect(r.status).not.toBe(201);
  });
});
