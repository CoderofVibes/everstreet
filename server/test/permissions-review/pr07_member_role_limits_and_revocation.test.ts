// Permissions review, promise 3: team members do only what their role allows, only while the
// grant is live. A viewer can't move cases; a revoked member and a member who left get 404;
// an invite can't be accepted by someone it wasn't addressed to.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

describe("pr07: team members", () => {
  it("roles, revocation and leaving are enforced on every member route", async () => {
    const s = await saleWorld({ product: "relaydesk" });
    const { ava, biz, w } = s;
    const vic = w.person("Vic Viewer");
    const inv = await ava(`/api/businesses/${biz}/members`, "POST", {
      person_id: vic.id,
      role: "viewer",
    });
    expect(inv.status).toBe(201);
    const memberId = inv.body.members[0].id as string;
    // Pending invite grants nothing.
    expect((await vic(`/api/businesses/${biz}/workflow-cases`)).status).toBe(404);
    // Someone else can't accept it.
    expect(
      (await w.dana(`/api/me/teams/${memberId}/respond`, "POST", { accept: true })).status,
    ).toBe(404);
    expect((await vic(`/api/me/teams/${memberId}/respond`, "POST", { accept: true })).status).toBe(
      200,
    );
    // A viewer reads the board but can't move a case.
    expect((await vic(`/api/businesses/${biz}/workflow-cases`)).status).toBe(200);
    const use = await s.customerUse();
    expect(use.status).toBe(201);
    const adv = await vic(`/api/businesses/${biz}/workflow-cases/${use.id}/advance`, "POST", {
      to_stage: "triage",
    });
    expect(adv.status).toBe(403);
    // Members can't reach owner-only records.
    for (const path of [
      `/api/businesses/${biz}`,
      `/api/businesses/${biz}/members`,
      `/api/businesses/${biz}/customer-offers`,
      `/api/businesses/${biz}/books`,
      `/api/businesses/${biz}/value`,
      `/api/product-projects/${w.f.project}`,
      `/api/product-projects/${w.f.project}/conversation`,
      `/api/sales/${biz}`,
    ])
      expect([path, (await vic(path)).status]).toEqual([path, 404]);
    // Revoked: the next request is refused.
    expect(
      (await ava(`/api/businesses/${biz}/members/${memberId}/revoke`, "POST", {})).status,
    ).toBe(200);
    expect((await vic(`/api/businesses/${biz}/workflow-cases`)).status).toBe(404);
    expect((await vic(`/api/businesses/${biz}/workspace`)).status).toBe(404);
    expect((await vic(`/api/businesses/${biz}/workflow-cases/${use.id}`)).status).toBe(404);
    // A revoked member can't re-accept or leave into a live state.
    expect((await vic(`/api/me/teams/${memberId}/respond`, "POST", { accept: true })).status).toBe(
      404,
    );
    expect((await vic(`/api/me/teams/${memberId}/leave`, "POST", {})).status).toBe(404);
  });

  it("a case worker reads submitted fields but a stranger with the request id does not", async () => {
    const s = await saleWorld({ product: "relaydesk" });
    const { ava, biz, w, stranger } = s;
    const kay = w.person("Kay Worker");
    const inv = await ava(`/api/businesses/${biz}/members`, "POST", {
      person_id: kay.id,
      role: "case_worker",
    });
    const memberId = inv.body.members[0].id as string;
    await kay(`/api/me/teams/${memberId}/respond`, "POST", { accept: true });
    const use = await s.customerUse();
    expect(use.status).toBe(201);
    const one = await kay(`/api/businesses/${biz}/workflow-cases/${use.id}`);
    expect(one.status).toBe(200);
    expect((await stranger(`/api/businesses/${biz}/workflow-cases/${use.id}`)).status).toBe(404);
    expect((await w.dana(`/api/businesses/${biz}/workflow-cases/${use.id}`)).status).toBe(404);
  });
});
