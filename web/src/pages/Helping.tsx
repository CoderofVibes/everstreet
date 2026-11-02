// What a helper sees for a business they help: messages to answer and paid orders to mark
// delivered. Every action is checked by the business's contract, not by Everstreet's records.

import { useCallback, useEffect, useState } from "react";
import { api4, type HelperDesk, usd } from "../api4.ts";
import { Link } from "../router.tsx";
import { when } from "../via.ts";

export function Helping({ id }: { id: string }) {
  const [d, setD] = useState<HelperDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api4
        .helperDesk(id)
        .then(setD)
        .catch((e) => setError((e as Error).message)),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn: () => Promise<HelperDesk>) => {
    setBusy(true);
    setError(null);
    try {
      setD(await fn());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  if (!d) return <div className="page muted">{error ?? "Loading…"}</div>;
  return (
    <div className="page">
      <div className="eyebrow">You help</div>
      <h1 className="display" style={{ fontSize: 40, margin: "4px 0" }}>
        {d.business.name}
      </h1>
      <p className={`notice ${d.chain_check.authorized ? "ok" : ""}`}>
        {d.chain_check.authorized
          ? `The business's contract (${d.business_account}) confirms you may answer customers and mark orders delivered.`
          : `The business's contract says you can't act for it now: ${d.chain_check.reason}.`}
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="desk">
        <section className="card">
          <h2>Customers' messages</h2>
          {d.inquiries.length === 0 && <p className="muted">Nothing to answer.</p>}
          {d.inquiries.map((i) => (
            <div className="message" key={i.id}>
              <div className="meta">
                {i.share_contact
                  ? i.from_name
                  : `${i.from_name.split(" ")[0]} (contact not shared)`}{" "}
                · {new Date(i.created_at).toLocaleString()}
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
                    value={replies[i.id] ?? ""}
                    onChange={(e) => setReplies({ ...replies, [i.id]: e.target.value })}
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
        </section>
        <section className="card">
          <h2>Orders to deliver</h2>
          {d.orders.length === 0 && <p className="muted">No paid orders.</p>}
          {d.orders.map((o) => (
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
        </section>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link to={`/b/${d.business.slug}`}>See the public page</Link>
      </p>
    </div>
  );
}
