// Permissions review, promise 5: one business's private records are never reachable through
// another business's id. Noah (a stranger to Ava's business) founds his own business and then
// names Ava's offers, members, intents, cases and releases under HIS business or project id.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

describe("pr05: another business's id in the path", () => {
  it("every two-id owner route refuses a foreign child id", async () => {
    const s = await saleWorld();
    const { ava, noah, biz, offerId, w } = s;
    // Ava's team member and a cost.
    const inv = await ava(`/api/businesses/${biz}/members`, "POST", {
      person_id: w.dana.id,
      role: "viewer",
    });
    const memberId = inv.body.members[0].id as string;
    const intent = (await ava(`/api/businesses/${biz}/v3/intents`)).body.intents?.[0]?.id;
    const avaRelease = w.release;
    // Noah's own business and product project.
    const p = (await noah("/api/projects", "POST", { route: "started", name: "Noah Co" })).body;
    const biz2 = p.business.id as string;
    const proj2 = (
      await noah("/api/product-projects", "POST", {
        business_id: biz2,
        foundation: "ai_api",
        idea: "A fictional extractor of Noah's own",
        name: "Noah Parse",
      })
    ).body.project.id as string;

    const attempts: [string, string, unknown?][] = [
      [`/api/businesses/${biz2}/customer-offers/${offerId}/retire`, "POST", {}],
      [`/api/businesses/${biz2}/customer-offers/${offerId}/agent-access`, "PUT", { enabled: true }],
      [`/api/businesses/${biz2}/members/${memberId}/revoke`, "POST", {}],
      [`/api/businesses/${biz2}/members/${memberId}/role`, "POST", { role: "case_worker" }],
      [`/api/businesses/${biz2}/v3/intents/${intent ?? "none"}`, "GET"],
      [`/api/businesses/${biz2}/v3/intents/${intent ?? "none"}/reconcile`, "POST", {}],
      [`/api/product-projects/${proj2}/releases/${avaRelease}/rollback`, "POST", {}],
      [`/api/product-projects/${proj2}/app-versions/${w.f.job ?? "none"}`, "GET"],
    ];
    for (const [path, method, body] of attempts) {
      const r = await noah(path, method, body);
      expect([path, r.status]).toEqual([path, 404]);
    }
    // Nothing of Ava's changed.
    const offer = w.state.store.db
      .prepare("SELECT state FROM customer_offers WHERE id = ?")
      .get(offerId) as { state: string };
    expect(offer.state).toBe("active");
    const m = w.state.store.db
      .prepare("SELECT state, role FROM business_members WHERE id = ?")
      .get(memberId) as { state: string; role: string };
    expect(m).toEqual({ state: "invited", role: "viewer" });
  });

  it("a build, evaluation, invocation or check id is not readable by another owner", async () => {
    const s = await saleWorld();
    const { noah, w } = s;
    const job = w.state.store.db
      .prepare("SELECT id FROM build_jobs WHERE business_id = ? LIMIT 1")
      .get(s.biz) as { id: string } | undefined;
    const run = w.state.store.db
      .prepare("SELECT id FROM eval_runs WHERE business_id = ? LIMIT 1")
      .get(s.biz) as { id: string } | undefined;
    if (job) {
      expect((await noah(`/api/builds/${job.id}`)).status).toBe(404);
      expect((await noah(`/api/builds/${job.id}/events`)).status).toBe(404);
      expect((await noah(`/api/builds/${job.id}/cancel`, "POST", {})).status).toBe(404);
    }
    if (run) expect((await noah(`/api/evaluations/${run.id}`)).status).toBe(404);
    // Unrelated-account reads of Ava's business-scoped resources.
    for (const path of [
      `/api/businesses/${s.biz}`,
      `/api/businesses/${s.biz}/customer-offers`,
      `/api/businesses/${s.biz}/members`,
      `/api/businesses/${s.biz}/books`,
      `/api/businesses/${s.biz}/handover-record`,
      `/api/product-projects/${w.f.project}`,
      `/api/product-projects/${w.f.project}/conversation`,
    ])
      expect([path, (await noah(path)).status]).toEqual([path, 404]);
  });
});
