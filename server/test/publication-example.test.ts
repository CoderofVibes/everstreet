// Job 001e: the owner-written illustrative example. Deliberate, bounded plain text for a featured
// product; saved, reviewed and published under 001d1's exact review rules; draft edits stay
// private; removing it and publishing takes it down; never filled from customer or private data.
// Real routes; fictional content; finite.

import { describe, expect, it } from "vitest";
import { EXAMPLE_LABEL } from "../src/publication.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";

const BASE = {
  headline: "Clean rows from supplier invoices",
  summary: "Upload a fictional supplier invoice and get its fields back as clean rows.",
  audience: "Bookkeepers at small fictional firms",
  capabilities: ["Reads invoice numbers, dates and totals"],
};
const EXAMPLE_INPUT = "Fictional invoice NB-7 from Northbeam Paper Co, 2026-09-30, total 88.20 USD";
const OUTPUTS = [
  { label: "Invoice number", value: "NB-7" },
  { label: "Supplier", value: "Northbeam Paper Co" },
  { label: "Total", value: "88.20 USD" },
];

async function world() {
  const t = await maintenanceWorld();
  const biz = `/api/businesses/${t.w.f.business}`;
  await t.w.owner(biz, "PATCH", { name: "Ledgerline Invoice Reader" });
  const slug = (
    t.w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(t.w.f.business) as {
      slug: string;
    }
  ).slug;
  const save = (base_rev: number, draft: Json) =>
    t.w.owner(`${biz}/public-profile/draft`, "PUT", { base_rev, draft });
  const publishCurrent = async () => {
    const v = (await t.w.owner(`${biz}/public-profile`)).body as Json;
    return t.w.owner(`${biz}/public-profile/publish`, "POST", {
      draft_rev: v.draft_rev,
      review: v.review,
    });
  };
  const page = () => t.w.cara(`/api/public/businesses/${slug}`);
  const draft = (example: Json | null) => ({
    ...BASE,
    products: [t.w.f.project],
    example,
  });
  return { t, biz, slug, save, publishCurrent, page, draft };
}

describe("001e an example is deliberate, reviewed and published exactly", () => {
  it("publishes with its product's reviewed name and the illustrative label; draft edits stay private; removal withdraws it", async () => {
    const x = await world();
    const ex = { product: x.t.w.f.project, input: EXAMPLE_INPUT, outputs: OUTPUTS };
    const saved = await x.save(0, x.draft(ex));
    expect(saved.status).toBe(200);
    expect(saved.body.preview.example).toEqual({
      product_name: "Invoice reader",
      input: EXAMPLE_INPUT,
      outputs: OUTPUTS,
      label: EXAMPLE_LABEL,
    });
    expect((await x.publishCurrent()).status).toBe(200);
    const live = (await x.page()).body.digital as Json;
    expect(live.example.input).toBe(EXAMPLE_INPUT);
    expect(live.example.label).toMatch(/Not a live run/);
    expect(JSON.stringify(live.example)).not.toContain(x.t.w.f.project);
    // A draft edit stays private until published.
    await x.save(1, x.draft({ ...ex, input: "Fictional invoice CHANGED-1 total 1.00 USD" }));
    expect((await x.page()).body.digital.example.input).toBe(EXAMPLE_INPUT);
    // Removing it and publishing takes it down.
    await x.save(2, x.draft(null));
    expect((await x.publishCurrent()).status).toBe(200);
    expect((await x.page()).body.digital.example).toBeNull();
  });

  it("without an example nothing is invented, even with customer uses on record", async () => {
    const x = await world();
    await x.t.prepare(x.t.w.cara, "example-key-0001", "Fictional invoice CANARY-CUSTOMER-DOC");
    await x.save(0, x.draft(null));
    await x.publishCurrent();
    const page = JSON.stringify((await x.page()).body);
    expect((await x.page()).body.digital.example).toBeNull();
    expect(page).not.toContain("CANARY-CUSTOMER-DOC");
    expect(page).not.toContain("Stackline"); // the fixture's invoice text, never copied in
  });

  it("is bounded plain text for a featured product", async () => {
    const x = await world();
    const ok = { product: x.t.w.f.project, input: EXAMPLE_INPUT, outputs: OUTPUTS };
    const bad = async (example: Json) => (await x.save(0, x.draft(example))).status;
    expect(await bad({ ...ok, input: "x".repeat(1201) })).toBe(400);
    expect(await bad({ ...ok, input: "   " })).toBe(400);
    expect(await bad({ ...ok, outputs: [] })).toBe(400);
    expect(
      await bad({
        ...ok,
        outputs: Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: "v" })),
      }),
    ).toBe(400);
    expect(await bad({ ...ok, outputs: [{ label: "x".repeat(41), value: "v" }] })).toBe(400);
    expect(await bad({ ...ok, outputs: [{ label: "L", value: "x".repeat(201) }] })).toBe(400);
    expect(await bad({ ...ok, outputs: [{ label: "L" }] })).toBe(400);
    // Only a featured product.
    const other = await x.t.w.owner("/api/product-projects", "POST", {
      idea: "A fictional second product",
      foundation: "agent_service",
      business_id: x.t.w.f.business,
    });
    const notFeatured = await x.save(0, x.draft({ ...ok, product: other.body.project.id }));
    expect(notFeatured.status).toBe(400);
    expect(notFeatured.body.code).toBe("example_product");
    // Control characters are removed; newlines kept; markup stays inert text.
    const s = await x.save(
      0,
      x.draft({
        ...ok,
        input: "Line one\r\nLine\u0007 two <b>not markup</b>",
        outputs: [{ label: "Total\u0000", value: "1.00\tUSD" }],
      }),
    );
    expect(s.status).toBe(200);
    expect(s.body.preview.example.input).toBe("Line one\nLine two <b>not markup</b>");
    expect(s.body.preview.example.outputs).toEqual([{ label: "Total", value: "1.00USD" }]);
  });

  it("an old draft without the example field reads as having none", async () => {
    const x = await world();
    await x.save(0, { ...BASE, products: [x.t.w.f.project] });
    const v = (await x.t.w.owner(`${x.biz}/public-profile`)).body as Json;
    expect(v.draft.example).toBeNull();
    expect(v.preview.example).toBeNull();
    expect(v.slug).toBe(x.slug);
  });
});
