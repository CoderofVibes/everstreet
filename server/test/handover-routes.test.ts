// Job 003wf3 (MANAGED_HANDOVER.md §14.2, §10.3 S-6, S-21): every mutation route of app.ts,
// classified, and the classification checked against the source (a new route fails this file until
// it is classified). Each gated owner route is then called through the composition's real routes
// during an actual managed closing, as the seller, for the gated business (409
// handover_in_progress) and for a second business of the same founder (never refused by this
// gate). The awaited request-body and awaited chain-read races are exercised on real routes.
// The configured composition in one process (handoverWorld.ts); fictional data.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { type HandoverWorld, handoverWorld } from "./handoverWorld.ts";
import { FOUNDER, signInAs } from "./lifecycleWorld.ts";

type Class =
  | "gated_owner"
  | "legacy_v2"
  | "allowed_recovery"
  | "customer_admission"
  | "evidence"
  | "not_business";

/** §14.2, for every route in app.ts. */
const CLASS: Record<string, Class> = {
  // gated owner mutations of a business (by business id or its product project)
  "PATCH /api/businesses/:id": "gated_owner",
  "PATCH /api/businesses/:id/idea": "gated_owner",
  "PATCH /api/businesses/:id/listing": "gated_owner",
  "PATCH /api/businesses/:id/offer": "gated_owner",
  "PATCH /api/businesses/:id/value/settings": "gated_owner",
  "POST /api/businesses/:id/costs": "gated_owner",
  "DELETE /api/businesses/:id/costs/:costId": "gated_owner",
  "POST /api/businesses/:id/customer-offer-inspections": "gated_owner",
  "POST /api/businesses/:id/customer-offers": "gated_owner",
  "POST /api/businesses/:id/customer-offers/:offer/retire": "gated_owner",
  "POST /api/businesses/:id/workflow-cases/:request/advance": "gated_owner",
  "PUT /api/businesses/:id/customer-offers/:offer/agent-access": "gated_owner",
  "POST /api/businesses/:id/public-profile/publish": "gated_owner",
  "PUT /api/businesses/:id/public-profile/draft": "gated_owner",
  "POST /api/businesses/:id/publish": "gated_owner",
  "POST /api/businesses/:id/unpublish": "gated_owner",
  "POST /api/businesses/:id/updates": "gated_owner",
  "POST /api/businesses/:id/value/scenarios": "gated_owner",
  "POST /api/businesses/:id/value/try": "gated_owner",
  "PUT /api/businesses/:id/build-budget": "gated_owner",
  "PUT /api/businesses/:id/runtime-budget": "gated_owner",
  "POST /api/product-projects/:id/revisions": "gated_owner",
  "POST /api/product-projects/:id/restore": "gated_owner",
  "POST /api/product-projects/:id/conversation": "gated_owner",
  "POST /api/product-projects/:id/proposals/:pid/apply": "gated_owner",
  "POST /api/product-projects/:id/builds": "gated_owner",
  "POST /api/builds/:id/retry": "gated_owner",
  "POST /api/product-projects/:id/app-versions/:job/current": "gated_owner",
  "POST /api/product-projects/:id/app-versions/:job/checks": "gated_owner",
  "POST /api/product-projects/:id/app-versions/:job/preview": "gated_owner",
  "POST /api/product-projects/:id/runtime/invocations": "gated_owner",
  "POST /api/product-projects/:id/test-cases": "gated_owner",
  "POST /api/product-projects/:id/evaluations": "gated_owner",
  "POST /api/product-projects/:id/releases": "gated_owner",
  "POST /api/product-projects/:id/releases/:rid/rollback": "gated_owner",
  "POST /api/product-projects/:id/releases/app-terms": "gated_owner",
  "POST /api/product-projects/:id/releases/withdraw": "gated_owner",
  "POST /api/businesses/:id/members": "gated_owner",
  "POST /api/businesses/:id/rehearsals": "gated_owner",
  "POST /api/businesses/:id/members/:member/role": "gated_owner",
  "POST /api/businesses/:id/members/:member/revoke": "allowed_recovery",
  "POST /api/me/teams/:member/respond": "not_business",
  "POST /api/me/teams/:member/leave": "not_business",
  "POST /api/acquire/buyers/:id/representative": "not_business",
  "POST /api/acquire/buyers/:id/positions/:listing": "not_business",
  "POST /api/imports": "gated_owner",
  "PATCH /api/imports/:id": "gated_owner",
  "POST /api/imports/:id/inspections": "gated_owner",
  "PUT /api/imports/:id/dependencies/:category": "gated_owner",
  // November 5 build: a founder's manual check (Phase B) and connected source (004b)
  "POST /api/product-projects/:id/manual-checks": "gated_owner",
  "POST /api/imports/:id/source/connect": "gated_owner",
  "POST /api/imports/:id/source/disconnect": "gated_owner",
  "POST /api/imports/:id/source/inspections": "gated_owner",
  // 005c: a person's own expert profile and private help requests (a business link is checked
  // and refused while it changes hands inside the service; the request itself isn't owner state)
  "PUT /api/me/expert-profile": "not_business",
  // 006b: a customer's own agent grants (not business state); the agent's uses go through the
  // customer admission path (paused during a handover there)
  "POST /api/customer/agent-grants": "not_business",
  "POST /api/customer/agent-grants/:id/revoke": "not_business",
  "POST /api/agent/v1/uses": "customer_admission",
  "POST /api/agent/v1/uses/:id/confirm": "customer_admission",
  "POST /api/agent/v1/uses/:id/execute": "customer_admission",
  "POST /api/agent/mcp": "customer_admission",
  "DELETE /api/agent/mcp": "not_business",
  // 003x: verifies supplied text only (reads and changes nothing)
  "POST /api/handover-records/verify": "not_business",
  // 005d: the viewer's own private portfolio note (never business state)
  "PUT /api/me/portfolio/:businessId/note": "not_business",
  "POST /api/me/expert-profile/publish": "not_business",
  "POST /api/me/expert-profile/unpublish": "not_business",
  "POST /api/help-requests/preview": "not_business",
  "POST /api/help-requests": "not_business",
  "POST /api/help-requests/:id/events": "not_business",
  // 003wf slice 3: an operator reads one attempt's own FINAL status (recovery evidence)
  "POST /api/operator/writer-history/check": "allowed_recovery",
  // v2 (legacy) owner routes: refused at entry for a business that is changing hands; a v2-only
  // business can't have a handover (§14.2 legacy rule)
  "POST /api/businesses/:id/team": "legacy_v2",
  "DELETE /api/businesses/:id/team/:personId": "legacy_v2",
  "POST /api/businesses/:id/sessions": "legacy_v2",
  "POST /api/businesses/:id/deals": "legacy_v2",
  "POST /api/businesses/:id/payments/activate": "legacy_v2",
  "POST /api/businesses/:id/withdraw": "legacy_v2",
  "POST /api/deals/:id/accept": "legacy_v2",
  "POST /api/deals/:id/cancel": "legacy_v2",
  "POST /api/deals/:id/claim": "legacy_v2",
  "POST /api/deals/:id/former-owner-check": "legacy_v2",
  "POST /api/deals/:id/fund": "legacy_v2",
  "POST /api/deals/:id/items/:key": "legacy_v2",
  "POST /api/deals/:id/revise": "legacy_v2",
  "POST /api/deals/:id/test-dollars": "legacy_v2",
  "POST /api/deals/:id/withdraw-hold": "legacy_v2",
  "POST /api/payments/:id/deliver": "legacy_v2",
  "POST /api/payments/:id/reconcile": "legacy_v2",
  "POST /api/payments/:id/retry": "legacy_v2",
  "POST /api/activity/bookings/:id/cancel": "legacy_v2",
  "POST /api/public/sessions/:id/book": "legacy_v2",
  "POST /api/public/sessions/:id/pay": "legacy_v2",
  // allowed participant or customer recovery (stopping work, finishing what was started)
  "POST /api/builds/:id/cancel": "allowed_recovery",
  "POST /api/app-checks/:id/cancel": "allowed_recovery",
  "POST /api/runtime/invocations/:id/cancel": "allowed_recovery",
  "POST /api/customer/uses/:id/cancel": "allowed_recovery",
  "POST /api/customer/uses/:id/execution/cancel": "allowed_recovery",
  "POST /api/customer/uses/:id/reconcile": "allowed_recovery",
  "POST /api/customer/uses/:id/release": "allowed_recovery",
  "POST /api/customer/uses/:id/units/reconcile": "allowed_recovery",
  "POST /api/customer/offers/:offer/purchases": "allowed_recovery",
  "POST /api/customer/purchases/:id/abandon": "allowed_recovery",
  "POST /api/customer/purchases/:id/check": "allowed_recovery",
  "POST /api/customer/purchases/:id/requested": "allowed_recovery",
  "POST /api/sales/:business/actions": "allowed_recovery",
  "POST /api/sales/:business/prepare": "allowed_recovery",
  "POST /api/sales/actions/:id/abandon": "allowed_recovery",
  "POST /api/sales/actions/:id/check": "allowed_recovery",
  "POST /api/sales/actions/:id/requested": "allowed_recovery",
  "POST /api/businesses/:id/v3/intents": "allowed_recovery",
  "POST /api/businesses/:id/v3/intents/:intent/reconcile": "allowed_recovery",
  // customer admission (409 handover_pause)
  "POST /api/customer/offers/:offer/prepare": "customer_admission",
  "POST /api/customer/uses/:id/confirm": "customer_admission",
  "POST /api/customer/uses/:id/execute": "customer_admission",
  // evidence
  "POST /api/businesses/:id/v3/refresh": "evidence",
  // not a mutation of an existing business's owner state: the person's own session, wallet and
  // profile; a new business or idea; buyer organisations; public visitors; needs and help
  "POST /api/product-projects": "not_business",
  "POST /api/projects": "not_business",
  "POST /api/projects/:id/choose": "not_business",
  "POST /api/projects/:id/explore": "not_business",
  "POST /api/projects/:id/step": "not_business",
  "PATCH /api/projects/:id/answers": "not_business",
  "POST /api/opportunities/:id/projects": "not_business",
  "PATCH /api/tasks/:id": "not_business",
  "PATCH /api/me": "not_business",
  "POST /api/session": "not_business",
  "DELETE /api/session": "not_business",
  "POST /api/session/as/:id": "not_business",
  "POST /api/session/challenge": "not_business",
  "DELETE /api/session/challenge": "not_business",
  "POST /api/session/verify": "not_business",
  "POST /api/wallet": "not_business",
  "POST /api/wallet/top-up": "not_business",
  "POST /api/acquire/buyers": "not_business",
  "PATCH /api/acquire/buyers/:id": "not_business",
  "POST /api/acquire/buyers/:id/mandates": "not_business",
  "DELETE /api/acquire/buyers/:id/mandates/:mandateId": "not_business",
  "POST /api/acquire/buyers/:id/members": "not_business",
  "DELETE /api/acquire/buyers/:id/members/:personId": "not_business",
  "POST /api/acquire/buyers/:id/shortlist": "not_business",
  "POST /api/acquire/interpret": "not_business",
  "POST /api/acquire/search": "not_business",
  "POST /api/acquire/listings/:id/requests": "not_business",
  "POST /api/acquire/requests/:id/decide": "not_business",
  "POST /api/acquire/requests/:id/revoke": "not_business",
  "POST /api/acquire/requests/:id/withdraw": "not_business",
  "POST /api/acquire/rooms/:id/scenarios": "not_business",
  "POST /api/acquire/rooms/:id/try": "not_business",
  "POST /api/needs": "not_business",
  "POST /api/needs/:id/close": "not_business",
  "POST /api/needs/:id/respond": "not_business",
  "POST /api/need-responses/:id/reply": "not_business",
  "POST /api/inquiries/:id/reply": "not_business",
  "POST /api/helping/:id/inquiries/:inquiryId/reply": "not_business",
  "POST /api/public/businesses/:slug/follow": "not_business",
  "POST /api/public/businesses/:slug/inquiries": "not_business",
  "POST /api/public/reports": "not_business",
};

describe("003wf3 S-21: every mutation route is classified", () => {
  it("the classification lists exactly the routes app.ts defines", () => {
    const src = readFileSync("server/src/app.ts", "utf8");
    const found = new Set(
      [...src.matchAll(/app\.(post|put|patch|delete)\("([^"]+)"/g)].map(
        (m) => `${(m[1] as string).toUpperCase()} ${m[2]}`,
      ),
    );
    const listed = new Set(Object.keys(CLASS));
    expect(
      [...found].filter((r) => !listed.has(r)),
      "unclassified routes",
    ).toEqual([]);
    expect(
      [...listed].filter((r) => !found.has(r)),
      "classified routes that don't exist",
    ).toEqual([]);
  });
});

const UNAVAILABLE_HERE = [
  "POST /api/product-projects/:id/proposals/:pid/apply",
  "POST /api/product-projects/:id/app-versions/:job/current",
  "POST /api/product-projects/:id/app-versions/:job/checks",
  "POST /api/product-projects/:id/app-versions/:job/preview",
];

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});

/** Each gated owner route, with a body that is otherwise valid where it matters. */
function gatedCalls(ids: {
  biz: string;
  project: string;
  costId: string;
  offer: string;
  release: string;
  build: string;
  importId: string | null;
  cancelled?: string;
  importVersion?: number;
  reviewed?: string;
  draftRev?: number;
  review?: string;
  revision?: Json;
}) {
  const b = `/api/businesses/${ids.biz}`;
  const p = `/api/product-projects/${ids.project}`;
  const calls: [string, string, string, Json][] = [
    ["PATCH /api/businesses/:id", "PATCH", b, { name: "Renamed during the closing" }],
    ["PATCH /api/businesses/:id/idea", "PATCH", `${b}/idea`, { summary: "x" }],
    [
      "POST /api/businesses/:id/members",
      "POST",
      `${b}/members`,
      { account: "teammate.testnet", role: "viewer" },
    ],
    ["PATCH /api/businesses/:id/listing", "PATCH", `${b}/listing`, { mode: "open" }],
    ["PATCH /api/businesses/:id/offer", "PATCH", `${b}/offer`, { headline: "x" }],
    [
      "PATCH /api/businesses/:id/value/settings",
      "PATCH",
      `${b}/value/settings`,
      { founder_hours_week: 3 },
    ],
    [
      "POST /api/businesses/:id/costs",
      "POST",
      `${b}/costs`,
      { label: "Hosting", monthly_cents: 500 },
    ],
    ["DELETE /api/businesses/:id/costs/:costId", "DELETE", `${b}/costs/${ids.costId}`, {}],
    [
      "POST /api/businesses/:id/customer-offer-inspections",
      "POST",
      `${b}/customer-offer-inspections`,
      { release_id: ids.release, plan_id: 1 },
    ],
    [
      "POST /api/businesses/:id/customer-offers",
      "POST",
      `${b}/customer-offers`,
      {
        idempotency_key: "route-offer-0001",
        release_id: ids.release,
        plan_id: 1,
        retention_days: 30,
        reviewed_terms: ids.reviewed ?? "0".repeat(64),
      },
    ],
    [
      "POST /api/businesses/:id/customer-offers/:offer/retire",
      "POST",
      `${b}/customer-offers/${ids.offer}/retire`,
      {},
    ],
    [
      "POST /api/businesses/:id/workflow-cases/:request/advance",
      "POST",
      `${b}/workflow-cases/no-such-case/advance`,
      { to_stage: "assigned" },
    ],
    [
      "PUT /api/businesses/:id/customer-offers/:offer/agent-access",
      "PUT",
      `${b}/customer-offers/${ids.offer}/agent-access`,
      { enabled: true },
    ],
    [
      "POST /api/businesses/:id/public-profile/publish",
      "POST",
      `${b}/public-profile/publish`,
      { draft_rev: ids.draftRev ?? 0, review: ids.review ?? "0".repeat(64) },
    ],
    [
      "PUT /api/businesses/:id/public-profile/draft",
      "PUT",
      `${b}/public-profile/draft`,
      { base_rev: ids.draftRev ?? 0, draft: {} },
    ],
    ["POST /api/businesses/:id/publish", "POST", `${b}/publish`, {}],
    ["POST /api/businesses/:id/unpublish", "POST", `${b}/unpublish`, {}],
    ["POST /api/businesses/:id/updates", "POST", `${b}/updates`, { text: "An update" }],
    ["POST /api/businesses/:id/value/scenarios", "POST", `${b}/value/scenarios`, { name: "x" }],
    ["POST /api/businesses/:id/value/try", "POST", `${b}/value/try`, {}],
    ["PUT /api/businesses/:id/build-budget", "PUT", `${b}/build-budget`, { limit_cents: 5 }],
    ["PUT /api/businesses/:id/runtime-budget", "PUT", `${b}/runtime-budget`, { limit_cents: 5 }],
    [
      "POST /api/product-projects/:id/revisions",
      "POST",
      `${p}/revisions`,
      {
        brief: ids.revision?.brief ?? {},
        prototype: ids.revision?.prototype ?? {},
        base_revision: ids.revision?.number ?? 1,
        note: "Edited during the closing",
      },
    ],
    ["POST /api/product-projects/:id/restore", "POST", `${p}/restore`, { revision: 1 }],
    [
      "POST /api/product-projects/:id/conversation",
      "POST",
      `${p}/conversation`,
      { text: "Make it read dates", idempotency_key: "route-conv-0001" },
    ],
    [
      "POST /api/product-projects/:id/proposals/:pid/apply",
      "POST",
      `${p}/proposals/none/apply`,
      {},
    ],
    [
      "POST /api/product-projects/:id/builds",
      "POST",
      `${p}/builds`,
      {
        idempotency_key: "route-build-0001",
        revision: 1,
        budget: {
          max_input_tokens: 10_000,
          max_output_tokens: 2_000,
          max_seconds: 60,
          max_cost_cents: 10,
        },
      },
    ],
    [
      "POST /api/builds/:id/retry",
      "POST",
      `/api/builds/${ids.cancelled ?? ids.build}/retry`,
      { idempotency_key: "route-retry-0001" },
    ],
    [
      "POST /api/product-projects/:id/app-versions/:job/current",
      "POST",
      `${p}/app-versions/${ids.build}/current`,
      {},
    ],
    [
      "POST /api/product-projects/:id/app-versions/:job/checks",
      "POST",
      `${p}/app-versions/${ids.build}/checks`,
      { idempotency_key: "route-check-0001" },
    ],
    [
      "POST /api/product-projects/:id/app-versions/:job/preview",
      "POST",
      `${p}/app-versions/${ids.build}/preview`,
      {},
    ],
    [
      "POST /api/product-projects/:id/runtime/invocations",
      "POST",
      `${p}/runtime/invocations`,
      {
        idempotency_key: "route-trial-0001",
        artifact_job: ids.build,
        text: "Fictional invoice total 1.00 USD",
      },
    ],
    ["POST /api/product-projects/:id/test-cases", "POST", `${p}/test-cases`, { cases: [] }],
    [
      "POST /api/product-projects/:id/evaluations",
      "POST",
      `${p}/evaluations`,
      { artifact_job: ids.build },
    ],
    [
      "POST /api/product-projects/:id/releases",
      "POST",
      `${p}/releases`,
      { artifact_job: ids.build },
    ],
    [
      "POST /api/product-projects/:id/releases/:rid/rollback",
      "POST",
      `${p}/releases/${ids.release}/rollback`,
      {},
    ],
    [
      "POST /api/product-projects/:id/releases/app-terms",
      "POST",
      `${p}/releases/app-terms`,
      { artifact_job: ids.build, app_terms: { access: "free" } },
    ],
    ["POST /api/product-projects/:id/releases/withdraw", "POST", `${p}/releases/withdraw`, {}],
    [
      "POST /api/product-projects/:id/manual-checks",
      "POST",
      `${p}/manual-checks`,
      { revision: 1, check_key: "manual_fallback", outcome: "done", note: "" },
    ],
    [
      "POST /api/imports",
      "POST",
      "/api/imports",
      { idempotency_key: "route-import-0001", business_id: ids.biz, name: "Imported" },
    ],
  ];
  if (ids.importId)
    calls.push(
      [
        "PATCH /api/imports/:id",
        "PATCH",
        `/api/imports/${ids.importId}`,
        { version: ids.importVersion ?? 1, name: "Renamed import" },
      ],
      [
        "POST /api/imports/:id/inspections",
        "POST",
        `/api/imports/${ids.importId}/inspections`,
        {
          idempotency_key: "route-inspect-0001",
          file_name: "package.json",
          content: JSON.stringify({ name: "imported-product", dependencies: { hono: "4.6.0" } }),
        },
      ],
      [
        "PUT /api/imports/:id/dependencies/:category",
        "PUT",
        `/api/imports/${ids.importId}/dependencies/hosting`,
        { version: ids.importVersion ?? 1, uses: false },
      ],
      [
        "POST /api/imports/:id/source/connect",
        "POST",
        `/api/imports/${ids.importId}/source/connect`,
        { connection: "fictional-fixture", repository: "ledgerline-fictional/invoice-reader" },
      ],
      [
        "POST /api/imports/:id/source/disconnect",
        "POST",
        `/api/imports/${ids.importId}/source/disconnect`,
        {},
      ],
      [
        "POST /api/imports/:id/source/inspections",
        "POST",
        `/api/imports/${ids.importId}/source/inspections`,
        { idempotency_key: "route-source-0001", ref: "main" },
      ],
    );
  return calls;
}

describe("003wf3 S-6/S-21: gated owner routes during an actual managed closing", () => {
  it("each refuses handover_in_progress for the gated business; a second business of the same founder is never refused by the gate; reads continue", async () => {
    const w = await handoverWorld();
    worlds.push(w);
    // Objects the routes act on, made before the closing through the real routes.
    const cost = await w.seller(`/api/businesses/${w.biz}/costs`, "POST", {
      label: "Domain",
      monthly_cents: 100,
    });
    const costId = String(cost.body?.cost?.id ?? cost.body?.id ?? "none");
    const release = (w.rows(
      "SELECT id, artifact_job FROM runtime_releases WHERE state = 'active'",
    )[0] ?? {}) as Json;
    const second = await w.seller("/api/product-projects", "POST", {
      idea: "A second fictional business for the noninterference check",
      foundation: "ai_api",
    });
    expect([200, 201], JSON.stringify(second.body)).toContain(second.status);
    const other = {
      biz: second.body.project.business_id as string,
      project: second.body.project.id as string,
    };
    // Real objects for the routes, through the real routes, before the closing.
    const find = (o: unknown, k: string): unknown => {
      if (!o || typeof o !== "object") return undefined;
      if (k in (o as Json)) return (o as Json)[k];
      for (const v of Object.values(o as Json)) {
        const x = find(v, k);
        if (x !== undefined) return x;
      }
      return undefined;
    };
    const insp = await w.seller(`/api/businesses/${w.biz}/customer-offer-inspections`, "POST", {
      release_id: release.id,
      plan_id: 1,
    });
    const reviewed = find(insp.body, "terms_digest") as string | undefined;
    expect(reviewed, JSON.stringify(insp.body).slice(0, 300)).toMatch(/^[0-9a-f]{64}$/);
    const profile = (await w.seller(`/api/businesses/${w.biz}/public-profile`)).body;
    const draftRev = find(profile, "draft_rev") as number;
    const review = find(profile, "review") as string;
    const revision = (await w.seller(`/api/product-projects/${w.b.w.f.project}/revisions/1`)).body;
    const built = await w.seller(`/api/product-projects/${w.b.w.f.project}/builds`, "POST", {
      idempotency_key: "route-build-cancelled-0001",
      revision: 1,
      budget: {
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_seconds: 60,
        max_cost_cents: 10,
      },
    });
    const cancelled = built.body.job.id as string;
    // An import for this business (Astra 03:05: its routes are exercised, not only classified).
    const imported = await w.seller("/api/imports", "POST", {
      idempotency_key: "route-import-pre-0001",
      business_id: w.biz,
      name: "Imported product",
    });
    expect([200, 201], JSON.stringify(imported.body).slice(0, 300)).toContain(imported.status);
    const importId = String(find(imported.body, "id"));
    const importVersion = Number(find(imported.body.workspace ?? imported.body, "version"));
    expect((await w.seller(`/api/builds/${cancelled}/cancel`, "POST", {})).status).toBe(200);
    await w.toBuyerAccepted();
    const c = await w.act(w.seller, FOUNDER, "accept");
    expect(c.check?.body.resolution).toMatchObject({ result: "closing" });
    expect(w.handoverRow()?.state).toBe("gated");

    const refusedHere: string[] = [];
    const notRefused: string[] = [];
    for (const [route, method, path, body] of gatedCalls({
      biz: w.biz,
      project: w.b.w.f.project as string,
      costId,
      offer: w.b.offer,
      release: String(release.id),
      build: String(release.artifact_job),
      importId,
      importVersion,
      cancelled,
      reviewed,
      draftRev,
      review,
      revision,
    })) {
      const r = await w.seller(path, method, body);
      if (r.status === 409 && r.body?.code === "handover_in_progress") refusedHere.push(route);
      else
        notRefused.push(
          `${route} → ${r.status} ${r.body?.code ?? ""} ${String(r.body?.error ?? "").slice(0, 80)}`,
        );
    }
    // Routes whose objects this composition can't have (an app version, a Studio proposal, a
    // preview origin: the synthetic model builds extraction products only). Refused for that
    // reason, nothing admitted; their gate is proven in the app-product service test (D5).
    const unavailable = notRefused.filter((x) =>
      UNAVAILABLE_HERE.some((r) => x.startsWith(`${r} →`)),
    );
    expect(unavailable.map((x) => x.split(" → ")[0])).toEqual(UNAVAILABLE_HERE);
    for (const x of unavailable) expect(x).toMatch(/→ (404|409) /);
    expect(
      notRefused.filter((x) => !unavailable.includes(x)),
      "gated owner routes not refused for the gated business",
    ).toEqual([]);
    // The same founder's other business: the gate never refuses it (other errors may apply).
    const hit: string[] = [];
    for (const [route, method, path, body] of gatedCalls({
      biz: other.biz,
      project: other.project,
      costId: "none",
      offer: "none",
      release: "none",
      build: "none",
      importId: null,
    })) {
      const r = await w.seller(path, method, body);
      if (r.body?.code === "handover_in_progress") hit.push(route);
    }
    expect(hit, "routes refused for a business that isn't changing hands").toEqual([]);
    // Reads continue for the gated business (§14.2: every GET is allowed), including the
    // owner-only reads that check the owner's period of control after their awaited reads.
    const reads = [
      `/api/businesses/${w.biz}`,
      `/api/sales/${w.biz}`,
      `/api/businesses/${w.biz}/books`,
      `/api/businesses/${w.biz}/digital-desk`,
      `/api/businesses/${w.biz}/value`,
      `/api/businesses/${w.biz}/public-profile`,
    ];
    const answers = new Map<string, { status: number; body: Json }>();
    for (const path of reads) answers.set(path, await w.seller(path));
    const failed = [...answers]
      .filter(([, r]) => r.status !== 200)
      .map(([p, r]) => `${p} → ${r.status} ${r.body?.code ?? ""}`);
    expect(failed, "owner reads during the handover").toEqual([]);
    const got = (suffix: string) =>
      (answers.get(`/api/businesses/${w.biz}${suffix}`) as { body: Json }).body;
    expect(got("").business?.id ?? got("").id).toBe(w.biz);
    expect(got("/books")).toHaveProperty("basis");
    expect(got("/books")).toHaveProperty("period_months", 12);
    expect(got("/value")).toHaveProperty("estimate");
    expect(typeof find(got("/public-profile"), "draft_rev")).toBe("number");
    expect(got("/digital-desk")).toBeTruthy();
    // A real edit of the second business takes effect while the first is changing hands.
    const renamed = await w.seller(`/api/businesses/${other.biz}`, "PATCH", {
      name: "Second business, renamed",
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(w.rows("SELECT name FROM businesses WHERE id = ?", other.biz)[0]?.name).toBe(
      "Second business, renamed",
    );
    expect(w.rows("SELECT name FROM businesses WHERE id = ?", w.biz)[0]?.name).not.toBe(
      "Renamed during the closing",
    );
    expect(refusedHere.length + UNAVAILABLE_HERE.length).toBe(
      gatedCalls({
        biz: "",
        project: "",
        costId: "",
        offer: "",
        release: "",
        build: "",
        importId: "counted",
      }).length,
    );
  }, 120_000);
});

describe("003wf3 S-21: admission after an awaited request body or chain read", () => {
  it("a write whose body arrives only after the gate closed is refused in its own transaction; an inspection whose chain read was overtaken by the gate is refused after it", async () => {
    const w = await handoverWorld();
    worlds.push(w);
    // The seller's own session, with its cookie, for requests whose body is streamed.
    const jar = new Map<string, string>();
    const call = async (path: string, method = "GET", body?: unknown) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await w.composed.app.request(path, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const set of res.headers.getSetCookie()) {
        const [pair] = set.split(";");
        const [name, ...rest] = (pair as string).split("=");
        if (rest.join("=")) jar.set(name as string, rest.join("="));
      }
      return { status: res.status, body: (await res.json().catch(() => null)) as Json };
    };
    await signInAs(call, FOUNDER, w.b.ava);
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    /** A request whose JSON body is sent only when `send()` is called. */
    const streamed = (path: string, method: string, json: Json) => {
      let push: (s: string) => void = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (s) => {
            controller.enqueue(new TextEncoder().encode(s));
            controller.close();
          };
        },
      });
      const res = w.composed.app.request(path, {
        method,
        headers: { "content-type": "application/json", cookie: cookie() },
        body: stream,
        duplex: "half",
      } as RequestInit);
      return {
        send: () => push(JSON.stringify(json)),
        answer: async () => {
          const r = await res;
          return { status: r.status, body: (await r.json().catch(() => null)) as Json };
        },
      };
    };
    const release = w.rows("SELECT id FROM runtime_releases WHERE state = 'active'")[0] as Json;
    await w.toBuyerAccepted();
    // Both requests are admitted at the route before the closing; their bodies are still coming.
    const rename = streamed(`/api/businesses/${w.biz}`, "PATCH", { name: "Renamed late" });
    const budget = streamed(`/api/businesses/${w.biz}/build-budget`, "PUT", { limit_cents: 7 });
    // The inspection's chain read answers from before the closing and waits there.
    const held = w.b.rpc.holdNextQuery();
    const inspecting = call(`/api/businesses/${w.biz}/customer-offer-inspections`, "POST", {
      release_id: release.id,
      plan_id: 1,
    });
    await held.entered;
    const c = await w.act(w.seller, FOUNDER, "accept");
    expect(c.check?.body.resolution).toMatchObject({ result: "closing" });
    expect(w.handoverRow()?.state).toBe("gated");
    rename.send();
    budget.send();
    held.open();
    for (const r of [await rename.answer(), await budget.answer(), await inspecting])
      expect([r.status, r.body?.code], JSON.stringify(r.body)).toEqual([
        409,
        "handover_in_progress",
      ]);
    const biz = w.rows("SELECT name FROM businesses WHERE id = ?", w.biz)[0] as Json;
    expect(biz.name).not.toBe("Renamed late");
    expect(
      w
        .rows("SELECT limit_cents FROM build_budgets WHERE business_id = ?", w.biz)
        .map((b) => b.limit_cents),
    ).not.toContain(7);
  }, 90_000);
});
