// Job 001d: the in-memory scenario behind scripts/preview-publication.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout. It is the operations preview (recorded fictional customer
// uses, contract fixture views, a preview-only signer). Through the app's own routes: Ava's digital
// business is taken down so its public profile starts from an empty draft (she drafts, reviews and
// publishes in the browser); Bea has a brief-only product (a coming-soon profile); Dee runs a
// legacy class business published the old way. Nothing is published outside this computer.

import type { Json } from "../../server/test/customer-world.ts";
import { operationsPreview } from "./operationsPreview.ts";

export async function publicationPreview() {
  const p = await operationsPreview();
  const { w } = p;
  const ok = (what: string, r: { status: number; body: Json }) => {
    if (r.status >= 300)
      throw new Error(`preview setup: ${what} ${r.status} ${r.body.error ?? ""}`);
    return r;
  };
  ok("take down", await w.owner(`/api/businesses/${p.businessId}/unpublish`, "POST"));
  const bea = w.person("Bea Fictional");
  const brief = ok(
    "brief-only founder",
    await bea("/api/product-projects", "POST", {
      idea: "A fictional client portal for a tutoring practice",
      foundation: "client_portal",
      name: "Tutor Portal",
    }),
  );
  const beaBusiness = brief.body.project.business_id as string;
  ok(
    "Bea's name",
    await bea(`/api/businesses/${beaBusiness}`, "PATCH", { name: "Tutor Portal Co" }),
  );
  const dee = w.person("Dee Fictional");
  const start = ok(
    "legacy business",
    await dee("/api/projects", "POST", { route: "idea", name: "Fictional Pottery" }),
  );
  const legacy = start.body.business.id as string;
  ok("legacy family", await dee(`/api/businesses/${legacy}`, "PATCH", { family: "class" }));
  ok(
    "legacy offer",
    await dee(`/api/businesses/${legacy}/offer`, "PATCH", {
      title: "Wheel throwing for beginners",
    }),
  );
  ok("legacy publish", await dee(`/api/businesses/${legacy}/publish`, "POST"));
  const slugOf = (id: string) =>
    (
      w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(id) as {
        slug: string;
      }
    ).slug;
  return {
    ...p,
    people: { ...p.people, bea: bea.id, dee: dee.id },
    businesses: { digital: p.businessId, briefOnly: beaBusiness, legacy },
    slugs: {
      digital: slugOf(p.businessId),
      briefOnly: slugOf(beaBusiness),
      legacy: slugOf(legacy),
    },
    projects: { digital: w.f.project, briefOnly: brief.body.project.id as string },
  };
}
