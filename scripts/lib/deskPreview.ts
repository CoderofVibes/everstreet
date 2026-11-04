// Job 001c: the in-memory scenario behind scripts/preview-desk.ts, kept apart from any listener
// so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout. It is the operations preview (scripts/lib/
// operationsPreview.ts: recorded fictional customer uses, a worker run only by a control, contract
// fixture sale views, a preview-only synthetic signer). It adds, through the app's own routes, a
// second, brief-only product, an imported product and a configured legacy page offering for the
// same business; a brief-only founder; and a legacy class business. Nothing is backdated or
// invented as activity; nothing leaves this computer.

import { operationsPreview } from "./operationsPreview.ts";

export async function deskPreview() {
  const p = await operationsPreview();
  const { w } = p;
  const biz = `/api/businesses/${p.businessId}`;
  const ok = (what: string, r: { status: number }) => {
    if (r.status >= 300) throw new Error(`preview setup: ${what} ${r.status}`);
  };
  // The same business: a second product (a saved brief only), an imported product, and the
  // page's legacy offering, filled in as a founder would.
  ok(
    "second product",
    await w.owner("/api/product-projects", "POST", {
      idea: "A fictional agent that drafts replies to supplier emails",
      foundation: "agent_service",
      name: "Reply Drafter",
      business_id: p.businessId,
    }),
  );
  ok(
    "import",
    await w.owner("/api/imports", "POST", {
      idempotency_key: "desk-preview-import-0001",
      name: "Fictional receipts inbox",
      product_kind: "saas",
      business_id: p.businessId,
    }),
  );
  ok(
    "legacy offering",
    await w.owner(`${biz}/offer`, "PATCH", { title: "Invoice clean-up session, one hour" }),
  );
  // A brief-only founder.
  const bea = w.person("Bea Fictional");
  const brief = await bea("/api/product-projects", "POST", {
    idea: "A fictional client portal for a tutoring practice",
    foundation: "client_portal",
    name: "Tutor Portal",
  });
  ok("brief-only founder", brief);
  // A legacy class business.
  const dee = w.person("Dee Fictional");
  const start = await dee("/api/projects", "POST", { route: "idea", name: "Fictional Pottery" });
  ok("legacy business", start);
  const legacyId = start.body.business.id as string;
  ok("legacy family", await dee(`/api/businesses/${legacyId}`, "PATCH", { family: "class" }));
  ok(
    "legacy offer",
    await dee(`/api/businesses/${legacyId}/offer`, "PATCH", {
      title: "Wheel throwing for beginners",
    }),
  );

  return {
    ...p,
    people: { ...p.people, bea: bea.id, dee: dee.id },
    businesses: {
      digital: p.businessId,
      briefOnly: brief.body.project.business_id as string,
      legacy: legacyId,
    },
  };
}
