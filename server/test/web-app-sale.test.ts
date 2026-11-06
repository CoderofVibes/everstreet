// Job 006a (WEB_APP_RELEASE.md §6): a released web app through a Direct sale, over the same
// synthetic state as the sale journey (sale-world.ts, `quote-app`): customers buy 7-day passes
// before the close (each charged when access starts), the existing reconciliation moves the
// business, and then the seller can't release or withdraw, the buyer administers the app, the
// next pass is served under the buyer, and a pass bought before the sale keeps its pinned release
// at the same address. A labelled stand-in release (test double check); fictional data.

import { describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

describe("006a a released web app through a sale", () => {
  it("passes survive the close; the seller is refused, the buyer administers", async () => {
    const s = await saleWorld({ product: "quote-app" });
    const project = s.w.f.project;
    const passUrl = async (id: string) =>
      (await s.cara(`/api/customer/uses/${id}/result`)).body.result.url as string;
    const open = async (url: string) => {
      const r = await s.w.state.app.request(url.replace(/^https?:\/\/[^/]+/, ""));
      return { status: r.status, text: await r.text() };
    };

    // Before the sale: the seller's own release, and two passes (the agreed floor).
    expect(
      (await s.act(s.ava, SELLER, "propose", proposal({ floor: "100000" }))).check,
    ).toBeTruthy();
    expect((await s.act(s.noah, BUYER, "register")).check?.body.resolution.kind).toBe("confirmed");
    expect((await s.act(s.noah, BUYER, "fund")).check?.body.resolution.kind).toBe("confirmed");
    const first = await s.customerUse();
    expect(first.unit).toBe("charged");
    expect((await s.customerUse()).unit).toBe("charged");
    const url = await passUrl(first.id as string);
    expect((await open(url)).status).toBe(200);

    expect((await s.act(s.noah, BUYER, "accept")).check?.body.resolution.kind).toBe("confirmed");
    const close = await s.act(s.ava, SELLER, "accept");
    expect(close.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
    expect(close.check?.body.effects).toMatchObject({ reconcile: { state: "applied" } });

    // The seller can't administer the app any more.
    const seller = await s.ava(`/api/product-projects/${project}/releases/withdraw`, "POST", {});
    expect(seller.status).toBe(404);
    // The buyer sees the same release and address; the next pass is served under the buyer.
    const view = (await s.noah(`/api/product-projects/${project}/releases`)).body as Json;
    expect(view.active.app_terms).toMatchObject({ access: "pass", pass_days: 7 });
    expect(view.active.stand_in).toBe(true);
    const after = await s.customerUse();
    expect(after.unit).toBe("charged");
    expect((await open(await passUrl(after.id as string))).status).toBe(200);
    // The pass bought before the sale still opens the app, at the same private address.
    expect((await open(url)).status).toBe(200);
    // The buyer withdraws: new passes stop; started ones keep their pinned release.
    const gone = await s.noah(`/api/product-projects/${project}/releases/withdraw`, "POST", {});
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect((await s.customerUse()).status).toBe(409);
    expect((await open(url)).status).toBe(200);
  });
});
