// Job 006b: a customer gives an agent narrow access to one offer: a key slot installed for the
// agent (its own key; Everstreet never holds it), a use limit and an expiry. The token is shown
// once; revoking stops every later call before anything runs.

import { useCallback, useEffect, useId, useState } from "react";
import { useSession } from "../session.tsx";

// biome-ignore lint/suspicious/noExplicitAny: a loosely typed projection, read field by field
type Json = Record<string, any>;

export function AgentAccessPage() {
  const { person, requireSignIn } = useSession();
  const offerFromUrl = new URLSearchParams(window.location.search).get("offer") ?? "";
  const [grants, setGrants] = useState<Json[] | null>(null);
  const [f, setF] = useState({
    offer_id: offerFromUrl,
    label: "",
    key_slot: "1",
    max_uses: "10",
    expires_in_days: "30",
  });
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const load = useCallback(() => {
    fetch("/api/customer/agent-grants", { credentials: "same-origin" })
      .then(async (r) => setGrants(((await r.json()) as Json).grants ?? []))
      .catch(() => setGrants([]));
  }, []);
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to manage agent access</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to manage agent access.")}
        >
          Sign in or join
        </button>
      </div>
    );
  const create = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);
    fetch("/api/customer/agent-grants", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...f,
        key_slot: Number(f.key_slot),
        max_uses: Number(f.max_uses),
        expires_in_days: Number(f.expires_in_days),
      }),
    })
      .then(async (r) => {
        const d = (await r.json()) as Json;
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        setToken(d.token);
        load();
      })
      .catch((x: Error) => setError(x.message));
  };
  const revoke = (id: string) =>
    fetch(`/api/customer/agent-grants/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      credentials: "same-origin",
    }).then(load);
  return (
    <div className="page narrow">
      <p className="eyebrow">Your products · Agent access</p>
      <h1 className="display" style={{ fontSize: 36 }}>
        Let an agent use a product for you
      </h1>
      <p className="lead">
        An agent signs each use with its own key, installed for it on the product's contract with
        its own daily limit. Here you give it a token for one offer, with a use limit and an expiry.
        It can't change limits, see other products, or act as the business.
      </p>
      <section className="card" aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`}>New agent access</h2>
        <form className="help-form" onSubmit={create}>
          <label htmlFor={`${uid}-o`}>Offer id</label>
          <input
            id={`${uid}-o`}
            className="input mono"
            value={f.offer_id}
            onChange={(e) => setF({ ...f, offer_id: e.target.value })}
            required
          />
          <label htmlFor={`${uid}-l`}>Agent's name</label>
          <input
            id={`${uid}-l`}
            className="input"
            maxLength={80}
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            required
          />
          <div className="grid-3">
            <div>
              <label htmlFor={`${uid}-s`}>Its key slot (0 to 3)</label>
              <input
                id={`${uid}-s`}
                className="input"
                inputMode="numeric"
                value={f.key_slot}
                onChange={(e) => setF({ ...f, key_slot: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-m`}>Most uses</label>
              <input
                id={`${uid}-m`}
                className="input"
                inputMode="numeric"
                value={f.max_uses}
                onChange={(e) => setF({ ...f, max_uses: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-d`}>Expires in (days)</label>
              <input
                id={`${uid}-d`}
                className="input"
                inputMode="numeric"
                value={f.expires_in_days}
                onChange={(e) => setF({ ...f, expires_in_days: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            Create access
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
        {token && (
          <div className="help-preview" role="status">
            <strong>Copy this token now: it isn't shown again.</strong>
            <p className="mono" style={{ overflowWrap: "anywhere" }}>
              {token}
            </p>
            <p className="small muted">
              MCP: POST /api/agent/mcp (protocol 2026-07-28) or the plain API at /api/agent/v1.
            </p>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Your agents</h2>
        {grants === null ? (
          <p className="muted">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="plain">
            {grants.map((g) => (
              <li key={g.id} className="pf-row">
                <strong>{g.label}</strong> · {g.state} · {g.used} of {g.max_uses} uses · slot{" "}
                {g.key_slot} · until {new Date(g.expires_at).toLocaleDateString()}{" "}
                {g.state === "active" && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => void revoke(g.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
