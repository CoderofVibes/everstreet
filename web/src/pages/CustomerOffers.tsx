// Job 003r: the product studio's customer-offer section. The founder sees what is configured on
// this server, what is unavailable and what is unknown (never an all-green badge), inspects one
// plan number, reviews the exact observed terms and creates one offer, then opens its customer
// page. Retiring stops new uses only. Everything comes from OfferSetup (offerSetup.ts).

import { useEffect, useState, useSyncExternalStore } from "react";
import { pageAuthorizer } from "../customerAuthorizer.ts";
import {
  type Evidence,
  type Inspection,
  OfferSetup,
  type OwnerOffer,
  offerHttp,
  type ReadinessItem,
} from "../offerSetup.ts";
import { Link } from "../router.tsx";

const EVIDENCE: Record<Evidence, { label: string; tone: string }> = {
  observed: { label: "Observed", tone: "mint" },
  configured: { label: "Configured here", tone: "blue" },
  unavailable: { label: "Unavailable", tone: "caution" },
  unknown: { label: "Unknown", tone: "" },
};

const time = (ms: string) => new Date(Number(ms)).toLocaleString();
const minutes = (ms: string) => {
  const m = Number(ms) / 60_000;
  return Number.isInteger(m) ? `${m} min` : `${ms} ms`;
};

/** The server's local readiness, with the plan replaced by an inspection's observed evidence. */
function itemsWith(items: ReadinessItem[], i: Inspection | null): ReadinessItem[] {
  const a = pageAuthorizer();
  return items.map((x) => {
    if (x.key === "plan" && i)
      return {
        ...x,
        state: "observed",
        detail: `Plan ${i.plan_id} read from block ${i.block.height} at ${time(i.block.timestamp_ms)}.`,
        next: null,
      };
    if (x.key === "authorization" && a?.synthetic)
      return {
        ...x,
        state: "configured",
        detail: `${a.label}. This page has a preview-only authorizer; it is not a wallet and nothing real is signed.`,
        next: null,
      };
    return x;
  });
}

function Terms({ i }: { i: Inspection }) {
  return (
    <section className="use-consent offer-review" aria-labelledby="offer-review-title">
      <h3 id="offer-review-title">Review these exact terms</h3>
      <dl className="use-terms">
        <dt>Product</dt>
        <dd>
          {i.release.product.name}
          {i.release.product.revision !== null && ` · revision ${i.release.product.revision}`}
        </dd>
        <dt>Price of one use</dt>
        <dd>
          <span className="mono">{i.plan.unit_price}</span> base units of{" "}
          <span className="mono">{i.asset}</span>, charged only when a customer gets a result
        </dd>
        <dt>Results kept</dt>
        <dd>
          {i.retention_days} days, for the customer only; after that every read refuses them.
          Deleting them takes the server's retention pass: see Result cleanup above for what is
          known about it here. Neither you nor a future owner can read them.
        </dd>
        <dt>Plan</dt>
        <dd>
          Number {i.plan_id} · up to {i.plan.max_units_per_purchase} units per purchase · a hold
          lasts {minutes(i.plan.hold_ttl_ms)}
        </dd>
        <dt>Metering</dt>
        <dd>
          {i.metering.platform_meters === true
            ? `The contract lets the platform (${i.metering.operator}) meter uses.`
            : i.metering.platform_meters === false
              ? `The contract doesn't currently let the platform (${i.metering.operator}) meter uses, so customers can't start one.`
              : "No metering account is configured here."}
        </dd>
        <dt>Read</dt>
        <dd>
          Block <span className="mono">{i.block.height}</span> at {time(i.block.timestamp_ms)}
        </dd>
      </dl>
      <details className="advanced">
        <summary>Technical details</summary>
        <dl className="use-terms">
          <dt>Contract</dt>
          <dd className="mono">
            {i.source.account} on {i.source.network}
          </dd>
          <dt>Release</dt>
          <dd className="mono">{i.release.id}</dd>
          <dt>Artifact digest</dt>
          <dd className="mono">{i.release.artifact_digest}</dd>
          <dt>Terms digest</dt>
          <dd className="mono">{i.terms_digest}</dd>
          <dt>Plan limits</dt>
          <dd>
            {i.plan.max_units_outstanding} outstanding · {i.plan.max_hold_units} per hold · settle
            grace {minutes(i.plan.settle_grace_ms)} · created at owner generation{" "}
            {i.plan.created_generation}
          </dd>
        </dl>
      </details>
      {i.active_offer && (
        <p className="notice info">
          This release is already offered on plan {i.plan_id}. Retire that offer first to replace
          it.
        </p>
      )}
    </section>
  );
}

function OfferRow({
  o,
  confirming,
  busy,
  onRetire,
  onCancel,
}: {
  o: OwnerOffer;
  confirming: boolean;
  busy: boolean;
  onRetire: () => void;
  onCancel: () => void;
}) {
  return (
    <li className="offer-row">
      <div className="offer-row-main">
        <strong>{o.product.name}</strong>{" "}
        <span className={`pill ${o.state === "active" ? "mint" : ""}`}>
          {o.state === "active" ? "Active" : "Retired"}
        </span>
        <div className="muted" style={{ fontSize: 13.5 }}>
          Plan {o.plan_id} · <span className="mono">{o.plan.unit_price}</span> base units of{" "}
          <span className="mono">{o.asset}</span> per use · results kept {o.retention_days} days ·
          created {new Date(o.created_at).toLocaleDateString()}
          {o.retired_at && ` · retired ${new Date(o.retired_at).toLocaleDateString()}`}
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {o.state === "active" && (
          <Link to={`/use/${o.id}`} className="btn btn-secondary btn-sm">
            Open customer page
          </Link>
        )}
        {o.state === "active" &&
          (confirming ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={onRetire}
              >
                Retire: stop new uses
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={onRetire}
            >
              Retire…
            </button>
          ))}
      </div>
    </li>
  );
}

/** Job 001b: whether the offer setup holds something the owner must see before moving on. */
export function offerNeedsAttention(st: {
  unanswered: unknown;
  access: string;
  confirmRetire: string | null;
}): boolean {
  return st.unanswered !== null || st.access === "unconfirmed" || st.confirmRetire !== null;
}

export function CustomerOffers({
  personId,
  businessId,
  projectId,
  onAttention,
}: {
  personId: string;
  businessId: string;
  projectId: string;
  /** Job 001b: told when something here needs the owner (an unanswered create, unconfirmed access). */
  onAttention?: (needs: boolean) => void;
}) {
  const [s] = useState(
    () =>
      new OfferSetup(offerHttp, {
        personId,
        businessId,
        projectId,
        storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
      }),
  );
  const st = useSyncExternalStore(s.subscribe, s.getState);
  useEffect(() => {
    void s.start();
    return () => s.retire();
  }, [s]);
  const needs = offerNeedsAttention(st);
  useEffect(() => onAttention?.(needs), [needs, onAttention]);

  const busy = st.busy !== null;
  // 003r1: while access is unconfirmed, nothing that changes anything can be pressed.
  const locked = busy || st.access === "unconfirmed";
  const r = st.readiness;
  const items = r ? itemsWith(r.items, st.inspection) : [];
  const configured = items.filter((i) => i.state === "configured" || i.state === "observed");
  const mine = st.offers.filter((o) => o.project_id === projectId);

  return (
    <section className="card offer-setup" aria-labelledby="offer-setup-title">
      <h2 id="offer-setup-title">Customer offer</h2>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Connect a tested release to its customers: one use at a time, metered by the business's
        contract. An offer is a local setting; it doesn't publish your page or connect anything.
      </p>

      {st.status === "loading" && (
        <p className="muted" role="status">
          Loading…
        </p>
      )}
      {st.status === "gone" && (
        <p className="notice" role="status">
          {st.notice?.message}
        </p>
      )}
      {st.status === "error" && (
        <div role="status">
          <p className="notice error">{st.notice?.message ?? "Couldn't load this."}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => s.refresh()}
          >
            Try again
          </button>
        </div>
      )}

      {st.status === "ready" && r && (
        <>
          {st.access === "unconfirmed" && (
            <div className="notice" role="alert">
              We couldn't confirm that you still manage this business. Below is what was last
              loaded, for reference only; changes are paused until access is confirmed.
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => s.checkAccess()}
                >
                  {st.busy === "check_access" ? "Checking…" : "Check access"}
                </button>
              </div>
            </div>
          )}
          <h3 className="offer-sub">Where it stands</h3>
          <p style={{ fontSize: 14 }}>
            {configured.length} of {items.length} set on this server.{" "}
            <span className="muted">
              "Configured here" means set up, not proven live: only a customer's completed use shows
              it working.
            </span>
          </p>
          {(() => {
            const first = items.find((i) => i.next);
            return first ? (
              <p className="offer-next" style={{ fontSize: 14 }}>
                <strong>{first.label}:</strong> {first.next}
              </p>
            ) : null;
          })()}
          {/* Job 001b: a compact summary; every row stays one click away. */}
          <details className="advanced offer-readiness-details">
            <summary>All {items.length} readiness items</summary>
            <ol className="offer-readiness">
              {items.map((i) => (
                <li key={i.key}>
                  <span className={`pill ${EVIDENCE[i.state].tone}`}>
                    {EVIDENCE[i.state].label}
                  </span>
                  <div>
                    <strong>{i.label}</strong> <span className="muted">{i.detail}</span>
                    {i.next && <div className="offer-next">Next: {i.next}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </details>

          <h3 className="offer-sub">Set up an offer</h3>
          {!r.release ? (
            <p className="muted">Release a tested version above first.</p>
          ) : (
            <>
              <p style={{ fontSize: 14 }}>
                Offering <strong>{r.release.product.name}</strong>
                {r.release.product.revision !== null && `, revision ${r.release.product.revision}`},
                released {new Date(r.release.activated_at).toLocaleString()}.
              </p>
              {st.unanswered && (
                <div className="notice info" role="note">
                  Your request to offer plan {st.unanswered.plan_id} with results kept{" "}
                  {st.unanswered.retention_days} days wasn't answered. Recover it first: it's the
                  same request, so nothing is made twice. What you've typed below is kept.
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={locked}
                      onClick={() => s.recoverOriginal()}
                    >
                      {st.busy === "recover" ? "Recovering…" : "Recover my original request"}
                    </button>
                  </div>
                </div>
              )}
              <div className="row offer-form">
                <label className="field">
                  <span>Contract plan number</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={st.draft.plan}
                    onChange={(e) => s.setDraft({ plan: e.target.value })}
                    aria-describedby="offer-plan-help"
                  />
                  <small id="offer-plan-help">
                    The plan as created on the business's contract. It's read, never guessed.
                  </small>
                </label>
                <label className="field">
                  <span>Keep results for (days)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={st.draft.retention}
                    onChange={(e) => s.setDraft({ retention: e.target.value })}
                  />
                  <small>1 to 365. After this, results can't be read.</small>
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={locked}
                  onClick={() => s.inspect()}
                >
                  {st.busy === "inspect" ? "Reading…" : "Inspect plan"}
                </button>
              </div>
              {st.inspection && (
                <>
                  <Terms i={st.inspection} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={locked || st.inspection.active_offer !== null}
                    onClick={() => s.create()}
                  >
                    {st.busy === "create" ? "Creating…" : "Create this offer"}
                  </button>
                </>
              )}
            </>
          )}
          {st.created && st.offers.some((o) => o.id === st.created && o.state === "active") && (
            <p style={{ marginTop: 12 }}>
              <Link to={`/use/${st.created}`}>Open the customer page</Link>
            </p>
          )}

          <h3 className="offer-sub">Offers</h3>
          {mine.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="offer-list">
              {mine.map((o) => (
                <OfferRow
                  key={o.id}
                  o={o}
                  busy={locked}
                  confirming={st.confirmRetire === o.id}
                  onRetire={() => s.retireOffer(o.id)}
                  onCancel={() => s.cancelRetire()}
                />
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 13 }}>
            Retiring stops new uses. Customers keep their requests, results and units, and the offer
            stays with the business if it's sold.
          </p>
        </>
      )}
      <div role="status" aria-live="polite">
        {st.status !== "gone" && st.status !== "error" && st.notice && (
          <p
            className={`notice ${st.notice.tone === "error" ? "error" : st.notice.tone === "ok" ? "ok" : ""}`}
          >
            {st.notice.message}
          </p>
        )}
      </div>
    </section>
  );
}
