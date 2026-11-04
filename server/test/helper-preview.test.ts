// Job 005b: the helper preview (scripts/lib/helperPreview.ts) through its site's fetch (no
// listener, no network), every control in turn, as Astra would in the browser. SYNTHETIC; a hard
// request ceiling; finite.

import { describe, expect, it } from "vitest";
import { HELPER_CANARY, helperPreview } from "../../scripts/lib/helperPreview.ts";
import type { Json } from "./customer-world.ts";

describe("005b helper preview: each control, and what Ellis's direct URL shows", () => {
  it("authorized → revoke → regrant → contract-only → support-only → outage → restore → sale", async () => {
    const p = await helperPreview({ maxRequests: 80 });
    const as = async (personId: string) => {
      const r = await p.site.fetch(
        new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
      );
      const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      return async (path: string) => {
        const res = await p.site.fetch(
          new Request(`http://preview${path}`, { headers: { cookie } }),
        );
        return { status: res.status, body: (await res.json()) as Json };
      };
    };
    const ellis = await as(p.people.ellis);
    const read = async () => {
      const r = await ellis(`/api/helping/${p.businessId}`);
      return { ...r, text: JSON.stringify(r.body) };
    };
    const label = await (
      await p.site.fetch(new Request("http://preview/__preview/label.js"))
    ).text();
    expect(label).toMatch(/Preview only: synthetic helper access/);

    expect((await read()).text).toContain(HELPER_CANARY);
    await p.controls.run("revoke");
    let r = await read();
    expect(r.body.access).toBe("ended");
    expect(r.text).not.toContain(HELPER_CANARY);
    await p.controls.run("regrant");
    expect((await read()).text).toContain(HELPER_CANARY);
    await p.controls.run("contract-revoke");
    r = await read();
    expect(r.body.access).toBe("denied");
    expect(r.text).not.toContain(HELPER_CANARY);
    await p.controls.run("regrant"); // Everstreet still records him: refused, contract unchanged
    await p.controls.run("support-only");
    r = await read();
    expect(r.body.orders).toBeNull();
    expect(r.text).toContain(HELPER_CANARY);
    await p.controls.run("outage");
    r = await read();
    expect(r.body.access).toBe("unconfirmed");
    expect(r.text).not.toContain(HELPER_CANARY);
    await p.controls.run("restore");
    expect((await read()).body.access).toBe("active");
    const sale = await p.controls.run("sale");
    expect(sale?.body.deal.status).toBe("closed");
    r = await read();
    expect(r.body.access).toBe("ended");
    expect(r.text).not.toContain(HELPER_CANARY);
    expect(p.controls.summary()).toMatchObject({ owner: "Ana (after the sale)" });
    // Bea, unrelated, gets nothing at all.
    const bea = await as(p.people.bea);
    expect((await bea(`/api/helping/${p.businessId}`)).status).toBe(404);
  });
});
