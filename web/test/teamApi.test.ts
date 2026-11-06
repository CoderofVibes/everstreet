// Plan step 6: the browser's team answers are checked before they're shown. A well-formed team,
// invitation list and workspace parse; an unknown role or state is refused as malformed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MalformedAnswer } from "../src/customerApi.ts";
import { teamApi } from "../src/teamApi.ts";

const answer = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
afterEach(() => vi.unstubAllGlobals());

const team = {
  members: [
    {
      id: "m1",
      account: "maya.testnet",
      name: null,
      role: "case_worker",
      role_label: "Case worker",
      state: "invited",
      invited_at: "2026-11-05T00:00:00Z",
      history: [{ at: "2026-11-05T00:00:00Z", kind: "invited", detail: "case_worker" }],
    },
  ],
  ended_by_change_of_control: 0,
  roles: [{ key: "viewer", label: "Viewer", detail: "Reads" }],
  is_not: "Not an owner.",
  invite_by: "account",
  people: [],
};

describe("team answers", () => {
  it("parses the owner's team, invitations and a workspace", async () => {
    answer(team);
    expect((await teamApi.team("b1")).members[0]).toMatchObject({
      account: "maya.testnet",
      state: "invited",
    });
    answer({
      invites: [
        {
          id: "m1",
          business_id: "b1",
          business_name: "Relaydesk",
          role: "viewer",
          role_label: "Viewer",
          role_detail: "Reads",
          invited_at: "x",
        },
      ],
      teams: [],
      is_not: "Not an owner.",
    });
    expect((await teamApi.mine()).invites).toHaveLength(1);
    answer({
      business: { id: "b1", name: "Relaydesk" },
      role: "viewer",
      role_label: "Viewer",
      can_move: false,
      is_not: "Not an owner.",
    });
    expect(await teamApi.workspace("b1")).toMatchObject({ role: "viewer", can_move: false });
  });

  it("refuses an unknown role or state", async () => {
    answer({ ...team, members: [{ ...team.members[0], role: "owner" }] });
    await expect(teamApi.team("b1")).rejects.toBeInstanceOf(MalformedAnswer);
    answer({ ...team, members: [{ ...team.members[0], state: "owner" }] });
    await expect(teamApi.team("b1")).rejects.toBeInstanceOf(MalformedAnswer);
  });
});
