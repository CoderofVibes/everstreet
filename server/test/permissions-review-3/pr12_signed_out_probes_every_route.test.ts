// Promise 6: sign-in is checked before anything else. This composition connects no bookings, no
// payments and no deals; a signed-out probe of each private route must still be 401, never a 409
// that says what is connected, nor a 404 that says what is configured.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

const ID = "some-id";

describe("pr12 a signed-out visitor probes the private routes", () => {
  it("bookings, payments, deals, team, helping: 401 before the connection is considered", async () => {
    const r = await reviewWorld();
    const probes: [string, string][] = [
      ["GET", `/api/businesses/${ID}/sessions`],
      ["POST", `/api/businesses/${ID}/sessions`],
      ["POST", `/api/public/sessions/${ID}/book`],
      ["POST", `/api/activity/bookings/${ID}/cancel`],
      ["GET", `/api/activity/bookings/${ID}/calendar.ics`],
      ["GET", "/api/wallet"],
      ["POST", "/api/wallet"],
      ["POST", "/api/wallet/top-up"],
      ["POST", `/api/businesses/${ID}/payments/activate`],
      ["GET", `/api/businesses/${ID}/money`],
      ["POST", `/api/businesses/${ID}/withdraw`],
      ["POST", `/api/payments/${ID}/deliver`],
      ["POST", `/api/public/sessions/${ID}/pay`],
      ["GET", `/api/payments/${ID}`],
      ["POST", `/api/payments/${ID}/reconcile`],
      ["POST", `/api/payments/${ID}/retry`],
      ["GET", `/api/businesses/${ID}/team`],
      ["POST", `/api/businesses/${ID}/team`],
      ["DELETE", `/api/businesses/${ID}/team/${ID}`],
      ["GET", "/api/deals"],
      ["POST", `/api/businesses/${ID}/deals`],
      ["GET", `/api/businesses/${ID}/deals/snapshot`],
      ["GET", `/api/deals/${ID}`],
      ["POST", `/api/deals/${ID}/revise`],
      ["POST", `/api/deals/${ID}/fund`],
      ["POST", `/api/deals/${ID}/test-dollars`],
      ["POST", `/api/deals/${ID}/withdraw-hold`],
      ["POST", `/api/deals/${ID}/accept`],
      ["POST", `/api/deals/${ID}/cancel`],
      ["POST", `/api/deals/${ID}/claim`],
      ["POST", `/api/deals/${ID}/former-owner-check`],
      ["POST", `/api/deals/${ID}/items/${ID}`],
      ["GET", "/api/helping"],
      ["GET", `/api/helping/${ID}`],
      ["POST", `/api/helping/${ID}/inquiries/${ID}/reply`],
    ];
    const wrong: string[] = [];
    for (const [method, path] of probes) {
      const res = await r.anon(path, method, {});
      if (res.status !== 401)
        wrong.push(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("the sale, companion and intents routes: 401 with real ids and with missing ones", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    const prepared = (await r.c.prepare(r.ava, "allowance_approve", { invoice: "x" })).body;
    for (const id of [r.biz, ID]) {
      const probes: [string, string, unknown][] = [
        ["GET", `/api/sales/${id}`, undefined],
        ["GET", `/api/sales/${id}/economics`, undefined],
        ["GET", `/api/sales/${id}/intents`, undefined],
        ["POST", `/api/sales/${id}/intents/quote`, { token: r.ALT_TOKEN }],
        ["GET", `/api/sales/${id}/proof`, undefined],
        ["GET", `/api/sales/${id}/receipt`, undefined],
        ["POST", `/api/sales/${id}/prepare`, { kind: "fund", input: {} }],
        ["GET", `/api/companions/${id}`, undefined],
        ["POST", `/api/companions/${id}/prepare`, { kind: "feed_move", input: {} }],
        ["GET", `/api/businesses/${id}/companions`, undefined],
        ["GET", `/api/businesses/${id}/members`, undefined],
        ["GET", `/api/businesses/${id}/agent-access`, undefined],
      ];
      for (const [method, path, body] of probes) {
        const res = await r.anon(path, method, body);
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    }
    for (const id of [q.id, ID]) {
      expect((await r.anon(`/api/intents/${id}`)).status).toBe(401);
      expect(
        (await r.anon(`/api/intents/${id}/sign`, "POST", { public_key: "x", signature: "y" }))
          .status,
      ).toBe(401);
    }
    for (const id of [prepared.id ?? ID, ID]) {
      const res = await r.anon(`/api/companions/actions/${id}/sent`, "POST", {
        tx_hash: "4".repeat(44),
      });
      expect(res.status).toBe(401);
    }
  });

  it("an operator-only route the composition doesn't configure still says 401 first", async () => {
    const r = await reviewWorld();
    expect((await r.anon("/api/operator/writer-history")).status).toBe(401);
    expect((await r.anon("/api/operator/writer-history/check", "POST", {})).status).toBe(401);
  });
});
