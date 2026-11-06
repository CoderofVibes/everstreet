// Plan step 6 (docs/design/TEAM_AUTHORITY.md §2): business teams. The owner's Team page (invite a
// NEAR account with a role, change a role, revoke, each person's history), the invitee's
// "Teams and invitations" (accept, decline, leave), and a member's workspace (the case board,
// within their role). Every read is bound to the person, their session and the business, so a
// late answer for an earlier scope is never shown. Membership is never shown as ownership.

import { useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { type MemberRole, type MyTeams, type TeamView, teamApi } from "../teamApi.ts";
import { ago } from "../via.ts";
import { WorkflowCaseBoard } from "./WorkflowCaseBoard.tsx";

const STATE_WORDS: Record<string, string> = {
  invited: "Invited, not yet accepted",
  active: "On the team",
  declined: "Declined",
  revoked: "Removed",
  left: "Left",
};
const EVENT_WORDS: Record<string, string> = {
  invited: "Invited",
  accepted: "Accepted",
  declined: "Declined",
  role_changed: "Role changed",
  revoked: "Removed",
  left: "Left",
};

function SignInFirst({ why }: { why: string }) {
  const { requireSignIn } = useSession();
  return (
    <div className="page empty">
      <h2>{why}</h2>
      <button type="button" className="btn btn-primary" onClick={() => requireSignIn(why)}>
        Sign in or join
      </button>
    </div>
  );
}

/** The owner's team: who can do what inside Everstreet, kept apart from control. */
export function TeamPage({ businessId }: { businessId: string }) {
  const { person, sessionEpoch } = useSession();
  const scope = person ? `${person.id}#${sessionEpoch}|${businessId}` : null;
  const read = useActorRead(scope, (w) => teamApi.team(w.slice(w.lastIndexOf("|") + 1)));
  const [shown, setShown] = useState<{ scope: string; view: TeamView } | null>(null);
  const [account, setAccount] = useState("");
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<MemberRole>("case_worker");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The latest answer for THIS scope: an action's answer, or the read.
  const view = shown && shown.scope === scope ? shown.view : read.state.data;

  const act = async (f: () => Promise<TeamView>, done: string) => {
    if (busy || !scope) return;
    const mine = scope;
    setBusy(true);
    setNote(null);
    try {
      const v = await f();
      setShown({ scope: mine, view: v });
      setNote(done);
    } catch (e) {
      setNote((e as Error).message);
      read.retry();
    } finally {
      setBusy(false);
    }
  };

  if (!person) return <SignInFirst why="Sign in to see this business's team." />;
  if (!view)
    return (
      <div className="page" role="status">
        {read.state.error ? (
          <p className="notice error">
            {read.state.error}{" "}
            <button type="button" className="btn btn-quiet btn-sm" onClick={read.retry}>
              Retry
            </button>
          </p>
        ) : (
          <p className="muted">Loading the team…</p>
        )}
      </div>
    );

  const current = view.members.filter((m) => m.state === "invited" || m.state === "active");
  const past = view.members.filter((m) => m.state !== "invited" && m.state !== "active");
  return (
    <div className="page narrow team-page">
      <div className="eyebrow">
        <Link to={`/desk/${businessId}`}>Back to the desk</Link>
      </div>
      <h1 className="display" style={{ fontSize: 36 }}>
        Team
      </h1>
      <p className="notice info" role="note">
        {view.is_not}
      </p>
      <p className="muted">
        On-chain authority is separate: the business's owner and the operators named on its contract
        are under <Link to={`/desk/${businessId}/continuity`}>Ownership and continuity</Link>.
      </p>
      {view.ended_by_change_of_control > 0 && (
        <p className="muted">
          {view.ended_by_change_of_control === 1
            ? "1 membership from an earlier owner ended"
            : `${view.ended_by_change_of_control} memberships from an earlier owner ended`}{" "}
          when control of this business changed. Their details stay private to that owner.
        </p>
      )}

      <section className="card" aria-labelledby="team-invite">
        <h2 id="team-invite">Invite someone</h2>
        <fieldset className="team-invite">
          {view.invite_by === "account" ? (
            <label className="field">
              <span>Their NEAR account</span>
              <input
                className="input"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="e.g. maya.testnet"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : (
            <label className="field">
              <span>Person (fictional preview people)</span>
              <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {view.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="radiogroup" aria-label="Role" className="team-roles">
            {view.roles.map((r) => (
              <label key={r.key} className="team-role">
                <input
                  type="radio"
                  name="team-role"
                  checked={role === r.key}
                  onChange={() => setRole(r.key)}
                />{" "}
                <strong>{r.label}</strong>
                <span className="muted"> · {r.detail}</span>
              </label>
            ))}
          </div>
          {/* Never disabled under the user's focus: aria-disabled while saving (focus stays). */}
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={busy}
            onClick={() =>
              act(
                () =>
                  teamApi.invite(
                    businessId,
                    view.invite_by === "account"
                      ? { account: account.trim(), role }
                      : { person_id: pick, role },
                  ),
                "Invited. They get access only after they accept.",
              ).then(() => {
                setAccount("");
                setPick("");
              })
            }
          >
            Send the invitation
          </button>
        </fieldset>
      </section>

      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}

      <section className="card" aria-labelledby="team-now">
        <h2 id="team-now">On the team</h2>
        {current.length === 0 ? (
          <p className="muted">Nobody yet. Only you run this business here.</p>
        ) : (
          <ul className="team-list">
            {current.map((m) => (
              <li key={m.id} className="team-member">
                <div>
                  <strong>{m.name ?? m.account}</strong>
                  {m.name && m.account && <span className="mono muted"> {m.account}</span>}
                  <div className="muted">
                    {m.role_label} · {STATE_WORDS[m.state]} · invited {ago(m.invited_at)}
                  </div>
                </div>
                <div className="row team-actions">
                  <label className="sr-only" htmlFor={`role-${m.id}`}>
                    Role for {m.name ?? m.account}
                  </label>
                  <select
                    id={`role-${m.id}`}
                    className="input"
                    value={m.role}
                    aria-disabled={busy}
                    onChange={(e) =>
                      act(
                        () => teamApi.setRole(businessId, m.id, e.target.value as MemberRole),
                        "Role changed. It applies to their next action.",
                      )
                    }
                  >
                    {view.roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-disabled={busy}
                    onClick={() =>
                      act(
                        () => teamApi.revoke(businessId, m.id),
                        m.state === "invited"
                          ? "Invitation withdrawn."
                          : "Removed. Their next action is refused.",
                      )
                    }
                  >
                    {m.state === "invited" ? "Withdraw the invitation" : "Remove from the team"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details className="card">
          <summary>Earlier members and invitations ({past.length})</summary>
          <ul className="team-list">
            {past.map((m) => (
              <li key={m.id}>
                <strong>{m.name ?? m.account}</strong>{" "}
                <span className="muted">
                  {STATE_WORDS[m.state]} ·{" "}
                  {m.history.map((h) => `${EVENT_WORDS[h.kind] ?? h.kind} ${ago(h.at)}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** "Teams and invitations" in My activity: what the person was invited to, and their teams. */
export function MyTeamsSection() {
  const { person, sessionEpoch } = useSession();
  const scope = person ? `${person.id}#${sessionEpoch}` : null;
  const read = useActorRead(scope, () => teamApi.mine());
  const [shown, setShown] = useState<{ scope: string; v: MyTeams } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const v = shown && shown.scope === scope ? shown.v : read.state.data;
  if (!scope || !v || (v.invites.length === 0 && v.teams.length === 0)) return null;
  const act = async (f: () => Promise<MyTeams>, done: string) => {
    if (busy) return;
    const mine = scope;
    setBusy(true);
    setNote(null);
    try {
      setShown({ scope: mine, v: await f() });
      setNote(done);
    } catch (e) {
      setNote((e as Error).message);
      read.retry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="my-teams">
      <h2 id="my-teams">Teams and invitations</h2>
      <p className="muted">{v.is_not}</p>
      {v.invites.map((i) => (
        <div key={i.id} className="message">
          <strong>{i.business_name}</strong> invited you as <strong>{i.role_label}</strong>.
          <div className="muted">{i.role_detail}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              aria-disabled={busy}
              onClick={() =>
                act(() => teamApi.respond(i.id, true), `You're on ${i.business_name}'s team.`)
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              aria-disabled={busy}
              onClick={() => act(() => teamApi.respond(i.id, false), "Declined.")}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      {v.teams.map((t) => (
        <div key={t.id} className="message row">
          <div>
            <Link to={`/team/${t.business_id}`}>
              <strong>{t.business_name}</strong>
            </Link>{" "}
            <span className="muted">· {t.role_label}</span>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-disabled={busy}
            onClick={() => act(() => teamApi.leave(t.id), `You left ${t.business_name}'s team.`)}
          >
            Leave
          </button>
        </div>
      ))}
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

/** A member's workspace for one business: their role and the case board within it. */
export function TeamWorkspacePage({ businessId }: { businessId: string }) {
  const { person, sessionEpoch } = useSession();
  const scope = person ? `${person.id}#${sessionEpoch}|${businessId}` : null;
  const read = useActorRead(scope, (w) => teamApi.workspace(w.slice(w.lastIndexOf("|") + 1)));
  const ws = read.state.data;
  if (!person) return <SignInFirst why="Sign in to open this team." />;
  if (!ws)
    return (
      <div className="page" role="status">
        {read.state.error ? (
          <>
            <h2>Not available</h2>
            <p>You aren't on this business's team now, or it doesn't exist.</p>
            <Link to="/activity">My activity</Link>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );
  return (
    <div className="page team-workspace">
      <div className="eyebrow">Team · {ws.role_label}</div>
      <h1 className="display" style={{ fontSize: 36 }}>
        {ws.business.name}
      </h1>
      <p className="muted">{ws.is_not}</p>
      <WorkflowCaseBoard businessId={ws.business.id} canMove={ws.can_move} member />
    </div>
  );
}
