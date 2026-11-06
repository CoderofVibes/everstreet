// Job 005d: a person's portfolio. Owned (with how control arrived), considering (anonymous stays
// anonymous), former (history only), what needs attention, and private labels and notes. Each
// business's figures stay in its own units; unknown stays unknown; no valuation.

import { useId, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Dashboard } from "./Dashboard.tsx";

// biome-ignore lint/suspicious/noExplicitAny: a loosely typed projection, read field by field
type Json = Record<string, any>;

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

/** Plan step 7: the dashboard's figures, read the same way. */
const fetchDashboard = async (): Promise<Json> => {
  const r = await fetch("/api/me/dashboard?days=30", { credentials: "same-origin" });
  const d = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`, d.code);
  return d;
};

export function PortfolioPage() {
  const { person, requireSignIn, environment } = useSession();
  const dash = useActorRead(person?.id ?? null, fetchDashboard);
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
    <div className="page page-wide">
      {dash.state.data ? (
        <Dashboard d={dash.state.data} environment={environment} />
      ) : dash.state.status === "failed" || dash.state.status === "refused" ? (
        <p className="error" role="alert">
          Your dashboard couldn't be read just now
          {dash.state.error ? ` (${dash.state.error})` : ""}.{" "}
          <button type="button" className="btn btn-secondary btn-sm" onClick={dash.retry}>
            Try again
          </button>
        </p>
      ) : (
        <p className="muted">Loading your dashboard…</p>
      )}
      <p className="muted small">{p.basis}</p>
      {p.owned.length > 0 && (
        <>
          <h2 className="section-title">Control sheets and notes</h2>
          <ul className="plain pf-owned">
            {p.owned.map((o: Json) => (
              <li key={o.business.id} className="card pf-row">
                <strong>
                  <Link to={`/desk/${o.business.id}`}>{o.business.name}</Link>
                </strong>{" "}
                <span className="small muted">
                  {o.control.how === "founded"
                    ? `Founded here ${new Date(o.control.at).toLocaleDateString()}`
                    : `Received from ${o.control.from} ${new Date(o.control.at).toLocaleDateString()}${o.control.receipt?.tx ? " (recorded close)" : ""}`}
                </span>{" "}
                <Link to={`/acquire/control/${o.business.id}`} className="btn btn-quiet btn-sm">
                  Control sheet<span className="sr-only">: {o.business.name}</span>
                </Link>
                <NoteEditor item={o} labels={p.labels} onSaved={setP} />
              </li>
            ))}
          </ul>
        </>
      )}
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
