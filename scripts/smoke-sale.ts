// A real testnet run of a sale through Everstreet's own API and the same NearChain the app uses,
// with fresh fictional people and a fresh business (v2 shared code, no keys). Writes
// data/evidence/sale-testnet.json.
//
//   npm run smoke:sale                  the whole sale, start to proceeds
//   npm run smoke:sale -- --until-access stop once the buyer team has access (for a UI run)
//
// The run keeps its own databases in data/runtime/sale-smoke*.db so the local app's data is
// untouched; `PORT=8801 EVERSTREET_DB=data/runtime/sale-smoke.db OPENSEAT_DB=data/runtime/sale-smoke-openseat.db npm run serve`
// opens them.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { everstreetApi } from "../server/src/app.ts";
import { openSeatProvider } from "../server/src/bookings.ts";
import { NearChain } from "../server/src/chain.ts";
import { openDb } from "../server/src/db.ts";
import { Store } from "../server/src/store.ts";
import { TestDoubleAuthority } from "../services/openseat/src/authority.ts";
import { openSeatApp } from "../services/openseat/src/http.ts";
import { OpenSeat } from "../services/openseat/src/service.ts";

const untilAccess = process.argv.includes("--until-access");
const chain = NearChain.fromLocalConfig();
if (!chain) {
  console.error("No testnet config or root key on this computer.");
  process.exit(1);
}
const DB = "data/runtime/sale-smoke.db";
const SEATS = "data/runtime/sale-smoke-openseat.db";
for (const f of [DB, SEATS]) for (const x of ["", "-wal", "-shm"]) rmSync(f + x, { force: true });
mkdirSync("data/runtime", { recursive: true });

const openseat = new OpenSeat({
  dbPath: SEATS,
  authority: new TestDoubleAuthority("smoke", "smoke"),
});
const http = openSeatApp(openseat);
const store = new Store(openDb(DB));
const app = everstreetApi(store, {
  localPreview: true,
  environment: "Sale smoke run",
  bookingProvider: openSeatProvider((p, i) => Promise.resolve(http.request(p, i))),
  chain,
});

// biome-ignore lint/suspicious/noExplicitAny: a script reading API responses
type Json = Record<string, any>;
const steps: { step: string; ok: boolean; observed: string; url?: string }[] = [];
function record(step: string, ok: boolean, observed: string, url?: string | null) {
  steps.push({ step, ok, observed, ...(url ? { url } : {}) });
  console.log(`${ok ? "✓" : "✗"} ${step}: ${observed}${url ? `\n    ${url}` : ""}`);
  if (!ok) finish(1);
}
function finish(code: number) {
  if (!untilAccess) {
    mkdirSync("data/evidence", { recursive: true });
    writeFileSync(
      "data/evidence/sale-testnet.json",
      `${JSON.stringify({ kind: "sale-evidence/v1", network: "testnet", token: chain?.token, at: new Date().toISOString(), steps }, null, 2)}\n`,
    );
  }
  openseat.db.close();
  process.exit(code);
}
const join = async (name: string) => {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const id = ((await res.json()) as Json).person.id as string;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Json };
  };
  return Object.assign(call, { id });
};
const lastTx = (v: Json, kind: string) =>
  [...(v.steps as Json[])].reverse().find((s) => s.kind === kind)?.tx_url as string | undefined;

// A small fictional pottery studio with payments on and two paid places before any sale.
const june = await join("June Okafor");
const p = (await june("/api/projects", "POST", { route: "started", name: "Kiln Lane Pottery" }))
  .body;
const id = p.business.id as string;
await june(`/api/projects/${p.id}/answers`, "PATCH", {
  audience: "Adults who want to try the wheel",
  outcome: "Two pots of your own, glazed and fired",
  deliverable: "Two hours at the wheel",
  price: "$35",
  when: "Sundays",
  where: "3 Kiln Lane (fictional)",
  capacity: "6",
  confirmed: true,
});
await june(`/api/businesses/${id}`, "PATCH", { family: "class" });
await june(`/api/businesses/${id}/publish`, "POST");
const act = await june(`/api/businesses/${id}/payments/activate`, "POST", {
  refund_hours: 24,
  reserve_cents: 0,
});
record(
  "business account",
  act.status === 201,
  `${act.body.account_id}, owned by June's own account`,
  act.body.explorer,
);
for (const days of [3, 10])
  await june(`/api/businesses/${id}/sessions`, "POST", {
    starts_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    duration_minutes: 120,
    capacity: 6,
  });
const page = (await june(`/api/public/businesses/${p.business.slug}`)).body;
const pat = await join("Pat Rivera");
const orders: Json[] = [];
for (const s of page.sessions as Json[]) {
  const o = (await pat(`/api/public/sessions/${s.id}/pay`, "POST", { source: "link" })).body;
  orders.push(o);
  record(
    "customer pays before the sale",
    o.status === "paid",
    `Pat paid $35 for ${s.starts_at.slice(0, 10)}`,
    o.tx_url,
  );
}

// A co-op of regulars asks for access; June appoints a helper (who must lose authority at close).
const lena = await join("Lena Park");
const dev = await join("Dev Shah");
const coop = (
  await lena("/api/acquire/buyers", "POST", {
    name: "Kiln Lane Regulars Co-op",
    kind: "cooperative",
    intent: "team",
    about: "Regulars who'd keep the Sunday classes going.",
  })
).body.buyer.id as string;
await lena(`/api/acquire/buyers/${coop}/members`, "POST", { person_id: dev.id, role: "research" });
const helper = await june(`/api/businesses/${id}/team`, "POST", { person_id: dev.id });
record(
  "helper appointed before the sale",
  helper.status === 201,
  "Dev may answer customers and mark orders delivered",
  helper.body.team?.[0]?.appointed_url,
);
await june(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] });
const listing = (await lena("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
  .listing_id;
const req = (
  await lena(`/api/acquire/listings/${listing}/requests`, "POST", {
    buyer_id: coop,
    categories: ["financials", "operations"],
    purpose: "Could the co-op keep these classes running?",
    days: 7,
  })
).body.request;
await june(`/api/acquire/requests/${req.id}/decide`, "POST", { action: "grant" });
record("buyer team has access", true, "Kiln Lane Regulars Co-op (Lena accepts for the team)");
if (untilAccess) {
  console.log(
    `\nReady for a UI run. Business ${id}; people: June Okafor (seller), Lena Park (buyer), Dev Shah, Pat Rivera.`,
  );
  finish(0);
}

// Terms, a revision that clears acceptances, and the close.
const v1 = (
  await june(`/api/businesses/${id}/deals`, "POST", {
    buyer_id: coop,
    price_cents: 50_000,
    days: 7,
    handover: "Two Sundays teaching alongside the new owner",
  })
).body;
const dealId = v1.deal.id as string;
record(
  "terms proposed (v1)",
  v1.chain?.matches_terms === true,
  `$500; the contract holds the same terms fingerprint`,
  lastTx(v1, "proposed"),
);
await lena(`/api/deals/${dealId}/test-dollars`, "POST");
const funded1 = (await lena(`/api/deals/${dealId}/fund`, "POST")).body;
record(
  "buyer funds v1",
  funded1.chain?.funded === true,
  "$500 held by the contract for this deal",
  lastTx(funded1, "funded"),
);
const s1 = (await june(`/api/deals/${dealId}/accept`, "POST", { digest: v1.deal.digest })).body;
record(
  "seller accepts v1",
  s1.chain?.seller_accepted === true,
  "June's acceptance of v1 recorded",
  lastTx(s1, "seller_accepted"),
);
const v2 = (
  await june(`/api/deals/${dealId}/revise`, "POST", {
    price_cents: 45_000,
    days: 7,
    handover: "Two Sundays teaching alongside the new owner",
  })
).body;
record(
  "seller revises (v2)",
  v2.deal.version === 2 && v2.chain.seller_accepted === false && v2.chain.funded === false,
  `Price $500 → $450; both acceptances cleared; the $500 hold no longer matches`,
  lastTx(v2, "revised"),
);
const stale = await lena(`/api/deals/${dealId}/accept`, "POST", { digest: v1.deal.digest });
const staleView = (await lena(`/api/deals/${dealId}`)).body;
record(
  "buyer can't accept the old version",
  stale.status === 409,
  `Refused by the contract: ${stale.body.error}`,
  lastTx(staleView, "buyer_accepted"),
);
const back = (await lena(`/api/deals/${dealId}/withdraw-hold`, "POST")).body;
record(
  "buyer takes the old hold back",
  back.chain?.held_cents === 0,
  "$500 back in Lena's account",
  lastTx(back, "hold_withdrawn"),
);
const funded2 = (await lena(`/api/deals/${dealId}/fund`, "POST")).body;
record("buyer funds v2", funded2.chain?.funded === true, "$450 held", lastTx(funded2, "funded"));
const b2 = (await lena(`/api/deals/${dealId}/accept`, "POST", { digest: v2.deal.digest })).body;
record(
  "buyer accepts v2",
  b2.chain?.buyer_accepted === true && b2.deal.status === "open",
  "Waiting for the seller",
  lastTx(b2, "buyer_accepted"),
);
const closed = (await june(`/api/deals/${dealId}/accept`, "POST", { digest: v2.deal.digest })).body;
record(
  "seller accepts v2: the sale closes",
  closed.deal.status === "closed",
  `Control at generation ${closed.deal.generation_after}; proceeds $${(closed.proceeds?.held_cents ?? 0) / 100} held for June`,
  closed.deal.close_tx_url,
);
const twice = await june(`/api/deals/${dealId}/accept`, "POST", { digest: v2.deal.digest });
record("it can't close twice", twice.status === 409, twice.body.error);

// After the close.
const shift = (await lena(`/api/deals/${dealId}`)).body.first_shift;
record(
  "the buyer controls it on NEAR",
  shift.control?.is_buyer === true,
  `Owner ${shift.control?.owner} at generation ${shift.control?.generation}, ${shift.control?.operators} helpers`,
);
record(
  "customer money stayed with the business",
  shift.customer_money.in_terms === shift.customer_money.now,
  `In the terms ${shift.customer_money.in_terms}; now ${shift.customer_money.now}`,
);
const check = (await june(`/api/deals/${dealId}/former-owner-check`, "POST")).body.check;
record(
  "the former owner is refused",
  check.refused === true && /E_NOT_OWNER/.test(check.error ?? ""),
  check.error?.replace(/^Smart contract panicked: /, ""),
  `${chain.explorer}/txns/${check.tx}`,
);
const devCheck = await chain.operatorCheck(
  closed.deal.business.account,
  (await dev("/api/wallet")).body.wallet.account_id,
  "fulfillment",
);
record(
  "the old helper is refused",
  devCheck.authorized === false,
  `operator_check: ${devCheck.reason} (generation ${devCheck.generation})`,
);
const delivered = await lena(`/api/payments/${orders[0]?.order_id}/deliver`, "POST");
record(
  "the new owner serves a pre-sale customer",
  delivered.status === 200,
  "Pat's first session marked delivered by Lena",
  delivered.body.orders?.find((o: Json) => o.order_id === orders[0]?.order_id)?.deliver_tx_url ??
    null,
);
const refund = await pat(`/api/activity/bookings/${orders[1]?.booking_id}/cancel`, "POST");
record(
  "a pre-sale customer's refund right survives",
  refund.status === 200,
  "Pat cancelled the second session and the contract refunded $35 under the rules June set",
  refund.body.payment?.refund_tx_url ?? null,
);
const pubPage = (await pat(`/api/public/businesses/${p.business.slug}`)).body;
record(
  "the public page shows the change of hands",
  pubPage.history?.length === 1 && pubPage.founder.display_name === "Lena Park",
  `${pubPage.history?.[0]?.from} → ${pubPage.history?.[0]?.team}`,
);
const before = (await june("/api/wallet")).body.wallet.balance_cents;
const claimed = (await june(`/api/deals/${dealId}/claim`, "POST")).body;
const after = (await june("/api/wallet")).body.wallet.balance_cents;
record(
  "the seller claims proceeds",
  claimed.proceeds?.held_cents === 0 && after - before === 45_000,
  `$450 arrived in June's account`,
  claimed.proceeds?.claim_tx_url,
);
finish(0);
