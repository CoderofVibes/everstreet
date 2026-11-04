// Job 003u: the in-memory scenario behind scripts/preview-evidence.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout. It is the operations preview (recorded fictional customer
// uses, a worker run only by a control, contract fixture sale views, a preview-only signer). Through
// the app's own routes it publishes the business, lists it privately to two fictional buying teams,
// and has each team ask for evidence: Fenn Holdings asks for digital performance, Ruiz Ventures asks
// only for financials. Both requests are left pending: the owner decides in the browser. No buyer is
// contacted and nothing leaves this computer.

import type { Json } from "../../server/test/customer-world.ts";
import { operationsPreview } from "./operationsPreview.ts";

export async function evidencePreview() {
  const p = await operationsPreview();
  const { w } = p;
  const biz = `/api/businesses/${p.businessId}`;
  const ok = (what: string, r: { status: number; body: Json }) => {
    if (r.status >= 300)
      throw new Error(`preview setup: ${what} ${r.status} ${r.body.error ?? ""}`);
    return r;
  };
  // Publishing still asks for the page's (legacy) offering title.
  ok("offer title", await w.owner(`${biz}/offer`, "PATCH", { title: "Invoice rows, per use" }));
  ok("publish", await w.owner(`${biz}/publish`, "POST"));
  const noah = w.person("Noah Fenn (buyer)");
  const ana = w.person("Ana Ruiz (buyer)");
  const team = async (who: typeof noah, name: string) =>
    ok(
      `team ${name}`,
      await who("/api/acquire/buyers", "POST", { name, kind: "individual", intent: "operate" }),
    ).body.buyer.id as string;
  const fenn = await team(noah, "Fenn Holdings");
  const ruiz = await team(ana, "Ruiz Ventures");
  ok(
    "listing",
    await w.owner(`${biz}/listing`, "PATCH", { mode: "private", invites: [fenn, ruiz] }),
  );
  const listing = (
    w.state.store.db.prepare("SELECT id FROM listings WHERE business_id = ?").get(p.businessId) as {
      id: string;
    }
  ).id;
  const ask = async (who: typeof noah, buyer: string, categories: string[]) =>
    ok(
      "request",
      await who(`/api/acquire/listings/${listing}/requests`, "POST", {
        buyer_id: buyer,
        categories,
        purpose: "Check how the invoice service is used before we talk price",
        days: 7,
      }),
    ).body.request.id as string;
  const fennRequest = await ask(noah, fenn, ["financials", "digital_performance"]);
  const ruizRequest = await ask(ana, ruiz, ["financials"]);
  // Job 003u2: a third team asks only for the older customers summary (left pending too).
  const cole = w.person("Cole Marsh (buyer)");
  const marsh = await team(cole, "Marsh Partners");
  ok(
    "listing",
    await w.owner(`${biz}/listing`, "PATCH", { mode: "private", invites: [fenn, ruiz, marsh] }),
  );
  const marshRequest = await ask(cole, marsh, ["customers"]);

  // Job 003u2: fictional stored payment rows for the customers summary (no chain, no money; the
  // same rows Astra's probe seeded). Replaces any earlier fixture rows.
  const db = w.state.store.db;
  const shoppers = ["Dee", "Eli", "Fay", "Gus", "Hal", "Ivy"].map((n) =>
    w.person(`${n} (shopper)`),
  );
  const SHAPES = {
    // Astra's counterexample: one customer, 3 delivered and 1 refunded.
    small: [
      [0, "delivered"],
      [0, "delivered"],
      [0, "delivered"],
      [0, "refunded"],
    ],
    // Every group 0 or at least 3: 6 customers, 9 orders, 6 delivered, 3 refunded.
    large: [
      [0, "delivered"],
      [1, "delivered"],
      [2, "refunded"],
      [3, "delivered"],
      [3, "delivered"],
      [4, "delivered"],
      [4, "refunded"],
      [5, "delivered"],
      [5, "refunded"],
    ],
    none: [],
  } as const;
  const legacyPayments = (shape: keyof typeof SHAPES) => {
    db.prepare("DELETE FROM payments WHERE order_id LIKE 'preview-legacy-%'").run();
    const t = new Date().toISOString();
    SHAPES[shape].forEach(([who, status], i) => {
      db.prepare(
        "INSERT INTO payments (order_id, person_id, business_id, session_id, amount_cents, status, cancel_before, created_at, updated_at) VALUES (?, ?, ?, 'preview-session', 3500, ?, ?, ?, ?)",
      ).run(`preview-legacy-${i}`, shoppers[who]?.id ?? "", p.businessId, status, t, t, t);
    });
    return { shape, rows: SHAPES[shape].length };
  };
  legacyPayments("small");

  return {
    ...p,
    people: { ...p.people, fennBuyer: noah.id, ruizBuyer: ana.id, marshBuyer: cole.id },
    teams: { fenn, ruiz, marsh },
    requests: { fenn: fennRequest, ruiz: ruizRequest, marsh: marshRequest },
    listing,
    legacyPayments,
    legacyShapes: Object.keys(SHAPES) as (keyof typeof SHAPES)[],
  };
}
