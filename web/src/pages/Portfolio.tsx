// Job 005d: a person's portfolio. Owned (with how control arrived), considering (anonymous stays
// anonymous), former (history only), what needs attention, and private labels and notes. Each
// business's figures stay in its own units; unknown stays unknown; no valuation.

import { useId, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

// biome-ignore lint/suspicious/noExplicitAny: a loosely typed projection, read field by field
type Json = Record<string, any>;
const group = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function NoteEditor({
  item,
  onSaved,
  labels,
}: {
  item: Json;
  onSaved: (v: Json) => void;
  labels: string[];
}) {
  const [label, setLabel] = useState<string>(item.label);
  const [note, setNote] = useState<string>(item.note);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const uid = useId();
  const id = item.business?.id;
  if (!id) return null;
  const save = () => {
    setError(null);
    fetch(`/api/me/portfolio/${encodeURIComponent(id)}/note`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, note, version: item.note_version }),
    })
      .then(async (r) => {
        const d = (await r.json()) as Json;
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        setSaved(true);
        onSaved(d);
      })
      .catch((e: Error) => setError(e.message));
  };
  return (
    <details className="pf-note">
      <summary>
        {item.label || item.note
          ? `Your note${item.label ? ` · ${item.label}` : ""}`
          : "Add a private note"}
      </summary>
      <label htmlFor={`${uid}-l`}>Label</label>
      <select
        id={`${uid}-l`}
        className="input"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          setSaved(false);
        }}
      >
        <option value="">None</option>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <label htmlFor={`${uid}-n`}>Note (only you see it)</label>
      <textarea
        id={`${uid}-n`}
        className="input"
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
      />
      <button type="button" className="btn btn-sm btn-secondary" onClick={save}>
        Save note
      </button>
      {saved && (
        <span className="muted small" role="status">
          {" "}
          Saved.
        </span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

/** The signed-in person's portfolio (private): read through the actor-bound reader. */
const fetchPortfolio = async (): Promise<Json> => {
  const r = await fetch("/api/me/portfolio", { credentials: "same-origin" });
  const d = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`, d.code);
  return d;
};

export function PortfolioPage() {
  const { person, requireSignIn } = useSession();
  // 006b1 (Astra, Nov 5): bound to the person who asked. A switch or sign-out drops what was
  // shown at once; a late answer for anyone else changes nothing.
  const { state, retry } = useActorRead(person?.id ?? null, fetchPortfolio);
  const p = state.data;
  const setP = (_saved: Json) => retry();
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see your portfolio</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to see your portfolio.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!p && (state.status === "failed" || state.status === "refused"))
    return (
      <div className="page">
        <p className="error" role="alert">
          Your portfolio couldn't be read just now{state.error ? ` (${state.error})` : ""}.
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
          Try again
        </button>
      </div>
    );
  if (!p) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <p className="eyebrow">Acquire · Portfolio</p>
      <h1 className="display" style={{ fontSize: 40 }}>
        Your portfolio
      </h1>
      <p className="muted">{p.basis}</p>
      {p.attention.length > 0 && (
        <section className="card pf-attention" aria-labelledby="pf-att">
          <h2 id="pf-att">Needs attention</h2>
          <ul className="plain">
            {p.attention.map((a: Json) => (
              <li key={`${a.business.id}-${a.text}`}>
                <Link to={`/desk/${a.business.id}`}>{a.business.name}</Link>: {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <h2 className="section-title">Owned ({p.owned.length})</h2>
      {p.owned.length === 0 && <p className="muted">You don't control a business yet.</p>}
      <div className="pf-grid">
        {p.owned.map((o: Json) => (
          <article key={o.business.id} className="card pf-card">
            <h3 style={{ marginTop: 0 }}>
              <Link to={`/desk/${o.business.id}`}>{o.business.name}</Link>
            </h3>
            <p className="small muted">
              {o.control.how === "founded"
                ? `Founded here ${new Date(o.control.at).toLocaleDateString()}`
                : `Received from ${o.control.from} ${new Date(o.control.at).toLocaleDateString()}${o.control.receipt?.tx ? " (recorded close)" : ""}`}
            </p>
            <p className="small">
              {o.products.projects} product{o.products.projects === 1 ? "" : "s"} ·{" "}
              {o.products.released} released · {o.products.offers} offer
              {o.products.offers === 1 ? "" : "s"} active
            </p>
            {o.this_month === null ? (
              <p className="small muted">This month's figures couldn't be read: unknown.</p>
            ) : Object.keys(o.this_month.by_asset).length === 0 ? (
              <p className="small muted">{o.this_month.label}: no charged uses or purchases.</p>
            ) : (
              <ul className="plain small">
                {Object.entries(o.this_month.by_asset as Record<string, Json>).map(([asset, v]) => (
                  <li key={asset}>
                    {o.this_month.label}: earned <span className="mono">{group(v.earned)}</span>{" "}
                    base units of <span className="mono">{asset}</span> from {v.earned_units} use
                    {v.earned_units === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
            {(o.owed ?? []).map((w: Json) => (
              <p key={w.asset} className="small">
                Customers are owed{" "}
                {w.outstanding_units === null ? "an unknown number of" : w.outstanding_units}{" "}
                prepaid use
                {w.outstanding_units === 1 ? "" : "s"}.
              </p>
            ))}
            {o.next_action && <p className="small notice info">Next: {o.next_action}</p>}
            <Link to={`/acquire/control/${o.business.id}`} className="btn btn-quiet btn-sm">
              Control sheet
            </Link>
            <NoteEditor item={o} labels={p.labels} onSaved={setP} />
          </article>
        ))}
      </div>
      <h2 className="section-title">Considering ({p.considering.length})</h2>
      {p.considering.length === 0 ? (
        <p className="muted">
          Nothing shortlisted. <Link to="/acquire">Browse businesses for sale</Link>.
        </p>
      ) : (
        <ul className="plain">
          {p.considering.map((c: Json) => (
            <li key={c.listing.id} className="card pf-row">
              {c.business ? (
                <strong>{c.business.name}</strong>
              ) : (
                <strong>An anonymous listing</strong>
              )}{" "}
              · shortlisted by {c.team} {new Date(c.shortlisted_at).toLocaleDateString()}
              {c.business && <NoteEditor item={c} labels={p.labels} onSaved={setP} />}
            </li>
          ))}
        </ul>
      )}
      <h2 className="section-title">Former ({p.former.length})</h2>
      {p.former.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="plain">
          {p.former.map((f: Json) => (
            <li key={`${f.business.id}-${f.passed_on.at}`} className="card pf-row">
              <strong>{f.business.name}</strong> · passed to {f.passed_on.to}{" "}
              {new Date(f.passed_on.at).toLocaleDateString()}.{" "}
              <span className="muted small">{f.history_only}</span>
              <NoteEditor item={f} labels={p.labels} onSaved={setP} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
