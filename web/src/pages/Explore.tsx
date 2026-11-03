// Explore: a street of things starting. Starting now (testing interest), Open for customers,
// What people need (needs someone chose to publish), and Following.

import { type ReactNode, useEffect, useState } from "react";
import { api, type Need, type PublicBusiness, type Update } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money } from "../ui.tsx";
import { ago } from "../via.ts";

export function Tile({
  b,
  via = "discovery",
  why,
}: {
  b: PublicBusiness;
  via?: string;
  why?: string;
}) {
  const price = b.offer
    ? b.offer.first_free
      ? "First one free"
      : b.offer.price_cents !== null
        ? `${money(b.offer.price_cents)} ${b.offer.price_unit}`
        : null
    : null;
  return (
    <div>
      <Link to={`/b/${b.slug}?via=${via}`} className="card link">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="pill">{FAMILY_LABEL[b.family]}</span>
          {b.action.kind === "interest" ? (
            <span className="pill caution">Testing interest</span>
          ) : (
            <span className="pill lime">Open for customers</span>
          )}
          {b.new_here && <span className="pill">New here</span>}
        </div>
        <h3 style={{ fontSize: 18, marginBottom: 4 }}>{b.name}</h3>
        {b.offer && <p style={{ marginBottom: 6 }}>{b.offer.title}</p>}
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          by {b.founder.display_name}
          {price ? ` · ${price}` : ""}
        </p>
      </Link>
      {why && <p className="why">{why}</p>}
    </div>
  );
}

export function NeedCard({
  n,
  onAnswered,
  children,
  replyLabel = "I can help with this",
}: {
  n: Need;
  onAnswered?: () => void;
  /** Extra detail shown above the actions (job 005a: classification, matches, Explore building). */
  children?: ReactNode;
  replyLabel?: string;
}) {
  const { person, requireSignIn } = useSession();
  const [mine, setMine] = useState<{ business_id: string; name: string }[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [biz, setBiz] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const start = async () => {
    if (!person && !(await requireSignIn("Join to reply to this request with your business.")))
      return;
    const { projects } = await api.projects();
    const published = projects
      .filter((p) => p.published_at)
      .map((p) => ({ business_id: p.business_id, name: p.name }));
    setMine(published);
    setBiz(published[0]?.business_id ?? "");
    setOpen(true);
  };
  const c = n.constraints;
  return (
    <div className="card need">
      <p style={{ fontSize: 18, margin: 0 }}>“{n.text}”</p>
      <div className="chips">
        {c.family && <span className="pill">{FAMILY_LABEL[c.family]}</span>}
        {c.max_price_cents !== undefined && (
          <span className="pill">Up to {money(c.max_price_cents)}</span>
        )}
        {c.online && <span className="pill">Online</span>}
        <span className="muted" style={{ fontSize: 13 }}>
          Posted {ago(n.created_at)} · {n.responses} {n.responses === 1 ? "reply" : "replies"} ·
          open until {new Date(n.expires_at).toLocaleDateString()}
        </span>
      </div>
      {n.matched && n.matched.length > 0 && (
        <p className="why">Mentions what you offer: {n.matched.join(", ")}</p>
      )}
      {children}
      {msg ? (
        <p className="notice ok" style={{ margin: 0 }}>
          {msg}
        </p>
      ) : !n.allow_replies ? (
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          The person who posted this asked not to receive replies.
        </p>
      ) : n.answered ? (
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          You replied to this.
        </p>
      ) : !open ? (
        <div>
          <button type="button" className="btn btn-secondary" onClick={start}>
            {replyLabel}
          </button>
        </div>
      ) : mine && mine.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Publish a business page first, then you can reply with it.{" "}
          <Link to="/start">Start a business</Link>
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {mine && mine.length > 1 && (
            <select
              className="input"
              value={biz}
              onChange={(e) => setBiz(e.target.value)}
              aria-label="Reply as"
            >
              {mine.map((m) => (
                <option key={m.business_id} value={m.business_id}>
                  Reply as {m.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            className="input"
            style={{ minHeight: 70 }}
            placeholder="How you could help, and what it would cost"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!text.trim() || !biz}
              onClick={async () => {
                try {
                  await api.respondToNeed(n.id, biz, text);
                  setMsg(
                    "Sent. They'll see your reply and a link to your page; their contact stays private unless they reply.",
                  );
                  onAnswered?.();
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            >
              Send reply
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = "starting" | "open" | "needs" | "following";

export function Explore() {
  const { person, requireSignIn } = useSession();
  const [tab, setTab] = useState<Tab>("starting");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.exploreFeed>> | null>(null);
  const [feed, setFeed] = useState<{
    following: { name: string; slug: string }[];
    feed: Update[];
  } | null>(null);
  useEffect(() => {
    api
      .exploreFeed()
      .then(setData)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === "following" && person)
      api
        .activity()
        .then((a) => setFeed({ following: a.following, feed: a.feed }))
        .catch(() => {});
  }, [tab, person]);

  const tabs: [Tab, string, number | undefined][] = [
    ["starting", "Starting now", data?.starting.length],
    ["open", "Open for customers", data?.open.length],
    ["needs", "What people need", data?.needs.length],
    ["following", "Following", undefined],
  ];
  return (
    <div className="page">
      <div className="eyebrow">Explore</div>
      <h1 className="display" style={{ fontSize: 44 }}>
        A street of things starting.
      </h1>
      <p className="muted" style={{ fontSize: 18 }}>
        New businesses testing an idea, ones you can use today, and things people have asked for.
        Nobody pays to appear here.
      </p>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
            {n !== undefined ? ` (${n})` : ""}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : tab === "starting" ? (
        data.starting.length === 0 ? (
          <div className="card empty">
            <h2>Nothing testing right now</h2>
            <p>Ideas looking for their first interested people show up here.</p>
          </div>
        ) : (
          <>
            <p className="muted">
              These are still being shaped: you can tell the founder you're interested, but nothing
              can be booked yet.
            </p>
            <div className="shelf">
              {data.starting.map((b) => (
                <Tile key={b.slug} b={b} />
              ))}
            </div>
          </>
        )
      ) : tab === "open" ? (
        data.open.length === 0 ? (
          <div className="card empty">
            <h2>Nothing open yet</h2>
          </div>
        ) : (
          <div className="shelf">
            {data.open.map((b) => (
              <Tile key={b.slug} b={b} />
            ))}
          </div>
        )
      ) : tab === "needs" ? (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>
              Requests people chose to publish. Who posted them stays private; founders can reply
              when allowed. Private searches never appear here.
            </p>
            <Link to="/opportunities" className="btn btn-primary">
              Build for these
            </Link>
            <Link to="/find" className="btn btn-secondary">
              Post a need
            </Link>
          </div>
          {data.needs.length === 0 ? (
            <div className="card empty">
              <h2>No open requests</h2>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {data.needs.map((n) => (
                <NeedCard key={n.id} n={n} />
              ))}
            </div>
          )}
        </>
      ) : !person ? (
        <div className="card empty">
          <h2>Follow businesses to see their updates here</h2>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => requireSignIn("Join to follow businesses.")}
          >
            Sign in or join
          </button>
        </div>
      ) : !feed ? (
        <p className="muted">Loading…</p>
      ) : feed.feed.length === 0 ? (
        <div className="card empty">
          <h2>
            {feed.following.length === 0 ? "You're not following anyone yet" : "No updates yet"}
          </h2>
          <p>Tap Follow on a business page to see its updates here, newest first.</p>
        </div>
      ) : (
        <div className="card">
          {feed.feed.map((u) => (
            <div className="message" key={u.id}>
              <div className="meta">
                <Link to={`/b/${u.slug}?via=follow`}>{u.business_name}</Link> · {ago(u.created_at)}
              </div>
              <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
