// Phase 3: paying for a place, refunds by the business's rule, a dropped connection that is
// reconciled without paying twice, delivery, and withdrawals that cannot touch customer money.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { FakeChain } from "./fake-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

function world() {
  const openseat = new OpenSeat({
    dbPath: ":memory:",
    authority: new TestDoubleAuthority("o.test", "o.test"),
  });
  const http = openSeatApp(openseat);
  const chain = new FakeChain();
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    bookingProvider: openSeatProvider((p, i) => Promise.resolve(http.request(p, i))),
    chain,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return as((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "");
  };
  return { chain, join, anon: as(""), store };
}

async function paidClass(
  w: ReturnType<typeof world>,
  opts: { startsInHours?: number; refundHours?: number; reserveCents?: number } = {},
) {
  const mara = await w.join("Mara Solis");
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults new to printmaking",
    outcome: "Make your first three linocut prints",
    deliverable: "90 minutes; three prints",
    price: "$35",
    when: "Saturdays",
    where: "14 Alder Lane",
    capacity: "2",
    confirmed: true,
  });
  await mara(`/api/businesses/${p.business.id}`, "PATCH", { family: "class" });
  await mara(`/api/businesses/${p.business.id}/publish`, "POST");
  const act = await mara(`/api/businesses/${p.business.id}/payments/activate`, "POST", {
    refund_hours: opts.refundHours ?? 24,
    reserve_cents: opts.reserveCents ?? 0,
  });
  expect(act.status).toBe(201);
  const starts = new Date(Date.now() + (opts.startsInHours ?? 72) * 3_600_000).toISOString();
  await mara(`/api/businesses/${p.business.id}/sessions`, "POST", {
    starts_at: starts,
    duration_minutes: 90,
    capacity: 2,
  });
  const page = (await w.anon(`/api/public/businesses/${p.business.slug}`)).body;
  return {
    mara,
    id: p.business.id as string,
    slug: p.business.slug as string,
    session: page.sessions[0].id as string,
    account: act.body.account_id as string,
    page,
  };
}

describe("paying for a place", () => {
  it("activates a business account owned by the founder's own account", async () => {
    const w = world();
    const { page, account } = await paidClass(w);
    expect(page.payments).toMatchObject({ account_id: account, refund_hours: 24 });
    expect(w.chain.businesses.get(account)?.owner).toMatch(/^p-mara-solis/);
  });

  it("holds the seat, takes the money once, and shows a receipt", async () => {
    const w = world();
    const b = await paidClass(w);
    const sam = await w.join("Sam Lee");
    expect((await sam(`/api/public/sessions/${b.session}/book`, "POST")).status).toBe(409);
    const paid = await sam(`/api/public/sessions/${b.session}/pay`, "POST", { source: "link" });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({
      status: "paid",
      amount_cents: 3500,
      refundable_now: true,
      business_account: b.account,
    });
    const wallet = (await sam("/api/wallet")).body.wallet;
    expect(wallet.balance_cents).toBe(20_000 - 3500);
    const activity = (await sam("/api/activity")).body.bookings[0];
    expect(activity).toMatchObject({ status: "confirmed", payment: { status: "paid" } });
    const money = (await b.mara(`/api/businesses/${b.id}/money`)).body;
    expect(money.treasury).toMatchObject({ customer_money: 3500, available: 0, withdrawable: 0 });
    expect(money.orders[0]).toMatchObject({ customer: "Sam Lee", status: "paid" });
  });

  it("reconciles a dropped connection from the chain instead of paying twice", async () => {
    const w = world();
    const b = await paidClass(w);
    const sam = await w.join("Sam Lee");
    w.chain.dropNextReply = "after-payment";
    const first = (await sam(`/api/public/sessions/${b.session}/pay`, "POST")).body;
    expect(first.status).toBe("unknown");
    const retried = (await sam(`/api/payments/${first.order_id}/retry`, "POST")).body;
    expect(retried.status).toBe("paid");
    expect((await sam("/api/wallet")).body.wallet.balance_cents).toBe(20_000 - 3500);
  });

  it("releases the seat when the payment never left", async () => {
    const w = world();
    const b = await paidClass(w);
    const sam = await w.join("Sam Lee");
    w.chain.dropNextReply = "before-payment";
    const first = (await sam(`/api/public/sessions/${b.session}/pay`, "POST")).body;
    expect(first.status).toBe("unknown");
    const checked = (await sam(`/api/payments/${first.order_id}/reconcile`, "POST")).body;
    // Unknown and fresh: we wait before releasing. A retry sends it with the same order id.
    expect(["unknown", "failed"]).toContain(checked.status);
    const retried = (await sam(`/api/payments/${first.order_id}/retry`, "POST")).body;
    expect(retried.status).toBe("paid");
    expect((await sam("/api/wallet")).body.wallet.balance_cents).toBe(20_000 - 3500);
  });

  it("refunds a cancellation inside the window and keeps one outside it", async () => {
    const w = world();
    const early = await paidClass(w, { startsInHours: 72, refundHours: 24 });
    const sam = await w.join("Sam Lee");
    await sam(`/api/public/sessions/${early.session}/pay`, "POST");
    const bookingId = (await sam("/api/activity")).body.bookings[0].id;
    const cancelled = (await sam(`/api/activity/bookings/${bookingId}/cancel`, "POST")).body;
    expect(cancelled).toMatchObject({ status: "cancelled", payment: { status: "refunded" } });
    expect((await sam("/api/wallet")).body.wallet.balance_cents).toBe(20_000);

    const w2 = world();
    const late = await paidClass(w2, { startsInHours: 10, refundHours: 24 });
    const ana = await w2.join("Ana Ruiz");
    const paid = (await ana(`/api/public/sessions/${late.session}/pay`, "POST")).body;
    expect(paid.refundable_now).toBe(false);
    const bid = (await ana("/api/activity")).body.bookings[0].id;
    const kept = (await ana(`/api/activity/bookings/${bid}/cancel`, "POST")).body;
    expect(kept.payment.status).toBe("kept");
    expect((await ana("/api/wallet")).body.wallet.balance_cents).toBe(20_000 - 3500);
  });

  it("turns delivered orders into money the founder can withdraw, never customer money", async () => {
    const w = world();
    const b = await paidClass(w, { reserveCents: 500 });
    const sam = await w.join("Sam Lee");
    const ana = await w.join("Ana Ruiz");
    const s = (await sam(`/api/public/sessions/${b.session}/pay`, "POST")).body;
    await ana(`/api/public/sessions/${b.session}/pay`, "POST");
    expect((await b.mara(`/api/businesses/${b.id}/withdraw`, "POST", { cents: 100 })).status).toBe(
      409,
    );
    await b.mara(`/api/payments/${s.order_id}/deliver`, "POST");
    const money = (await b.mara(`/api/businesses/${b.id}/money`)).body;
    expect(money.treasury).toMatchObject({
      customer_money: 3500,
      available: 3500,
      withdrawable: 3000,
    });
    const tooMuch = await b.mara(`/api/businesses/${b.id}/withdraw`, "POST", { cents: 3001 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toMatch(/Not allowed/);
    const ok = (await b.mara(`/api/businesses/${b.id}/withdraw`, "POST", { cents: 3000 })).body;
    expect(ok.treasury).toMatchObject({ available: 500, customer_money: 3500 });
    expect(ok.month).toMatchObject({ orders_in: 7000, earned: 3500, owner_withdrawals: 3000 });
    expect((await sam(`/api/payments/${s.order_id}/deliver`, "POST")).status).toBe(404);
  });

  it("does not offer a paid waitlist", async () => {
    const w = world();
    const b = await paidClass(w);
    for (const name of ["A One", "B Two"])
      await (await w.join(name))(`/api/public/sessions/${b.session}/pay`, "POST");
    const third = await (await w.join("C Three"))(`/api/public/sessions/${b.session}/pay`, "POST");
    expect(third.status).toBe(409);
    expect(third.body.error).toMatch(/full/i);
  });
});
