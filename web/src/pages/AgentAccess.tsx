// Job 006b: a customer gives an agent narrow access to one offer: a key slot installed for the
// agent (its own key; Everstreet never holds it), a use limit and an expiry. The token is shown
// once; revoking stops every later call before anything runs.
//
// 006b1 (Astra, Nov 5):
// - Everything here belongs to the person who asked. A switch or sign-out drops the list and the
//   one-time token at once, and a late answer for anyone else changes nothing.
// - A failed read says access couldn't be checked; it never shows "None".
// - Revoke is offered for every grant that isn't revoked yet, including a used-up one that can
//   still read its results, and only a confirmed answer counts as revoked.
// - One create at a time, so a double click can't make two grants.

import { useEffect, useId, useRef, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { useSession } from "../session.tsx";

// biome-ignore lint/suspicious/noExplicitAny: a loosely typed projection, read field by field
type Json = Record<string, any>;

const send = async (path: string, method = "GET", payload?: unknown): Promise<Json> => {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const d = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`, d.code);
  return d;
};
const fetchGrants = async (): Promise<Json[]> =>
  ((await send("/api/customer/agent-grants")).grants ?? []) as Json[];

const STATE_WORDS: Record<string, string> = {
  active: "active",
  used_up: "all uses made (can still read its results until it expires)",
  expired: "expired",
  revoked: "revoked",
};

export function AgentAccessPage() {
  const { person, requireSignIn } = useSession();
  const who = person?.id ?? null;
  const offerFromUrl = new URLSearchParams(window.location.search).get("offer") ?? "";
  const list = useActorRead(who, fetchGrants);
  const [f, setF] = useState({
    offer_id: offerFromUrl,
    label: "",
    key_slot: "1",
    max_uses: "10",
    expires_in_days: "30",
  });
  // The one-time token and messages, each bound to the person they were made for.
  const [token, setToken] = useState<{ who: string; value: string } | null>(null);
  const [error, setError] = useState<{ who: string; text: string } | null>(null);
  const [revokeError, setRevokeError] = useState<{ who: string; id: string; text: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const current = useRef(who);
  const busy = useRef(false);
  const uid = useId();
  useEffect(() => {
    current.current = who;
    // A different person (or none): nothing of the previous one stays on screen.
    setToken(null);
    setError(null);
    setRevokeError(null);
  }, [who]);

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
  const me = person.id;
  const mine = <T extends { who: string }>(v: T | null) => (v && v.who === me ? v : null);

  const create = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (busy.current) return; // one create at a time
    busy.current = true;
    setCreating(true);
    setError(null);
    setToken(null);
    const asker = me;
    send("/api/customer/agent-grants", "POST", {
      ...f,
      key_slot: Number(f.key_slot),
      max_uses: Number(f.max_uses),
      expires_in_days: Number(f.expires_in_days),
    })
      .then((d) => {
        if (current.current !== asker) return; // a late answer for someone else
        setToken({ who: asker, value: d.token as string });
        list.retry();
      })
      .catch((x: Error) => {
        if (current.current === asker) setError({ who: asker, text: x.message });
      })
      .finally(() => {
        busy.current = false;
        setCreating(false);
      });
  };
  const revoke = (id: string) => {
    if (revoking) return;
    setRevoking(id);
    setRevokeError(null);
    const asker = me;
    send(`/api/customer/agent-grants/${encodeURIComponent(id)}/revoke`, "POST")
      .then(() => {
        if (current.current === asker) list.retry();
      })
      .catch((x: Error) => {
        if (current.current === asker)
          setRevokeError({
            who: asker,
            id,
            text: `Not revoked: ${x.message}. It may still work; try again.`,
          });
      })
      .finally(() => setRevoking(null));
  };

  const grants = list.state.data;
  const shownToken = mine(token);
  const shownError = mine(error);
  const shownRevokeError = mine(revokeError);
  return (
    <div className="page narrow">
      <p className="eyebrow">Your products · Agent access</p>
      <h1 className="display" style={{ fontSize: 36 }}>
        Let an agent use a product for you
      </h1>
      <p className="lead">
        An agent signs each use with its own key, installed for it on the product's contract with
        its own daily limit. Here you give it a token for one offer, with a use limit and an expiry.
        It can't change limits, see other products, or act as the business. The business must allow
        agent use for that offer.
      </p>
      <section className="card" aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`}>New agent access</h2>
        <form className="help-form" onSubmit={create} aria-busy={creating}>
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
          <button type="submit" className="btn btn-primary" aria-disabled={creating}>
            {creating ? "Creating…" : "Create access"}
          </button>
          {shownError && (
            <p className="error" role="alert">
              {shownError.text}
            </p>
          )}
        </form>
        {shownToken && (
          <div className="help-preview" role="status">
            <strong>Copy this token now: it isn't shown again.</strong>
            <p className="mono" style={{ overflowWrap: "anywhere" }}>
              {shownToken.value}
            </p>
            <p className="small muted">
              MCP: POST /api/agent/mcp (protocol 2026-07-28) or the plain API at /api/agent/v1.
            </p>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby={`${uid}-g`}>
        <h2 id={`${uid}-g`}>Your agents</h2>
        {grants === null && list.state.status === "loading" ? (
          <p className="muted">Loading…</p>
        ) : grants === null ? (
          <div role="alert">
            <p className="error">
              Your agent access couldn't be checked just now
              {list.state.error ? ` (${list.state.error})` : ""}. Any access you gave still works
              until it's revoked.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={list.retry}>
              Check again
            </button>
          </div>
        ) : grants.length === 0 ? (
          <p className="muted">You haven't given any agent access.</p>
        ) : (
          <ul className="plain">
            {grants.map((g) => (
              <li key={g.id} className="pf-row">
                <strong>{g.label}</strong> · {STATE_WORDS[g.state] ?? g.state} · {g.used} of{" "}
                {g.max_uses} uses · slot {g.key_slot} · until{" "}
                {new Date(g.expires_at).toLocaleDateString()}{" "}
                {g.state !== "revoked" && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-disabled={revoking !== null}
                    onClick={() => revoke(g.id)}
                  >
                    {revoking === g.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
                {shownRevokeError?.id === g.id && (
                  <p className="error" role="alert">
                    {shownRevokeError?.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {grants !== null && list.state.status === "failed" && (
          <p className="small muted" role="status">
            This list may be out of date: the last check failed.{" "}
            <button type="button" className="btn btn-quiet btn-sm" onClick={list.retry}>
              Check again
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
