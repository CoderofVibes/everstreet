// Job 001f2: the Home preview's read faults, through the real app's fetch (no listener, no
// network). A held project-list answer is the real one for whoever asked (Ava), delivered late;
// a failed read is a labelled 503 once; project lists stay per account on the server. Bounded:
// short hold ceiling, few requests. SYNTHETIC throughout.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { publicationPreview } from "../../scripts/lib/publicationPreview.ts";
import { readFaults } from "../../scripts/lib/readFaults.ts";
import type { Json } from "./customer-world.ts";

async function setup(maxHoldMs = 2_000) {
  const p = await publicationPreview();
  const faults = readFaults({ maxHoldMs, maxRequests: 40 });
  const site = new Hono();
  site.use("/api/*", faults.middleware);
  site.route("/", p.site);
  const as = async (personId: string) => {
    const r = await site.fetch(
      new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
    );
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return (path: string) =>
      site.fetch(new Request(`http://preview${path}`, { headers: { cookie } }));
  };
  return { p, faults, as };
}

const names = async (r: Response) =>
  ((await r.json()) as { projects: Json[] }).projects.map((x) => x.name as string);

describe("001f2 Home preview: a held answer is the asker's own, delivered late", () => {
  it("Ava's held list arrives after Bea's, and each list is only its owner's", async () => {
    const { p, faults, as } = await setup();
    const ava = await as(p.people.ava);
    const bea = await as(p.people.bea);
    faults.hold();
    const late = ava("/api/product-projects");
    const beaList = await names(await bea("/api/product-projects"));
    expect(beaList).toEqual(["Tutor Portal"]);
    expect(faults.summary().held).toBe(1);
    expect(faults.release()).toBe(1);
    const avaList = await names(await late);
    expect(avaList).not.toContain("Tutor Portal");
    expect(avaList.length).toBeGreaterThan(0);
    expect(faults.summary().requests).toBeLessThanOrEqual(6);
  });

  it("an unreleased hold ends by itself at the ceiling", async () => {
    const { p, faults, as } = await setup(50);
    const ava = await as(p.people.ava);
    faults.hold();
    const r = await ava("/api/product-projects");
    expect(r.status).toBe(200);
    expect(faults.summary()).toMatchObject({ held: 1, held_delivered: 1 });
  });

  it("a failed read is a labelled 503 once, then the real answer", async () => {
    const { p, faults, as } = await setup();
    const ava = await as(p.people.ava);
    faults.fail("discover");
    faults.fail("foundations");
    const d1 = await ava("/api/public/discover?q=");
    expect(d1.status).toBe(503);
    expect(((await d1.json()) as Json).error).toMatch(/Preview: this read was made to fail once/);
    expect((await ava("/api/public/discover?q=")).status).toBe(200);
    expect((await ava("/api/product-foundations")).status).toBe(503);
    expect((await ava("/api/product-foundations")).status).toBe(200);
  });
});
