// Job 003j: Ownership and continuity, the owner's read-only view of what has been observed on
// NEAR about their business: who controls it, what it owes customers, any sale in progress, and
// the evidence behind each. It never acts: no buy, accept, close, withdraw or reconcile here.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type ContinuityView,
  continuityApi,
  monthLabel,
  msDate,
  type Observed,
} from "../continuityApi.ts";
import { ACCESS_UNCONFIRMED, ContinuityController } from "../continuityController.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { TokenAmount } from "../TokenAmount.tsx";
import { when } from "../when.ts";

function SignIn({ reason }: { reason: string }) {
  const { requireSignIn } = useSession();
  return (
    <div className="page empty">
      <h2>{reason}</h2>
      <button type="button" className="btn btn-primary" onClick={() => requireSignIn(reason)}>
        Sign in or join
      </button>
    </div>
  );
}

/** An amount in the asset: readable when the token's details are known (review #42/#47). */
function Amount({ v, asset, token }: { v: string; asset: string; token?: unknown }) {
  return <TokenAmount base={v} asset={asset} token={token ?? null} exact={false} />;
}

function ago(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 120) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
}

const OUTCOME_LABEL: Record<string, string> = {
  closed: "Closed: control moved to the buyer on chain",
  cancelled: "Cancelled",
  expired: "Expired",
  aborted: "Aborted (the closer didn't finish in time)",
};

const COUNTER_LABEL: Record<string, string> = {
  purchases_in: "Customer purchases received",
  earned: "Earned from customer use",
  customer_returns: "Paid back to customers",
  owner_withdrawals: "Paid out to the owner",
  paid_on_retry: "Of those, paid on a retry",
  escrow_in: "Sale escrow received",
  escrow_returned: "Sale escrow returned",
  sale_proceeds_paid: "Sale proceeds paid out",
};

function attention(v: ContinuityView, stale: boolean, access: string): string[] {
  const out: string[] = [];
  if (access !== "current") out.push(ACCESS_UNCONFIRMED);
  if (v.state === "unbound")
    out.push(
      "This business isn't connected to a NEAR contract here, so nothing below is observed.",
    );
  if (v.state === "paused") out.push(v.message);
  if (v.state === "never_observed")
    out.push(
      v.transport === "unavailable"
        ? "Reading NEAR isn't set up on this server, so nothing has been observed."
        : "Nothing has been read yet. Refresh to record the first observation.",
    );
  if (v.state !== "observed") return out;
  if (v.flag)
    out.push(`Evidence conflict: ${v.flag.message} It stays flagged until it's explained.`);
  if (stale) out.push("The evidence shown is stale. Refresh to read it again.");
  if (v.owner_match === "mismatch")
    out.push(
      "The contract's owner isn't this business's owner here. That needs reconciliation; nothing changed automatically.",
    );
  if (v.owner_match === "unknown_mapping")
    out.push(
      "The contract's owner account isn't linked to anyone here, so ownership can't be compared.",
    );
  if (!v.binding_matches_record)
    out.push("The configured contract differs from the one recorded below.");
  if (!v.history.complete)
    out.push(`${v.history.missing_count} earlier deal(s) ended without being observed here.`);
  if (v.transport === "unavailable") out.push("Refreshing isn't available on this server.");
  return out;
}

export function Continuity({ id }: { id: string }) {
  const { person } = useSession();
  // Keyed by person and business in the route: another person or business starts clean.
  const [c] = useState(() => new ContinuityController(id, continuityApi));
  const s = useSyncExternalStore(c.subscribe, c.getState);
  const [, tick] = useState(0);
  useEffect(() => {
    if (person) void c.load();
    return () => c.dispose();
  }, [c, person]);
  // Re-renders so freshness is recomputed as time passes (no request is made).
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!person) return <SignIn reason="Sign in to see your business's ownership and continuity." />;
  if (s.status === "loading")
    return (
      <div className="page muted" role="status">
        Loading ownership evidence…
      </div>
    );
  if (s.status === "gone")
    return (
      <div className="page empty" role="status">
        <h2>Not available</h2>
        <p>{s.message}</p>
        <Link to="/desk">My businesses</Link>
      </div>
    );
  if (s.status === "error" || !s.view)
    return (
      <div className="page empty" role="alert">
        <h2>The ownership evidence couldn't be loaded</h2>
        <p>{s.message}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void c.load()}>
          Try again
        </button>
      </div>
    );

  const v = s.view;
  const fresh = c.freshness();
  const notes = attention(v, Boolean(fresh?.stale), s.access);
  const blocked = c.blocked;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/desk/${id}`} className="muted">
          Business desk
        </Link>
        <span className="muted">/</span>
        <span className="pill">Read-only</span>
        <span className="spacer" />
        <Link to={`/desk/${id}/handover`}>Sale and handover</Link>
      </div>
      <h1 className="display" style={{ fontSize: 32, margin: "6px 0" }}>
        Ownership and continuity
      </h1>
      <p className="muted" style={{ maxWidth: "75ch" }}>
        What has been observed on NEAR about who controls this business, what it owes its customers,
        and any sale in progress. Nothing here changes ownership or moves money.
      </p>

      <section className="card" aria-labelledby="ct-attn">
        <h2 id="ct-attn" style={{ fontSize: 18 }}>
          Needs attention
        </h2>
        {notes.length === 0 ? (
          <p style={{ margin: 0 }}>Nothing recorded needs attention.</p>
        ) : (
          <ul className="missing-list" style={{ margin: 0 }}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {s.access !== "current" && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 8 }}
            disabled={s.access === "checking"}
            onClick={() => void c.checkAccess()}
          >
            {s.access === "checking" ? "Checking access…" : "Check access"}
          </button>
        )}
        <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
          Not shown or verified here: which chain the endpoint serves, whether the app and external
          accounts have been handed over, and each customer's remaining uses.
        </p>
      </section>

      <RefreshPanel c={c} blocked={blocked} />

      {v.state === "observed" && (
        <ObservedSections v={v} age={fresh?.age_ms ?? 0} stale={Boolean(fresh?.stale)} id={id} />
      )}
      {v.state === "never_observed" && (
        <section className="card">
          <h2 style={{ fontSize: 18 }}>Connection</h2>
          <p style={{ margin: 0 }}>
            Configured for <span className="mono">{v.binding.account}</span> on {v.binding.network}.
            No observation recorded yet.
          </p>
        </section>
      )}
    </div>
  );
}

function RefreshPanel({ c, blocked }: { c: ContinuityController; blocked: string | null }) {
  const s = c.getState();
  const r = s.refresh;
  return (
    <section className="card" aria-labelledby="ct-refresh">
      <h2 id="ct-refresh" style={{ fontSize: 18 }}>
        Read again
      </h2>
      <form
        className="row"
        style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          void c.refresh();
        }}
      >
        <label className="mini-field">
          <span className="mini-label">Also read one month (optional, yyyymm)</span>
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            value={s.month}
            placeholder="e.g. 202611"
            onChange={(e) => c.setMonth(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={Boolean(blocked)}>
          {r.state === "sending" ? "Reading…" : "Refresh evidence"}
        </button>
        {blocked && r.state !== "sending" && (
          <span className="muted" style={{ fontSize: 13 }}>
            {blocked}
          </span>
        )}
      </form>
      <div role="status" aria-live="polite" style={{ marginTop: 8 }}>
        {r.state === "done" && (
          <p
            className={
              r.outcome === "accepted" || r.outcome === "duplicate" ? "notice ok" : "notice error"
            }
          >
            {r.message}
            {r.period && ` ${monthLabel(r.period.yyyymm)}: ${r.period.outcome}.`}
          </p>
        )}
        {(r.state === "refused" || r.state === "unknown") && (
          <p className="notice error">
            {r.state === "refused" ? "Not refreshed. " : ""}
            {r.message}
          </p>
        )}
        {r.state === "info" && <p className="notice info">{r.message}</p>}
      </div>
    </section>
  );
}

function ObservedSections({
  v,
  age,
  stale,
  id,
}: {
  v: Observed;
  age: number;
  stale: boolean;
  id: string;
}) {
  const t = v.treasury;
  const d = v.control.live_deal;
  return (
    <>
      <p className={stale ? "notice error" : "notice info"}>
        Observed at block <span className="mono">{v.block.height}</span> on {when(v.observed_at)} (
        {ago(age)} ago, <strong>{stale ? "stale" : "fresh"}</strong>). {v.provenance}
      </p>

      <div className="desk">
        <div>
          <section className="card" aria-labelledby="ct-own">
            <h2 id="ct-own" style={{ fontSize: 18 }}>
              Ownership
            </h2>
            <dl className="facts">
              <dt>Owner on chain</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                {v.control.owner}
              </dd>
              <dt>Control generation</dt>
              <dd>{v.control.generation}</dd>
              <dt>Owner here</dt>
              <dd>
                {v.owner_match === "matches"
                  ? "Matches this business's owner"
                  : v.owner_match === "mismatch"
                    ? "Doesn't match: reconciliation needed"
                    : "Not linked to anyone here"}
              </dd>
              <dt>How sales close</dt>
              <dd>{v.control.closer_note}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {v.owner_note}
            </p>
          </section>

          <section className="card" aria-labelledby="ct-obl">
            <h2 id="ct-obl" style={{ fontSize: 18 }}>
              Customer obligations and funds
            </h2>
            <dl className="facts">
              <dt>Prepaid by customers, not yet used</dt>
              <dd>
                <Amount v={t.ent_free_value} asset={t.asset} token={v.token} />
              </dd>
              <dt>Reserved for customer uses in progress</dt>
              <dd>
                <Amount v={t.ent_held_value} asset={t.asset} token={v.token} />
              </dd>
              <dt>Owed, not yet paid (claims)</dt>
              <dd>
                <Amount v={t.claims_total} asset={t.asset} token={v.token} />
              </dd>
              <dt>Payouts sent, outcome not yet confirmed</dt>
              <dd>
                <Amount v={t.pending_total} asset={t.asset} token={v.token} />
              </dd>
              <dt>The business's own funds</dt>
              <dd>
                <Amount v={t.available} asset={t.asset} token={v.token} />
              </dd>
              <dt>Withdrawable by the owner</dt>
              <dd>
                <Amount v={t.withdrawable} asset={t.asset} token={v.token} />
              </dd>
              <dt>Buyer's sale escrow held</dt>
              <dd>
                <Amount v={t.escrow_total} asset={t.asset} token={v.token} />
              </dd>
              <dt>Total held by the contract</dt>
              <dd>
                <Amount v={t.held} asset={t.asset} token={v.token} />
              </dd>
            </dl>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Amounts are exact base units of the asset account; no decimals or dollar value are
              assumed. {v.claims_note} These totals don't show any one customer's remaining uses, or
              that the service is running.
            </p>
          </section>

          <section className="card" aria-labelledby="ct-sale">
            <h2 id="ct-sale" style={{ fontSize: 18 }}>
              Transfer in progress
            </h2>
            {!d ? (
              <p style={{ margin: 0 }}>No sale is in progress at the observed block.</p>
            ) : (
              <>
                {/* First-use review #53: where the sale is acted on. */}
                <Link to={`/sales/${id}`} className="btn btn-secondary btn-sm">
                  Open the sale
                </Link>
                <dl className="facts">
                  <dt>Deal</dt>
                  <dd>
                    Number {d.seq}, terms version {d.version}: {d.state}
                  </dd>
                  <dt>Buyer</dt>
                  <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                    {d.buyer}
                  </dd>
                  <dt>Price</dt>
                  <dd>
                    <Amount v={d.price} asset={t.asset} token={v.token} />
                  </dd>
                  <dt>Escrow</dt>
                  <dd>
                    <Amount v={d.escrow} asset={t.asset} token={v.token} />
                  </dd>
                  <dt>Accepted by</dt>
                  <dd>
                    {[d.seller_accepted && "seller", d.buyer_accepted && "buyer"]
                      .filter(Boolean)
                      .join(" and ") || "nobody yet"}
                  </dd>
                  <dt>Offer open until</dt>
                  <dd>{msDate(d.expires_at_ms) ?? "not set"}</dd>
                  {d.state === "closing" && (
                    <>
                      <dt>Closer's deadline</dt>
                      <dd>{msDate(d.deadline_ms) ?? "not set"}</dd>
                    </>
                  )}
                </dl>
              </>
            )}
          </section>

          <section className="card" aria-labelledby="ct-out">
            <h2 id="ct-out" style={{ fontSize: 18 }}>
              Past deals
            </h2>
            {v.outcomes.length === 0 ? (
              <p style={{ margin: 0 }}>No ended deal has been observed.</p>
            ) : (
              <ul className="missing-list" style={{ margin: 0 }}>
                {v.outcomes.map((o) => (
                  <li key={o.seq}>
                    Deal {o.seq}: {OUTCOME_LABEL[o.status] ?? o.status}, on{" "}
                    {msDate(o.at_ms) ?? "an unknown date"} (first seen at block{" "}
                    {o.observed_from_block}), price{" "}
                    <Amount v={o.price} asset={t.asset} token={v.token} />
                  </li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
              {v.history.note}
              {!v.history.complete && ` Not observed: deal ${v.history.first_missing.join(", ")}.`}{" "}
              A closed deal moves control on chain; it doesn't show that the app, its data or
              external accounts have been handed over.
            </p>
          </section>
        </div>

        <aside className="studio-side">
          <section className="card" aria-labelledby="ct-month">
            <h2 id="ct-month" style={{ fontSize: 17 }}>
              Monthly books
            </h2>
            {v.periods.length === 0 ? (
              <p style={{ margin: 0 }}>No month has been read yet.</p>
            ) : (
              v.periods.map((p) => (
                <details key={p.yyyymm} style={{ marginBottom: 8 }}>
                  <summary>
                    {monthLabel(p.yyyymm)}{" "}
                    <span className="muted" style={{ fontSize: 13 }}>
                      read {when(p.observed_at)}
                      {p.at_core_block ? "" : `, at block ${p.block.height}`}
                    </span>
                  </summary>
                  {p.period === null ? (
                    <p className="muted">
                      {p.status === "no_activity"
                        ? "No activity recorded for this month."
                        : p.status === "not_retained"
                          ? "The contract no longer keeps this month."
                          : "Not a month the contract records."}
                    </p>
                  ) : (
                    <ul className="missing-list" style={{ fontSize: 13 }}>
                      {Object.entries(p.period)
                        .filter(([k]) => k !== "yyyymm")
                        .map(([k, x]) => (
                          <li key={k}>
                            {COUNTER_LABEL[k] ?? k}: {x.exact ? "" : "at least "}
                            <Amount v={x.amount} asset={v.treasury.asset} token={v.token} />
                          </li>
                        ))}
                    </ul>
                  )}
                </details>
              ))
            )}
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {v.periods_note} Only these counters show money actually paid.
            </p>
          </section>

          <details className="card">
            <summary style={{ fontWeight: 650 }}>Evidence details</summary>
            <dl className="facts" style={{ fontSize: 13 }}>
              <dt>Contract</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                {v.source.account} ({v.source.network}, {v.source.schema})
              </dd>
              <dt>Block</dt>
              <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                {v.block.height} · {v.block.hash}
              </dd>
              <dt>Highest recorded</dt>
              <dd>
                block {v.high_water.block_height}, control step {v.high_water.control_seq}
              </dd>
              <dt>Network</dt>
              <dd>{v.network_identity}</dd>
              {v.flag && (
                <>
                  <dt>Flag</dt>
                  <dd>
                    {v.flag.code}: {v.flag.detail}
                  </dd>
                </>
              )}
              <dt>Manifest</dt>
              <dd>
                <span className="mono" style={{ overflowWrap: "anywhere" }}>
                  {v.control.service_manifest}
                </span>{" "}
                (sequence {v.control.manifest_seq}). {v.control.manifest_note}
              </dd>
            </dl>
          </details>
        </aside>
      </div>
    </>
  );
}
