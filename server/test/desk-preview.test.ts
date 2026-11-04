// Job 001c: the disposable desk preview (scripts/lib/deskPreview.ts), driven through its site's
// fetch (no listener, no network) as the browser would. SYNTHETIC: fictional people, products and
// customer uses recorded by the app's routes; contract fixture views; synthetic keys.

import { describe, expect, it } from "vitest";
import { deskPreview } from "../../scripts/lib/deskPreview.ts";
import type { Json } from "./customer-world.ts";

async function browser(p: Awaited<ReturnType<typeof deskPreview>>, personId: string) {
  const as = await p.site.fetch(
    new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
  );
  const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return async (path: string) => {
    const res = await p.site.fetch(new Request(`http://preview${path}`, { headers: { cookie } }));
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
  };
}

describe("001c desk preview: a working digital business, a brief-only founder, a legacy business", () => {
  it("each desk reads its own records; nobody reads another's", async () => {
    const p = await deskPreview();
    const ava = await browser(p, p.people.ava);
    const bea = await browser(p, p.people.bea);
    const dee = await browser(p, p.people.dee);
    const desk = (id: string) => `/api/businesses/${id}/digital-desk`;

    const d = (await ava(desk(p.businesses.digital))).body;
    expect(d.kind).toBe("digital");
    expect(d.products.total).toBe(2);
    expect(d.products.shown.map((x: Json) => x.status).sort()).toEqual(["brief_only", "offered"]);
    expect(d.imports.total).toBe(1);
    expect(d.legacy_offering).toEqual({
      configured: true,
      title: "Invoice clean-up session, one hour",
    });
    // Recorded work, not "all caught up".
    expect(d.work.length).toBeGreaterThan(0);
    expect(d.current.reserved_not_settled + d.current.awaiting_settlement).toBeGreaterThan(0);

    const b = (await bea(desk(p.businesses.briefOnly))).body;
    expect(b.kind).toBe("digital");
    expect(b.products.shown[0]).toMatchObject({ name: "Tutor Portal", status: "brief_only" });

    const l = (await dee(desk(p.businesses.legacy))).body;
    expect(l.kind).toBe("legacy");
    expect(l.legacy_offering.configured).toBe(true);

    // Switching who is acting changes what can be read.
    expect((await bea(desk(p.businesses.digital))).status).toBe(404);
    expect((await dee(desk(p.businesses.digital))).status).toBe(404);
    expect((await ava(desk(p.businesses.legacy))).status).toBe(404);
  });
});
