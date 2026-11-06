// Business teams: app membership, never control (docs/design/TEAM_AUTHORITY.md §2). The owner
// invites a NEAR account (or, in the local preview, a fictional person) with a role; the invitee
// accepts; the owner can change the role or revoke, and a member can leave. A membership grants
// named capabilities inside Everstreet's own services only: nothing on chain, no keys, no money.
// It records the owner generation it was granted under, so any change of control (a sale) ends
// it. Every request reads the active row at request time; writes check it again in their
// transaction. Every change is an append-only event.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const MEMBER_ROLES = {
  case_worker: {
    label: "Case worker",
    detail: "Reads the case board and moves cases to their next stage, with notes.",
    caps: ["cases.read", "cases.move"],
  },
  viewer: {
    label: "Viewer",
    detail: "Reads the case board. Changes nothing.",
    caps: ["cases.read"],
  },
} as const;
export type MemberRole = keyof typeof MEMBER_ROLES;
export type Capability = "cases.read" | "cases.move";

/** What every member is told (and the owner sees): what membership is not. */
export const MEMBERSHIP_IS_NOT =
  "Team membership is access inside Everstreet only. A member isn't an owner, a signer or an operator on the business's contract, holds no keys and can't move money, release, sell or change the team.";

const LIMIT = 20;
const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;

type State = "invited" | "active" | "declined" | "revoked" | "left";
interface MemberRow {
  id: string;
  business_id: string;
  invite_account: string | null;
  invite_person: string | null;
  person_id: string | null;
  role: MemberRole;
  state: State;
  owner_generation: number;
  invited_by: string;
  created_at: string;
  updated_at: string;
}

const iso = () => new Date().toISOString();

/**
 * The NEAR accounts a person holds here: proven at verified sign-in (person_accounts) or linked
 * in the local preview (chain_accounts). Invitations and a buying team's signer match either.
 */
export function accountsOfPerson(db: Db, personId: string): string[] {
  return (
    db
      .prepare(
        "SELECT account_id FROM person_accounts WHERE person_id = ? UNION SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ? ORDER BY 1",
      )
      .all(personId, personId) as { account_id: string }[]
  ).map((r) => r.account_id);
}

export class Members {
  constructor(
    readonly db: Db,
    readonly store: Store,
    /** Local preview: invites may name a fictional person instead of an account. */
    readonly localPreview: boolean,
  ) {}

  /** The business's current owner generation (the number of recorded changes of control). */
  generation(businessId: string) {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
  }

  private row(id: string) {
    return this.db.prepare("SELECT * FROM business_members WHERE id = ?").get(id) as
      | MemberRow
      | undefined;
  }

  private event(memberId: string, kind: string, actor: string, detail = "") {
    this.db
      .prepare(
        "INSERT INTO business_member_events (member_id, at, kind, actor_id, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .run(memberId, iso(), kind, actor, detail);
  }

  private accountsOf(personId: string) {
    return accountsOfPerson(this.db, personId);
  }

  /** Whether this invite is addressed to the viewer (their linked account, or in preview, them). */
  private addressedTo(m: MemberRow, viewer: Person) {
    if (m.invite_person) return m.invite_person === viewer.id;
    return !!m.invite_account && this.accountsOf(viewer.id).includes(m.invite_account);
  }

  /** The viewer's ACTIVE membership of this business under its current owner, or null. */
  private active(viewer: Person, businessId: string) {
    return (
      (this.db
        .prepare(
          "SELECT * FROM business_members WHERE business_id = ? AND person_id = ? AND state = 'active' AND owner_generation = ?",
        )
        .get(businessId, viewer.id, this.generation(businessId)) as MemberRow | undefined) ?? null
    );
  }

  /**
   * Who may do `cap` on this business: its owner, or an active member of the current owner
   * generation whose role includes it. Anyone else: the same 404 as a missing business. A member
   * whose role lacks the capability: 403 saying which role it needs.
   */
  staff(viewer: Person, businessId: string, cap: Capability) {
    const generation = this.generation(businessId);
    if (this.store.isOwnerOf(viewer, businessId))
      return { kind: "owner" as const, role: null, businessId, generation };
    const m = this.active(viewer, businessId);
    if (!m) throw new HttpError(404, "No such business");
    if (!(MEMBER_ROLES[m.role].caps as readonly string[]).includes(cap))
      throw new HttpError(
        403,
        `Your role on this team (${MEMBER_ROLES[m.role].label}) can't do this; ask the owner.`,
        "member_role",
      );
    return { kind: "member" as const, role: m.role, businessId, generation };
  }

  /**
   * After an await or inside a write: the same person still may, under the same owner
   * generation (a revoke, a role change or a change of control refuses; nothing is shown or saved).
   */
  still(viewer: Person, epoch: { businessId: string; generation: number }, cap: Capability) {
    const now = this.staff(viewer, epoch.businessId, cap);
    if (now.generation !== epoch.generation)
      throw new HttpError(
        409,
        "Control of this business changed while this was loading, so nothing was shown or saved. Try again.",
        "control_changed",
      );
    return now;
  }

  // ---------- the owner ----------

  list(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const generation = this.generation(businessId);
    const rows = this.db
      .prepare(
        "SELECT * FROM business_members WHERE business_id = ? AND owner_generation = ? ORDER BY created_at, rowid",
      )
      .all(businessId, generation) as unknown as MemberRow[];
    // Earlier owners' teams ended at the change of control; only their number is shown here.
    const ended = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM business_members WHERE business_id = ? AND owner_generation < ? AND state IN ('invited','active')",
        )
        .get(businessId, generation) as { n: number }
    ).n;
    return {
      members: rows.map((m) => this.view(m)),
      ended_by_change_of_control: ended,
      roles: Object.entries(MEMBER_ROLES).map(([key, r]) => ({
        key,
        label: r.label,
        detail: r.detail,
      })),
      is_not: MEMBERSHIP_IS_NOT,
      invite_by: this.localPreview ? "person" : "account",
      people: this.localPreview
        ? (
            this.db
              .prepare("SELECT id, display_name FROM people WHERE id != ? ORDER BY display_name")
              .all(viewer.id) as { id: string; display_name: string }[]
          ).slice(0, 50)
        : [],
    };
  }

  private view(m: MemberRow) {
    const person = m.person_id ?? m.invite_person;
    const name = person
      ? ((
          this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(person) as
            | { display_name: string }
            | undefined
        )?.display_name ?? null)
      : null;
    return {
      id: m.id,
      account: m.invite_account,
      name,
      role: m.role,
      role_label: MEMBER_ROLES[m.role].label,
      state: m.state,
      invited_at: m.created_at,
      updated_at: m.updated_at,
      history: (
        this.db
          .prepare(
            "SELECT at, kind, detail FROM business_member_events WHERE member_id = ? ORDER BY seq",
          )
          .all(m.id) as { at: string; kind: string; detail: string }[]
      ).slice(-20),
    };
  }

  private role(raw: unknown): MemberRole {
    if (raw !== "case_worker" && raw !== "viewer")
      throw new HttpError(400, "Choose a role: case worker or viewer", "bad_role");
    return raw;
  }

  invite(
    viewer: Person,
    businessId: string,
    input: { account?: unknown; person_id?: unknown; role?: unknown },
  ) {
    const role = this.role(input.role);
    let account: string | null = null;
    let person: string | null = null;
    if (typeof input.account === "string" && input.account.trim()) {
      account = input.account.trim().toLowerCase();
      if (!ACCOUNT.test(account))
        throw new HttpError(400, "That isn't a NEAR account id", "bad_account");
    } else if (this.localPreview && typeof input.person_id === "string") {
      person = input.person_id;
      if (!this.db.prepare("SELECT 1 FROM people WHERE id = ?").get(person))
        throw new HttpError(404, "No such person");
    } else throw new HttpError(400, "Name the NEAR account to invite", "bad_account");
    return this.store.tx(() => {
      const b = this.store.ownedBusiness(viewer, businessId);
      this.store.requireNoHandover(businessId);
      if (person === viewer.id || (account && this.accountsOf(viewer.id).includes(account)))
        throw new HttpError(409, "You own this business already", "is_owner");
      const generation = this.generation(b.id);
      const open = this.db
        .prepare(
          "SELECT * FROM business_members WHERE business_id = ? AND owner_generation = ? AND state IN ('invited','active')",
        )
        .all(b.id, generation) as unknown as MemberRow[];
      if (open.length >= LIMIT)
        throw new HttpError(409, `A team has at most ${LIMIT} people`, "team_full");
      if (
        open.some(
          (m) =>
            (account && m.invite_account === account) ||
            (person && (m.invite_person === person || m.person_id === person)),
        )
      )
        throw new HttpError(409, "They're invited or on the team already", "already_member");
      const id = randomUUID();
      const t = iso();
      this.db
        .prepare(
          `INSERT INTO business_members (id, business_id, invite_account, invite_person, person_id, role, state, owner_generation, invited_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, 'invited', ?, ?, ?, ?)`,
        )
        .run(id, b.id, account, person, role, generation, viewer.id, t, t);
      this.event(id, "invited", viewer.id, role);
      return this.list(viewer, businessId);
    });
  }

  private ownersMember(viewer: Person, businessId: string, memberId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const m = this.row(memberId);
    if (!m || m.business_id !== businessId || m.owner_generation !== this.generation(businessId))
      throw new HttpError(404, "No such team member");
    return m;
  }

  setRole(viewer: Person, businessId: string, memberId: string, input: { role?: unknown }) {
    const role = this.role(input.role);
    return this.store.tx(() => {
      const m = this.ownersMember(viewer, businessId, memberId);
      this.store.requireNoHandover(businessId);
      if (m.state !== "invited" && m.state !== "active")
        throw new HttpError(409, "This person isn't on the team", "not_member");
      if (m.role !== role) {
        this.db
          .prepare("UPDATE business_members SET role = ?, updated_at = ? WHERE id = ?")
          .run(role, iso(), m.id);
        this.event(m.id, "role_changed", viewer.id, `${m.role} -> ${role}`);
      }
      return this.list(viewer, businessId);
    });
  }

  revoke(viewer: Person, businessId: string, memberId: string) {
    return this.store.tx(() => {
      const m = this.ownersMember(viewer, businessId, memberId);
      if (m.state !== "invited" && m.state !== "active")
        throw new HttpError(409, "This person isn't on the team", "not_member");
      this.db
        .prepare("UPDATE business_members SET state = 'revoked', updated_at = ? WHERE id = ?")
        .run(iso(), m.id);
      this.event(m.id, "revoked", viewer.id, m.state === "invited" ? "invite withdrawn" : "");
      return this.list(viewer, businessId);
    });
  }

  // ---------- the invitee and member ----------

  /** Invites addressed to the viewer, and the teams they're on (current owner generation only). */
  mine(viewer: Person) {
    const accounts = this.accountsOf(viewer.id);
    const rows = this.db
      .prepare(
        `SELECT m.*, b.name AS business_name FROM business_members m JOIN businesses b ON b.id = m.business_id
          WHERE m.state IN ('invited','active')
            AND (m.person_id = ? OR m.invite_person = ? OR m.invite_account IN (SELECT value FROM json_each(?)))
          ORDER BY m.created_at DESC LIMIT 50`,
      )
      .all(viewer.id, viewer.id, JSON.stringify(accounts)) as unknown as (MemberRow & {
      business_name: string;
    })[];
    const current = rows.filter((m) => m.owner_generation === this.generation(m.business_id));
    const out = (m: MemberRow & { business_name: string }) => ({
      id: m.id,
      business_id: m.business_id,
      business_name: m.business_name,
      role: m.role,
      role_label: MEMBER_ROLES[m.role].label,
      role_detail: MEMBER_ROLES[m.role].detail,
      invited_at: m.created_at,
    });
    return {
      invites: current.filter((m) => m.state === "invited" && this.addressedTo(m, viewer)).map(out),
      teams: current.filter((m) => m.state === "active" && m.person_id === viewer.id).map(out),
      is_not: MEMBERSHIP_IS_NOT,
    };
  }

  respond(viewer: Person, memberId: string, input: { accept?: unknown }) {
    return this.store.tx(() => {
      const m = this.row(memberId);
      if (m?.state !== "invited" || !this.addressedTo(m, viewer))
        throw new HttpError(404, "No such invitation");
      if (m.owner_generation !== this.generation(m.business_id))
        throw new HttpError(
          409,
          "This business changed hands since you were invited, so the invitation ended",
          "control_changed",
        );
      if (this.store.isOwnerOf(viewer, m.business_id))
        throw new HttpError(409, "You own this business already", "is_owner");
      const accept = input.accept === true;
      if (accept) this.store.requireNoHandover(m.business_id);
      this.db
        .prepare(
          "UPDATE business_members SET state = ?, person_id = ?, updated_at = ? WHERE id = ? AND state = 'invited'",
        )
        .run(accept ? "active" : "declined", accept ? viewer.id : null, iso(), m.id);
      this.event(m.id, accept ? "accepted" : "declined", viewer.id);
      return this.mine(viewer);
    });
  }

  leave(viewer: Person, memberId: string) {
    return this.store.tx(() => {
      const m = this.row(memberId);
      if (m?.state !== "active" || m.person_id !== viewer.id)
        throw new HttpError(404, "No such team");
      this.db
        .prepare("UPDATE business_members SET state = 'left', updated_at = ? WHERE id = ?")
        .run(iso(), m.id);
      this.event(m.id, "left", viewer.id);
      return this.mine(viewer);
    });
  }

  /** A member's view of a business they work on: name and their role (404 otherwise). */
  workspace(viewer: Person, businessId: string) {
    const s = this.staff(viewer, businessId, "cases.read");
    const b = this.db.prepare("SELECT name FROM businesses WHERE id = ?").get(businessId) as {
      name: string;
    };
    return {
      business: { id: businessId, name: b.name },
      role: s.kind === "owner" ? "owner" : s.role,
      role_label: s.kind === "owner" ? "Owner" : MEMBER_ROLES[s.role as MemberRole].label,
      can_move: s.kind === "owner" || s.role === "case_worker",
      is_not: MEMBERSHIP_IS_NOT,
    };
  }
}
