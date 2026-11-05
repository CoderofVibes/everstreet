// Independent review: real customer routes and fictional, in-memory customer world.
import { expect, it } from "vitest";
import { customerWorld, SyntheticProtection } from "./customer-world.ts";

it("an agent's one-use grant admits at most one concurrent distinct preparation", async () => {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  const owner = w.caller(w.f.ava.id);
  expect(
    (
      await owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/agent-access`, "PUT", {
        enabled: true,
      })
    ).status,
  ).toBe(200);
  const grant = await w.caller(w.cara.id)("/api/customer/agent-grants", "POST", {
    offer_id: offer,
    key_slot: 0,
    label: "Independent fictional probe",
    max_uses: 1,
    expires_in_days: 1,
  });
  expect(grant.status).toBe(201);
  const replies = await Promise.all(
    [1, 2, 3].map(async (n) => {
      const r = await w.state.app.request("/api/agent/v1/uses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${grant.body.token}`,
        },
        body: JSON.stringify({
          idempotency_key: `astra-concurrent-${n}`,
          input:
            "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD",
        }),
      });
      return { status: r.status, body: await r.json() };
    }),
  );
  expect(
    replies.filter((r) => r.status === 201),
    JSON.stringify(replies),
  ).toHaveLength(1);
});
