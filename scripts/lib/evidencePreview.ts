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
  return {
    ...p,
    people: { ...p.people, fennBuyer: noah.id, ruizBuyer: ana.id },
    teams: { fenn, ruiz },
    requests: { fenn: fennRequest, ruiz: ruizRequest },
    listing,
  };
}
