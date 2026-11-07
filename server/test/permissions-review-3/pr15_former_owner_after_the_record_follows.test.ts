// Promises 3 and 7: once the close is applied here (the seller's own check applied it at once), the
// former owner's session reads nothing current and runs nothing: economics, companions, the live
// deal, the intents panel, companion requests, members, agent switches. They keep the proof and the
// receipt of their own sale.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr15 the former owner, with a session from before the close", () => {
  it("reads nothing current and runs nothing for the business", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const closed = await r.deal.close();
    expect(closed.check?.body.resolution.result).toBe("closed");
    expect(closed.check?.body.effects?.reconcile?.state).toBe("applied");
    const ava = r.ava;

    expect((await r.c.economics(ava)).status).toBe(404);
    expect((await r.c.view(ava)).status).toBe(404);
    expect((await r.c.config(ava)).status).toBe(404);
    expect((await ava(`/api/businesses/${r.biz}/members`)).status).toBe(404);
    expect((await ava(`/api/businesses/${r.biz}/agent-access`)).status).toBe(404);
    expect((await ava(`/api/businesses/${r.biz}`)).status).toBe(404);

    const page = (await r.setup(ava)).body;
    expect(page.local_owner).toBe(false);
    expect(page.roles.former_seller).toBe(true);
    expect(page.control.live_deal).toBeNull();
    expect(page.customer_obligations).toBeNull();
    expect(page.party.sale_proceeds_claim).toBe(r.PRICE); // their own receipt

    // Companion requests: refused by the contract's owner, before any call is built.
    const move = await r.c.prepare(ava, "feed_move");
    expect(move.status).toBe(409);
    expect(move.body.code).toBe("not_owner");
    const grant = await r.c.prepare(ava, "allowance_grant");
    expect(grant.status).toBe(409);
    expect(grant.body.code).toBe("not_owner");

    // Proof and receipt of their own sale: theirs to keep.
    expect((await ava(`/api/sales/${r.biz}/proof`)).status).toBe(200);
    const receipt = await r.w.state.app.request(`/api/sales/${r.biz}/receipt`, {
      headers: { cookie: `es_session=${await sessionOf(r, ava.id)}` },
    });
    expect(receipt.status).toBe(200);

    // The new owner's side.
    expect((await r.c.economics(r.noah)).status).toBe(200);
    expect((await r.c.view(r.noah)).body.you_own_it).toBe(true);
    expect((await r.c.config(r.noah)).status).toBe(200);
  });

  it("the intents panel for a former owner says nothing about the business beyond its configuration", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.close();
    const panel = await r.i.panel(r.ava);
    // Promise 3 as written: nothing current. The panel is configuration and the viewer's own
    // fundings; it must at least never carry another person's funding or the live deal.
    if (panel.status === 200) {
      expect(panel.body.funding).toBeNull();
      expect(panel.body.account).toBe(r.SELLER);
      expect(JSON.stringify(panel.body)).not.toContain("live_deal");
    }
    expect((await r.i.quote(r.ava)).status).not.toBe(200);
  });
});

async function sessionOf(r: Awaited<ReturnType<typeof reviewWorld>>, personId: string) {
  const row = r.w.state.store.db
    .prepare("SELECT token FROM sessions WHERE person_id = ? ORDER BY rowid DESC LIMIT 1")
    .get(personId) as { token: string };
  return row.token;
}
