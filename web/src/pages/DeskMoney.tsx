// The founder's money, read from the business's own contract on NEAR testnet: turning payments
// on (with the promises the business will keep, fixed for good), customer money held until
// delivered, earned money, this month's books, delivering orders and withdrawing.

import { useCallback, useEffect, useState } from "react";
import { api, type Desk, type Money } from "../api.ts";
import { money } from "../ui.tsx";
import { when } from "../via.ts";

function Activate({ desk, onDone }: { desk: Desk; onDone: () => void }) {
  const [refund, setRefund] = useState(24);
  const [reserve, setReserve] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>Take payments on NEAR</h2>
      <p className="muted" style={{ fontSize: 15 }}>
        {desk.business.name} gets its own account on NEAR testnet. Customers pay it directly in test
        dollars (no real money); it holds their money until you deliver, and you withdraw what
        you've earned. Nobody can change its rules later, including you and Everstreet. That's what
        makes it trustworthy to customers and, one day, to a buyer.
      </p>
      <h3 style={{ fontSize: 16 }}>Promises this business will keep, whoever owns it</h3>
      <label className="field">
        <span>Cancellation refunds</span>
        <select
          className="input"
          value={refund}
          onChange={(e) => setRefund(Number(e.target.value))}
          style={{ maxWidth: 420 }}
        >
          <option value={24}>Full refund if a customer cancels at least 24 hours before</option>
          <option value={48}>Full refund if a customer cancels at least 48 hours before</option>
          <option value={168}>Full refund if a customer cancels at least a week before</option>
          <option value={0}>No cancellation refunds</option>
        </select>
      </label>
      <label className="field">
        <span>Keep a reserve ($)</span>
        <small>
          Money you can never withdraw below, so refunds and running costs stay covered.
        </small>
        <input
          className="input"
          inputMode="numeric"
          value={reserve}
          onChange={(e) => setReserve(Number(e.target.value.replace(/\D/g, "")) || 0)}
          style={{ maxWidth: 160 }}
        />
      </label>
      <p className="muted" style={{ fontSize: 14 }}>
        Always on: customers' money stays theirs until you mark the order delivered, and unused
        credit can be taken back.
      </p>
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.activatePayments(desk.business.id, refund, reserve * 100);
            onDone();
          } catch (e) {
            setError((e as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? "Creating the business's account on NEAR testnet…" : "Turn on payments"}
      </button>
    </section>
  );
}

const STATUS: Record<string, string> = {
  paid: "Paid, not yet delivered",
  delivered: "Delivered",
  refunded: "Refunded",
  kept: "Cancelled late (kept)",
  unknown: "Not confirmed yet",
  submitted: "Being checked",
  failed: "Did not go through",
};

export function DeskMoney({ desk }: { desk: Desk }) {
  const [m, setM] = useState<Money | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const load = useCallback(
    () =>
      api
        .money(desk.business.id)
        .then(setM)
        .catch(() => setM({ enabled: false, active: false })),
    [desk.business.id],
  );
  useEffect(() => {
    load();
  }, [load]);
  const priced =
    desk.offer.price_cents !== null && desk.offer.price_cents > 0 && !desk.offer.first_free;
  if (!m?.enabled || !desk.business.published_at || !priced) return null;
  if (!m.active) return <Activate desk={desk} onDone={load} />;
  const t = m.treasury;
  const run = async (label: string, fn: () => Promise<Money>) => {
    setBusy(label);
    setError(null);
    try {
      setM(await fn());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const b = m.business;
  return (
    <section className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Money</h2>
        <span className="spacer" />
        {b && (
          <a
            href={b.explorer}
            target="_blank"
            rel="noreferrer"
            className="muted"
            style={{ fontSize: 14 }}
          >
            {b.account_id}
          </a>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "4px 0 12px" }}>
        {m.source}. Test dollars, no real money.
      </p>
      {t ? (
        <div className="stat-row">
          <div className="stat">
            <span className="muted" style={{ fontSize: 13 }}>
              Customers' money (not yet delivered)
            </span>
            <strong>{money(t.customer_money ?? 0)}</strong>
          </div>
          <div className="stat">
            <span className="muted" style={{ fontSize: 13 }}>
              Earned and in the business
            </span>
            <strong>{money(t.available ?? 0)}</strong>
          </div>
          <div className="stat">
            <span className="muted" style={{ fontSize: 13 }}>
              You can withdraw
            </span>
            <strong>{money(t.withdrawable ?? 0)}</strong>
          </div>
          <div className="stat">
            <span className="muted" style={{ fontSize: 13 }}>
              Reserve kept
            </span>
            <strong>{money(b?.reserve_cents ?? 0)}</strong>
          </div>
        </div>
      ) : (
        <p className="notice">
          NEAR testnet can't be reached right now, so the numbers aren't shown.
        </p>
      )}
      {m.month && (
        <p style={{ fontSize: 14, marginTop: 12 }}>
          <span className="muted">This month on chain:</span> {money(m.month.orders_in ?? 0)} paid
          in · {money(m.month.earned ?? 0)} earned · {money(m.month.refunds ?? 0)} refunded ·{" "}
          {money(m.month.owner_withdrawals ?? 0)} withdrawn
        </p>
      )}
      <p className="muted" style={{ fontSize: 14 }}>
        Promise:{" "}
        {b && b.refund_hours > 0
          ? `full refund if a customer cancels at least ${b.refund_hours} hours before`
          : "no cancellation refunds"}
        . Fixed when you turned payments on.
      </p>

      <h3 style={{ fontSize: 16, marginTop: 18 }}>Orders</h3>
      {(m.orders ?? []).length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          No paid orders yet.
        </p>
      ) : (
        (m.orders ?? []).map((o) => (
          <div className="message" key={o.order_id}>
            <div className="row">
              <span>
                <strong>{o.customer}</strong> · {money(o.amount_cents)} ·{" "}
                {o.session_starts_at ? when(o.session_starts_at) : ""}
              </span>
              <span className="spacer" />
              <span
                className={`pill ${o.status === "delivered" ? "lime" : o.status === "paid" ? "" : "caution"}`}
              >
                {STATUS[o.status] ?? o.status}
              </span>
              {o.status === "paid" && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => run("deliver", () => api.deliver(o.order_id))}
                >
                  Mark delivered
                </button>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {o.tx_url && (
                <a href={o.tx_url} target="_blank" rel="noreferrer">
                  payment
                </a>
              )}
              {o.deliver_tx_url && (
                <>
                  {" · "}
                  <a href={o.deliver_tx_url} target="_blank" rel="noreferrer">
                    delivered
                  </a>
                </>
              )}
              {o.refund_tx_url && (
                <>
                  {" · "}
                  <a href={o.refund_tx_url} target="_blank" rel="noreferrer">
                    refund
                  </a>
                </>
              )}
            </div>
          </div>
        ))
      )}

      <h3 style={{ fontSize: 16, marginTop: 18 }}>Withdraw to your account</h3>
      <div className="row">
        <input
          className="input"
          inputMode="decimal"
          placeholder="Amount ($)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(busy) || !Number(amount)}
          onClick={() =>
            run("withdraw", async () => {
              const r = await api.withdraw(desk.business.id, Math.round(Number(amount) * 100));
              setAmount("");
              return r;
            })
          }
        >
          {busy === "withdraw" ? "Sending…" : "Withdraw"}
        </button>
        {m.owner_wallet && (
          <span className="muted" style={{ fontSize: 14 }}>
            Your wallet: {money(m.owner_wallet.balance_cents ?? 0)}
          </span>
        )}
      </div>
      {busy === "deliver" && <p className="muted">Recording delivery on NEAR testnet…</p>}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
