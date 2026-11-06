# Teams and cooperatives: membership versus control (plan step 6, M6)

Plan step 6 (CLAUDE_RESUME.md). Grounding: the platform vision's "Team, authority and recovery"
screen ("an invited teammate is not automatically an owner or signer"), its cooperative rule
("a buying organization with members, discussion, evidence access and a named authorized
representative; governance, pooled investment and fundraising need a separate legal and
technical model"), Acceptance M6 ("team/cooperative authority corresponds to actual enforced
control, not a labelled lead"), and Astra's assessment ("define membership versus controlling
authority before implementation; no implicit shared-key model or unapproved legal ownership
claims"; "persist exact membership/roles and prove revocation/stale-access behavior").

## 1. Three kinds of authority, never merged

| Kind | Where it lives | Who | What it can do |
|---|---|---|---|
| **Control** | The business contract (owner, generation) mirrored in `businesses.owner_id` + `ownership` | One owner account | Everything the owner does today: release, offer, price, sell, appoint operators, change the team |
| **On-chain operators** | The contract's operator list (caps, e.g. metering) | Named NEAR accounts | Only the contract methods their caps allow; shown read-only, appointed through existing owner flows |
| **App membership (new)** | Everstreet's database (`business_members`) | People the owner invited, who accepted | Named capabilities inside Everstreet's own services; nothing on chain; no keys; no money |

A member is never an owner, signer or operator, and the screens say so. Nothing here creates a
shared key, a joint account or an ownership share.

## 2. Business teams (app membership)

**Roles** (each a fixed capability set, checked by the server on every request):

- **Case worker:** reads the business's case board and moves cases (Relaydesk workflow), with
  notes. Reads the case's submitted fields like the owner (they are written to the business).
- **Viewer:** reads the case board. Changes nothing.

Owners keep everything else. Members can't release, offer, price, publish, sell, see wallets or
treasury actions, start builds or spend budgets, see Studio conversations, or change the team.

**Lifecycle**, every step an append-only event (`business_member_events`):

1. **Invite.** The owner names a NEAR account (verified mode) or, in the local preview, a
   fictional person, plus a role. A pending invite grants nothing.
2. **Accept or decline.** The invitee, signed in as that account, sees the invite (business name,
   role, what it allows, who invited) and accepts. Only then is the membership active.
3. **Change role / revoke.** The owner can change the role or revoke at any time; a member can
   leave. Revocation takes effect on the next request: there is no cached grant.
4. **Change of control ends it.** Each membership records the owner generation it was granted
   under. After a sale (or any change of owner) every membership of the earlier generation stops
   granting anything, and the new owner's team page shows them as ended by the change of control.
   The buyer invites their own team. ("Every other operator ends with the close.")

**Enforcement.** One check, `members.can(viewer, businessId, capability)`, reads the active row
(accepted, not revoked, same owner generation, capability in role) at request time. Writes check
it again inside the write transaction (a revoke or sale during an await refuses the write). The
existing owner-only routes are unchanged; member access is added only on the case board and the
operations read. A former member gets the same 404 as a stranger.

**Acting context.** The member's business appears under "Teams" with their role; pages scope reads
to the person, session epoch and business, as for owners (006b2), so a revoked or signed-out
session's late answer is never shown.

## 3. Cooperatives and buying teams

Buying teams exist (`buyers`, `buyer_members`: research, evidence, approve). For a cooperative
(and any buying team) this step adds:

- **Membership history.** Every add, role change and removal is an append-only event; access to
  rooms is checked against the current row each time (already the case: `role()` reads it per
  request). (Buying-team adds keep their existing direct add, which works in the local preview
  only; an invite-and-accept flow for buying teams in verified mode is not built yet.)
- **A named authorized representative.** The lead names one member (or themselves) as the person
  who signs for the team: the NEAR account that funds and accepts a deal. Shown to sellers in the
  team's access request and in the sale room. Only the lead can change it, recorded.
- **Recorded member positions, not governance.** On a candidate, members with the approve role can
  record "support / object / abstain" with a note. The record is shown to the team as a
  discussion aid and labelled **not binding**: the representative's wallet decides on chain.

Not built (needs its own legal and technical model, per the vision): pooled funds, fractional
interests, fundraising, binding votes, a threshold-controlled organization account
(`organization_controller`).

## 4. Evidence planned

- Server tests: invite/accept/decline, role limits on every member route (case worker vs viewer vs
  stranger), revoke during an awaited read and inside a write, leave, a sale ends memberships (seller
  members refused, buyer's team empty), wrong account can't accept, a former member gets 404.
- Web: the Team page (owner), the invite in the invitee's activity, a member's case board, the
  buying team's representative and positions.
- Browser: owner invites, member accepts and works a case, owner revokes, member's next action is
  refused; phone width and keyboard.

## 5. As built (Nov 5, late)

- **Server.** `members.ts` (roles, invite by NEAR account or preview person, accept/decline,
  role change, revoke, leave, `staff()`/`still()` checks bound to the owner generation;
  `accountsOfPerson` matches accounts proven at verified sign-in or linked in the preview);
  tables `business_members` and append-only `business_member_events`; the case board's list,
  open and move use the member check (move re-checked in its write transaction). Buying teams:
  append-only `buyer_member_events`, `buyer_representatives` (lead only; needs a linked
  account), `buyer_positions` (approve role; labelled not binding); the seller sees the
  representative in the access request. Routes classified in the handover route test (invite and
  role change gated during a closing).
- **Web.** Desk link "Team" to `/desk/:id/team`; "Teams and invitations" in My activity; member
  workspace `/team/:id` with the case board (read-only for viewers); buying team: "Signs for the
  team", team history, "Team positions" on the shortlist.
- **Evidence.** `server/test/team-members.test.ts` (acceptance by the named account only, case
  worker vs viewer vs stranger, role change, revoke, leave, a verified-sign-in account, a revoke
  while a case's content is read, append-only events, a Direct sale ends the seller's team),
  `server/test/acquire.test.ts` (representative, positions, history), `web/test/teamApi.test.ts`.
  Browser (relaydesk harness, synthetic wallet and chain): the owner invites `cara.near` by
  keyboard at 375 px; Cara accepts in My activity, opens the team workspace, reads the case and
  moves it; the owner removes her; her workspace then says she isn't on the team.
- **Not built.** Buying-team invite-and-accept in verified mode; assigning cases to a specific
  member; threshold or pooled control (needs its own legal and technical model).
