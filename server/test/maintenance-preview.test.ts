// Job 002d: the disposable maintenance preview, driven through its site's fetch (no listener, no
// network). The worker runs only when its control starts it. SYNTHETIC throughout.

import { describe, expect, it } from "vitest";
import { maintenancePreview } from "../../scripts/lib/maintenancePreview.ts";
import type { Json } from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function browser(p: Awaited<ReturnType<typeof maintenancePreview>>, personId: string) {
  const as = await p.site.fetch(
    new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
  );
  const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return async (path: string, method = "GET", body?: unknown) => {
    const res = await p.site.fetch(
      new Request(`http://preview${path}`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
  };
}

describe("002d maintenance preview: stopped, running, a use settled without a click", () => {
  it("nothing runs until started; then the customer's use reaches charged evidence by itself", async () => {
    const p = await maintenancePreview();
    const cara = await browser(p, p.people.cara);
    const ava = await browser(p, p.people.ava);
    const readiness = async () =>
      (
        (
          await ava(
            `/api/businesses/${p.w.f.business}/customer-offer-readiness?project=${p.w.f.project}`,
          )
        ).body.readiness.items as Json[]
      ).find((i) => i.key === "maintenance");
    expect((await readiness())?.state).toBe("unavailable");
    expect(p.controls.health().worker.state).toBe("not_started");
    // One full use, without "Settle my unit".
    const prep = await cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
      idempotency_key: "mprev-key-0001",
      input: INVOICE,
    });
    const env = prep.body.use.envelope;
    const sig = await cara("/__preview/sign", "POST", {
      hold_message_hex: env.hold.message_hex,
      use_message_hex: env.use.message_hex,
    });
    const id = prep.body.use.id as string;
    await cara(`/api/customer/uses/${id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      ...sig.body,
    });
    await cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect((await cara(`/api/customer/uses/${id}`)).body.use.units.unit).toBe(
      "reserved_awaiting_settlement",
    );
    // Passes by the preview control only (the scheduled worker isn't started in this test).
    for (let i = 0; i < 3; i++) await p.controls.pass();
    expect((await cara(`/api/customer/uses/${id}`)).body.use.units.unit).toBe("charged");
    expect(p.controls.summary().entitlement).toMatchObject({ consumed: "1" });
    // Started: the owner sees it running; stopped: they see it stopped.
    p.controls.start();
    await p.controls.pass();
    expect((await readiness())?.state).toBe("observed");
    await p.controls.stop();
    expect(p.controls.health().worker.state).toBe("stopped");
    expect((await readiness())?.state).toBe("unavailable");
  });
});
