// Jobs 005a and 005a1: Opportunities. Requests people chose to publish, read as possible products
// for digital builders, with two separate actions: reply with a published business (the existing
// consent rules), or explore building it as a private project in the studio. A request isn't a
// contract, a customer or verified demand; nothing here invents market size, value or income.

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { FOUNDATION_ICON, Icon } from "../icons.tsx";
import { type Opportunity, opportunitiesApi } from "../opportunitiesApi.ts";
import { ReviewController, type ReviewPort, UNANSWERED } from "../opportunityReview.ts";
import { productsApi } from "../productsApi.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { FAMILY_LABEL, money } from "../ui.tsx";
import { ago } from "../via.ts";
import { NeedCard } from "./Explore.tsx";

/** The requester's limit, short; it is never a product price, budget or income. */
function priceLimit(o: Pick<Opportunity, "constraints" | "constraints_unreadable">) {
  if (o.constraints.max_price_cents !== undefined)
    return `Their stated price limit: up to ${money(o.constraints.max_price_cents)} (not a budget or income)`;
  if (o.constraints_unreadable.includes("max_price_cents"))
    return "A price limit was stated but can't be read, so none is assumed";
  return "No price limit stated";
}

function Classification({ o }: { o: Opportunity }) {
  const c = o.classification;
  return (
    <details style={{ fontSize: 13 }}>
      <summary className="muted">
        Looks like: <span className="pill blue">{c.label}</span>
      </summary>
      <p className="muted" style={{ margin: "4px 0 0" }}>
        {c.basis.length > 0 ? `Because it mentions ${c.basis.join(", ")}. ` : ""}
        {c.note}
      </p>
    </details>
  );
}

// ---------- /opportunities ----------

export function Opportunities() {
  const { person } = useSession();
  const [data, setData] = useState<{ opportunities: Opportunity[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the acting person and a retry are triggers: matches are per person, so another person reloads the list (and drops the previous person's answer)
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
  }, [person?.id, tries]);

  return (
    <div className="page">
      <div className="eyebrow">Opportunities</div>
      <h1 className="display" style={{ fontSize: 36, margin: "0 0 6px" }}>
        What people have asked for
      </h1>
      <p className="muted" style={{ fontSize: 16, maxWidth: "75ch" }}>
        Requests people chose to publish, for builders of AI tools, SaaS, agents, APIs, websites and
        NEAR apps. Who posted them stays private. A request isn't a commitment or verified demand.
      </p>
      {error ? (
        <div className="card empty" role="alert">
          <h2>Opportunities couldn't be loaded</h2>
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setTries((t) => t + 1)}
          >
            Try again
          </button>
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
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {priceLimit(o)}
              </p>
              <Classification o={o} />
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

/** The real calls; the route is keyed by person, so a signed-out page never lists businesses. */
function portFor(signedIn: boolean): ReviewPort {
  return {
    get: opportunitiesApi.get,
    createProject: opportunitiesApi.createProject,
    foundations: () => productsApi.foundations(),
    businesses: async () => {
      if (!signedIn) return [];
      const r = await api.projects();
      const seen = new Map<string, string>();
      for (const p of r.projects) seen.set(p.business_id, p.name);
      return [...seen].map(([id, name]) => ({ id, name }));
    },
  };
}

export function OpportunityReview({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const preset = new URLSearchParams(window.location.search).get("business");
  // Keyed by person and request in the route: another person or request gets a fresh controller.
  const [c] = useState(
    () => new ReviewController(id, portFor(Boolean(person)), newKey, { business_id: preset }),
  );
  const s = useSyncExternalStore(c.subscribe, c.getState);

  useEffect(() => {
    void c.load();
    void c.loadChoices();
    return () => c.dispose();
  }, [c]);
  const open = c.openNow;
  useEffect(() => {
    if (open) go(`/build/${open}`);
  }, [open, go]);

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
  const o = s.original;
  const made = s.created;
  const gone = s.status === "gone";
  const blocked = c.blocked;
  const signIn = async () =>
    Boolean(person) || (await requireSignIn("Join to save a private project."));

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
            if (await signIn()) await c.create();
          }}
        >
          <p className="notice info" style={{ marginTop: 0 }}>
            This makes a <strong>private starting brief</strong> in your studio. It sends no reply,
            contacts no one, reserves nothing and starts no build.
          </p>
          {gone && (
            <p className="notice error" role="alert">
              <strong>{s.message}</strong> No new project can be made from it. Your text below is
              still here to copy.
            </p>
          )}
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
          {s.foundations.state === "error" ? (
            <div className="notice error" role="alert" style={{ fontSize: 13.5 }}>
              The kinds of product couldn't be loaded, so nothing can be created yet.{" "}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void c.loadFoundations()}
              >
                Try again
              </button>
            </div>
          ) : s.foundations.state === "loading" ? (
            <p className="muted" role="status">
              Loading the kinds of product…
            </p>
          ) : (
            <fieldset className="foundations" style={{ border: 0, padding: 0 }}>
              <legend
                className="mini-label"
                style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}
              >
                What kind of product? (suggested: {n.classification.label})
              </legend>
              {s.foundations.items.map((x) => (
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
          )}
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
                {s.businesses.state === "ready" &&
                  s.businesses.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
              {s.businesses.state === "error" && (
                <span className="error-text" role="alert" style={{ fontSize: 13 }}>
                  Your businesses couldn't be loaded, so only a new private business is listed.{" "}
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => void c.loadBusinesses()}
                  >
                    Try again
                  </button>
                </span>
              )}
            </label>
          </div>

          {o && o.phase !== "sending" && (
            <div className="notice" role="alert" style={{ fontSize: 13.5 }}>
              <strong>
                {o.phase === "checking" ? "Checking the original request…" : "No answer yet."}
              </strong>{" "}
              {UNANSWERED} Your edits stay on this page; the check sends only what you first sent
              {o.sent.name ? ` (named “${o.sent.name}”)` : ""}.
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={o.phase === "checking"}
                  onClick={async () => {
                    if (await signIn()) await c.checkOriginal();
                  }}
                >
                  Check original request
                </button>
              </div>
            </div>
          )}
          {made?.newer_edits && (
            <div className="notice ok" role="status" style={{ fontSize: 13.5 }}>
              <strong>
                {made.again ? "Your project was already made." : "Your project was made."}
              </strong>{" "}
              It holds the brief you first sent. You've changed the text since; those edits are
              still here.
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <Link to={`/build/${made.project_id}`} className="btn btn-primary btn-sm">
                  Open the project
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void c.createAnother()}
                >
                  Make a separate project from my edits
                </button>
              </div>
            </div>
          )}
          {s.refusal && !gone && (
            <p className="notice error" role="alert" style={{ fontSize: 13.5 }}>
              <strong>The project wasn't created.</strong> {s.refusal.message}
            </p>
          )}

          {!o && !made && (
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={Boolean(blocked)}>
                Create project
              </button>
              <Link to="/opportunities" className="btn btn-quiet">
                Cancel
              </Link>
              {blocked && !gone && s.foundations.state === "ready" && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {blocked}
                </span>
              )}
            </div>
          )}
          {o?.phase === "sending" && (
            <p className="muted" role="status">
              Creating…
            </p>
          )}
        </form>
        <aside className="studio-side">
          <section className="card" aria-labelledby="rv-req">
            <h2 id="rv-req" style={{ fontSize: 17 }}>
              The public request
            </h2>
            <p style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>“{n.text}”</p>
            <p className="muted" style={{ fontSize: 13 }}>
              {priceLimit(n)} · open until {new Date(n.expires_at).toLocaleDateString()} ·{" "}
              {n.allow_replies ? "replies welcome" : "no replies, by their choice"}
            </p>
            {(n.constraints.online || n.constraints.family || n.constraints.confirmed_only) && (
              <ul className="missing-list" style={{ fontSize: 13, margin: "0 0 8px" }}>
                {n.constraints.family && (
                  <li>Kind they asked for: {FAMILY_LABEL[n.constraints.family]}</li>
                )}
                {n.constraints.online && <li>Online</li>}
                {n.constraints.confirmed_only && <li>Confirmed details only</li>}
              </ul>
            )}
            {n.constraints_unreadable.some((k) => k !== "max_price_cents") && (
              <p className="muted" style={{ fontSize: 13 }}>
                Some stated details couldn't be read, so none are assumed.
              </p>
            )}
            <Classification o={n} />
          </section>
          <details className="card">
            <summary style={{ fontWeight: 650 }}>What the project keeps</summary>
            <p style={{ fontSize: 14, margin: "8px 0 0" }}>
              The request's public text and stated constraints, with today's date and when it was
              posted ({ago(n.created_at)}). Not who posted it, their contact, any replies or
              searches. The project belongs to your business, like any other.
            </p>
          </details>
        </aside>
      </div>
    </div>
  );
}
