// Job 001h: the operating workspace preview (scripts/lib/workspacePreview.ts), through its site's
// fetch (no listener, no network). Several months with labelled fictional history and costs entered
// through the app, uses only this month (none backdated), two products of which one released under
// a name its draft no longer has, and an empty digital business. SYNTHETIC throughout; finite.

import { describe, expect, it } from "vitest";
import { workspacePreview } from "../../scripts/lib/workspacePreview.ts";
import type { Json } from "./customer-world.ts";

describe("001h workspace preview: months, products, identities and the empty state", () => {
  it("is what its label says, and nothing more", async () => {
    const p = await workspacePreview();
    const label = await (
      await p.site.fetch(new Request("http://preview/__preview/label.js"))
    ).text();
    expect(label).toMatch(/earlier months have no customer uses/);
    expect(label).toMatch(/fictional example history/);
    const as = await p.site.fetch(
      new Request(`http://preview/api/session/as/${p.people.ava}`, { method: "POST" }),
    );
    const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const ava = async (path: string) =>
      (await (
        await p.site.fetch(new Request(`http://preview${path}`, { headers: { cookie } }))
      ).json()) as Json;

    const books = await ava(`/api/businesses/${p.businesses.main}/books?months=6`);
    const months = books.months as Json[];
    expect(months).toHaveLength(6);
    const earlier = months.slice(0, -1);
    // Earlier months: labelled fictional history and founder costs entered through the app.
    expect(earlier.every((m) => m.revenue_basis === "seeded" || m.mixed)).toBe(true);
    expect(earlier.every((m) => m.direct_cents + m.overhead_cents > 0)).toBe(true);
    // Customer uses only this month: none backdated.
    const ops = books.operations as Json;
    expect((ops.months as Json[]).slice(0, -1).every((m) => m.usage.requested === 0)).toBe(true);
    expect((ops.months as Json[]).at(-1)?.usage.requested).toBeGreaterThan(0);

    const desk = await ava(`/api/businesses/${p.businesses.main}/digital-desk`);
    expect(desk.products.total).toBe(2);
    const released = (desk.products.shown as Json[]).find(
      (x) => x.project_id === p.projects.released,
    );
    expect(released?.released.name).toBe("Invoice reader");
    expect(released?.name).toBe("Ledgerline Rows (draft)");
    const brief = (desk.products.shown as Json[]).find(
      (x) => x.project_id === p.projects.briefOnly,
    );
    expect(brief).toMatchObject({ status: "brief_only", released: null });

    const empty = await ava(`/api/businesses/${p.businesses.empty}/digital-desk`);
    expect(empty).toMatchObject({ kind: "digital", products: { total: 0 } });
  });
});

describe("001h1 workspace preview: a books read fails once on request", () => {
  it("the next books read (any period) fails with a labelled 503 or 404, then reads recover", async () => {
    const p = await workspacePreview();
    const as = await p.site.fetch(
      new Request(`http://preview/api/session/as/${p.people.ava}`, { method: "POST" }),
    );
    const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const get = (path: string) =>
      p.site.fetch(new Request(`http://preview${path}`, { headers: { cookie } }));
    const books = (n: number) => get(`/api/businesses/${p.businesses.main}/books?months=${n}`);
    expect((await books(6)).status).toBe(200);
    p.controls.failBooks(503);
    const failed = await books(12);
    expect(failed.status).toBe(503);
    expect(((await failed.json()) as Json).error).toMatch(/made to fail once \(503\)/);
    // Other reads are untouched, and the next books read succeeds for the period asked.
    expect((await get(`/api/businesses/${p.businesses.main}/digital-desk`)).status).toBe(200);
    const twelve = (await (await books(12)).json()) as Json;
    expect(twelve.period_months).toBe(12);
    p.controls.failBooks(404);
    expect((await books(3)).status).toBe(404);
    expect(p.controls.summary()).toMatchObject({ books_failed: 2, books_fail_next: null });
  });
});
