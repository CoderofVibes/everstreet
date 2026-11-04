// Explore: a street of things starting. Starting now (not open to customers yet), Open for
// customers (usable now or taking requests; job 001f1), What people need (needs someone chose to
// publish), and Following.

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, type Need, type PublicBusiness, type Update } from "../api.ts";
import { marketLine, marketOrder } from "../discover.ts";
import {
  EXPLORE_TABS,
  type ExploreTab,
  exploreTabKey,
  type FollowSlot,
  feedView,
  followingFor,
} from "../exploreView.ts";
import { initialLoad, type LoadState, latestLoader } from "../latestLoad.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money } from "../ui.tsx";
import { ago } from "../via.ts";
import { MarketList } from "./Market.tsx";

export function Tile({
  b,
  via = "discovery",
  why,
}: {
  b: PublicBusiness;
  via?: string;
  why?: string;
}) {
  const m = marketLine(b);
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
          {/* Job 001d: a digital profile's availability comes from its active offers. Job 001f1:
              the same status as every other listing (marketLine), so Find and a person's page
              agree with Explore. */}
          <span className={`pill ${m.tone === "caution" ? "caution" : "lime"}`}>{m.status}</span>
          {b.new_here && <span className="pill">New here</span>}
        </div>
        <h3 style={{ fontSize: 18, marginBottom: 4 }}>{b.name}</h3>
        {b.digital ? (
          <>
            <p style={{ marginBottom: 6 }}>{b.digital.headline}</p>
            {/* Job 001e: only what was published: its first capability and whether an example is. */}
            {b.digital.capabilities[0] && (
              <p className="muted" style={{ fontSize: 13.5, margin: "0 0 6px" }}>
                {b.digital.capabilities[0]}
              </p>
            )}
            {b.digital.example && <span className="pill">Example included</span>}
          </>
        ) : (
          b.offer && <p style={{ marginBottom: 6 }}>{b.offer.title}</p>
        )}
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

type Feed = Awaited<ReturnType<typeof api.exploreFeed>>;
type Following = { following: { name: string; slug: string }[]; feed: Update[] };

const TAB_LABEL: Record<ExploreTab, string> = {
  starting: "Starting now",
  open: "Open for customers",
  needs: "What people need",
  following: "Following",
};

export function Explore() {
  const { person, requireSignIn } = useSession();
  const who = person?.id ?? null;
  const [tab, setTab] = useState<ExploreTab>("starting");
  const tabRefs = useRef<Partial<Record<ExploreTab, HTMLButtonElement | null>>>({});
  // Job 001f1: the feed settles into data or an honest retry; it never stays Loading on error.
  const [load, setLoad] = useState<LoadState<Feed>>(initialLoad);
  const [feedTry, setFeedTry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: feedTry is the retry trigger.
  useEffect(() => {
    setLoad((s) => ({ ...s, error: null, status: "loading" }));
    const l = latestLoader(api.exploreFeed, (p) => setLoad((s) => ({ ...s, ...p })));
    l.load();
    return () => l.close();
  }, [feedTry]);
  // Job 001f1: the Following feed is the signed-in account's; another account never sees it.
  const [follow, setFollow] = useState<FollowSlot<Following>>({ who: null, state: initialLoad() });
  const [followTry, setFollowTry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: followTry is the retry trigger.
  useEffect(() => {
    if (tab !== "following" || !who) return;
    setFollow((f) =>
      f.who === who
        ? { who, state: { ...f.state, error: null, status: "loading" } }
        : { who, state: initialLoad() },
    );
    const l = latestLoader(
      () => api.activity().then((a) => ({ following: a.following, feed: a.feed })),
      (p) => setFollow((f) => (f.who === who ? { who, state: { ...f.state, ...p } } : f)),
    );
    l.load();
    return () => l.close();
  }, [tab, who, followTry]);
  const following = followingFor(follow, who);

  const data = load.data;
  const counts: Record<ExploreTab, number | undefined> = {
    starting: data?.starting.length,
    open: data?.open.length,
    needs: data?.needs.length,
    following: undefined,
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = exploreTabKey(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const view = feedView(load);
  return (
    <div className="page">
      <div className="eyebrow">Explore</div>
      <h1 className="display page-title">A street of things starting.</h1>
      <p className="muted" style={{ fontSize: 18 }}>
        New businesses testing an idea, ones you can use today, and things people have asked for.
        Nobody pays to appear here.
      </p>
      <div className="tabs" role="tablist" aria-label="Explore">
        {EXPLORE_TABS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[id] = el;
            }}
            id={`explore-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`explore-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {TAB_LABEL[id]}
            {counts[id] !== undefined ? ` (${counts[id]})` : ""}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`explore-panel-${tab}`}
        aria-labelledby={`explore-tab-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a tab panel takes focus (WAI-ARIA tabs).
        tabIndex={0}
      >
        {tab === "following" ? null : view === "loading" ? (
          <p className="muted">Loading…</p>
        ) : view === "failed" || !data ? (
          <div className="card empty" role="alert">
            <h2>Couldn't load Explore just now</h2>
            <p>Nothing here has changed; this page just couldn't reach the street. {load.error}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFeedTry((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        ) : tab === "starting" ? (
          data.starting.length === 0 ? (
            <div className="card empty">
              <h2>Nothing starting right now</h2>
              <p>
                Ideas looking for their first interested people, and products not open yet, show up
                here.
              </p>
            </div>
          ) : (
            <>
              <p className="muted">
                Not open to customers yet: ideas testing interest, and digital products that are
                still being built or aren't taking new customers. Follow one, or tell the founder
                you're interested.
              </p>
              <MarketList list={marketOrder(data.starting)} />
            </>
          )
        ) : tab === "open" ? (
          data.open.length === 0 ? (
            <div className="card empty">
              <h2>Nothing open yet</h2>
              <p>Products you can use now, and offerings taking requests, show up here.</p>
            </div>
          ) : (
            <>
              <p className="muted">
                You can use these now, or ask about them. A business with a digital product and
                another offering is here when either part is open, listed once.
              </p>
              <MarketList list={marketOrder(data.open)} />
            </>
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
        ) : null}
        {tab === "following" && (
          <FollowingPanel
            signedIn={Boolean(person)}
            state={following}
            onJoin={() => requireSignIn("Join to follow businesses.")}
            onRetry={() => setFollowTry((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}

function FollowingPanel({
  signedIn,
  state,
  onJoin,
  onRetry,
}: {
  signedIn: boolean;
  state: LoadState<Following>;
  onJoin: () => void;
  onRetry: () => void;
}) {
  if (!signedIn)
    return (
      <div className="card empty">
        <h2>Follow businesses to see their updates here</h2>
        <button type="button" className="btn btn-primary" onClick={onJoin}>
          Sign in or join
        </button>
      </div>
    );
  const view = feedView(state);
  const f = state.data;
  if (view === "loading") return <p className="muted">Loading…</p>;
  if (view === "failed" || !f)
    return (
      <div className="card empty" role="alert">
        <h2>Couldn't load your updates just now</h2>
        <p>{state.error}</p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  if (f.feed.length === 0)
    return (
      <div className="card empty">
        <h2>{f.following.length === 0 ? "You're not following anyone yet" : "No updates yet"}</h2>
        <p>Tap Follow on a business page to see its updates here, newest first.</p>
      </div>
    );
  return (
    <div className="card">
      {f.feed.map((u) => (
        <div className="message" key={u.id}>
          <div className="meta">
            <Link to={`/b/${u.slug}?via=follow`}>{u.business_name}</Link> · {ago(u.created_at)}
          </div>
          <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
        </div>
      ))}
    </div>
  );
}
