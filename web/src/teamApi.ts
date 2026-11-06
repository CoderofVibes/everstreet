// Plan step 6 (docs/design/TEAM_AUTHORITY.md): business teams for the browser: the owner's team
// (invite, role, revoke), the invitee's invitations and teams (accept, decline, leave), and a
// member's workspace. Every answer is checked before it is shown. Browser-side types only.

import { call, MalformedAnswer } from "./customerApi.ts";

export type MemberRole = "case_worker" | "viewer";
export interface TeamMember {
  id: string;
  account: string | null;
  name: string | null;
  role: MemberRole;
  role_label: string;
  state: "invited" | "active" | "declined" | "revoked" | "left";
  invited_at: string;
  history: { at: string; kind: string; detail: string }[];
}
export interface TeamView {
  members: TeamMember[];
  ended_by_change_of_control: number;
  roles: { key: MemberRole; label: string; detail: string }[];
  is_not: string;
  invite_by: "account" | "person";
  people: { id: string; display_name: string }[];
}
export interface MyTeamEntry {
  id: string;
  business_id: string;
  business_name: string;
  role: MemberRole;
  role_label: string;
  role_detail: string;
  invited_at: string;
}
export interface MyTeams {
  invites: MyTeamEntry[];
  teams: MyTeamEntry[];
  is_not: string;
}
export interface TeamWorkspace {
  business: { id: string; name: string };
  role: MemberRole | "owner";
  role_label: string;
  can_move: boolean;
  is_not: string;
}

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected shape (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const arr = (v: unknown, where: string) => (Array.isArray(v) ? v : fail(where));
const role = (v: unknown, where: string): MemberRole =>
  v === "case_worker" || v === "viewer" ? v : fail(where);
const STATES = ["invited", "active", "declined", "revoked", "left"] as const;

function parseTeam(raw: unknown): TeamView {
  const o = obj(raw, "team");
  return {
    members: arr(o.members, "members")
      .slice(0, 50)
      .map((x) => {
        const m = obj(x, "member");
        const state = m.state as TeamMember["state"];
        if (!STATES.includes(state)) fail("member.state");
        return {
          id: str(m.id, "member.id"),
          account: m.account === null ? null : str(m.account, "member.account"),
          name: m.name === null ? null : str(m.name, "member.name"),
          role: role(m.role, "member.role"),
          role_label: str(m.role_label, "member.role_label"),
          state,
          invited_at: str(m.invited_at, "member.invited_at"),
          history: arr(m.history, "member.history")
            .slice(0, 20)
            .map((h) => {
              const e = obj(h, "history");
              return {
                at: str(e.at, "history.at"),
                kind: str(e.kind, "history.kind"),
                detail: str(e.detail, "history.detail"),
              };
            }),
        };
      }),
    ended_by_change_of_control:
      typeof o.ended_by_change_of_control === "number" ? o.ended_by_change_of_control : 0,
    roles: arr(o.roles, "roles").map((x) => {
      const r = obj(x, "role");
      return {
        key: role(r.key, "role.key"),
        label: str(r.label, "role.label"),
        detail: str(r.detail, "role.detail"),
      };
    }),
    is_not: str(o.is_not, "is_not"),
    invite_by: o.invite_by === "person" ? "person" : "account",
    people: (Array.isArray(o.people) ? o.people : []).slice(0, 50).map((x) => {
      const p = obj(x, "person");
      return { id: str(p.id, "person.id"), display_name: str(p.display_name, "person.name") };
    }),
  };
}

function parseMine(raw: unknown): MyTeams {
  const o = obj(raw, "teams");
  const entry = (x: unknown): MyTeamEntry => {
    const e = obj(x, "entry");
    return {
      id: str(e.id, "entry.id"),
      business_id: str(e.business_id, "entry.business"),
      business_name: str(e.business_name, "entry.name"),
      role: role(e.role, "entry.role"),
      role_label: str(e.role_label, "entry.role_label"),
      role_detail: str(e.role_detail, "entry.role_detail"),
      invited_at: str(e.invited_at, "entry.invited_at"),
    };
  };
  return {
    invites: arr(o.invites, "invites").slice(0, 50).map(entry),
    teams: arr(o.teams, "teams").slice(0, 50).map(entry),
    is_not: str(o.is_not, "is_not"),
  };
}

function parseWorkspace(raw: unknown): TeamWorkspace {
  const o = obj(raw, "workspace");
  const b = obj(o.business, "workspace.business");
  return {
    business: { id: str(b.id, "business.id"), name: str(b.name, "business.name") },
    role: o.role === "owner" ? "owner" : role(o.role, "workspace.role"),
    role_label: str(o.role_label, "workspace.role_label"),
    can_move: o.can_move === true,
    is_not: str(o.is_not, "workspace.is_not"),
  };
}

const enc = encodeURIComponent;
export const teamApi = {
  team: async (b: string) => parseTeam(await call(`/api/businesses/${enc(b)}/members`)),
  invite: async (b: string, body: { account?: string; person_id?: string; role: MemberRole }) =>
    parseTeam(await call(`/api/businesses/${enc(b)}/members`, "POST", body)),
  setRole: async (b: string, m: string, r: MemberRole) =>
    parseTeam(await call(`/api/businesses/${enc(b)}/members/${enc(m)}/role`, "POST", { role: r })),
  revoke: async (b: string, m: string) =>
    parseTeam(await call(`/api/businesses/${enc(b)}/members/${enc(m)}/revoke`, "POST", {})),
  mine: async () => parseMine(await call("/api/me/teams")),
  respond: async (m: string, accept: boolean) =>
    parseMine(await call(`/api/me/teams/${enc(m)}/respond`, "POST", { accept })),
  leave: async (m: string) => parseMine(await call(`/api/me/teams/${enc(m)}/leave`, "POST", {})),
  workspace: async (b: string) => parseWorkspace(await call(`/api/businesses/${enc(b)}/workspace`)),
};
