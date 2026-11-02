// My activity: everything this person has as a customer. Bookings show OpenSeat's live status
// and who promoted a waitlisted place (checked against NEAR); needs show founders' replies.

import { useCallback, useEffect, useState } from "react";
import { api, type MyBooking, type MyNeed } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { ago, when } from "../via.ts";

type ActivityData = Awaited<ReturnType<typeof api.activity>>;

function BookingCard({ b, onChange }: { b: MyBooking; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const past = Date.parse(b.ends_at) < Date.now();
  return (
    <div className="message">
      <div className="row">
        <div>
          <strong>{b.title}</strong>
          <div className="muted" style={{ fontSize: 14 }}>
            <Link to={`/b/${b.business.slug}`}>{b.business.name}</Link> · {when(b.starts_at)}
            {b.where ? ` · ${b.where}` : ""}
          </div>
        </div>
        <span className="spacer" />
        {b.status === "confirmed" && <span className="pill lime">Place confirmed</span>}
        {b.status === "waitlisted" && <span className="pill caution">Waitlist #{b.position}</span>}
        {b.status === "cancelled" && <span className="pill">Cancelled</span>}
        {b.status === "unknown" && (
          <span className="pill caution">Status can't be checked right now</span>
        )}
      </div>
      {b.promoted_by && b.status === "confirmed" && (
        <p className="near-note">
          A place opened and you were moved up from the waitlist by {b.promoted_by}, whose
          permission was checked against the booking service's contract on NEAR testnet (authority
          generation {b.promoted_generation}).
        </p>
      )}
      <div className="row" style={{ marginTop: 8, fontSize: 14 }}>
        <span className="muted">
          Your reference: <code>{b.reference}</code>. Keep it private; it is what proves the place
          is yours.
        </span>
        <span className="spacer" />
        {b.status === "confirmed" && (
          <a className="btn btn-secondary" href={`/api/activity/bookings/${b.id}/calendar.ics`}>
            Add to calendar
          </a>
        )}
        {(b.status === "confirmed" || b.status === "waitlisted") && !past && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  b.status === "confirmed"
                    ? "Give up your place? The next person waiting gets it."
                    : "Leave the waitlist?",
                )
              )
                return;
              setBusy(true);
              await api.cancelBooking(b.id);
              onChange();
            }}
          >
            {b.status === "confirmed" ? "Cancel my place" : "Leave the waitlist"}
          </button>
        )}
      </div>
    </div>
  );
}

function NeedCard({ n, onChange }: { n: MyNeed; onChange: (needs: MyNeed[]) => void }) {
  const [replies, setReplies] = useState<Record<string, string>>({});
  const open = n.status === "open" && !n.expired;
  return (
    <div className="message">
      <div className="row">
        <strong style={{ flex: 1 }}>“{n.text}”</strong>
        {open ? (
          <span className="pill lime">
            Open until {new Date(n.expires_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="pill">{n.expired ? "Expired" : "Closed"}</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        Posted {ago(n.created_at)} · {n.allow_replies ? "founders may reply" : "no replies"} · your
        name is not shown
      </div>
      {n.responses.length === 0 && open && n.allow_replies && (
        <p className="muted" style={{ fontSize: 14 }}>
          No replies yet.
        </p>
      )}
      {n.responses.map((r) => (
        <div key={r.id} style={{ marginTop: 10 }}>
          <div className="meta">
            <Link to={`/b/${r.slug}?via=need`}>{r.business_name}</Link> replied {ago(r.created_at)}
          </div>
          <blockquote>{r.message}</blockquote>
          {r.reply ? (
            <div className="reply">
              <strong>You:</strong> {r.reply}
            </div>
          ) : (
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Reply"
                value={replies[r.id] ?? ""}
                onChange={(e) => setReplies({ ...replies, [r.id]: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!replies[r.id]?.trim()}
                onClick={async () =>
                  onChange((await api.replyToResponse(r.id, replies[r.id] ?? "")).needs)
                }
              >
                Reply
              </button>
            </div>
          )}
        </div>
      ))}
      {open && (
        <button
          type="button"
          className="btn btn-quiet"
          style={{ paddingLeft: 0, marginTop: 6 }}
          onClick={async () => onChange((await api.closeNeed(n.id)).needs)}
        >
          Close this request
        </button>
      )}
    </div>
  );
}

export function Activity() {
  const { person, requireSignIn } = useSession();
  const [data, setData] = useState<ActivityData | null>(null);
  const load = useCallback(
    () =>
      api
        .activity()
        .then(setData)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see your bookings and requests</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to see your bookings and requests.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <div className="page narrow">
      <h1 className="display" style={{ fontSize: 40 }}>
        My activity
      </h1>
      <section className="card">
        <h2>Bookings</h2>
        {data.bookings.length === 0 ? (
          <p className="muted">
            No bookings yet. <Link to="/explore">Explore what's open</Link>.
          </p>
        ) : (
          data.bookings.map((b) => <BookingCard key={b.id} b={b} onChange={load} />)
        )}
      </section>
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Things you asked for</h2>
          <span className="spacer" />
          <Link to="/find" className="btn btn-secondary">
            Post a need
          </Link>
        </div>
        {data.needs.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            When search can't find what you need, you can post it, and founders who can help will
            reply here.
          </p>
        ) : (
          data.needs.map((n) => (
            <NeedCard key={n.id} n={n} onChange={(needs) => setData({ ...data, needs })} />
          ))
        )}
      </section>
      <section className="card">
        <h2>From businesses you follow</h2>
        {data.feed.length === 0 ? (
          <p className="muted">
            {data.following.length === 0
              ? "You're not following anyone yet."
              : "No updates yet from the businesses you follow."}
          </p>
        ) : (
          data.feed.map((u) => (
            <div className="message" key={u.id}>
              <div className="meta">
                <Link to={`/b/${u.slug}?via=follow`}>{u.business_name}</Link> · {ago(u.created_at)}
              </div>
              <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
            </div>
          ))
        )}
        {data.following.length > 0 && (
          <p className="muted" style={{ fontSize: 14, marginTop: 12, marginBottom: 0 }}>
            Following:{" "}
            {data.following.map((f, i) => (
              <span key={f.slug}>
                {i > 0 && ", "}
                <Link to={`/b/${f.slug}?via=follow`}>{f.name}</Link>
              </span>
            ))}
          </p>
        )}
      </section>
      <section className="card">
        <h2>Messages you sent</h2>
        {data.sent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          data.sent.map((i) => (
            <div className="message" key={i.id}>
              <div className="meta">
                To <Link to={`/b/${i.slug}`}>{i.business_name}</Link> · {ago(i.created_at)}
              </div>
              <blockquote>{i.message || "I'm interested."}</blockquote>
              {i.reply ? (
                <div className="reply">
                  <strong>Reply:</strong> {i.reply}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 14 }}>
                  Waiting for a reply.
                </p>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
