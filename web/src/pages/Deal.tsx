// A deal (Astra, phase 6 and IntactProfiles §7 G): the exact terms both people accept, what
// changed since the last version, every step with its NEAR transaction, and after the close the
// seller's proceeds, the former owner's refusal, and the buyer's first shift.

import { useCallback, useEffect, useState } from "react";
import { usd } from "../api4.ts";
import { when } from "../api5.ts";
import {
  api6,
  DEAL_STATUS,
  type DealSummary,
  type DealView,
  type SnapshotPreview,
  type Terms,
  type TermsInput,
} from "../api6.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

const STEP_LABEL: Record<string, string> = {
  proposed: "Terms proposed",
  revised: "Terms revised",
  test_dollars: "Test dollars from the faucet",
  funded: "Buyer funded the price",
  hold_withdrawn: "Buyer took the hold back",
  seller_accepted: "Seller accepted",
  buyer_accepted: "Buyer accepted",
  closed: "Sale closed on NEAR",
  accept_unconfirmed: "Acceptance sent; no answer yet",
  reconcile_needed: "Needs reconciling",
  cancelled: "Cancelled",
  proceeds_claimed: "Seller claimed proceeds",
  former_owner_check: "Former owner tried an owner action",
};

/** The seller's choice to put financial figures in the terms, with exactly what they'd be. */
function SnapshotChoice({
  businessId,
  buyerId,
  on,
  setOn,
}: {
  businessId: string;
  buyerId: string;
  on: boolean;
  setOn: (on: boolean) => void;
}) {
  const [p, setP] = useState<SnapshotPreview | null>(null);
  useEffect(() => {
    let live = true;
    api6
      .snapshotPreview(businessId, buyerId)
      .then((x) => live && setP(x))
      .catch(() => live && setP(null));
    return () => {
      live = false;
    };
  }, [businessId, buyerId]);
  if (!p) return null;
  return (
    <div className="field">
      <label className="check" style={{ margin: 0 }}>
        <input
          type="checkbox"
          checked={on && p.allowed}
          disabled={!p.allowed}
          onChange={(e) => setOn(e.target.checked)}
        />
        <span style={{ fontSize: 15 }}>Include a financial snapshot in the terms</span>
      </label>
      {p.allowed && p.figures ? (
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Would include: estimate {p.figures.estimate} ({p.figures.basis}); revenue{" "}
          {p.figures.revenue_month} and profit {p.figures.profit_month} a month
          {p.figures.months.length ? ` over ${p.figures.months.join(", ")}` : ""}. Seen by:{" "}
          {p.audience}. {p.retention}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {p.reason}
        </p>
      )}
      {!on && (
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Without it: {p.without}
        </p>
      )}
    </div>
  );
}

export function TermsForm({
  initial,
  submit,
  label,
  keepExpiry,
  snapshotFor,
}: {
  initial?: Partial<TermsInput>;
  submit: (t: TermsInput) => Promise<void>;
  label: string;
  keepExpiry?: boolean;
  /** Offer the financial-snapshot choice for this business and buying team. */
  snapshotFor?: { businessId: string; buyerId: string };
}) {
  const [price, setPrice] = useState(initial?.price_cents ? String(initial.price_cents / 100) : "");
  const [days, setDays] = useState(keepExpiry ? 0 : (initial?.days ?? 7));
  const [handover, setHandover] = useState(initial?.handover ?? "");
  const [conditions, setConditions] = useState(initial?.conditions ?? "");
  const [snapshot, setSnapshot] = useState(initial?.snapshot ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="filters" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Price ($, test dollars)</span>
          <input
            className="input"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Offer stays open for</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {keepExpiry && <option value={0}>Keep the current expiry</option>}
            {[1, 3, 7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Handover you'll give</span>
        <input className="input" value={handover} onChange={(e) => setHandover(e.target.value)} />
      </label>
      <label className="field">
        <span>Conditions (optional)</span>
        <input
          className="input"
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
        />
      </label>
      {snapshotFor && <SnapshotChoice {...snapshotFor} on={snapshot} setOn={setSnapshot} />}
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await submit({
              price_cents: Math.round(Number(price) * 100),
              days,
              handover,
              conditions,
              snapshot: Boolean(snapshotFor) && snapshot,
            });
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? "Recording on NEAR testnet…" : label}
      </button>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        The price, both accounts, the expiry and a fingerprint of these terms go on NEAR testnet,
        where anyone can read them.
      </p>
    </div>
  );
}

/** The evidence part of the terms, in whichever format they were written. */
function EvidenceText({ t }: { t: Terms }) {
  const e = t.evidence;
  const money = t.obligations?.customer_money ?? ("customer_money" in e ? e.customer_money : null);
  const figures =
    "included" in e && !e.included ? null : (e as Exclude<typeof e, { included: false }>);
  return (
    <>
      <p style={{ fontSize: 15, margin: 0 }}>
        {figures
          ? figures.months.length
            ? `Estimate ${figures.estimate} (${figures.basis}). Revenue ${figures.revenue_month} and profit ${figures.profit_month} a month over ${figures.months.join(", ")}. Taken ${when(figures.snapshot_at)}.`
            : "No complete month with earnings yet, so no earnings-based estimate."
          : "No financial figures are part of these terms."}{" "}
        {money && `Customer money held: ${money}.`}
      </p>
      {"included" in e && (
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {e.included ? `Seen by: ${e.audience}. ${e.retention}` : e.note}
        </p>
      )}
    </>
  );
}

function Check({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <div className="task" style={{ padding: "8px 0" }}>
      <span style={{ fontSize: 18, width: 22, color: done ? "var(--forest)" : "var(--ink-3)" }}>
        {done ? "✓" : "○"}
      </span>
      <div>
        <div className="title" style={{ fontWeight: done ? 600 : 500 }}>
          {label}
        </div>
        {detail && <div className="detail">{detail}</div>}
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3
        style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 16 }}
      >
        {title}
      </h3>
      <ul style={{ paddingLeft: 20, margin: 0, display: "grid", gap: 4, fontSize: 15 }}>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </>
  );
}

function Accept({ v, onDone }: { v: DealView; onDone: (v: DealView) => void }) {
  const [read, setRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ background: "var(--paper)", borderRadius: 8, padding: 14, marginTop: 10 }}>
      <label className="check">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
        <span style={{ fontSize: 14 }}>
          I've read version {v.deal.version} of these terms. Accepting signs its fingerprint{" "}
          <code>{v.deal.digest.slice(0, 12)}…</code> with my testnet account. If the terms change,
          this acceptance stops counting.
        </span>
      </label>
      {error && <p className="error-text">{error}</p>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!read || busy}
        onClick={async () => {
          setBusy(true);
          try {
            onDone(await api6.accept(v.deal.id, v.deal.digest));
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? "Signing on NEAR testnet…" : `Accept version ${v.deal.version}`}
      </button>
    </div>
  );
}

function Act({
  label,
  run,
  kind = "secondary",
}: {
  label: string;
  run: () => Promise<void>;
  kind?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        className={`btn btn-${kind}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await run();
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? "Working on NEAR testnet…" : label}
      </button>
      {error && (
        <span className="error-text" style={{ display: "block" }}>
          {error}
        </span>
      )}
    </span>
  );
}

export function DealPage({ id }: { id: string }) {
  const { person } = useSession();
  const [v, setV] = useState<DealView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const load = useCallback(
    () =>
      api6
        .deal(id)
        .then(setV)
        .catch((e) => setError((e as Error).message)),
    [id],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: person is a trigger: reload as another viewer
  useEffect(() => {
    load();
  }, [load, person]);
  if (error && !v)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/">Home</Link>
      </div>
    );
  if (!v) return <div className="page muted">Reading the deal from NEAR testnet…</div>;
  const d = v.deal;
  const c = v.chain;
  const open = d.status === "open";
  const seller = v.you === "seller";
  const rep = v.you === "representative";
  const t = v.terms;
  const refusalStep = [...v.steps].reverse().find((s) => s.kind === "former_owner_check");
  return (
    <div className="page">
      <Link
        to={seller ? (d.status === "closed" ? "/desk" : `/desk/${d.business.id}/sale`) : "/acquire"}
      >
        ← Back
      </Link>
      <div className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">
            Deal · version {d.version} · fictional example · test dollars
          </div>
          <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
            {d.business.name}
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {d.seller.name} → {d.buyer.team}
          </p>
        </div>
        <span className="spacer" />
        <div style={{ textAlign: "right" }}>
          <span className={`pill ${d.status === "closed" ? "lime" : open ? "" : "caution"}`}>
            {DEAL_STATUS[d.status]}
          </span>
          <div className="display" style={{ fontSize: 34 }}>
            {usd(d.price_cents)}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {open
              ? `Offer open until ${when(d.expires_at)}`
              : d.closed_at
                ? `Closed ${when(d.closed_at)}`
                : ""}
          </div>
        </div>
      </div>

      <div className="desk" style={{ marginTop: 20 }}>
        <div>
          {v.confirmation && (
            <section className="card" style={{ borderColor: "var(--caution)" }}>
              <h2>Waiting to confirm your acceptance</h2>
              <p style={{ margin: "0 0 8px" }}>{v.confirmation.detail}</p>
              <button type="button" className="btn" onClick={load}>
                Check again
              </button>
            </section>
          )}
          {v.reconciliation && (
            <section className="card" style={{ borderColor: "var(--caution)" }}>
              <h2>
                {v.reconciliation.state === "needed"
                  ? "Needs reconciling"
                  : "The contract shows a close Everstreet hasn't followed yet"}
              </h2>
              <p style={{ margin: "0 0 8px" }}>{v.reconciliation.detail}</p>
              {v.reconciliation.state !== "needed" && (
                <button type="button" className="btn" onClick={load}>
                  Check again
                </button>
              )}
            </section>
          )}
          {v.history_conflict && (
            <p className="notice">
              Everstreet's records show more than one change of hands for this deal. They were kept
              as they are, not repaired automatically.
            </p>
          )}
          {v.changes.length > 0 && open && (
            <section className="card" style={{ borderColor: "var(--caution)" }}>
              <h2>What changed since version {v.previous_version}</h2>
              <ul style={{ paddingLeft: 20, margin: "0 0 8px" }}>
                {v.changes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                Both acceptances were cleared by this revision. Each side accepts version{" "}
                {d.version} again.
              </p>
            </section>
          )}

          {v.first_shift && (
            <section className="card" style={{ borderColor: "var(--forest)" }}>
              <h2>Your first shift</h2>
              <Check
                done={Boolean(v.first_shift.control?.is_buyer)}
                label={`You control ${d.business.name} on NEAR`}
                detail={
                  v.first_shift.control
                    ? `Owner ${v.first_shift.control.owner} · generation ${v.first_shift.control.generation} · read from the contract now`
                    : "NEAR testnet couldn't be read"
                }
              />
              <Check
                done={(v.first_shift.control?.operators ?? 0) > 0}
                label="Appoint your own team"
                detail="The sale voided every helper the previous owner appointed. Appoint yours from the desk."
              />
              <div style={{ margin: "0 0 8px 34px" }}>
                <Link to={`/desk/${d.business.id}`}>Open your desk</Link>
              </div>
              <Check
                done={v.first_shift.customer_money.in_terms === v.first_shift.customer_money.now}
                label="Customer money stayed with the business"
                detail={`In the terms: ${v.first_shift.customer_money.in_terms} · now: ${v.first_shift.customer_money.now} · ${v.first_shift.customer_money.source}`}
              />
              <Check
                done={v.first_shift.pre_sale_orders.length === 0}
                label="Serve customers who paid before the sale"
                detail={
                  v.first_shift.pre_sale_orders.length
                    ? "Their places and refund rights carried over. Mark each delivered when they've had it."
                    : "Everyone who paid before the sale has been served."
                }
              />
              {v.first_shift.pre_sale_orders.map((o) => (
                <div
                  key={o.order_id}
                  className="row"
                  style={{ margin: "0 0 8px 34px", fontSize: 14 }}
                >
                  <span>
                    {o.customer} · {usd(o.amount_cents)} · paid {when(o.paid_at)}
                    {o.session_starts_at ? ` · session ${when(o.session_starts_at)}` : ""}
                  </span>
                  <span className="spacer" />
                  {rep && (
                    <Act
                      label="Mark delivered"
                      run={async () => {
                        await api6.deliver(o.order_id);
                        await load();
                      }}
                    />
                  )}
                </div>
              ))}
            </section>
          )}

          {d.status === "closed" && seller && (
            <section className="card">
              <h2>After the sale</h2>
              <h3 style={{ fontSize: 16 }}>Your proceeds</h3>
              {v.proceeds?.claimed_at ? (
                <p>
                  Claimed {when(v.proceeds.claimed_at)}.{" "}
                  {v.proceeds.claim_tx_url && (
                    <a href={v.proceeds.claim_tx_url} target="_blank" rel="noreferrer">
                      See it on NEAR testnet
                    </a>
                  )}
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 8px" }}>
                    {usd(v.proceeds?.held_cents ?? 0)} held for you by the business's contract until
                    you claim it.
                  </p>
                  {v.proceeds?.error && <p className="notice">{v.proceeds.error}</p>}
                  <Act
                    kind="primary"
                    label={v.proceeds?.error ? "Try the claim again" : "Claim proceeds"}
                    run={async () => setV(await api6.claim(d.id))}
                  />
                </>
              )}
              <h3 style={{ fontSize: 16, marginTop: 20 }}>Check that your access ended</h3>
              <p className="muted" style={{ fontSize: 14 }}>
                Try a real owner action, withdrawing $1 of profit, with your own key. The business's
                contract should refuse it.
              </p>
              <Act
                label="Try it as the former owner"
                run={async () => setV(await api6.formerOwnerCheck(d.id))}
              />
              {refusalStep && (
                <div className={refusalStep.ok ? "reply" : "notice"} style={{ marginTop: 10 }}>
                  {refusalStep.ok
                    ? "Refused by the contract: "
                    : "Allowed (this should not happen): "}
                  <code>{refusalStep.detail.replace(/^Smart contract panicked: /, "")}</code>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {when(refusalStep.at)}
                    {v.check
                      ? ` · helper check for your account: ${v.check.operator_check.reason}`
                      : ""}
                    {refusalStep.tx_url && (
                      <>
                        {" · "}
                        <a href={refusalStep.tx_url} target="_blank" rel="noreferrer">
                          the refused transaction
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="card">
            <h2>The terms, version {d.version}</h2>
            <dl className="facts" style={{ gridTemplateColumns: "150px 1fr" }}>
              <dt>Seller</dt>
              <dd>
                {t.seller.name} · <code style={{ fontSize: 13 }}>{t.seller.account}</code>
              </dd>
              <dt>Buyer</dt>
              <dd>
                {t.buyer.team}, accepting through {t.buyer.representative}'s account{" "}
                <code style={{ fontSize: 13 }}>{t.buyer.account}</code>
                {t.buyer.kind === "cooperative" && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Group control on NEAR isn't built yet: after the close, {t.buyer.representative}
                    's account is the owner and acts for the co-op.
                  </div>
                )}
              </dd>
              <dt>Price</dt>
              <dd>
                {usd(t.price_cents)} in {t.asset}
              </dd>
              <dt>Network</dt>
              <dd>
                {t.network} ·{" "}
                <a href={d.business.url} target="_blank" rel="noreferrer">
                  the business's contract
                </a>
              </dd>
              <dt>Offer expires</dt>
              <dd>{when(t.expires_at)}</dd>
              {t.handover && (
                <>
                  <dt>Handover</dt>
                  <dd>{t.handover}</dd>
                </>
              )}
              {t.conditions && (
                <>
                  <dt>Conditions</dt>
                  <dd>{t.conditions}</dd>
                </>
              )}
            </dl>
            <List title="Control the buyer receives" items={t.control} />
            <List title="Stays with the business" items={t.stays} />
            <List title="Separate transfer items" items={t.separate} />
            <List title="Excluded" items={t.excluded} />
            <h3
              style={{
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: 16,
              }}
            >
              Evidence snapshot
            </h3>
            <EvidenceText t={t} />
            <p className="muted" style={{ fontSize: 13 }}>
              Customer money is a live balance: the contract keeps all of it with the business
              whatever the number was when these terms were written.
            </p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Fingerprint of these terms <code>{d.terms_hash.slice(0, 16)}…</code> · deal digest{" "}
              <code>{d.digest.slice(0, 16)}…</code> ·{" "}
              {c?.matches_terms
                ? "✓ the contract holds exactly these terms"
                : "the contract's copy differs; read it again"}
            </p>
          </section>

          {v.items.length > 0 && (
            <section className="card">
              <h2>Separate transfer items</h2>
              {v.items.map((i) => (
                <div
                  key={i.key}
                  className="row"
                  style={{
                    padding: "8px 0",
                    borderTop: "1px solid var(--border)",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 15 }}>{i.name}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {i.note || i.detail}
                    </div>
                  </div>
                  <span className={`pill ${i.status === "completed" ? "lime" : "caution"}`}>
                    {i.status === "completed" ? "Completed" : "Pending"}
                  </span>
                  {d.status === "closed" && i.status === "pending" && (rep || seller) && (
                    <Act
                      label="Mark received"
                      run={async () =>
                        setV(await api6.markItem(d.id, i.key, rep ? "received" : "handed over"))
                      }
                    />
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="studio-side">
          <section className="card" style={{ padding: 18 }}>
            <strong>On NEAR testnet</strong>
            <Check done label={`Terms proposed by ${d.seller.name}`} />
            <Check
              done={Boolean(c?.funded) || d.status === "closed"}
              label={`${d.buyer.representative} funded ${usd(d.price_cents)}`}
              detail={
                c && !c.funded && c.held_cents > 0
                  ? `${usd(c.held_cents)} held from an earlier price`
                  : undefined
              }
            />
            <Check
              done={Boolean(c?.seller_accepted) || d.status === "closed"}
              label={`${d.seller.name} accepted version ${d.version}`}
            />
            <Check
              done={Boolean(c?.buyer_accepted) || d.status === "closed"}
              label={`${d.buyer.representative} accepted version ${d.version}`}
            />
            <Check
              done={d.status === "closed"}
              label="Control changed on the contract"
              detail={
                d.generation_after
                  ? `Now at generation ${d.generation_after}`
                  : "Happens with the second matching acceptance"
              }
            />
            {d.close_tx_url && (
              <a href={d.close_tx_url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
                The closing transaction
              </a>
            )}
          </section>

          {open && (seller || rep) && !v.confirmation && !v.reconciliation && (
            <section className="card" style={{ padding: 18 }}>
              <strong>Your part</strong>
              {rep && v.wallet && (
                <p className="muted" style={{ fontSize: 14, margin: "6px 0 10px" }}>
                  Your testnet account holds {usd(v.wallet.balance_cents)} in test dollars.
                </p>
              )}
              {rep && c && !c.funded && (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {c.held_cents > 0 ? (
                    <Act
                      label={`Take back the ${usd(c.held_cents)} hold`}
                      run={async () => setV(await api6.withdrawHold(d.id))}
                    />
                  ) : (
                    <>
                      {(v.wallet?.balance_cents ?? 0) < d.price_cents && (
                        <Act
                          label="Get the test dollars for this price"
                          run={async () => setV(await api6.testDollars(d.id))}
                        />
                      )}
                      <Act
                        kind="primary"
                        label={`Fund ${usd(d.price_cents)}`}
                        run={async () => setV(await api6.fund(d.id))}
                      />
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        The contract holds it for this deal only. If the deal doesn't close you can
                        take it back.
                      </p>
                    </>
                  )}
                </div>
              )}
              {rep && c?.funded && !c.buyer_accepted && <Accept v={v} onDone={setV} />}
              {seller && c && !c.seller_accepted && <Accept v={v} onDone={setV} />}
              {((seller && c?.seller_accepted) || (rep && c?.buyer_accepted)) && (
                <p style={{ fontSize: 14 }}>
                  You've accepted version {d.version}. Waiting for{" "}
                  {seller ? d.buyer.representative : d.seller.name}.
                </p>
              )}
              {seller && (
                <div style={{ marginTop: 12 }}>
                  {revising ? (
                    <TermsForm
                      keepExpiry
                      snapshotFor={{ businessId: d.business.id, buyerId: d.buyer.id }}
                      label="Record the new version"
                      initial={{
                        price_cents: d.price_cents,
                        days: 7,
                        handover: t.handover,
                        conditions: t.conditions,
                      }}
                      submit={async (x) => {
                        setV(await api6.revise(d.id, x));
                        setRevising(false);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setRevising(true)}
                    >
                      Change the terms
                    </button>
                  )}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <Act label="Cancel this deal" run={async () => setV(await api6.cancel(d.id))} />
              </div>
            </section>
          )}
          {open && v.you === "team" && (
            <section className="card" style={{ padding: 18 }}>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Only {d.buyer.representative}, the team's accepting account, funds and accepts.
              </p>
            </section>
          )}
          {!open && d.status !== "closed" && rep && c && c.held_cents > 0 && (
            <section className="card" style={{ padding: 18 }}>
              <strong>Your hold</strong>
              <p style={{ fontSize: 14 }}>{usd(c.held_cents)} is still held for this deal.</p>
              <Act
                kind="primary"
                label="Take it back"
                run={async () => setV(await api6.withdrawHold(d.id))}
              />
            </section>
          )}

          <section className="card" style={{ padding: 18 }}>
            <strong>Every step</strong>
            {v.steps.map((s) => (
              <div
                key={`${s.at}-${s.kind}`}
                style={{ fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}
              >
                <div>
                  {s.ok ? "" : "✗ "}
                  {STEP_LABEL[s.kind] ?? s.kind}
                  {s.version ? ` · v${s.version}` : ""}
                  {s.by ? ` · ${s.by}` : ""}
                </div>
                <div className="muted">
                  {when(s.at)}
                  {s.tx_url && (
                    <>
                      {" · "}
                      <a href={s.tx_url} target="_blank" rel="noreferrer">
                        transaction
                      </a>
                    </>
                  )}
                  {s.detail ? ` · ${s.detail.replace(/^Smart contract panicked: /, "")}` : ""}
                </div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Deals the viewer is part of, optionally for one business or one buying team. */
export function DealsList({
  title,
  businessId,
  buyerId,
  empty,
}: {
  title: string;
  businessId?: string;
  buyerId?: string;
  empty?: string;
}) {
  const [deals, setDeals] = useState<DealSummary[] | null>(null);
  useEffect(() => {
    api6
      .deals()
      .then((r) =>
        setDeals(
          r.deals.filter(
            (x) =>
              (!businessId || x.business_id === businessId) && (!buyerId || x.buyer_id === buyerId),
          ),
        ),
      )
      .catch(() => setDeals([]));
  }, [businessId, buyerId]);
  if (!deals || (deals.length === 0 && !empty)) return null;
  return (
    <section className="card">
      <h2>{title}</h2>
      {deals.length === 0 && <p className="muted">{empty}</p>}
      {deals.map((x) => (
        <Link key={x.id} to={`/deal/${x.id}`} className="row deal-row">
          <strong>{x.business}</strong>
          <span className="muted">
            {x.role === "seller" ? `selling to ${x.buyer}` : `${x.buyer} buying`} · version{" "}
            {x.version}
          </span>
          <span className="spacer" />
          <span>{usd(x.price_cents)}</span>
          <span
            className={`pill ${x.status === "closed" ? "lime" : x.status === "open" ? "" : "caution"}`}
          >
            {DEAL_STATUS[x.status]}
          </span>
        </Link>
      ))}
    </section>
  );
}
