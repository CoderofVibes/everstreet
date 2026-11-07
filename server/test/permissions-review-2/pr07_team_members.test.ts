// Promise 3: team members see and do only what their role allows, only while the grant is live,
// and never after revocation or a change of hands.
import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr07: team members", () => {
  it("a viewer reads the board, can't move a case, and loses access on revoke", async () => {
    const w = await reviewWorld({ product: "relaydesk" });
    const use = await w.customerUse();
    expect(use.unit).toBe("charged");
    const invited = await w.ava(`/api/businesses/${w.biz}/members`, "POST", {
      person_id: w.dana.id,
      role: "viewer",
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const memberId = invited.body.members[0].id as string;
    // Before accepting: nothing.
    expect((await w.dana(`/api/businesses/${w.biz}/workspace`)).status).toBe(404);
    expect((await w.dana(`/api/businesses/${w.biz}/workflow-cases`)).status).toBe(404);
    // Someone else can't accept Dana's invitation.
    expect(
      (await w.cara(`/api/me/teams/${memberId}/respond`, "POST", { accept: true })).status,
    ).toBe(404);
    const accepted = await w.dana(`/api/me/teams/${memberId}/respond`, "POST", { accept: true });
    expect(accepted.status).toBe(200);
    const board = await w.dana(`/api/businesses/${w.biz}/workflow-cases`);
    expect(board.status).toBe(200);
    expect(board.body.cases.length).toBe(1);
    const caseId = board.body.cases[0].request_id as string;
    const one = await w.dana(`/api/businesses/${w.biz}/workflow-cases/${caseId}`);
    expect(one.status).toBe(200);
    // A viewer moves nothing.
    const move = await w.dana(`/api/businesses/${w.biz}/workflow-cases/${caseId}/advance`, "POST", {
      to_stage: board.body.cases[0].next.key,
    });
    expect(move.status).toBe(403);
    expect(move.body.code).toBe("member_role");
    // A member is not an owner: the owner's routes stay closed.
    for (const path of [
      `/api/businesses/${w.biz}`,
      `/api/businesses/${w.biz}/members`,
      `/api/businesses/${w.biz}/customer-offers`,
      `/api/businesses/${w.biz}/books`,
      `/api/businesses/${w.biz}/agent-purchases`,
      `/api/sales/${w.biz}`,
      `/api/companions/${w.biz}`,
    ])
      expect((await w.dana(path)).status, path).toBe(404);
    // A customer's result stays the customer's.
    expect((await w.dana(`/api/customer/uses/${caseId}/result`)).status).toBe(404);
    // Promoted to case worker: moves; revoked: nothing, at once.
    expect(
      (
        await w.ava(`/api/businesses/${w.biz}/members/${memberId}/role`, "POST", {
          role: "case_worker",
        })
      ).status,
    ).toBe(200);
    const moved = await w.dana(
      `/api/businesses/${w.biz}/workflow-cases/${caseId}/advance`,
      "POST",
      {
        to_stage: board.body.cases[0].next.key,
      },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(
      (await w.ava(`/api/businesses/${w.biz}/members/${memberId}/revoke`, "POST")).status,
    ).toBe(200);
    expect((await w.dana(`/api/businesses/${w.biz}/workspace`)).status).toBe(404);
    expect((await w.dana(`/api/businesses/${w.biz}/workflow-cases`)).status).toBe(404);
    expect(
      (
        await w.dana(`/api/businesses/${w.biz}/workflow-cases/${caseId}/advance`, "POST", {
          to_stage: "resolved",
        })
      ).status,
    ).toBe(404);
    // A member can't revoke, re-role or invite.
    expect(
      (
        await w.dana(`/api/businesses/${w.biz}/members`, "POST", {
          person_id: w.cara.id,
          role: "viewer",
        })
      ).status,
    ).toBe(404);
  });

  it("the seller's team and invitations end with the sale", async () => {
    const w = await reviewWorld({ product: "relaydesk" });
    const invited = await w.ava(`/api/businesses/${w.biz}/members`, "POST", {
      person_id: w.dana.id,
      role: "case_worker",
    });
    const memberId = invited.body.members[0].id as string;
    await w.dana(`/api/me/teams/${memberId}/respond`, "POST", { accept: true });
    const pending = await w.ava(`/api/businesses/${w.biz}/members`, "POST", {
      person_id: w.stranger.id,
      role: "viewer",
    });
    const pendingId = pending.body.members.find((m: { state: string }) => m.state === "invited")
      .id as string;
    expect((await w.dana(`/api/businesses/${w.biz}/workspace`)).status).toBe(200);
    await w.proposeAndRegister();
    await w.fundAndClose();
    expect((await w.dana(`/api/businesses/${w.biz}/workspace`)).status).toBe(404);
    expect((await w.dana(`/api/businesses/${w.biz}/workflow-cases`)).status).toBe(404);
    expect((await w.dana("/api/me/teams")).body.teams).toEqual([]);
    const late = await w.stranger(`/api/me/teams/${pendingId}/respond`, "POST", { accept: true });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("control_changed");
    // The new owner's board is theirs; the seller's former member isn't on it.
    const list = await w.noah(`/api/businesses/${w.biz}/members`);
    expect(list.status).toBe(200);
    expect(list.body.members).toEqual([]);
    expect(list.body.ended_by_change_of_control).toBe(2);
  });
});
