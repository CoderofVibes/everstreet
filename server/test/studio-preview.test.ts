// Job 001b: the disposable studio preview's states, through its site's fetch (no listener, no
// network), and the status the studio derives from them. SYNTHETIC throughout.

import { describe, expect, it } from "vitest";
import { studioPreview } from "../../scripts/lib/studioPreview.ts";
import { projectStatus } from "../../web/src/studioStatus.ts";
import type { Json } from "./customer-world.ts";

async function browser(p: Awaited<ReturnType<typeof studioPreview>>, personId: string) {
  const as = await p.site.fetch(
    new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
  );
  const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return async (path: string) => {
    const res = await p.site.fetch(new Request(`http://preview${path}`, { headers: { cookie } }));
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
  };
}

describe("001b studio preview: released, failed and draft products, from real records", () => {
  it("each project's status is what its records show; nothing is invented", async () => {
    const p = await studioPreview();
    const ava = await browser(p, p.people.ava);
    const label = await (
      await p.site.fetch(new Request("http://preview/__preview/label.js"))
    ).text();
    expect(label).toMatch(/Preview only: synthetic studio/);

    const statusOf = async (id: string) => {
      const v = (await ava(`/api/product-projects/${id}`)).body;
      const rr = await ava(`/api/product-projects/${id}/releases`);
      expect(rr.status).toBe(200);
      const releases = rr.body;
      const offers = (await ava(`/api/businesses/${v.project.business_id}/customer-offers`)).body
        .offers as Json[];
      const mine = offers.filter((o) => o.project_id === id);
      return {
        v,
        s: projectStatus({
          head: v.head.number,
          dirty: false,
          build: v.build,
          businessId: v.project.business_id,
          releases: releases as never,
          offers: {
            active: mine.filter((o) => o.state === "active").length,
            retired: mine.filter((o) => o.state === "retired").length,
          },
        }),
      };
    };
    const items = (s: ReturnType<typeof projectStatus>) =>
      Object.fromEntries(s.items.map((i) => [i.key, i.value]));

    // 1. Released with a newer brief: both stated, neither relabelled.
    const r = await statusOf(p.projects.released);
    expect(r.v.head.number).toBe(2);
    expect(r.v.build.available).toBe(false); // building deliberately not connected here
    expect(r.s.chip.label).toBe("Released build");
    expect(items(r.s).release).toMatch(
      /\(revision 1\) released; the brief has changed since \(revision 2\)/,
    );
    expect(items(r.s).customers).toMatch(/^1 active/);

    // 2. A failed release check: built, never releasable or released.
    const f = await statusOf(p.projects.failed);
    expect(f.s.chip.label).toBe("Built, not released");
    expect(items(f.s).evaluation).toMatch(/not releasable/);
    expect(items(f.s).release).toBe("Not released");

    // 3. A brief only, with building unavailable: prototype only, no next build step offered.
    const d = await statusOf(p.projects.draft);
    expect(d.s.chip.label).toBe("Prototype only");
    expect(items(d.s).build).toBe("Not available here");
    // First-use review #19: a way forward, never a dead end.
    expect(d.s.next).toEqual({
      label: "Offer it as a service instead",
      target: { route: "/start" },
    });
    // Job 001g: it is also the empty state the canvas studio starts from: revision 1, untitled,
    // no audience or promised result yet, so the header's Next opens a brief to-do in Edit mode;
    // its starter prototype has a form whose parts Edit mode can select.
    expect(d.v.head.number).toBe(1);
    expect(d.v.head.brief).toMatchObject({ name: "Untitled product", audience: "", promise: "" });
    expect(
      (d.v.checks.deterministic as Json[]).some((c) => c.state === "todo" && c.id === "name"),
    ).toBe(true);
    expect((d.v.head.prototype.screens as Json[]).some((s) => s.kind === "form")).toBe(true);

    // The buyer-to-be and the customer see none of Ava's projects.
    const noah = await browser(p, p.people.noah);
    expect((await noah(`/api/product-projects/${p.projects.released}`)).status).toBe(404);
  });
});
