// What a helper sees for a business they help: messages to answer and paid orders to mark
// delivered. Every action is checked by the business's contract, not by Everstreet's records.
//
// Job 005b (docs/design/HELPER_READ_AUTHORITY.md): only the capabilities confirmed now are shown;
// ended, denied, unconfirmed and failed reads show no private section; drafts are cleared when
// access ends and kept for a retry otherwise; an action with no answer re-reads instead of
// resending. The page is keyed by actor and business (App.tsx), so a switch starts it afresh.

import { useEffect, useMemo, useState } from "react";
import { api4, type HelperDesk, usd } from "../api4.ts";
import {
  actionMessage,
  actionOutcome,
  helperPatch,
  helperShown,
  keepDrafts,
} from "../helperView.ts";
import { initialLoad, type LoadState, latestLoader } from "../latestLoad.ts";
import { Link } from "../router.tsx";
import { when } from "../via.ts";

export function Helping({ id }: { id: string }) {
  const [s, setS] = useState<LoadState<HelperDesk>>(initialLoad);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loader = useMemo(
    () =>
      latestLoader(
        () => api4.helperDesk(id),
        // A failed re-read never leaves older private data to show again on retry.
        (p) => setS((prev) => helperPatch(prev, p)),
      ),
    [id],
  );
  useEffect(() => {
    loader.open();
    void loader.load();
    return () => loader.close();
  }, [loader]);
  const retry = () => {
    setS((prev) => ({ ...prev, data: null, error: null, status: "loading" }));
    void loader.load();
  };

  const shown = helperShown(s);
  // Access ended or was refused: drafts go with it (they may hold what customers wrote about).
  const clear = !keepDrafts(shown);
  useEffect(() => {
    if (clear) setReplies({});
  }, [clear]);

  const run = async (fn: () => Promise<HelperDesk>) => {
    setBusy(true);
    setNote(null);
    try {
      const d = await fn();
      loader.invalidate(); // an older read still in flight must not overwrite this answer
      setS({ data: d, error: null, status: "ready" });
    } catch (e) {
      const kind = actionOutcome(e);
      setNote(actionMessage(kind, (e as Error).message));
      void loader.load(); // show what is recorded now; never resend on its own
    }
    setBusy(false);
  };

  if (shown.kind === "loading") return <div className="page muted">Loading…</div>;
  if (shown.kind === "refused")
    return (
      <div className="page empty">
        <h2>You can't open this business's help page</h2>
        <p className="muted">{shown.error}</p>
        <Link to="/desk">Your businesses</Link>
      </div>
    );
  if (shown.kind === "failed")
    return (
      <div className="page empty" role="alert">
        <h2>Your access couldn't be checked just now</h2>
        <p className="muted">
          Nothing private is shown until it is. {shown.error ? `(${shown.error})` : ""}
        </p>
        <button type="button" className="btn btn-secondary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  const d = shown.desk;
  if (shown.kind !== "active")
    return (
      <div className="page">
        <div className="eyebrow">You helped</div>
        <h1 className="display" style={{ fontSize: 40, margin: "4px 0" }}>
          {d.business.name}
        </h1>
        <div className="notice" role="status">
          {shown.kind === "ended"
            ? "Your helper access for this business has ended. Its customers' messages and orders aren't shown."
            : shown.kind === "denied"
              ? `The business's contract doesn't allow you to act for it now (${d.capabilities.support.reason}). Nothing private is shown.`
              : `The business's contract couldn't be checked just now, so nothing private is shown. ${d.capabilities.support.reason}.`}
        </div>
        {shown.kind === "unconfirmed" && (
          <button type="button" className="btn btn-secondary" onClick={retry}>
            Try again
          </button>
        )}
        {note && <p className="error-text">{note}</p>}
        <p className="muted" style={{ marginTop: 16 }}>
          <Link to={`/b/${d.business.slug}`}>See the public page</Link>
        </p>
      </div>
    );

  return (
    <div className="page">
      <div className="eyebrow">You help</div>
      <h1 className="display" style={{ fontSize: 40, margin: "4px 0" }}>
        {d.business.name}
      </h1>
      <p className="notice ok">
        The business's contract ({d.business_account}) confirms, as of this read:{" "}
        {[
          d.capabilities.support.state === "authorized" && "answering customers",
          d.capabilities.fulfillment.state === "authorized" && "marking orders delivered",
        ]
          .filter(Boolean)
          .join(" and ")}
        .
      </p>
      {note && (
        <p className="error-text" aria-live="polite">
          {note}
        </p>
      )}
      <div className="desk">
        <section className="card">
          <h2>Customers' messages</h2>
          {shown.inquiries === null ? (
            <p className="muted">
              Not shown: answering customers isn't confirmed for you now (
              {d.capabilities.support.reason}).
            </p>
          ) : (
            <>
              {shown.inquiries.length === 0 && <p className="muted">Nothing to answer.</p>}
              {shown.inquiries.map((i) => (
                <div className="message" key={i.id}>
                  <div className="meta">
                    {i.share_contact ? i.from_name : `${i.from_name} (contact not shared)`} ·{" "}
                    {new Date(i.created_at).toLocaleString()}
                  </div>
                  {i.message && <blockquote>{i.message}</blockquote>}
                  {i.reply ? (
                    <div className="reply" style={{ whiteSpace: "pre-wrap" }}>
                      <strong>Replied:</strong> {i.reply}
                    </div>
                  ) : (
                    <div className="row" style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="Write a reply"
                        aria-label={`Reply to ${i.from_name}`}
                        value={replies[i.id] ?? ""}
                        onChange={(e) => setReplies((r) => ({ ...r, [i.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !replies[i.id]?.trim()}
                        onClick={() => run(() => api4.helperReply(id, i.id, replies[i.id] ?? ""))}
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
        <section className="card">
          <h2>Orders to deliver</h2>
          {shown.orders === null ? (
            <p className="muted">
              Not shown: marking orders delivered isn't confirmed for you now (
              {d.capabilities.fulfillment.reason}).
            </p>
          ) : (
            <>
              {shown.orders.length === 0 && <p className="muted">No paid orders.</p>}
              {shown.orders.map((o) => (
                <div className="message" key={o.order_id}>
                  <div className="row">
                    <span>
                      <strong>{o.customer}</strong> · {usd(o.amount_cents)} ·{" "}
                      {o.session_starts_at ? when(o.session_starts_at) : ""}
                    </span>
                    <span className="spacer" />
                    {o.status === "paid" ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => run(() => api4.deliverAsHelper(o.order_id))}
                      >
                        {busy ? "On NEAR testnet…" : "Mark delivered"}
                      </button>
                    ) : (
                      <span className="pill lime">Delivered</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link to={`/b/${d.business.slug}`}>See the public page</Link>
      </p>
    </div>
  );
}
