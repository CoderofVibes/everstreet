// Plan step 6 (docs/design/TEAM_AUTHORITY.md §2): business teams are app membership, never
// control. Through the real routes over the Relaydesk sale world (its accepted requests open real
// cases): an invite grants nothing until accepted by the account it names; a case worker reads and
// moves cases, a viewer only reads, a stranger and a former member get 404; the owner changes
// roles and revokes; a revoke while a case's content is being read returns nothing; events are
// append-only; and a Direct sale ends the seller's team (the buyer starts with none). Synthetic
// chain and wallet; fictional people.

import { describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

type Caller = ((
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>) & { id: string };

async function world() {
  const s = await saleWorld({ product: "relaydesk" });
  const maya = s.w.person("Maya Reed") as Caller;
  s.w.link(maya.id, "maya.near");
  const sam = s.w.person("Sam Iyer") as Caller;
  // One accepted request, so the board has a case.
  const use = await s.customerUse();
  expect(use.unit).toBe("charged");
  const biz = s.biz;
  const members = (who: Caller = s.ava) => who(`/api/businesses/${biz}/members`);
  const board = (who: Caller) => who(`/api/businesses/${biz}/workflow-cases`);
  return { s, maya, sam, biz, members, board, caseId: use.id as string };
}

describe("plan step 6: business teams", () => {
  it("an invite grants nothing until the named account accepts; roles limit what members do", async () => {
    const { s, maya, sam, biz, members, board, caseId } = await world();
    // Invite Maya by her NEAR account as a case worker; Sam (preview: by person) as a viewer.
    const inv = await s.ava(`/api/businesses/${biz}/members`, "POST", {
      account: "maya.near",
      role: "case_worker",
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.is_not).toMatch(/isn't an owner, a signer or an operator/);
    expect(
      (
        await s.ava(`/api/businesses/${biz}/members`, "POST", {
          account: "maya.near",
          role: "viewer",
        })
      ).body.code,
    ).toBe("already_member");
    await s.ava(`/api/businesses/${biz}/members`, "POST", { person_id: sam.id, role: "viewer" });
    // Pending: nothing yet.
    expect((await board(maya)).status).toBe(404);
    const mine = (await maya("/api/me/teams")).body;
    expect(mine.invites).toEqual([
      expect.objectContaining({ business_id: biz, role: "case_worker" }),
    ]);
    expect(mine.teams).toEqual([]);
    // Nobody else can answer Maya's invitation.
    const invite = mine.invites[0].id as string;
    expect((await sam(`/api/me/teams/${invite}/respond`, "POST", { accept: true })).status).toBe(
      404,
    );
    expect(
      (await s.stranger(`/api/me/teams/${invite}/respond`, "POST", { accept: true })).status,
    ).toBe(404);
    const ok = await maya(`/api/me/teams/${invite}/respond`, "POST", { accept: true });
    expect(ok.body.teams).toEqual([
      expect.objectContaining({ business_id: biz, role: "case_worker" }),
    ]);
    const samInvite = (await sam("/api/me/teams")).body.invites[0].id as string;
    await sam(`/api/me/teams/${samInvite}/respond`, "POST", { accept: true });

    // The case worker reads and moves a case; the viewer reads only; a stranger sees nothing.
    expect((await board(maya)).body.cases.map((c: Json) => c.request_id)).toEqual([caseId]);
    const open = await maya(`/api/businesses/${biz}/workflow-cases/${caseId}`);
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body.fields?.length).toBeGreaterThan(0);
    const c = open.body.case as Json;
    const next = c.next.key as string;
    const moved = await maya(`/api/businesses/${biz}/workflow-cases/${caseId}/advance`, "POST", {
      to_stage: next,
      note: "Picked up by the team",
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.case.stage.key).toBe(next);
    expect((await board(sam)).status).toBe(200);
    const nope = await sam(`/api/businesses/${biz}/workflow-cases/${caseId}/advance`, "POST", {
      to_stage: "x",
    });
    expect([nope.status, nope.body.code]).toEqual([403, "member_role"]);
    expect((await board(s.stranger)).status).toBe(404);
    // Members can't administer the team or anything else the owner does.
    expect((await members(maya)).status).toBe(404);
    expect(
      (await maya(`/api/businesses/${biz}/members`, "POST", { account: "x.near", role: "viewer" }))
        .status,
    ).toBe(404);
    expect((await maya(`/api/businesses/${biz}/books?months=1`)).status).toBe(404);
    expect((await maya(`/api/businesses/${biz}/customer-offers`)).status).toBe(404);
    // The member's workspace says what they are and aren't.
    const ws = (await maya(`/api/businesses/${biz}/workspace`)).body;
    expect(ws).toMatchObject({ role: "case_worker", can_move: true });
    expect((await sam(`/api/businesses/${biz}/workspace`)).body.can_move).toBe(false);

    // Role change and revoke take effect on the next request.
    const list = (await members()).body.members as Json[];
    const samRow = list.find((m) => m.name === "Sam Iyer") as Json;
    await s.ava(`/api/businesses/${biz}/members/${samRow.id}/role`, "POST", {
      role: "case_worker",
    });
    expect((await sam(`/api/businesses/${biz}/workspace`)).body.can_move).toBe(true);
    const mayaRow = list.find((m) => m.account === "maya.near") as Json;
    await s.ava(`/api/businesses/${biz}/members/${mayaRow.id}/revoke`, "POST", {});
    expect((await board(maya)).status).toBe(404);
    expect((await maya(`/api/businesses/${biz}/workflow-cases/${caseId}`)).status).toBe(404);
    // Sam leaves.
    expect((await sam(`/api/me/teams/${samRow.id}/leave`, "POST", {})).body.teams).toEqual([]);
    expect((await board(sam)).status).toBe(404);
    // The owner's list keeps the history of each.
    const after = (await members()).body.members as Json[];
    expect(after.find((m) => m.id === mayaRow.id)).toMatchObject({ state: "revoked" });
    expect(after.find((m) => m.id === mayaRow.id)?.history.map((h: Json) => h.kind)).toEqual([
      "invited",
      "accepted",
      "revoked",
    ]);
    expect(after.find((m) => m.id === samRow.id)?.history.map((h: Json) => h.kind)).toEqual([
      "invited",
      "accepted",
      "role_changed",
      "left",
    ]);
    // Events are append-only.
    expect(() =>
      s.w.state.store.db.prepare("UPDATE business_member_events SET kind = 'x'").run(),
    ).toThrow(/append-only/);
    expect(() => s.w.state.store.db.prepare("DELETE FROM business_member_events").run()).toThrow(
      /append-only/,
    );
  });

  it("an invite to an account proven at verified sign-in reaches that person (browser pass)", async () => {
    // The browser pass found invites matched only preview-linked accounts; verified sign-in
    // records the account in person_accounts.
    const { s, biz, board } = await world();
    const lee = s.w.person("Lee Park") as Caller;
    s.w.state.store.db
      .prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?)",
      )
      .run("lee.testnet", lee.id, new Date().toISOString());
    await s.ava(`/api/businesses/${biz}/members`, "POST", {
      account: "lee.testnet",
      role: "viewer",
    });
    const invites = (await lee("/api/me/teams")).body.invites as Json[];
    expect(invites).toHaveLength(1);
    await lee(`/api/me/teams/${invites[0]?.id}/respond`, "POST", { accept: true });
    expect((await board(lee)).status).toBe(200);
  });

  it("a revoke while a case's content is read returns nothing", async () => {
    const { s, maya, biz, caseId } = await world();
    await s.ava(`/api/businesses/${biz}/members`, "POST", {
      account: "maya.near",
      role: "case_worker",
    });
    const invite = (await maya("/api/me/teams")).body.invites[0].id as string;
    await maya(`/api/me/teams/${invite}/respond`, "POST", { accept: true });
    // Hold the protected read; revoke meanwhile; then let it finish.
    const load = s.protection.load.bind(s.protection);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    s.protection.load = async (...a: Parameters<typeof load>) => {
      await held;
      return load(...a);
    };
    const pending = maya(`/api/businesses/${biz}/workflow-cases/${caseId}`);
    await new Promise((r) => setTimeout(r, 20));
    const row = ((await s.ava(`/api/businesses/${biz}/members`)).body.members as Json[])[0] as Json;
    await s.ava(`/api/businesses/${biz}/members/${row.id}/revoke`, "POST", {});
    release();
    const r = await pending;
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain("Export");
  });

  it("a Direct sale ends the seller's team; the buyer starts with none; a stale invite can't be accepted", async () => {
    const { s, maya, sam, biz, members, board } = await world();
    await s.ava(`/api/businesses/${biz}/members`, "POST", {
      account: "maya.near",
      role: "case_worker",
    });
    const invite = (await maya("/api/me/teams")).body.invites[0].id as string;
    await maya(`/api/me/teams/${invite}/respond`, "POST", { accept: true });
    await s.ava(`/api/businesses/${biz}/members`, "POST", { person_id: sam.id, role: "viewer" });
    const samInvite = (await sam("/api/me/teams")).body.invites[0].id as string;
    expect((await board(maya)).status).toBe(200);

    expect(
      (await s.act(s.ava, SELLER, "propose", proposal({ floor: "100000" }))).check,
    ).toBeTruthy();
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    expect((await s.customerUse()).unit).toBe("charged");
    await s.act(s.noah, BUYER, "accept");
    const close = await s.act(s.ava, SELLER, "accept");
    expect(close.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });

    // The seller's team: no access, no team listed, the pending invite ended.
    expect((await board(maya)).status).toBe(404);
    expect((await maya("/api/me/teams")).body).toMatchObject({ invites: [], teams: [] });
    const stale = await sam(`/api/me/teams/${samInvite}/respond`, "POST", { accept: true });
    expect([stale.status, stale.body.code]).toEqual([409, "control_changed"]);
    // The buyer starts with no team; only the number of ended memberships is shown.
    const nv = (await members(s.noah)).body;
    expect(nv.members).toEqual([]);
    expect(nv.ended_by_change_of_control).toBe(2);
    expect(JSON.stringify(nv)).not.toContain("maya.near");
    expect((await members(s.ava)).status).toBe(404);
    // The buyer invites their own team.
    const own = await s.noah(`/api/businesses/${biz}/members`, "POST", {
      account: "maya.near",
      role: "viewer",
    });
    expect(own.status).toBe(201);
  });
});
