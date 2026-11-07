// Promise 5 and 6: an unrelated signed-in account and a signed-out visitor, against every private
// route with real ids. Nothing private answers; existing and missing ids answer alike.
import { describe, expect, it } from "vitest";
import type { Json } from "../customer-world.ts";
import { nearKey, reviewWorld } from "./world.ts";

describe("pr11: outsiders against real ids", () => {
  it("every private route answers 401 signed out and 404 to a stranger", async () => {
    const w = await reviewWorld();
    const db = w.w.state.store.db;
    // Real ids of other people's records.
    const use = await w.customerUse();
    const useId = use.id as string;
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    const key = nearKey();
    w.registerKey("buyer.near", key.publicKey);
    const action = (
      db.prepare("SELECT id FROM sale_actions WHERE person_id = ? LIMIT 1").get(w.noah.id) as {
        id: string;
      }
    ).id;
    const intent = (db.prepare("SELECT id FROM v3_intents LIMIT 1").get() as { id: string }).id;
    const companion = await w.ava(`/api/companions/${w.biz}/prepare`, "POST", {
      kind: "allowance_grant",
      input: {},
    });
    const invited = await w.ava(`/api/businesses/${w.biz}/members`, "POST", {
      person_id: w.dana.id,
      role: "viewer",
    });
    const memberId = invited.body.members[0].id as string;
    await w.ava(`/api/businesses/${w.biz}/customer-offers/${w.offerId}/agent-access`, "PUT", {
      enabled: true,
    });
    const grant = await w.cara("/api/customer/agent-grants", "POST", {
      offer_id: w.offerId,
      key_slot: 0,
      max_uses: 1,
      label: "x",
    });
    const releases = await w.ava(`/api/product-projects/${w.w.f.project}/releases`);
    const releaseId = releases.body.active?.id as string;
    const build = (
      db.prepare("SELECT id FROM build_jobs LIMIT 1").get() as { id: string } | undefined
    )?.id;
    const project = w.w.f.project;
    const biz = w.biz;
    const gets = [
      `/api/businesses/${biz}`,
      `/api/businesses/${biz}/customer-offers`,
      `/api/businesses/${biz}/members`,
      `/api/businesses/${biz}/workspace`,
      `/api/businesses/${biz}/workflow-cases`,
      `/api/businesses/${biz}/workflow-cases/${useId}`,
      `/api/businesses/${biz}/agent-purchases`,
      `/api/businesses/${biz}/agent-access`,
      `/api/businesses/${biz}/v3`,
      `/api/businesses/${biz}/v3/intents`,
      `/api/businesses/${biz}/v3/intents/${intent}`,
      `/api/businesses/${biz}/books`,
      `/api/businesses/${biz}/economics`,
      `/api/businesses/${biz}/digital-desk`,
      `/api/businesses/${biz}/value`,
      `/api/businesses/${biz}/rehearsals`,
      `/api/businesses/${biz}/control-sheet`,
      `/api/businesses/${biz}/handover-record`,
      `/api/businesses/${biz}/imports`,
      `/api/businesses/${biz}/listing`,
      `/api/businesses/${biz}/listing/summary`,
      `/api/businesses/${biz}/public-profile`,
      `/api/businesses/${biz}/build-budget`,
      `/api/businesses/${biz}/runtime-budget`,
      `/api/businesses/${biz}/customer-offer-readiness`,
      `/api/businesses/${biz}/customer-access`,
      `/api/businesses/${biz}/companions`,
      `/api/businesses/${biz}/sessions`,
      `/api/businesses/${biz}/money`,
      `/api/businesses/${biz}/team`,
      `/api/businesses/${biz}/deals/snapshot`,
      `/api/me/dashboard/businesses/${biz}`,
      `/api/sales/${biz}`,
      `/api/sales/${biz}/intents`,
      `/api/sales/${biz}/proof`,
      `/api/sales/${biz}/receipt`,
      `/api/sales/${biz}/economics`,
      `/api/companions/${biz}`,
      `/api/intents/${q.body.id}`,
      `/api/customer/uses/${useId}`,
      `/api/customer/uses/${useId}/result`,
      `/api/customer/uses/${useId}/case`,
      `/api/product-projects/${project}`,
      `/api/product-projects/${project}/revisions/1`,
      `/api/product-projects/${project}/builds`,
      `/api/product-projects/${project}/conversation`,
      `/api/product-projects/${project}/app-versions`,
      `/api/product-projects/${project}/runtime`,
      `/api/product-projects/${project}/test-cases`,
      `/api/product-projects/${project}/evaluations`,
      `/api/product-projects/${project}/releases`,
      ...(build ? [`/api/builds/${build}`, `/api/builds/${build}/events`] : []),
      `/api/helping/${biz}`,
    ];
    const posts: [string, unknown][] = [
      [`/api/businesses/${biz}/members/${memberId}/revoke`, {}],
      [`/api/businesses/${biz}/members/${memberId}/role`, { role: "viewer" }],
      [`/api/me/teams/${memberId}/respond`, { accept: true }],
      [`/api/me/teams/${memberId}/leave`, {}],
      [`/api/businesses/${biz}/workflow-cases/${useId}/advance`, { to_stage: "x" }],
      [`/api/businesses/${biz}/v3/intents/${intent}/reconcile`, {}],
      [`/api/businesses/${biz}/v3/refresh`, {}],
      [`/api/businesses/${biz}/customer-offers/${w.offerId}/retire`, {}],
      [`/api/businesses/${biz}/rehearsals`, {}],
      [`/api/sales/${biz}/prepare`, { kind: "cancel", input: {} }],
      [`/api/sales/${biz}/actions`, { kind: "cancel", input: {}, idempotency_key: "k-00000001" }],
      [`/api/sales/actions/${action}/requested`, {}],
      [`/api/sales/actions/${action}/check`, {}],
      [`/api/sales/actions/${action}/abandon`, {}],
      [`/api/sales/${biz}/intents/quote`, { token: "talt.synthetic.near" }],
      [`/api/intents/${q.body.id}/sign`, { public_key: key.publicKey, signature: "AAAA" }],
      [`/api/companions/${biz}/prepare`, { kind: "allowance_grant", input: {} }],
      [
        `/api/companions/actions/${companion.body.id}/sent`,
        { tx_hash: "11111111111111111111111111111111111111111111" },
      ],
      [`/api/customer/uses/${useId}/confirm`, {}],
      [`/api/customer/uses/${useId}/execute`, {}],
      [`/api/customer/uses/${useId}/release`, {}],
      [`/api/customer/agent-grants/${grant.body.grant.id}/revoke`, {}],
      [`/api/product-projects/${project}/releases/withdraw`, {}],
      [`/api/product-projects/${project}/releases/${releaseId}/rollback`, {}],
      [`/api/product-projects/${project}/revisions`, { base_revision: 1 }],
      [`/api/product-projects/${project}/builds`, { idempotency_key: "k-00000001", revision: 1 }],
      [`/api/product-projects/${project}/evaluations`, { artifact_job: build ?? "x" }],
      [`/api/businesses/${biz}/publish`, {}],
      [`/api/businesses/${biz}/updates`, { body: "hi" }],
      [`/api/businesses/${biz}/costs`, { category: "Hosting", amount_cents: 1 }],
      [`/api/businesses/${biz}/deals`, {}],
      [`/api/businesses/${biz}/team`, { person_id: w.cara.id }],
    ];
    const failures: string[] = [];
    const app = w.w.state.app;
    // Finding 7 (fixed for sign-in): the v2 routes behind services this composition doesn't
    // connect (bookings, payments, deals) answer 401 signed out. Signed in, they answer one
    // uniform 409 ("not connected here") before any id is looked at, the same for a real id and
    // a missing one, so a stranger learns the composition and nothing about the business.
    const unconnected = new Set([
      `/api/businesses/${biz}/sessions`,
      `/api/businesses/${biz}/money`,
      `/api/businesses/${biz}/team`,
      `/api/businesses/${biz}/deals/snapshot`,
      `/api/businesses/${biz}/deals`,
      `/api/helping/${biz}`,
    ]);
    for (const path of gets) {
      const out = await app.request(path);
      if (out.status !== 401) failures.push(`signed out GET ${path} -> ${out.status}`);
      const r = await w.stranger(path);
      if (unconnected.has(path)) {
        const missing = await w.stranger(path.replace(biz, "00000000-0000-4000-8000-000000000000"));
        if (
          r.status !== 409 ||
          missing.status !== 409 ||
          JSON.stringify(r.body) !== JSON.stringify(missing.body)
        )
          failures.push(`stranger GET ${path} -> ${r.status} (missing id: ${missing.status})`);
        continue;
      }
      if (r.status !== 404)
        failures.push(`stranger GET ${path} -> ${r.status} ${r.body.code ?? ""}`);
    }
    for (const [path, body] of posts) {
      const out = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (out.status !== 401) failures.push(`signed out POST ${path} -> ${out.status}`);
      const r = await w.stranger(path, "POST", body);
      if (unconnected.has(path)) {
        if (r.status !== 409) failures.push(`stranger POST ${path} -> ${r.status}`);
        continue;
      }
      if (r.status !== 404)
        failures.push(`stranger POST ${path} -> ${r.status} ${r.body.code ?? ""}`);
    }
    expect(failures).toEqual([]);
  });

  it("a missing id and someone else's id answer alike", async () => {
    const w = await reviewWorld();
    const use = await w.customerUse();
    const pairs: [string, string][] = [
      [`/api/businesses/${w.biz}`, "/api/businesses/00000000-0000-4000-8000-000000000000"],
      [`/api/customer/uses/${use.id}`, "/api/customer/uses/00000000-0000-4000-8000-000000000000"],
      [`/api/sales/${w.biz}`, "/api/sales/00000000-0000-4000-8000-000000000000"],
      [`/api/companions/${w.biz}`, "/api/companions/00000000-0000-4000-8000-000000000000"],
      [`/api/product-projects/${w.w.f.project}`, "/api/product-projects/nope"],
      [`/api/businesses/${w.biz}/companions`, "/api/businesses/nope/companions"],
    ];
    const differences: string[] = [];
    for (const [real, fake] of pairs) {
      const a = await w.stranger(real);
      const b = await w.stranger(fake);
      const strip = (x: Json) => ({ ...x, body: { ...x.body } });
      if (JSON.stringify(strip(a)) !== JSON.stringify(strip(b)))
        differences.push(
          `${real}: ${a.status} ${JSON.stringify(a.body)} vs ${b.status} ${JSON.stringify(b.body)}`,
        );
    }
    expect(differences).toEqual([]);
  });
});
