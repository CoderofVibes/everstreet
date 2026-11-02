// A business's public page: who runs it, the idea, updates, the offer, real sessions when the
// business takes bookings, and one honest next action.

import { useEffect, useState } from "react";
import { api, type MyBooking, type PublicBusiness, type PublicSession } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Avatar, FAMILY_LABEL, OfferCard, STAGE_LABEL } from "../ui.tsx";
import { ago, rememberVia, viaFor, when } from "../via.ts";

function seatsText(s: PublicSession) {
  if (!s.available || s.seats_left === null) return "Availability can't be checked right now";
  if (s.seats_left > 0) return `${s.seats_left} of ${s.capacity} places left`;
  return `Full · ${s.waitlisted ?? 0} on the waitlist`;
}

function Sessions({
  page,
  preview,
  onBooked,
}: {
  page: PublicBusiness;
  preview?: boolean;
  onBooked: () => void;
}) {
  const { person, requireSignIn } = useSession();
  const [booked, setBooked] = useState<MyBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = page.founder.display_name.split(" ")[0];
  const sessions = page.sessions ?? [];
  if (sessions.length === 0) return null;
  const book = async (s: PublicSession) => {
    if (preview || page.viewer_is_owner) return;
    if (
      !person &&
      !(await requireSignIn(`Join to book. Your name is shared with ${first} for the booking.`))
    )
      return;
    try {
      setBooked(await api.book(s.id, viaFor(page.slug)));
      setError(null);
      onBooked();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card" style={{ padding: 18 }}>
      <strong>Choose a session</strong>
      {booked ? (
        <p
          className={`notice ${booked.status === "confirmed" ? "ok" : ""}`}
          style={{ margin: "10px 0 0" }}
        >
          {booked.status === "confirmed"
            ? `You have a place on ${when(booked.starts_at)}.`
            : `You're number ${booked.position} on the waitlist for ${when(booked.starts_at)}. If a place opens, it's yours automatically.`}{" "}
          See it in <Link to="/activity">My activity</Link>.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {sessions.map((s) => {
            const full = s.available && s.seats_left === 0;
            return (
              <div key={s.id} className="session-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{when(s.starts_at)}</div>
                  <div
                    className={`muted${!s.available ? " unknown" : ""}`}
                    style={{ fontSize: 14 }}
                  >
                    {seatsText(s)}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn ${full ? "btn-secondary" : "btn-primary"}`}
                  disabled={preview || page.viewer_is_owner || !s.available}
                  onClick={() => book(s)}
                >
                  {full ? "Join the waitlist" : "Book a place"}
                </button>
              </div>
            );
          })}
          {error && <p className="error-text">{error}</p>}
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Places are held by OpenSeat, the booking service {first} uses. No payment is taken yet.
            Booking shares your name with {first}.
          </p>
        </div>
      )}
    </div>
  );
}

function Report({ slug }: { slug: string }) {
  const { requireSignIn } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  if (done)
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Thanks. We'll take a look.
      </p>
    );
  if (!open)
    return (
      <button
        type="button"
        className="btn btn-quiet"
        style={{ fontSize: 13, padding: 0, minHeight: 0 }}
        onClick={() => setOpen(true)}
      >
        Report this page
      </button>
    );
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <input
        className="input"
        style={{ flex: 1 }}
        placeholder="What is wrong with this page?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!reason.trim()}
        onClick={async () => {
          if (!(await requireSignIn("Join to report a page."))) return;
          await api.report("business", slug, reason);
          setDone(true);
        }}
      >
        Send report
      </button>
    </div>
  );
}

export function StorefrontView({
  page,
  preview,
  onSent,
}: {
  page: PublicBusiness;
  preview?: boolean;
  onSent?: () => void;
}) {
  const { person, requireSignIn } = useSession();
  const [message, setMessage] = useState("");
  const [share, setShare] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState({
    on: Boolean(page.following),
    n: page.followers ?? 0,
  });
  useEffect(
    () => setFollowing({ on: Boolean(page.following), n: page.followers ?? 0 }),
    [page.following, page.followers],
  );
  const first = page.founder.display_name.split(" ")[0];
  const hasSessions = (page.sessions ?? []).length > 0;

  const send = async () => {
    if (preview) return;
    if (
      !person &&
      !(await requireSignIn(
        `Join so ${first} can reply to you. Your contact details stay private unless you choose to share them.`,
      ))
    )
      return;
    try {
      await api.inquire(page.slug, page.action.kind, message, share, viaFor(page.slug));
      setSent(true);
      onSent?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleFollow = async () => {
    if (preview) return;
    if (!person && !(await requireSignIn(`Join to follow ${page.name} and see its updates.`)))
      return;
    const r = await api.follow(page.slug, !following.on);
    setFollowing({ on: r.following, n: r.followers });
  };

  return (
    <div className="storefront">
      <div>
        <div className="storefront-hero">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="pill">{FAMILY_LABEL[page.family]}</span>
            <span className="pill lime">{STAGE_LABEL[page.stage]}</span>
            {page.new_here && <span className="pill">New here</span>}
            <span className="spacer" />
            {!page.viewer_is_owner && (
              <button
                type="button"
                className={`btn ${following.on ? "btn-secondary" : "btn-primary"}`}
                onClick={toggleFollow}
                disabled={preview}
              >
                {following.on ? "Following" : "Follow"}
              </button>
            )}
          </div>
          <h1>{page.name}</h1>
          {page.tagline && <p className="tagline">{page.tagline}</p>}
          <p className="muted" style={{ fontSize: 14 }}>
            {following.n} {following.n === 1 ? "follower" : "followers"}
          </p>
        </div>

        {page.idea && (page.idea.problem || page.idea.why_me || page.idea.evidence) && (
          <section className="card prose">
            <div className="eyebrow">The idea</div>
            {page.idea.problem && (
              <p style={{ fontSize: 18, color: "var(--ink)" }}>{page.idea.problem}</p>
            )}
            {(page.idea.why_me || page.idea.evidence) && (
              <>
                <h3 style={{ fontSize: 16, marginTop: 16 }}>Why {first}</h3>
                <p>{page.idea.why_me || page.idea.evidence}</p>
              </>
            )}
            {page.idea.ask && (
              <p className="notice ok" style={{ marginTop: 12, marginBottom: 0 }}>
                <strong>Right now:</strong> {page.idea.ask}
              </p>
            )}
          </section>
        )}

        {(page.updates ?? []).length > 0 && (
          <section className="card">
            <div className="eyebrow">Updates</div>
            {(page.updates ?? []).map((u) => (
              <div key={u.id} className="message">
                <div className="meta">{ago(u.created_at)}</div>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
              </div>
            ))}
          </section>
        )}

        {page.about && (
          <section className="card prose">
            <div className="eyebrow">About</div>
            <p style={{ whiteSpace: "pre-wrap" }}>{page.about}</p>
          </section>
        )}

        <section className="card">
          <div className="eyebrow">Who runs it</div>
          <div className="founder">
            <Avatar name={page.founder.display_name} large />
            <div>
              <h3 style={{ marginBottom: 2 }}>
                {page.founder.id && !preview ? (
                  <Link to={`/p/${page.founder.id}`}>{page.founder.display_name}</Link>
                ) : (
                  page.founder.display_name
                )}
              </h3>
              {page.founder.headline && <p className="muted">{page.founder.headline}</p>}
              {page.founder.bio && <p style={{ whiteSpace: "pre-wrap" }}>{page.founder.bio}</p>}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="eyebrow">Numbers</div>
          <p className="muted" style={{ margin: 0 }}>
            {page.interested > 0
              ? `${page.interested} ${page.interested === 1 ? "person has" : "people have"} responded so far. `
              : "No responses yet. "}
            Revenue, costs and performance appear here once this business takes payments through
            Everstreet.
          </p>
        </section>
        {!preview && !page.viewer_is_owner && <Report slug={page.slug} />}
      </div>

      <aside className="studio-side">
        {page.offer ? (
          <>
            {hasSessions && <Sessions page={page} preview={preview} onBooked={() => onSent?.()} />}
            <OfferCard
              offer={page.offer}
              family={page.family}
              footer={
                <div
                  style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}
                >
                  {page.viewer_is_owner && !preview ? (
                    <p className="notice ok" style={{ margin: 0 }}>
                      This is your page. <Link to="/desk">Go to your desk</Link>
                    </p>
                  ) : sent ? (
                    <p className="notice ok" style={{ margin: 0 }}>
                      Sent. {first} will reply in your <Link to="/inbox">inbox</Link>.
                    </p>
                  ) : (
                    <>
                      <label className="field" style={{ marginBottom: 10 }}>
                        <span>
                          {hasSessions
                            ? "A question first? (optional)"
                            : page.action.kind === "interest"
                              ? "Anything you'd like to say? (optional)"
                              : "Your question or request"}
                        </span>
                        <textarea
                          className="input"
                          style={{ minHeight: 72 }}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder={
                            page.action.kind === "interest"
                              ? "e.g. Saturdays work for me"
                              : "e.g. Can I bring a friend?"
                          }
                          disabled={preview}
                        />
                      </label>
                      <label className="check" style={{ fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={share}
                          onChange={(e) => setShare(e.target.checked)}
                          disabled={preview}
                        />
                        <span>Share my name and contact with {first}</span>
                      </label>
                      {error && <p className="error-text">{error}</p>}
                      <button
                        type="button"
                        className={`btn ${hasSessions ? "btn-secondary" : "btn-primary"}`}
                        style={{ width: "100%" }}
                        onClick={send}
                        disabled={preview}
                      >
                        {hasSessions ? "Send a question" : page.action.label}
                      </button>
                      {page.action.kind === "interest" && (
                        <p
                          className="muted"
                          style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}
                        >
                          Not open for bookings yet. You'll hear when it is; nothing is charged.
                        </p>
                      )}
                    </>
                  )}
                </div>
              }
            />
          </>
        ) : (
          <div className="card muted">No offer published yet.</div>
        )}
      </aside>
    </div>
  );
}

export function PublicPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<PublicBusiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { person } = useSession();
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the acting person changes (owner banner, following)
  useEffect(() => {
    rememberVia(slug);
    api
      .page(slug)
      .then(setPage)
      .catch((e) => setError((e as Error).message));
  }, [slug, person]);
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <p>It may still be a private draft.</p>
        <Link to="/find">Find something else</Link>
      </div>
    );
  if (!page) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <StorefrontView page={page} onSent={() => api.page(slug).then(setPage)} />
    </div>
  );
}
