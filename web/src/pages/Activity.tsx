// My activity: everything this person has as a customer. Bookings show OpenSeat's live status
// and who promoted a waitlisted place (checked against NEAR); needs show founders' replies.

import { useCallback, useEffect, useState } from "react";
import { api, type MyBooking, type MyNeed, type Wallet } from "../api.ts";
import { myUses, type UseSummary } from "../customerApi.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { money } from "../ui.tsx";
import { ago, when } from "../via.ts";

type ActivityData = Awaited<ReturnType<typeof api.activity>>;

function BookingCard({ b, onChange }: { b: MyBooking; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const past = Date.parse(b.ends_at) < Date.now();
  return (
    <div className="message">
      <div className="row">
        <div>
          <strong>{b.title}</strong>
          <div className="muted" style={{ fontSize: 14 }}>
            <Link to={`/b/${b.business.slug}`}>{b.business.name}</Link> · {when(b.starts_at)}
            {b.where ? ` · ${b.where}` : ""}
          </div>
        </div>
        <span className="spacer" />
        {b.status === "confirmed" && <span className="pill lime">Place confirmed</span>}
        {b.status === "waitlisted" && <span className="pill caution">Waitlist #{b.position}</span>}
        {b.status === "cancelled" && <span className="pill">Cancelled</span>}
        {b.status === "unknown" && (
          <span className="pill caution">Status can't be checked right now</span>
        )}
      </div>
      {b.promoted_by && b.status === "confirmed" && (
        <p className="near-note">
          A place opened and you were moved up from the waitlist by {b.promoted_by}, whose
          permission was checked against the booking service's contract on NEAR testnet (authority
          generation {b.promoted_generation}).
        </p>
      )}
      {b.payment && <PaymentLine p={b.payment} />}
      <div className="row" style={{ marginTop: 8, fontSize: 14 }}>
        <span className="muted">
          Your reference: <code>{b.reference}</code>. Keep it private; it is what proves the place
          is yours.
        </span>
        <span className="spacer" />
        {b.status === "confirmed" && (
          <a className="btn btn-secondary" href={`/api/activity/bookings/${b.id}/calendar.ics`}>
            Add to calendar
          </a>
        )}
        {(b.status === "confirmed" || b.status === "waitlisted") && !past && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  b.payment?.status === "paid"
                    ? b.payment.refundable_now
                      ? `Cancel and get ${money(b.payment.amount_cents)} back? The refund is paid by the business's contract on NEAR testnet.`
                      : "The refund window has closed: if you cancel now, the business keeps the payment. Cancel anyway?"
                    : b.status === "confirmed"
                      ? "Give up your place? The next person waiting gets it."
                      : "Leave the waitlist?",
                )
              )
                return;
              setBusy(true);
              try {
                await api.cancelBooking(b.id);
              } catch (e) {
                window.alert((e as Error).message);
              }
              onChange();
            }}
          >
            {b.status === "confirmed" ? "Cancel my place" : "Leave the waitlist"}
          </button>
        )}
      </div>
    </div>
  );
}

function PaymentLine({ p }: { p: NonNullable<MyBooking["payment"]> }) {
  const label: Record<string, string> = {
    paid: `Paid ${money(p.amount_cents)}`,
    delivered: `Paid ${money(p.amount_cents)} · delivered`,
    refunded: `Refunded ${money(p.amount_cents)}`,
    kept: `Paid ${money(p.amount_cents)} · cancelled after the refund window`,
    unknown: "Payment not confirmed yet",
    submitted: "Payment being checked",
    failed: "Payment did not go through",
  };
  return (
    <p className="near-note">
      <strong>{label[p.status] ?? p.status}</strong> in test dollars{" "}
      {p.status === "refunded" ? "back from" : "to"} <code>{p.business_account}</code>.{" "}
      {p.status === "paid" &&
        (p.refundable_now
          ? `Full refund if you cancel before ${when(p.cancel_before)}. `
          : "The refund window has closed. ")}
      {p.tx_url && (
        <a href={p.tx_url} target="_blank" rel="noreferrer">
          Payment
        </a>
      )}
      {p.refund_tx_url && (
        <>
          {" · "}
          <a href={p.refund_tx_url} target="_blank" rel="noreferrer">
            Refund
          </a>
        </>
      )}
      {p.error && p.status !== "kept" && <> · {p.error}</>}
    </p>
  );
}

function WalletCard() {
  const [w, setW] = useState<Wallet | null | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .wallet()
      .then((r) => {
        setW(r.wallet);
        setEnabled(r.info.enabled);
      })
      .catch(() => setW(null));
  }, []);
  if (w === undefined || !enabled) return null;
  return (
    <section className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Your test wallet</h2>
        <span className="spacer" />
        {w && (
          <strong style={{ fontSize: 22 }}>
            {w.balance_cents === null ? "…" : money(w.balance_cents)}
          </strong>
        )}
      </div>
      {w ? (
        <>
          <p className="muted" style={{ fontSize: 14, margin: "6px 0" }}>
            Your own account on NEAR testnet:{" "}
            <a href={w.explorer} target="_blank" rel="noreferrer">
              <code>{w.account_id}</code>
            </a>
            . Test dollars have no value. In this local preview its key is kept on this computer;
            real sign-in replaces that later.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setW((await api.topUp()).wallet);
              setBusy(false);
            }}
          >
            Get $100 more test dollars
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            Paying a business on Everstreet uses your own testnet account. It's created with $200 in
            test dollars (no real money) the first time you pay, or now.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setW((await api.createWallet()).wallet);
              setBusy(false);
            }}
          >
            {busy ? "Creating on NEAR testnet…" : "Create my test wallet"}
          </button>
        </>
      )}
    </section>
  );
}

function NeedCard({ n, onChange }: { n: MyNeed; onChange: (needs: MyNeed[]) => void }) {
  const [replies, setReplies] = useState<Record<string, string>>({});
  const open = n.status === "open" && !n.expired;
  return (
    <div className="message">
      <div className="row">
        <strong style={{ flex: 1 }}>“{n.text}”</strong>
        {open ? (
          <span className="pill lime">
            Open until {new Date(n.expires_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="pill">{n.expired ? "Expired" : "Closed"}</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        Posted {ago(n.created_at)} · {n.allow_replies ? "founders may reply" : "no replies"} · your
        name is not shown
      </div>
      {n.responses.length === 0 && open && n.allow_replies && (
        <p className="muted" style={{ fontSize: 14 }}>
          No replies yet.
        </p>
      )}
      {n.responses.map((r) => (
        <div key={r.id} style={{ marginTop: 10 }}>
          <div className="meta">
            <Link to={`/b/${r.slug}?via=need`}>{r.business_name}</Link> replied {ago(r.created_at)}
          </div>
          <blockquote>{r.message}</blockquote>
          {r.reply ? (
            <div className="reply">
              <strong>You:</strong> {r.reply}
            </div>
          ) : (
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Reply"
                value={replies[r.id] ?? ""}
                onChange={(e) => setReplies({ ...replies, [r.id]: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!replies[r.id]?.trim()}
                onClick={async () =>
                  onChange((await api.replyToResponse(r.id, replies[r.id] ?? "")).needs)
                }
              >
                Reply
              </button>
            </div>
          )}
        </div>
      ))}
      {open && (
        <button
          type="button"
          className="btn btn-quiet"
          style={{ paddingLeft: 0, marginTop: 6 }}
          onClick={async () => onChange((await api.closeNeed(n.id)).needs)}
        >
          Close this request
        </button>
      )}
    </div>
  );
}

const UNIT_LABEL: Record<UseSummary["unit"], string> = {
  reserved_awaiting_settlement: "unit reserved",
  charge_pending: "charging one unit",
  release_pending: "returning your unit",
  charged: "one unit used",
  returned: "unit returned",
  conflict: "needs checking",
  unknown: "unit not known yet",
};

/**
 * Job 003q: the digital products this person used, newest first, each a durable link back to
 * its own request. Only their own requests; no documents or results are listed here.
 */
function MyUses() {
  const [uses, setUses] = useState<UseSummary[] | null>(null);
  useEffect(() => {
    myUses()
      .then(setUses)
      .catch(() => setUses([]));
  }, []);
  if (uses === null) return null;
  const products = [...new Map(uses.map((u) => [u.offer_id, u])).values()];
  return (
    <section className="card">
      <h2>My products</h2>
      {uses.length === 0 ? (
        <p className="muted">
          Digital products you use appear here. <Link to="/explore">Explore what's open</Link>.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14 }}>
            {products.map((p, i) => (
              <span key={p.offer_id}>
                {i > 0 && " · "}
                <strong>{p.product.name}</strong> from{" "}
                <Link to={`/b/${p.business.slug}`}>{p.business.name}</Link>
              </span>
            ))}
          </p>
          <h3 style={{ fontSize: 15, margin: "14px 0 6px" }}>Recent uses</h3>
          <ul className="use-recent">
            {uses.slice(0, 10).map((u) => (
              <li key={u.id}>
                <Link to={`/uses/${u.id}`}>{u.product.name}</Link>
                <span className="muted">
                  {" "}
                  · {u.label.toLowerCase()} · {UNIT_LABEL[u.unit]} · {ago(u.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function Activity() {
  const { person, requireSignIn } = useSession();
  const [data, setData] = useState<ActivityData | null>(null);
  const load = useCallback(
    () =>
      api
        .activity()
        .then(setData)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see your bookings and requests</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to see your bookings and requests.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <div className="page narrow">
      <h1 className="display" style={{ fontSize: 40 }}>
        My activity
      </h1>
      <MyUses />
      <WalletCard
        key={data.bookings.map((b) => `${b.id}:${b.status}:${b.payment?.status ?? ""}`).join("|")}
      />
      <section className="card">
        <h2>Bookings</h2>
        {data.bookings.length === 0 ? (
          <p className="muted">
            No bookings yet. <Link to="/explore">Explore what's open</Link>.
          </p>
        ) : (
          data.bookings.map((b) => <BookingCard key={b.id} b={b} onChange={load} />)
        )}
      </section>
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Things you asked for</h2>
          <span className="spacer" />
          <Link to="/find" className="btn btn-secondary">
            Post a need
          </Link>
        </div>
        {data.needs.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            When search can't find what you need, you can post it, and founders who can help will
            reply here.
          </p>
        ) : (
          data.needs.map((n) => (
            <NeedCard key={n.id} n={n} onChange={(needs) => setData({ ...data, needs })} />
          ))
        )}
      </section>
      <section className="card">
        <h2>From businesses you follow</h2>
        {data.feed.length === 0 ? (
          <p className="muted">
            {data.following.length === 0
              ? "You're not following anyone yet."
              : "No updates yet from the businesses you follow."}
          </p>
        ) : (
          data.feed.map((u) => (
            <div className="message" key={u.id}>
              <div className="meta">
                <Link to={`/b/${u.slug}?via=follow`}>{u.business_name}</Link> · {ago(u.created_at)}
              </div>
              <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{u.body}</p>
            </div>
          ))
        )}
        {data.following.length > 0 && (
          <p className="muted" style={{ fontSize: 14, marginTop: 12, marginBottom: 0 }}>
            Following:{" "}
            {data.following.map((f, i) => (
              <span key={f.slug}>
                {i > 0 && ", "}
                <Link to={`/b/${f.slug}?via=follow`}>{f.name}</Link>
              </span>
            ))}
          </p>
        )}
      </section>
      <section className="card">
        <h2>Messages you sent</h2>
        {data.sent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          data.sent.map((i) => (
            <div className="message" key={i.id}>
              <div className="meta">
                To <Link to={`/b/${i.slug}`}>{i.business_name}</Link> · {ago(i.created_at)}
              </div>
              <blockquote>{i.message || "I'm interested."}</blockquote>
              {i.reply ? (
                <div className="reply">
                  <strong>Reply:</strong> {i.reply}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 14 }}>
                  Waiting for a reply.
                </p>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
