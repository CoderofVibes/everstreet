// Promise 1 and 4: after the sale closes, the former owner's reads and writes stop, including the
// companions' owner pages; a past participant keeps only their own receipts.
import { describe, expect, it } from "vitest";
import { reviewWorld, SELLER } from "./world.ts";

const ownerReads = (biz: string, project: string) => [
  `/api/businesses/${biz}`,
  `/api/businesses/${biz}/customer-offers`,
  `/api/businesses/${biz}/members`,
  `/api/businesses/${biz}/agent-purchases`,
  `/api/businesses/${biz}/agent-access`,
  `/api/businesses/${biz}/v3`,
  `/api/businesses/${biz}/v3/intents`,
  `/api/businesses/${biz}/books`,
  `/api/businesses/${biz}/economics`,
  `/api/businesses/${biz}/digital-desk`,
  `/api/businesses/${biz}/value`,
  `/api/businesses/${biz}/workflow-cases`,
  `/api/businesses/${biz}/rehearsals`,
  `/api/businesses/${biz}/control-sheet`,
  `/api/businesses/${biz}/handover-record`,
  `/api/businesses/${biz}/imports`,
  `/api/businesses/${biz}/listing`,
  `/api/businesses/${biz}/listing/summary`,
  `/api/businesses/${biz}/public-profile`,
  `/api/businesses/${biz}/build-budget`,
  `/api/businesses/${biz}/runtime-budget`,
  `/api/businesses/${biz}/customer-offer-readiness`,
  `/api/businesses/${biz}/customer-access`,
  `/api/businesses/${biz}/extras`,
  `/api/product-projects/${project}`,
  `/api/product-projects/${project}/releases`,
  `/api/product-projects/${project}/runtime`,
  `/api/product-projects/${project}/conversation`,
  `/api/product-projects/${project}/app-versions`,
  `/api/product-projects/${project}/builds`,
  `/api/product-projects/${project}/evaluations`,
  `/api/product-projects/${project}/test-cases`,
];

describe("pr04: the former owner after the close", () => {
  it("every owner read and write answers 404 to the seller once the sale is applied", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    await w.fundAndClose();
    const owner = (
      w.w.state.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(w.biz) as {
        owner_id: string;
      }
    ).owner_id;
    expect(owner).toBe(w.noah.id);
    expect(w.control().owner).toBe("buyer.near");
    const failures: string[] = [];
    for (const path of ownerReads(w.biz, w.w.f.project)) {
      const r = await w.ava(path);
      if (r.status !== 404) failures.push(`GET ${path} -> ${r.status}`);
      const n = await w.noah(path);
      if (n.status >= 500) failures.push(`new owner GET ${path} -> ${n.status}`);
    }
    const writes: [string, string, unknown][] = [
      ["PATCH", `/api/businesses/${w.biz}`, { name: "Taken back" }],
      ["PATCH", `/api/businesses/${w.biz}/offer`, { title: "x" }],
      ["POST", `/api/businesses/${w.biz}/publish`, {}],
      ["POST", `/api/businesses/${w.biz}/unpublish`, {}],
      ["POST", `/api/businesses/${w.biz}/members`, { person_id: w.cara.id, role: "viewer" }],
      ["POST", `/api/businesses/${w.biz}/updates`, { body: "still here" }],
      ["POST", `/api/businesses/${w.biz}/costs`, { category: "Hosting", amount_cents: 1 }],
      ["PUT", `/api/businesses/${w.biz}/build-budget`, { limit_cents: 1 }],
      ["PUT", `/api/businesses/${w.biz}/runtime-budget`, { limit_cents: 1 }],
      ["POST", `/api/businesses/${w.biz}/v3/refresh`, {}],
      ["POST", `/api/businesses/${w.biz}/rehearsals`, {}],
      ["PATCH", `/api/businesses/${w.biz}/listing`, { mode: "named" }],
      ["PUT", `/api/businesses/${w.biz}/public-profile/draft`, { base_rev: 0, draft: {} }],
      ["POST", `/api/product-projects/${w.w.f.project}/releases/withdraw`, {}],
      ["POST", `/api/businesses/${w.biz}/customer-offers/${w.offerId}/retire`, {}],
      [
        "PUT",
        `/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`,
        { enabled: true },
      ],
    ];
    for (const [method, path, body] of writes) {
      const r = await w.ava(path, method, body);
      if (r.status !== 404) failures.push(`${method} ${path} -> ${r.status} ${r.body.code ?? ""}`);
    }
    expect(failures).toEqual([]);
  });

  it("the former owner can't prepare a companion request; the chain owner decides", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    await w.fundAndClose();
    const r = await w.ava(`/api/companions/${w.biz}/prepare`, "POST", {
      kind: "allowance_grant",
      input: {},
    });
    expect([404, 409]).toContain(r.status);
    expect(r.body.code === "not_owner" || r.status === 404).toBe(true);
    // The new owner can.
    const n = await w.noah(`/api/companions/${w.biz}/prepare`, "POST", {
      kind: "allowance_grant",
      input: {},
    });
    expect(n.status, JSON.stringify(n.body)).toBe(200);
    expect(n.body.call.receiverId).toBe(w.BUDGET);
  });

  it("the former owner no longer reads the business's economics or companions", async () => {
    const w = await reviewWorld();
    // Some operating history before the sale, and a supplier payment matched to a use.
    const use = await w.customerUse();
    expect(use.unit).toBe("charged");
    w.companions.allowance.pay(w.AGENT, w.SUPPLIER, 900_000n, w.sha(`supplier-invoice-${use.id}`));
    await w.proposeAndRegister();
    await w.fundAndClose();
    // Operations continue under the buyer.
    const later = await w.customerUse();
    expect(later.unit).toBe("charged");
    const econ = await w.ava(`/api/sales/${w.biz}/economics`);
    expect(econ.status, JSON.stringify(econ.body)).toBe(404);
    const comp = await w.ava(`/api/companions/${w.biz}`);
    expect(comp.status, JSON.stringify(comp.body)).toBe(404);
    // The new owner reads both.
    expect((await w.noah(`/api/sales/${w.biz}/economics`)).status).toBe(200);
    expect((await w.noah(`/api/companions/${w.biz}`)).status).toBe(200);
  });

  it("a buyer whose deal was cancelled no longer reads economics or companions", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    // While the deal is live the named buyer may check the economics.
    expect((await w.noah(`/api/sales/${w.biz}/economics`)).status).toBe(200);
    const cancelled = await w.act(w.ava, SELLER, "cancel");
    expect(cancelled.check?.body.resolution?.kind).toBe("confirmed");
    const econ = await w.noah(`/api/sales/${w.biz}/economics`);
    expect(econ.status, JSON.stringify(econ.body)).toBe(404);
    const comp = await w.noah(`/api/companions/${w.biz}`);
    expect(comp.status, JSON.stringify(comp.body)).toBe(404);
  });

  it("the sale page shows a former seller nothing current", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    await w.fundAndClose();
    const page = await w.ava(`/api/sales/${w.biz}`);
    expect(page.status).toBe(200);
    expect(page.body.local_owner).toBe(false);
    expect(page.body.roles.former_seller).toBe(true);
    expect(page.body.control.live_deal).toBeNull();
    expect(page.body.customer_obligations).toBeNull();
  });
});
