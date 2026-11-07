// Job 003s: the digital acquisition workspace. /desk/:id/handover is the owner's view of a sale in
// progress on the business's v3 contract: the exact observed terms, recording that exact version,
// and applying the contract's outcome here when a participant deliberately asks. /handovers is
// each participant's own receipts. Nothing here signs, pays or closes a sale on NEAR.

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import { APPLY_EFFECTS, Handovers, OwnerHandover, reviewProblem } from "../handover.ts";
import {
  elapsedAt,
  type Handover,
  handoverHttp,
  type Intent,
  type IntentStatus,
  type ObservedDeal,
  type ReconcileAnswer,
  type SaleEvidence,
  sellerMark,
} from "../handoverApi.ts";
import { type ProjectSummary, productsApi } from "../productsApi.ts";
import { Link } from "../router.tsx";
import { STEP_WORD, saleCurrent, saleNext, saleSentence, saleSteps } from "../saleView.ts";
import { useSession } from "../session.tsx";
import { TokenAmount } from "../TokenAmount.tsx";
import { chainWords } from "../wallet.ts";
import { when } from "../when.ts";

const STATUS: Record<IntentStatus, { label: string; tone: string }> = {
  recorded: { label: "Exact version recorded: waiting for the contract's outcome", tone: "blue" },
  applied: { label: "Applied here", tone: "mint" },
  ended: { label: "Ended on the contract without a sale", tone: "" },
  superseded: { label: "Replaced by another version or sale", tone: "" },
};

const msDate = (ms: string) => (ms === "0" ? null : when(ms));
const caps = (c: number) =>
  [c & 1 && "metering", c & 2 && "operations", c & ~3 && `other (${c & ~3})`]
    .filter(Boolean)
    .join(", ") || "none";

/** An amount in the asset: readable when the token's details are known (review #42), else exact base units. */
function Amount({ v, asset, token }: { v: string; asset: string; token?: unknown }) {
  return <TokenAmount base={v} asset={asset} token={token ?? null} exact={false} />;
}

function Effects() {
  return (
    <ul className="handover-effects">
      {APPLY_EFFECTS.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

/** Job 001i: where the sale stands, step by step, with its status in words (never colour alone). */
export function SaleProgress({ ev, intents }: { ev: SaleEvidence | null; intents: Intent[] }) {
  return (
    <ol className="sale-steps" aria-label="Where the sale stands">
      {saleSteps({ evidence: ev, intents }).map((st) => (
        <li key={st.key} className={`sale-step is-${st.status}`}>
          <span className="sale-step-status">{STEP_WORD[st.status]}</span>
          <strong className="sale-step-title">{st.title}</strong>
          <span className="sale-step-detail">{st.detail}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Job 001i: the three continuity facts, kept apart: what authority changes, what customers keep,
 * and what needs its own verified transfer. From the evidence and the existing APPLY_EFFECTS.
 */
export function Continuity({ ev }: { ev: SaleEvidence }) {
  const o = ev.observed;
  const d = o?.deal ?? null;
  return (
    <aside className="sale-continuity" aria-label="What changes and what stays">
      <section>
        <h2 className="sale-h3">Authority that changes</h2>
        <ul>
          <li>
            {d ? (
              <>
                The owner role on the business's contract moves to{" "}
                <span className="mono wrap">{d.buyer}</span>.
              </>
            ) : (
              "The owner role on the business's contract moves to the buyer named in the sale."
            )}
          </li>
          <li>
            {d && d.grants.length > 0 ? (
              <>
                These operators keep their roles:{" "}
                {d.grants.map((g, i) => (
                  <span key={g.account}>
                    {i > 0 && "; "}
                    <span className="mono wrap">{g.account}</span> ({caps(g.caps)}
                    {sellerMark(g.account, d.seller)})
                  </span>
                ))}
                . Any other operator, including the platform's metering account, needs the new owner
                to appoint it.
              </>
            ) : (
              "No operator keeps a role unless the sale lists it. The platform's metering account needs the new owner to appoint it."
            )}
          </li>
          <li>
            Here, the seller's team access, listing and data rooms end when the close is applied.
          </li>
        </ul>
      </section>
      <section>
        <h2 className="sale-h3">Customer rights that stay</h2>
        <ul>
          {o ? (
            <>
              <li>
                Prepaid, not yet used:{" "}
                <Amount v={o.customers.prepaid_unused} asset={o.asset} token={o?.token} />
              </li>
              <li>
                Reserved for uses in progress:{" "}
                <Amount v={o.customers.reserved_in_use} asset={o.asset} token={o?.token} />
              </li>
            </>
          ) : (
            <li>Customer money held by the contract is shown once the contract has been read.</li>
          )}
          <li>Customers keep their requests, results and units; nobody gains access to them.</li>
        </ul>
      </section>
      <section>
        <h2 className="sale-h3">Needs its own verified transfer</h2>
        <p>{NOT_TRANSFERRED}</p>
      </section>
    </aside>
  );
}

/** Job 001i: the business's own name for the owner's page (owner-only read; none if it fails). */
function useBusinessName(id: string, enabled: boolean) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .desk(id)
      .then((d) => alive && setName(d.business.name))
      .catch(() => alive && setName(null));
    return () => {
      alive = false;
    };
  }, [id, enabled]);
  return name;
}

function DealTerms({ d, asset, ev }: { d: ObservedDeal; asset: string; ev: SaleEvidence }) {
  const o = ev.observed;
  return (
    <>
      <dl className="facts">
        <dt>Price</dt>
        <dd>
          <Amount v={d.price} asset={asset} token={o?.token} />
        </dd>
        <dt>Seller account</dt>
        <dd className="mono wrap">{d.seller}</dd>
        <dt>Buyer account</dt>
        <dd className="mono wrap">{d.buyer}</dd>
        <dt>Deal</dt>
        <dd>
          Number {d.seq}, terms version {d.version} · {d.state}
        </dd>
        <dt>Accepted by</dt>
        <dd>
          {[d.seller_accepted && "seller", d.buyer_accepted && "buyer"]
            .filter(Boolean)
            .join(" and ") || "nobody yet"}
        </dd>
        <dt>Offer open until</dt>
        <dd>
          {msDate(d.expires_at_ms) ?? "not set"}
          {o && d.state !== "closing" && elapsedAt(d.expires_at_ms, o.observed_at) && (
            <div className="error-text" style={{ fontSize: 13 }}>
              Already passed when this was read. That doesn't show how the sale ended: only a later
              reading of the contract's outcome does, and acceptance may no longer be possible.
            </div>
          )}
        </dd>
        {d.state === "closing" && (
          <>
            <dt>Closer's deadline</dt>
            <dd>
              {msDate(d.deadline_ms) ?? "not set"}
              {o && elapsedAt(d.deadline_ms, o.observed_at) && (
                <div className="error-text" style={{ fontSize: 13 }}>
                  Already passed when this was read; read again for the outcome.
                </div>
              )}
            </dd>
          </>
        )}
        <dt>How it closes</dt>
        <dd>
          {o?.close_mode === "gated"
            ? `By the closer account ${o.closer ?? "(not set)"}, within its window`
            : "On the second matching acceptance"}
        </dd>
        <dt>Authority the buyer receives</dt>
        <dd>
          {d.grants.length === 0
            ? "No operator accounts"
            : d.grants.map((g) => (
                <div key={g.account}>
                  <span className="mono wrap">{g.account}</span> · {caps(g.caps)}
                  {sellerMark(g.account, d.seller)}
                </div>
              ))}
          <div className="muted" style={{ fontSize: 13 }}>
            Only these operators keep their roles after the close. An account not listed (such as
            the platform's metering account) needs the new owner to appoint it on the contract.
          </div>
        </dd>
        {o && (
          <>
            <dt>Customer obligations that stay with the business</dt>
            <dd>
              Prepaid, not yet used:{" "}
              <Amount v={o.customers.prepaid_unused} asset={asset} token={o?.token} />
              <br />
              Reserved for uses in progress:{" "}
              <Amount v={o.customers.reserved_in_use} asset={asset} token={o?.token} />
            </dd>
          </>
        )}
      </dl>
      <details className="advanced">
        <summary>Technical details</summary>
        <dl className="facts">
          <dt>Deal digest (the contract's own)</dt>
          <dd className="mono wrap">{d.digest}</dd>
          <dt>Terms hash</dt>
          <dd className="mono wrap">{d.terms_hash}</dd>
          <dt>Generation before the close</dt>
          <dd>{d.expected_generation}</dd>
          <dt>Buyer's escrow</dt>
          <dd>
            <Amount v={d.escrow} asset={asset} token={o?.token} />
          </dd>
          <dt>Funds floor kept for customers</dt>
          <dd>
            <Amount v={d.available_floor} asset={asset} token={o?.token} />
          </dd>
        </dl>
      </details>
    </>
  );
}

function AnswerLine({ a }: { a: ReconcileAnswer | undefined }) {
  if (!a) return null;
  return (
    <p className={`notice ${a.state === "applied" || a.state === "already" ? "ok" : ""}`}>
      {a.message}
      {a.code && <span className="muted"> ({a.code})</span>}
    </p>
  );
}

const NOT_TRANSFERRED =
  "Not handed over by applying a sale here: domains, provider and model accounts, secrets, or anything outside this app. Each needs its own verified transfer.";

export function HandoverWorkspace({ id }: { id: string }) {
  const { person, wallet } = useSession();
  const [c] = useState(
    () =>
      new OwnerHandover(handoverHttp, {
        personId: person?.id ?? "anon",
        businessId: id,
        storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
      }),
  );
  const s = useSyncExternalStore(c.subscribe, c.getState);
  useEffect(() => {
    if (person) void c.start();
    return () => c.dispose();
  }, [c, person]);
  const name = useBusinessName(id, Boolean(person) && s.status === "ready");

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see this business's sale and handover.</h2>
      </div>
    );
  if (s.status === "loading")
    return (
      <div className="page muted" role="status">
        Loading…
      </div>
    );
  if (s.status === "gone")
    return (
      <div className="page">
        <h1 className="display" style={{ fontSize: 30 }}>
          Sale and handover
        </h1>
        <p className="notice" role="status">
          {s.notice?.message}
        </p>
        {s.receipts.map((h) => (
          <ReceiptCard key={h.receipt.intent_id} h={h} />
        ))}
        <p>
          <Link to="/handovers">All your handover receipts</Link> ·{" "}
          <Link to="/desk">My businesses</Link>
        </p>
      </div>
    );
  if (s.status === "error" || !s.evidence)
    return (
      <div className="page empty" role="alert">
        <h2>The sale evidence couldn't be loaded</h2>
        <p>{s.notice?.message}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void c.start()}>
          Try again
        </button>
      </div>
    );

  const ev = s.evidence;
  const o = ev.observed;
  const deal = o?.deal ?? null;
  const busy = s.busy !== null;
  const locked = busy || s.access === "unconfirmed";
  const problem = reviewProblem(ev);
  // Job 001i1: one resolution of the current sale, shared with the sentence, steps and action.
  const current = saleCurrent(s);
  const currentRecord =
    current.kind === "live" || current.kind === "pending" ? current.record : null;
  const recordedThis = current.kind === "live" && current.record !== null;

  const next = saleNext(s);
  const runNext = () => {
    switch (next.action) {
      case "check_access":
        return void c.checkAccess();
      case "recover":
        return void c.recoverOriginal();
      case "retry":
        return void c.start();
      case "reconcile": {
        // Only opens the existing confirmation (with its effects). The applying click is the one
        // in that panel, next to what it does; this button never applies by itself.
        if (!next.intent) return undefined;
        if (s.confirmApply !== next.intent) void c.reconcile(next.intent);
        window.setTimeout(() => {
          const el = document.getElementById(`confirm-${next.intent}`);
          el?.scrollIntoView({ block: "nearest" });
          el?.focus({ preventScroll: true });
        }, 0);
        return undefined;
      }
      case "record":
        return void c.record();
      case "review":
        return c.review();
      case "refresh":
        return void c.refreshEvidence();
      default:
        return undefined;
    }
  };

  return (
    <div className="page handover sale-workspace">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/desk/${id}`} className="muted">
          Business desk
        </Link>
        <span className="muted">/</span>
        <Link to={`/desk/${id}/continuity`} className="muted">
          Ownership and continuity
        </Link>
      </div>
      {/* Job 001i: identity, where the sale stands, and one next action, together. */}
      <header className="sale-head">
        <div className="eyebrow">Sale and handover · business contract on {chainWords(wallet)}</div>
        <div className="sale-title-row">
          <h1 className="display sale-title">{name ?? "This business"}</h1>
          {next.action === "selling" ? (
            <Link to={`/desk/${id}/sale`} className="btn btn-primary">
              {next.label}
            </Link>
          ) : next.action === "accept" ? (
            <Link to={`/sales/${id}`} className="btn btn-primary">
              {next.label}
            </Link>
          ) : (
            next.action !== "none" && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={next.action === "check_access" ? busy : locked}
                onClick={runNext}
              >
                {s.busy === "check_access"
                  ? "Checking…"
                  : s.busy === "record"
                    ? "Recording…"
                    : s.busy === "refresh"
                      ? "Reading…"
                      : s.busy === "recover"
                        ? "Recovering…"
                        : s.busy === "reconcile"
                          ? "Checking the outcome…"
                          : next.label}
              </button>
            )
          )}
        </div>
        <p className="sale-state" role="status">
          {saleSentence({ evidence: ev, intents: s.intents })}
        </p>
        <p className="muted sale-scope">
          Nothing here signs, pays or closes a sale: that happens on the contract. This page shows
          what the contract shows, records the exact version you agree to, and applies a closed sale
          here only when you or the buyer ask.{" "}
          <Link to={`/sales/${id}`}>Sell directly through your wallet</Link> to propose, accept and
          collect with exact, reviewed wallet requests.
        </p>
      </header>

      {s.access === "unconfirmed" && (
        <div className="notice" role="alert">
          {s.notice?.message}
        </div>
      )}

      <SaleProgress ev={ev} intents={s.intents} />

      <div className="sale-grid">
        <div className="sale-main">
          {ev.state === "unbound" && (
            <section className="card">
              <h2 style={{ fontSize: 18 }}>No v3 contract here</h2>
              <p>{ev.message}</p>
              <p>
                A sale of a business on the earlier contract continues in{" "}
                <Link to={`/desk/${id}/sale`}>Selling</Link>.
              </p>
            </section>
          )}
          {ev.state === "paused" && <p className="notice error">{ev.message}</p>}

          {(ev.state === "observed" || ev.state === "never_observed") && (
            <section className="card" aria-labelledby="ho-evidence">
              <h2 id="ho-evidence" style={{ fontSize: 18 }}>
                Exact terms, as the contract shows them
              </h2>
              {o ? (
                <p className={o.freshness === "stale" || o.flag ? "notice error" : "notice info"}>
                  Read at block <span className="mono">{o.block.height}</span> on{" "}
                  {when(o.observed_at)} ({o.freshness}).
                  {o.flag && ` ${o.flag.message}`}
                </p>
              ) : (
                <p className="muted">Nothing has been read from the contract yet.</p>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={locked}
                onClick={() => void c.refreshEvidence()}
              >
                {s.busy === "refresh" ? "Reading…" : "Read the contract again"}
              </button>
              <p className="muted" style={{ fontSize: 13 }}>
                Reading records evidence only. It never applies a sale.
              </p>

              {o && !deal && <p>No sale is in progress at the observed block.</p>}
              {o && deal && (
                <>
                  <h3 style={{ fontSize: 16, marginTop: 16 }}>Sale in progress</h3>
                  <DealTerms d={deal} asset={o.asset} ev={ev} />
                  {!recordedThis && problem && (
                    <p className="notice" role="note">
                      {problem} The terms above are shown as last read, for reference.
                    </p>
                  )}
                  {!recordedThis && !s.reviewing && !problem && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={locked}
                      onClick={() => c.review()}
                    >
                      Review this version
                    </button>
                  )}
                  {recordedThis && <p className="muted">This exact version is recorded below.</p>}
                </>
              )}
            </section>
          )}

          {s.reviewing && (
            <section className="card" aria-labelledby="ho-review">
              <h2 id="ho-review" style={{ fontSize: 18 }}>
                Record version {s.reviewing.version} of deal {s.reviewing.seq}
              </h2>
              <p>
                Recording doesn't sign or send anything. It lets this app apply exactly this sale
                later, once the contract shows it closed. If the terms are revised, a new version
                needs its own review.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={locked || problem !== null}
                  onClick={() => void c.record()}
                >
                  {s.busy === "record" ? "Recording…" : "Record this exact version"}
                </button>
              </div>
            </section>
          )}

          {s.unanswered && (
            <div className="notice info" role="note">
              Your request to record deal {s.unanswered.seq}, version {s.unanswered.version}, wasn't
              answered. Recover it first: it's the same request, so nothing is recorded twice.{" "}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={locked}
                onClick={() => void c.recoverOriginal()}
              >
                {s.busy === "recover" ? "Recovering…" : "Recover my original request"}
              </button>
            </div>
          )}

          {s.intents.length > 0 && (
            <section className="card" aria-labelledby="ho-intents">
              <h2 id="ho-intents" style={{ fontSize: 18 }}>
                Recorded versions and history
              </h2>
              <p className="muted" style={{ fontSize: 13 }}>
                Every version recorded for this business, newest first. Only the one marked current
                belongs to the sale above; the others are history.
              </p>
              <ul className="handover-list">
                {s.intents.map((i) => (
                  <li key={i.id}>
                    <div>
                      <span className="pill">
                        {i.id === currentRecord?.id ? "Current sale" : "History"}
                      </span>{" "}
                      <strong>
                        Deal {i.deal.seq}, version {i.deal.version}
                      </strong>{" "}
                      <span className={`pill ${STATUS[i.status].tone}`}>
                        {STATUS[i.status].label}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 13.5 }}>
                      Buyer <span className="mono wrap">{i.buyer_account}</span> · price{" "}
                      <Amount
                        v={i.terms.price}
                        asset={o?.asset ?? "the business's asset"}
                        token={o?.token}
                      />{" "}
                      · recorded {when(i.created_at)}
                    </div>
                    {i.status === "recorded" && (
                      <ApplyControl
                        id={i.id}
                        confirming={s.confirmApply === i.id}
                        busy={locked}
                        onApply={() => void c.reconcile(i.id)}
                        onCancel={() => c.cancelApply()}
                      />
                    )}
                    <AnswerLine a={s.answers[i.id]} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <Continuity ev={ev} />
      </div>

      <div role="status" aria-live="polite">
        {s.notice && s.access !== "unconfirmed" && (
          <p
            className={`notice ${s.notice.tone === "error" ? "error" : s.notice.tone === "ok" ? "ok" : ""}`}
          >
            {s.notice.message}
          </p>
        )}
      </div>
    </div>
  );
}

function ApplyControl({
  id,
  confirming,
  busy,
  onApply,
  onCancel,
}: {
  /** Job 001i: the confirmation panel's id, so the header's next action can bring it into view. */
  id?: string;
  confirming: boolean;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  return confirming ? (
    <div className="handover-confirm" id={id ? `confirm-${id}` : undefined} tabIndex={-1}>
      <strong>Before checking the outcome</strong>
      <Effects />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onApply}>
          Check the outcome and apply it here
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          Not now
        </button>
      </div>
    </div>
  ) : (
    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onApply}>
      Check the contract's outcome…
    </button>
  );
}

function ReceiptCard({
  h,
  confirming,
  busy,
  answer,
  onApply,
  onCancel,
}: {
  h: Handover;
  confirming?: boolean;
  busy?: boolean;
  answer?: ReconcileAnswer;
  onApply?: () => void;
  onCancel?: () => void;
}) {
  const r = h.receipt;
  const bid = h.business.id;
  return (
    <section className="card handover-receipt" aria-label={`Handover receipt ${r.deal.seq}`}>
      <h2 style={{ fontSize: 17, margin: "0 0 4px", overflowWrap: "anywhere" }}>
        {h.business.name ?? "A business (its name isn't shared with you)"}
      </h2>
      <p style={{ margin: "0 0 6px" }}>
        You are the <strong>{r.role}</strong> ·{" "}
        <span className={`pill ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
      </p>
      {/* Review #76: the sale itself is the card's action; the outcome check comes after. */}
      <Link to={`/sales/${bid}`} className="btn btn-primary btn-sm">
        Open the sale
      </Link>
      <dl className="facts">
        <dt>Deal</dt>
        <dd>
          Number {r.deal.seq}, version {r.deal.version}
        </dd>
        <dt>Recorded</dt>
        <dd>{when(r.recorded_at)}</dd>
        {r.applied_at && (
          <>
            <dt>Applied here</dt>
            <dd>
              {when(r.applied_at)} (contract control step {r.outcome_control_seq ?? "not recorded"})
            </dd>
          </>
        )}
      </dl>
      <details className="advanced">
        <summary>Technical details</summary>
        <p className="mono wrap" style={{ fontSize: 13 }}>
          digest {r.deal.digest} · generation after the close {r.target_generation}
        </p>
      </details>
      {r.status === "recorded" && onApply && onCancel && (
        <ApplyControl
          confirming={Boolean(confirming)}
          busy={Boolean(busy)}
          onApply={onApply}
          onCancel={onCancel}
        />
      )}
      <AnswerLine a={answer} />
      {r.status === "applied" && h.you_own_it_now && (
        <div className="handover-first">
          <strong>Your first steps as the new owner</strong>
          <ol>
            <li>
              <Link to={`/desk/${bid}/continuity`}>Check the ownership evidence</Link>: the contract
              should show you as owner.
            </li>
            <li>
              <Link to={`/desk/${bid}`}>Open the business desk</Link>. Each product's Customer
              access shows what is configured, unavailable or unknown, including whether the
              platform may meter uses after the sale:
              <OwnedProducts businessId={bid} />
            </li>
            <li>
              Customers keep their requests, results and units. New uses wait until metering is
              appointed on the contract, if the sale didn't grant it.
            </li>
            <li>{NOT_TRANSFERRED}</li>
          </ol>
        </div>
      )}
      {r.status === "applied" && !h.you_own_it_now && (
        <p className="muted">
          {r.role === "seller"
            ? "This sale was applied here; you no longer manage the business. This receipt stays."
            : "Applied, but you don't manage this business here now (it may have changed hands again)."}
        </p>
      )}
    </section>
  );
}

/**
 * Job 001b: the products of a business this person now owns, each with a direct link to its
 * Customer access. Read through the owner's own project list, so nobody else sees anything.
 */
function OwnedProducts({ businessId }: { businessId: string }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    productsApi
      .list()
      .then((r) => setList(r.projects.filter((p) => p.business_id === businessId)))
      .catch(() => setList([]));
  }, [businessId]);
  if (!list || list.length === 0) return null;
  return (
    <ul style={{ marginTop: 4 }}>
      {list.map((p) => (
        <li key={p.id}>
          {p.name}: <Link to={`/build/${p.id}?view=service&task=customers`}>Customer access</Link>
        </li>
      ))}
    </ul>
  );
}

export function HandoversPage() {
  const { person } = useSession();
  const [c] = useState(() => new Handovers(handoverHttp));
  const s = useSyncExternalStore(c.subscribe, c.getState);
  useEffect(() => {
    if (person) void c.load();
    return () => c.dispose();
  }, [c, person]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see your handover receipts.</h2>
      </div>
    );
  return (
    <div className="page handover">
      <h1 className="display" style={{ fontSize: 30 }}>
        Business handovers
      </h1>
      <p className="muted" style={{ maxWidth: "75ch" }}>
        Sales of digital businesses you take part in, as seller or buyer. Each receipt is yours; it
        shows no private records of the business. Checking an outcome reads the contract and applies
        a matching closed sale here once; nothing is signed or paid.
      </p>
      {s.status === "loading" && (
        <p className="muted" role="status">
          Loading…
        </p>
      )}
      {s.status === "error" && (
        <div role="alert">
          <p className="notice error">{s.notice?.message}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void c.load()}>
            Try again
          </button>
        </div>
      )}
      {s.status === "ready" && s.handovers.length === 0 && (
        <p className="muted">No handovers yet.</p>
      )}
      {s.handovers.map((h) => (
        <ReceiptCard
          key={h.receipt.intent_id}
          h={h}
          confirming={s.confirmApply === h.receipt.intent_id}
          busy={s.busy !== null}
          answer={s.answers[h.receipt.intent_id]}
          onApply={() => void c.reconcile(h)}
          onCancel={() => c.cancelApply()}
        />
      ))}
      <div role="status" aria-live="polite">
        {s.status === "ready" && s.notice && (
          <p
            className={`notice ${s.notice.tone === "ok" ? "ok" : s.notice.tone === "error" ? "error" : ""}`}
          >
            {s.notice.message}
          </p>
        )}
      </div>
    </div>
  );
}
