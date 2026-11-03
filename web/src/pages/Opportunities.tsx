// Job 005a: Opportunities. Requests people chose to publish, read as possible products for
// digital builders, with two separate actions: reply with a published business (the existing
// consent rules), or explore building it as a private project in the studio. A request isn't a
// contract, a customer or verified demand; nothing here invents market size, value or income.

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import { type Opportunity, opportunitiesApi } from "../opportunitiesApi.ts";
import { ReviewController } from "../opportunityReview.ts";
import { type FoundationInfo, productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money } from "../ui.tsx";
import { ago } from "../via.ts";
import { NeedCard } from "./Explore.tsx";

function priceLimit(o: { constraints: Opportunity["constraints"] }) {
  return o.constraints.max_price_cents !== undefined
    ? `Stated price limit: up to ${money(o.constraints.max_price_cents)}. That is what they said they'd pay, not a product price, a development budget or income.`
    : "No price limit stated.";
}

function Classification({ o }: { o: Opportunity }) {
  const c = o.classification;
  return (
    <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
      <span className="pill blue">{c.label}</span>{" "}
      {c.basis.length > 0 ? `Because it mentions ${c.basis.join(", ")}. ` : ""}
      {c.note}
    </p>
  );
}

// ---------- /opportunities ----------

export function Opportunities() {
  const { person } = useSession();
  const [data, setData] = useState<{ opportunities: Opportunity[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the acting person is a trigger: matches are per person, so another person reloads the list (and drops the previous person's answer)
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    opportunitiesApi
      .list()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message || "Opportunities couldn't be loaded."));
    return () => {
      alive = false;
    };
  }, [person?.id]);

  return (
    <div className="page">
      <div className="eyebrow">Opportunities</div>
      <h1 className="display" style={{ fontSize: 36, margin: "0 0 6px" }}>
        What people have asked for
      </h1>
      <p className="muted" style={{ fontSize: 16, maxWidth: "75ch" }}>
        Requests people chose to publish, for builders of AI tools, SaaS, agents, APIs, websites and
        NEAR apps. Who posted them stays private. Reply with a published business when they allow
        it, or explore building one as a private project. A request isn't a commitment, a customer
        or verified demand.
      </p>
      {error ? (
        <div className="card empty" role="alert">
          <h2>Opportunities couldn't be loaded</h2>
          <p>{error}</p>
        </div>
      ) : !data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : data.opportunities.length === 0 ? (
        <div className="card empty">
          <h2>No open requests right now</h2>
          <p>
            Requests appear here when someone publishes one from{" "}
            <Link to="/find">Find a solution</Link>.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, maxWidth: 980 }}>
          {data.opportunities.map((o) => (
            <NeedCard key={o.id} n={o} replyLabel="Reply with a published business">
              <Classification o={o} />
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {priceLimit(o)}
              </p>
              {o.matches.map((m) => (
                <p key={m.business_id} className="why">
                  Shares words with {m.name}: {m.words.join(", ")}
                </p>
              ))}
              <div>
                <Link to={`/opportunities/${o.id}/build`} className="btn btn-primary">
                  Explore building this <Icon name="arrowRight" size="sm" />
                </Link>
              </div>
            </NeedCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- /opportunities/:id/build ----------

let keys = 0;
const newKey = () =>
  `req-${Date.now().toString(36)}-${(keys++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function OpportunityReview({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const preset = new URLSearchParams(window.location.search).get("business");
  // Keyed by person and request in the route: another person or request gets a fresh controller.
  const [c] = useState(
    () => new ReviewController(id, opportunitiesApi, newKey, { business_id: preset }),
  );
  const s = useSyncExternalStore(c.subscribe, c.getState);
  const [foundations, setFoundations] = useState<FoundationInfo[] | null>(null);
  const [owned, setOwned] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void c.load();
    return () => c.dispose();
  }, [c]);
  useEffect(() => {
    let alive = true;
    productsApi
      .foundations()
      .then((r) => alive && setFoundations(r.foundations))
      .catch(() => alive && setFoundations([]));
    if (person)
      api
        .projects()
        .then((r) => {
          if (!alive) return;
          const seen = new Map<string, string>();
          for (const p of r.projects) seen.set(p.business_id, p.name);
          setOwned([...seen].map(([bid, name]) => ({ id: bid, name })));
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [person]);
  useEffect(() => {
    if (s.created) go(`/build/${s.created.project_id}`);
  }, [s.created, go]);

  if (s.status === "loading")
    return (
      <div className="page muted" role="status">
        Loading the request…
      </div>
    );
  if (s.status === "error" && !s.need)
    return (
      <div className="page empty" role="alert">
        <h2>{s.message}</h2>
        <button type="button" className="btn btn-secondary" onClick={() => void c.load()}>
          Try again
        </button>{" "}
        <Link to="/opportunities">All opportunities</Link>
      </div>
    );
  if (!s.need || !s.draft)
    return (
      <div className="page empty" role="status">
        <h2>This request is no longer open</h2>
        <p>{s.message}</p>
        <Link to="/opportunities">All opportunities</Link>
      </div>
    );
  const n = s.need;
  const d = s.draft;
  const a = s.attempt;
  const sending = a?.state === "sending";
  const gone = s.status === "gone";

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to="/opportunities" className="muted">
          Opportunities
        </Link>
        <span className="muted">/</span>
        <span className="pill caution">Review before creating</span>
      </div>
      <h1 className="display" style={{ fontSize: 30, margin: "6px 0 12px" }}>
        Explore building this
      </h1>
      <div className="desk">
        <form
          className="card"
          aria-label="Your starting brief"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!person && !(await requireSignIn("Join to save a private project."))) return;
            await c.create();
          }}
        >
          <p className="notice info" style={{ marginTop: 0 }}>
            This creates a <strong>private starting brief</strong> in your studio. It sends no
            reply, doesn't contact the person who posted the request, and doesn't reserve it. You
            can correct anything before building, and no build starts on its own.
          </p>
          <label className="field" htmlFor="rv-idea">
            <span>What would you build? (starts from the request; make it yours)</span>
            <textarea
              id="rv-idea"
              className="input"
              rows={5}
              maxLength={2000}
              value={d.idea}
              onChange={(e) => c.edit({ idea: e.target.value })}
            />
          </label>
          <fieldset className="foundations" style={{ border: 0, padding: 0 }}>
            <legend
              className="mini-label"
              style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}
            >
              Foundation (suggested from the request's words: {n.classification.label})
            </legend>
            {(foundations ?? []).map((x) => (
              <label key={x.id} className="foundation">
                <input
                  type="radio"
                  name="rv-foundation"
                  className="sr-only"
                  checked={d.foundation === x.id}
                  onChange={() => c.edit({ foundation: x.id })}
                />
                <span className="f-head">
                  <Icon name={FOUNDATION_ICON[x.id] ?? "layers"} /> {x.label}
                </span>
                <p>{x.summary}</p>
              </label>
            ))}
          </fieldset>
          <div className="grid-2">
            <label className="mini-field">
              <span className="mini-label">Working name (optional)</span>
              <input
                className="input"
                maxLength={80}
                value={d.name}
                onChange={(e) => c.edit({ name: e.target.value })}
                placeholder="You can name it later"
              />
            </label>
            <label className="mini-field">
              <span className="mini-label">Business it belongs to</span>
              <select
                className="input"
                value={d.business_id ?? ""}
                onChange={(e) => c.edit({ business_id: e.target.value || null })}
              >
                <option value="">A new private business</option>
                {owned.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {a && a.state !== "sending" && (
            <div
              className={a.state === "unknown" ? "notice" : "notice error"}
              role="alert"
              style={{ fontSize: 13.5 }}
            >
              <strong>
                {a.state === "unknown" ? "No answer yet." : "The project wasn't created."}
              </strong>{" "}
              {a.message}
              {c.draftDiverged && (
                <> You've changed the brief since, so creating now is a new request.</>
              )}
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || gone || d.idea.trim().length < 3}
            >
              {sending
                ? "Creating…"
                : a?.state === "unknown" && !c.draftDiverged
                  ? "Create again (same request)"
                  : "Create project"}
            </button>
            <Link to="/opportunities" className="btn btn-quiet">
              Cancel
            </Link>
          </div>
        </form>
        <aside className="studio-side">
          <section className="card" aria-labelledby="rv-req">
            <h2 id="rv-req" style={{ fontSize: 17 }}>
              The public request
            </h2>
            <p style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>“{n.text}”</p>
            <p className="muted" style={{ fontSize: 13 }}>
              Posted {ago(n.created_at)} · open until {new Date(n.expires_at).toLocaleDateString()}{" "}
              ·{" "}
              {n.allow_replies
                ? "replies welcome"
                : "the person who posted it asked not to receive replies"}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              {priceLimit(n)}
            </p>
            {(n.constraints.online || n.constraints.family || n.constraints.confirmed_only) && (
              <ul className="missing-list" style={{ fontSize: 13, margin: "0 0 8px" }}>
                {n.constraints.family && (
                  <li>Kind they asked for: {FAMILY_LABEL[n.constraints.family]}</li>
                )}
                {n.constraints.online && <li>They asked for something online.</li>}
                {n.constraints.confirmed_only && <li>They asked for confirmed details only.</li>}
              </ul>
            )}
            <Classification o={n} />
          </section>
          <section className="card">
            <h2 style={{ fontSize: 17 }}>What the project keeps</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              The request's public text and stated constraints, with today's date, so you can see
              what inspired it. Not who posted it, their contact, any replies or searches. The
              project belongs to your business, like any other.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
