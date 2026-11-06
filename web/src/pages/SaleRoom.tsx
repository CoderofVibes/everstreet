// Job 003wf2 (docs/design/DIRECT_SALE.md §7): /sales/:business, one page for both parties of a
// Direct sale, in the approved acquisition composition: identity, where the sale stands, ONE next
// action, the progression in words, the exact terms and the continuity facts. Every wallet request
// is reviewed exactly (receiver, method, arguments, deposit, gas, plain effects and what can't be
// guaranteed) and re-derived in this browser before the wallet sees it. Nothing here claims a
// transaction, a close or a payout that its own evidence doesn't show.

import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { sellerMark } from "../handoverApi.ts";
import { Link, useRouter } from "../router.tsx";
import {
  type SaleAction,
  type SaleHandover,
  type SaleKind,
  type SalePreview,
  type SaleSetup,
  saleHttp,
} from "../saleApi.ts";
import {
  EXCLUSIVE,
  KIND_LABEL,
  STATE_LABEL,
  sha256Hex,
  toBaseUnits,
  tokenAmount,
} from "../saleCalls.ts";
import {
  currentSale,
  handoverInProgress,
  SaleFlow,
  type SaleFlowState,
  saleNext,
  saleRoleWords,
  saleSentence,
  saleSteps,
} from "../saleFlow.ts";
import { serviceWord } from "../serviceWords.ts";
import { useSession } from "../session.tsx";
import { chainWords } from "../wallet.ts";
import { when } from "../when.ts";

const EMPTY: SaleFlowState = {
  status: "loading",
  setup: null,
  review: null,
  busy: null,
  notice: null,
  answers: {},
  drafts: {},
  focus: null,
};
const STEP_WORD = {
  done: "Completed",
  current: "Now",
  waiting: "Waiting",
  unknown: "Not shown",
} as const;
const tgas = (gas: string) => `${(Number(BigInt(gas) / 1_000_000_000n) / 1000).toString()} Tgas`;
const yocto = (v: string) => tokenAmount(v, 24);
/** First-use review #79: a transaction id, short; the full id on hover and for copying. */
function TxId({ hash }: { hash: string }) {
  return (
    <span className="mono" title={hash}>
      {hash.length > 14 ? `${hash.slice(0, 10)}…` : hash}
    </span>
  );
}

const caps = (c: number) =>
  [c & 1 && "metering", c & 2 && "support"].filter(Boolean).join(" and ") || "none";

function Amount({ base, s }: { base: string; s: SaleSetup }) {
  const m = s.token.meta;
  return m ? (
    <strong>
      {tokenAmount(base, m.decimals)} {m.symbol}
    </strong>
  ) : (
    <span className="mono">{base} base units</span>
  );
}

/** The exact wallet request, every field shown; the exact units in one disclosure. */
function ExactCall({ call }: { call: SaleAction["call"] }) {
  return (
    <>
      <dl className="use-terms">
        <dt>Sent to</dt>
        <dd className="mono wrap">{call.receiverId}</dd>
        <dt>Request</dt>
        <dd className="mono wrap">{call.methodName}</dd>
        <dt>Attached NEAR</dt>
        {/* First-use review #80: the 1 yoctoNEAR confirmation in plain words, not 24 decimals. */}
        <dd>
          {call.deposit === "1" ? (
            <>
              1 yoctoNEAR{" "}
              <span className="muted">(the smallest unit; a confirmation, not a payment)</span>
            </>
          ) : (
            <span className="mono">{yocto(call.deposit)} NEAR</span>
          )}
        </dd>
        <dt>Network fee limit</dt>
        <dd className="mono">up to {tgas(call.gas)}</dd>
      </dl>
      <details>
        <summary>Exact arguments</summary>
        <pre className="mono wrap sale-args">{JSON.stringify(call.args, null, 2)}</pre>
        <p className="muted">Attached, exactly: {call.deposit} yoctoNEAR</p>
      </details>
    </>
  );
}

/** The terms document, checked in this browser against the contract's terms hash. */
function TermsDocument({ text, hash }: { text: string; hash: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void sha256Hex(text).then((h) => alive && setOk(h === hash));
    return () => {
      alive = false;
    };
  }, [text, hash]);
  let doc: Record<string, unknown> | null = null;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {}
  const t = doc?.transfers as { included?: string[]; not_included?: string[] } | undefined;
  return (
    <section aria-label="Terms document">
      <p className={ok === false ? "notice error" : "notice info"} role="status">
        {ok === null
          ? "Checking the terms document against the contract's terms hash…"
          : ok
            ? "This terms document is exactly the one the contract's terms hash names (checked in your browser)."
            : "This document does NOT match the contract's terms hash. Don't rely on it."}
      </p>
      {t && (
        <>
          <h3 className="sale-h3">Included</h3>
          <ul>
            {(t.included ?? []).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h3 className="sale-h3">Not included</h3>
          <ul>
            {(t.not_included ?? []).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {typeof doc?.note === "string" && doc.note && (
        <p>
          <span className="muted">Seller's note: </span>
          {doc.note}
        </p>
      )}
      <details className="advanced">
        <summary>The exact document</summary>
        <pre className="mono wrap sale-args">{text}</pre>
        <p className="mono wrap muted">sha256 {hash}</p>
      </details>
    </section>
  );
}

/** An absolute time, readable, with its time zone, and the exact UTC instant. */
// ---------- job 003wf3: the managed handover, in plain words ----------

const HANDOVER_STATE: Record<string, string> = {
  gated: "Checking the handover",
  ready: "Ready to close",
  ordering: "Close prepared; confirmation pending",
  outcome_unknown: "Confirmation pending; checking the original transaction and the contract",
  closed_observed: "Closed on the contract; applying it here",
  reconciled: "Applied here",
  attention: "Needs attention",
  released_to_buyer: "Handed over to the buyer",
  released_to_seller: "The closing ended; the seller keeps the business",
  released_current: "Settled to the business's current owner",
  ended: "Ended (a newer sale is closing)",
};

/** What the handover is waiting for, without internal codes (the code stays in the details). */
function waitingWords(code: string | null): string | null {
  if (!code) return null;
  const c = code.replace(/^not_ready:/, "");
  if (c.startsWith("customers_") || c === "holds_active")
    return "Customer uses already in progress are finishing and settling. New uses are paused.";
  if (c === "owner_work_running") return "An owner check or trial already running is finishing.";
  if (c === "below_floor") return "The business's available balance is below the agreed floor.";
  if (c === "too_late")
    return "Too little time is left before the deadline to send the close safely. After the deadline either party can end the closing.";
  if (c === "order_outstanding")
    return "A close order exists; its own transaction and the contract are being checked.";
  if (c.startsWith("capability_"))
    return "Further closing work isn't available on this server right now. Any transaction already sent is still being confirmed.";
  if (c.startsWith("read_") || c.startsWith("evidence_"))
    return "The contract couldn't be read just now; it is read again shortly.";
  return "Checking the handover.";
}

/** One close order's transaction, from its own evidence only (Astra 02:00). */
function attemptWords(a: SaleHandover["orders"][number]["attempt"]): string {
  if (a === null) return "prepared; no transaction yet";
  if (a.state === "success") return "its transaction succeeded";
  if (a.state === "failure") return `its transaction was refused (${a.code ?? "refused"})`;
  if (a.state === "invalid")
    return `its transaction wasn't accepted by the network (${a.code ?? "invalid"})`;
  if ((a.broadcasts ?? 0) > 0) return "sent; its outcome is read from its own transaction";
  return "signed; not known to be sent yet";
}

/**
 * The managed handover's progress (MANAGED_HANDOVER.md §8, §16): what is being checked, the deadline,
 * the close order(s) and their own transactions, the outcome, and (after the close) whether
 * customers are eligible to be served, kept apart from "applied here".
 */
export function HandoverPanel({
  s,
  checkedMs = null,
  onCheck,
  checking = false,
  blocked = false,
}: {
  s: SaleSetup;
  checkedMs?: number | null;
  onCheck?: () => void;
  checking?: boolean;
  blocked?: boolean;
}) {
  const h = s.handover;
  if (!h) return null;
  const waiting = waitingWords(h.waiting_for);
  return (
    <section className="card sale-handover" aria-label="The handover">
      <h2 className="sale-h3">Handover: {HANDOVER_STATE[h.state] ?? h.state}</h2>
      <dl className="facts">
        <dt>Deal</dt>
        <dd>
          Number {h.deal_seq}, version {h.version}
        </dd>
        <dt>Close deadline</dt>
        <dd>
          <When ms={h.deadline_ms} />
        </dd>
      </dl>
      {waiting && !h.state.startsWith("released") && <p>{waiting}</p>}
      {h.state === "attention" && (
        <p className="error-text">
          Managing the business here stays paused while this server reconciles its ownership records
          with the contract's evidence. What the contract shows stays as it is.
        </p>
      )}
      {h.orders.length > 0 && (
        <details>
          <summary>Close orders ({h.orders.length})</summary>
          <ul>
            {h.orders.map((o) => (
              <li key={o.n}>
                Order {o.n}, issued <When ms={o.issued_at_ms} />: {attemptWords(o.attempt)}
                {o.attempt && <TxId hash={o.attempt.tx_hash} />}
              </li>
            ))}
          </ul>
        </details>
      )}
      {onCheck && (
        <p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCheck}
            disabled={checking || blocked}
          >
            {checking ? "Checking…" : "Check the handover"}
          </button>{" "}
          <small className="muted">
            Reads the contract and this server again; nothing is sent.
            {blocked ? " Finish or set aside the request you're reviewing first." : ""}
            {checkedMs !== null
              ? ` Last checked ${new Date(checkedMs).toISOString().slice(11, 19)} UTC.`
              : " This page also checks every few seconds while it's open."}
          </small>
        </p>
      )}
      {h.service && (
        <p>
          {h.service.eligible
            ? "Customer service: eligible (the runtime, release, budget and metering checks pass). A customer's next use is what proves it."
            : `Customer service: paused: ${h.service.reasons.map(serviceWord).join("; ")}.`}
        </p>
      )}
    </section>
  );
}

/** Review #80: one format for every moment (local, with its zone). */
export function When({ ms }: { ms: string }) {
  return <>{when(ms)}</>;
}

/**
 * The reviewed facts, readable and together, before the wallet button (Astra's browser review):
 * who, how much, until when, the floor kept, the operators named, and what is attached. The exact
 * arguments stay below as secondary evidence.
 */
export function ReviewSummary({ p, s }: { p: SalePreview; s: SaleSetup }) {
  const v = p.review as Record<string, unknown>;
  const live = s.control.live_deal;
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  const buyer = str("buyer") ?? live?.buyer ?? null;
  const price = str("price");
  const expires =
    str("expires_at_ms") ??
    (live && p.kind !== "claim" && p.kind !== "register" && p.kind !== "appoint"
      ? live.expires_at_ms
      : null);
  const floor =
    str("available_floor") ??
    (live && (p.kind === "accept" || p.kind === "fund") ? live.available_floor : null);
  const grants = Array.isArray(v.grants)
    ? (v.grants as { account: string; caps: number }[])
    : live && (p.kind === "accept" || p.kind === "fund")
      ? live.grants
      : null;
  return (
    <dl className="facts sale-summary" aria-label="What you are reviewing">
      {str("deal_seq") && (
        <>
          <dt>Deal</dt>
          <dd>
            Number {str("deal_seq")}, version {String(v.version ?? v.next_version)}
          </dd>
        </>
      )}
      {buyer && p.kind !== "claim" && p.kind !== "register" && p.kind !== "appoint" && (
        <>
          <dt>Buyer</dt>
          <dd className="mono wrap">{buyer}</dd>
        </>
      )}
      {price && (
        <>
          <dt>Price</dt>
          <dd>
            <Amount base={price} s={s} /> <span className="muted mono">({price} base units)</span>
          </dd>
        </>
      )}
      {str("amount") && (
        <>
          <dt>Amount</dt>
          <dd>
            <Amount base={str("amount") as string} s={s} />{" "}
            <span className="muted mono">({str("amount")} base units)</span>
          </dd>
        </>
      )}
      {expires && (
        <>
          <dt>Offer open until</dt>
          <dd>
            <When ms={expires} />
          </dd>
        </>
      )}
      {floor !== null && (
        <>
          <dt>Available balance kept (floor)</dt>
          <dd>
            <Amount base={floor} s={s} />
          </dd>
        </>
      )}
      {grants && (
        <>
          <dt>Operators named</dt>
          <dd>
            {grants.length === 0
              ? "None: after the close, customers' new uses pause until the new owner appoints metering."
              : grants
                  .map(
                    (g) =>
                      `${g.account} (${caps(g.caps)}${sellerMark(g.account, live?.seller ?? s.control.owner)})`,
                  )
                  .join("; ")}
          </dd>
        </>
      )}
      {typeof v.operator === "string" && (
        <>
          <dt>{p.kind === "owner_probe" ? "Asks to appoint" : "Operator appointed"}</dt>
          <dd className="mono wrap">{v.operator} (metering)</dd>
        </>
      )}
      {p.kind === "owner_probe" && typeof v.owner === "string" && (
        <>
          <dt>Owner on the contract</dt>
          <dd className="mono wrap">{v.owner}</dd>
        </>
      )}
      <dt>Attached NEAR</dt>
      <dd>
        <span className="mono">{yocto(p.call.deposit)} NEAR</span>
        {typeof v.deposit_basis === "string" && <div className="muted">{v.deposit_basis}</div>}
      </dd>
    </dl>
  );
}

function Review({ flow, st, s }: { flow: SaleFlow; st: SaleFlowState; s: SaleSetup }) {
  const ref = useRef<HTMLElement>(null);
  const r = st.review;
  useEffect(() => {
    if (r) ref.current?.focus();
  }, [r]);
  if (!r) return null;
  const p = r.preview;
  const v = p.review as Record<string, unknown>;
  return (
    <section
      className="card sale-review"
      ref={ref}
      tabIndex={-1}
      aria-labelledby="sale-review-title"
    >
      <h2 id="sale-review-title" style={{ fontSize: 18 }}>
        Review: {KIND_LABEL[p.kind]}
        {p.kind === "claim" ? ` (${String(v.category_name)})` : ""}
      </h2>
      {r.replaces && (
        <p className="notice" role="note">
          This is the identical request in place of one whose outcome isn't known. At most one of
          the two can take effect: the contract refuses whichever lands second. Your wallet signs a
          new transaction; each one's outcome is checked by its own transaction.
        </p>
      )}
      <ReviewSummary p={p} s={s} />
      <h3 className="sale-h3">What this does</h3>
      <ul>
        {((v.effects as string[] | undefined) ?? []).map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {((v.conditions as string[] | undefined) ?? []).length > 0 && (
        <>
          <h3 className="sale-h3">What can't be guaranteed in advance</h3>
          <ul>
            {(v.conditions as string[]).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {p.terms_doc && <TermsDocument text={p.terms_doc.text} hash={p.terms_doc.hash} />}
      <p>
        <span className="muted">Your account (approves and pays):</span>{" "}
        <span className="mono">{p.account}</span>
      </p>
      <ExactCall call={p.call} />
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={st.busy !== null}
          onClick={() => void flow.confirm()}
        >
          {st.busy === "storing"
            ? "Storing…"
            : st.busy === "wallet"
              ? "Waiting for your wallet…"
              : "Ask my wallet for exactly this"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={st.busy !== null}
          onClick={() => flow.cancelReview()}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

function OpenRequest({ flow, st, a }: { flow: SaleFlow; st: SaleFlowState; a: SaleAction }) {
  const [tx, setTx] = useState("");
  const id = useId();
  const answer = st.answers[a.id];
  const replaceable = EXCLUSIVE.includes(a.kind) && a.state !== "prepared";
  return (
    <section className="card sale-open" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} style={{ fontSize: 18 }}>
        Your wallet request: {KIND_LABEL[a.kind]}
      </h2>
      <p role="status">
        <strong>{STATE_LABEL[a.state]}.</strong>{" "}
        {answer?.resolution?.message ?? a.evidence?.message ?? ""}
      </p>
      <ExactCall call={a.call} />
      {a.tx_hash && (
        <p className="muted">
          Its transaction: <TxId hash={a.tx_hash} />
        </p>
      )}
      {a.state === "prepared" ? (
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={st.busy !== null}
            onClick={() => void flow.continuePrepared(a.id)}
          >
            Ask my wallet for exactly this
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={st.busy !== null}
            onClick={() => void flow.setAside(a.id)}
          >
            Set it aside (my wallet was never asked)
          </button>
        </div>
      ) : (
        <>
          <div className="row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={st.busy !== null}
              onClick={() => void flow.checkOpen(a.id)}
            >
              {st.busy === "checking" ? "Checking…" : "Check again"}
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void flow.checkWithTransaction(a.id, tx);
            }}
          >
            <label className="field">
              <span>Transaction ID from your wallet's activity</span>
              <input
                className="input mono"
                value={tx}
                onChange={(e) => setTx(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <small>
                43 or 44 letters and digits. Only this request's own transaction can settle it; any
                other ID shows nothing about it.
              </small>
            </label>
            <button type="submit" className="btn btn-secondary" disabled={st.busy !== null}>
              Check with this ID
            </button>
          </form>
          <p className="muted">
            Nothing is sent again automatically.{" "}
            {replaceable
              ? "If your wallet never sent it, you can review the identical request in its place; at most one of the two can take effect."
              : "This kind of request can't be replaced: it is recovered by its own transaction, or by the sale moving on (a new version or the offer ending)."}
          </p>
          {replaceable && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={st.busy !== null}
              onClick={() => void flow.reviewReplacement(a.id)}
            >
              Review the identical request in its place
            </button>
          )}
        </>
      )}
    </section>
  );
}

function TermsForm({
  flow,
  st,
  s,
  revise,
}: {
  flow: SaleFlow;
  st: SaleFlowState;
  s: SaleSetup;
  revise: boolean;
}) {
  const d = s.control.live_deal;
  const m = s.token.meta;
  const id = useId();
  const kind = revise ? ("revise" as const) : ("propose" as const);
  // The draft lives in the controller (this business, this account), so leaving the form for a
  // review and coming back, a retry or a stale review never loses what was typed.
  const saved = st.drafts[kind];
  const [buyer, setBuyer] = useState(saved?.buyer ?? d?.buyer ?? "");
  const [price, setPrice] = useState(
    saved?.price ?? (d && m ? tokenAmount(d.price, m.decimals) : ""),
  );
  const [days, setDays] = useState(saved?.days ?? 7);
  const [floor, setFloor] = useState(
    saved?.floor ?? (d && m ? tokenAmount(d.available_floor, m.decimals) : "0"),
  );
  const [metering, setMetering] = useState(
    saved?.metering ??
      (!d ||
        (s.platform_operator !== null &&
          d.grants.some((g) => g.account === s.platform_operator && (g.caps & 1) !== 0))),
  );
  const [exclusions, setExclusions] = useState(saved?.exclusions ?? "");
  const [note, setNote] = useState(saved?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    flow.setDraft(kind, { buyer, price, days, floor, metering, exclusions, note });
  }, [flow, kind, buyer, price, days, floor, metering, exclusions, note]);
  if (!m)
    return (
      <p className="notice error">
        The business's token didn't state valid metadata, so terms can't be prepared.
      </p>
    );
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = toBaseUnits(price, m.decimals);
    const floorBase = toBaseUnits(floor || "0", m.decimals);
    if (!base || base === "0")
      return setProblem(
        `The price is a positive amount of ${m.symbol} with at most ${m.decimals} decimals.`,
      );
    if (floorBase === null)
      return setProblem(
        `The floor is an amount of ${m.symbol} with at most ${m.decimals} decimals.`,
      );
    setProblem(null);
    const grants =
      metering && s.platform_operator ? [{ account: s.platform_operator, caps: 1 }] : [];
    void flow.review(
      kind,
      {
        buyer_account: buyer.trim(),
        price: base,
        expires_in_days: days,
        available_floor: floorBase,
        grants,
        exclusions: exclusions
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        note,
      },
      null,
      `terms-${kind}`,
    );
  };
  return (
    <section className="card" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} style={{ fontSize: 18 }}>
        {revise ? `Revise deal ${d?.seq} (a new version)` : "Prepare terms for one named buyer"}
      </h2>
      {/* The established form system (.field/.input/.check/.grid-2; one column on phones). */}
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>Buyer's NEAR account</span>
          <input
            className="input mono"
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small>
            They must have signed in here with this account, so they can review the terms.
          </small>
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Price in {m.symbol}</span>
            <input
              className="input"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <small className="mono">
              {toBaseUnits(price, m.decimals)
                ? `= ${toBaseUnits(price, m.decimals)} base units of ${s.token.account}`
                : `Up to ${m.decimals} decimals.`}
            </small>
          </label>
          <label className="field">
            <span>Offer stays open (days)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
            />
            <small>1 to 30 days from the block the request is reviewed at.</small>
          </label>
        </div>
        <label className="field">
          <span>Available balance the business must keep ({m.symbol})</span>
          <input
            className="input"
            inputMode="decimal"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
          <small>
            The floor: both acceptances wait until the business's available balance reaches it.
          </small>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={metering}
            disabled={!s.platform_operator}
            onChange={(e) => setMetering(e.target.checked)}
          />
          <span>
            Name the platform's metering account
            {s.platform_operator ? ` (${s.platform_operator})` : ""} in the terms
            <br />
            <small className="muted">
              {metering
                ? s.control.close_mode === "gated"
                  ? "It keeps its metering authority after the close. Whether customers can actually be served is checked separately after the handover (the runtime, release and budget)."
                  : "Customers' new uses continue right after the close."
                : "Without it, customers keep their units after the close, but new uses pause until the new owner appoints metering. Both of you see this in the terms."}
            </small>
          </span>
        </label>
        <label className="field">
          <span>Not included</span>
          <textarea
            className="input"
            rows={3}
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
          />
          <small>
            One per line, up to 8 (each up to 160 characters). Part of the hashed terms.
          </small>
        </label>
        <label className="field">
          <span>Note to the buyer</span>
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <small>Part of the hashed terms; up to 1000 characters.</small>
        </label>
        {problem && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" className="btn btn-primary" data-focus={`terms-${kind}`}>
          Review the exact request
        </button>
      </form>
    </section>
  );
}

function LiveTerms({ s }: { s: SaleSetup }) {
  const d = s.control.live_deal;
  if (!d) return null;
  return (
    <section className="card" aria-labelledby="sale-terms-t">
      <h2 id="sale-terms-t" style={{ fontSize: 18 }}>
        Exact terms, as the contract shows them
      </h2>
      <dl className="facts">
        <dt>Price</dt>
        <dd>
          <Amount base={d.price} s={s} />
        </dd>
        <dt>Seller · buyer</dt>
        <dd className="mono wrap">
          {d.seller} · {d.buyer}
        </dd>
        <dt>Deal</dt>
        <dd>
          Number {d.seq}, version {d.version} · {d.state}
        </dd>
        <dt>Accepted by</dt>
        <dd>
          {[d.seller_accepted && "the seller", d.buyer_accepted && "the buyer"]
            .filter(Boolean)
            .join(" and ") || "nobody yet"}
        </dd>
        <dt>Escrow</dt>
        <dd>{d.escrow === "0" ? "Not funded" : <Amount base={d.escrow} s={s} />}</dd>
        <dt>Offer open until</dt>
        <dd>{when(d.expires_at_ms)}</dd>
        <dt>How it closes</dt>
        <dd>
          {s.control.close_mode === "gated" ? (
            <>
              By its named closer ({s.control.closer ?? "not shown"}), after both accept and
              Everstreet's handover checks, before a deadline {Number(d.close_window_ms) / 60_000}{" "}
              minutes after the second acceptance
              {d.state === "closing" && d.deadline_ms !== "0" ? (
                <>
                  {" "}
                  (<When ms={d.deadline_ms} />)
                </>
              ) : null}
              . If it isn't closed by then, either party can end the closing.
            </>
          ) : (
            "On the second matching acceptance, in that same transaction"
          )}
        </dd>
        <dt>Floor kept available</dt>
        <dd>
          <Amount base={d.available_floor} s={s} />
        </dd>
      </dl>
      {s.terms_doc ? (
        <TermsDocument text={s.terms_doc.text} hash={d.terms_hash} />
      ) : (
        <p className="notice">
          The terms document for this version isn't stored here, so only the contract's terms are
          shown.
        </p>
      )}
      <details className="advanced">
        <summary>Technical details</summary>
        <dl className="facts">
          <dt>Deal digest (the contract's own)</dt>
          <dd className="mono wrap">{d.digest}</dd>
          <dt>Terms hash</dt>
          <dd className="mono wrap">{d.terms_hash}</dd>
          <dt>Generation before the close · control sequence</dt>
          <dd>
            {d.expected_generation} · {s.control.control_seq}
          </dd>
        </dl>
      </details>
    </section>
  );
}

/**
 * Who holds authority now, from the contract reading (Astra's 23:42 review): after a close, the
 * CLOSED deal's record and the CURRENT owner and operators are shown apart, never pre-proposal
 * guidance. A live deal (even after an earlier close) is the current one; history stays history.
 */
function CurrentAuthority({ s }: { s: SaleSetup }) {
  const platform = s.platform_operator;
  const ops = s.control.operators.filter((o) => o.generation === s.control.generation);
  const metering = platform ? ops.some((o) => o.account === platform && (o.caps & 1) !== 0) : null;
  return (
    <ul>
      <li>
        Now, at block {s.block.height}: <span className="mono wrap">{s.control.owner}</span> owns
        the business's contract (generation {s.control.generation}).
      </li>
      <li>
        {ops.length > 0
          ? `Operators now: ${ops.map((o) => `${o.account} (${caps(o.caps)})`).join("; ")}.`
          : "No operator is appointed now."}
      </li>
      {metering === false && (
        <li className="error-text">
          The platform's metering account isn't appointed: customers' new uses pause until the owner
          appoints it.
        </li>
      )}
    </ul>
  );
}

export function Continuity({ s }: { s: SaleSetup }) {
  const d = s.control.live_deal;
  const p = s.party;
  const platform = s.platform_operator;
  const granted =
    d && platform ? d.grants.some((g) => g.account === platform && (g.caps & 1) !== 0) : null;
  const c = currentSale(s);
  const ended = c.kind === "ended" ? c.outcome : null;
  return (
    <aside className="sale-continuity" aria-label="What changes and what stays">
      <section>
        <h2 className="sale-h3">
          {d
            ? "Authority the buyer receives"
            : ended?.status === "closed"
              ? `Authority after deal ${ended.seq} closed`
              : "Authority now"}
        </h2>
        {!d && ended && (
          <p className="sale-closed-terms">
            {ended.status === "closed"
              ? `Deal ${ended.seq}, version ${ended.version} closed on the contract: ${ended.seller} sold the business to ${ended.buyer}; the owner role moved to generation ${ended.generation_after}. Those terms are finished; what holds now is read below.`
              : `Deal ${ended.seq}, version ${ended.version} ${ended.status === "aborted" ? "was aborted" : `was ${ended.status}`}: no authority changed with it. No sale is in progress.`}
          </p>
        )}
        {!d && ended && <CurrentAuthority s={s} />}
        {d ? (
          <ul>
            <li>
              From deal {d.seq}, version {d.version} as the contract shows it: the owner role on the
              business's contract, at the next generation.
            </li>
            <li>
              {d.grants.length > 0
                ? `Operators named in these terms: ${d.grants.map((g) => `${g.account} (${caps(g.caps)}${sellerMark(g.account, d.seller)})`).join("; ")}. Every other operator ends with the close.`
                : "These terms name no operator: every earlier operator ends with the close."}
            </li>
            {granted === false && (
              <li className="error-text">
                The platform's metering account isn't named: customers' new uses pause after the
                close until the new owner appoints it.
              </li>
            )}
          </ul>
        ) : ended ? null : (
          <p className="muted">
            No sale is proposed at this reading. Once terms are proposed, this shows exactly what
            they give the buyer; a draft you are editing isn't shown here until you review it.
          </p>
        )}
      </section>
      {s.customer_obligations && (
        <section>
          <h2 className="sale-h3">Customer obligations that stay with the business</h2>
          <ul>
            <li>
              Prepaid, not yet used: <Amount base={s.customer_obligations.prepaid_unused} s={s} />
            </li>
            <li>
              Reserved for uses in progress:{" "}
              <Amount base={s.customer_obligations.reserved_in_use} s={s} />
            </li>
            <li>Customers keep their requests, results and units; nobody gains access to them.</li>
          </ul>
        </section>
      )}
      <section>
        <h2 className="sale-h3">Not included: needs its own verified transfer</h2>
        <p>Domains, provider and model accounts, secrets and anything outside this app.</p>
      </section>
      <section>
        <h2 className="sale-h3">Your claims on this business</h2>
        {p &&
        (p.sale_proceeds_claim !== "0" ||
          p.escrow_return_claim !== "0" ||
          p.profit_claim !== "0") ? (
          <ul>
            {p.sale_proceeds_claim !== "0" && (
              <li>
                Sale proceeds owed (not paid yet): <Amount base={p.sale_proceeds_claim} s={s} />
              </li>
            )}
            {p.escrow_return_claim !== "0" && (
              <li>
                Returned escrow owed (not paid yet): <Amount base={p.escrow_return_claim} s={s} />
              </li>
            )}
            {p.profit_claim !== "0" && (
              <li>
                Operating profit owed: <Amount base={p.profit_claim} s={s} />
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">Nothing is owed to you here now.</p>
        )}
        {s.payouts.length > 0 && (
          <p>
            In flight (not paid until the contract settles it):{" "}
            {s.payouts.map((x) => (
              <span key={x.payout_id}>
                <Amount base={x.amount} s={s} /> ({x.kind.replace("_", " ")}){" "}
              </span>
            ))}
          </p>
        )}
      </section>
    </aside>
  );
}

function OtherActions({ flow, st, s }: { flow: SaleFlow; st: SaleFlowState; s: SaleSetup }) {
  const d = s.control.live_deal;
  const [revising, setRevising] = useState(false);
  if (!d || d.state === "closing" || s.open.length > 0) return null;
  const items: { kind: SaleKind; label: string }[] = [];
  if (s.roles.buyer && d.escrow !== "0")
    items.push({ kind: "unfund", label: "Withdraw your escrow (undoes your acceptance)" });
  if (s.roles.buyer || s.roles.seller)
    items.push({ kind: "cancel", label: "Cancel the sale (ends it for both sides)" });
  return (
    <section className="card quiet" aria-label="Other actions">
      <h2 className="sale-h3">Other actions</h2>
      <div className="row">
        {s.roles.seller && (
          <button
            type="button"
            className="btn btn-secondary"
            aria-expanded={revising}
            onClick={() => setRevising((x) => !x)}
          >
            Revise the terms
          </button>
        )}
        {items.map((i) => (
          <button
            key={i.kind}
            type="button"
            className="btn btn-secondary"
            disabled={st.busy !== null}
            data-focus={`other-${i.kind}`}
            onClick={() => void flow.review(i.kind, {}, null, `other-${i.kind}`)}
          >
            {i.label}
          </button>
        ))}
      </div>
      {revising && <TermsForm flow={flow} st={st} s={s} revise />}
    </section>
  );
}

function ShiftItem({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: ReactNode;
}) {
  return (
    <li className="sale-shift-item">
      <span aria-hidden="true" className={done ? "sale-shift-done" : "sale-shift-open"}>
        {done ? "✓" : "○"}
      </span>
      <span>
        <strong>{label}</strong>
        <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        {children && <span className="muted"> · {children}</span>}
      </span>
    </li>
  );
}

/** The judge rehearsal: the new owner's first shift after a close, each item read now. */
function FirstShift({ s, chain }: { s: SaleSetup; chain: string }) {
  if (!s.roles.new_owner || s.control.live_deal) return null;
  const ops = s.control.operators.filter((o) => o.generation === s.control.generation);
  const kept = ops.filter((o) => o.account !== s.platform_operator);
  return (
    <section className="card" aria-labelledby="sale-shift-t">
      <h2 id="sale-shift-t" className="sale-h3">
        Your first shift
      </h2>
      <ul className="sale-shift">
        <ShiftItem done label={`You control ${s.business.name} on ${chain}`}>
          generation {s.control.generation}
        </ShiftItem>
        <ShiftItem done={s.metering_appointed} label="Customers' new uses can run">
          {s.metering_appointed ? "metering appointed" : "appoint metering (the button above)"}
        </ShiftItem>
        {s.customer_obligations && (
          <ShiftItem done label="Customers who paid before the sale keep their units">
            <Amount base={s.customer_obligations.prepaid_unused} s={s} /> unused
          </ShiftItem>
        )}
        <ShiftItem done={kept.length === 0} label="Your team">
          {kept.length === 0
            ? "no operator kept from before"
            : `kept: ${kept.map((o) => `${o.account}${sellerMark(o.account, s.outcomes.find((x) => x.buyer === s.account)?.seller)}`).join(", ")}`}
        </ShiftItem>
      </ul>
      <Link to={`/desk/${s.business.id}`}>Customer requests and your desk</Link>
    </section>
  );
}

/**
 * The judge rehearsal: a former seller tries an owner action with their own wallet, and the
 * contract's own answer is shown (its error code and transaction).
 */
function FormerOwnerCheck({ flow, st, s }: { flow: SaleFlow; st: SaleFlowState; s: SaleSetup }) {
  if (!s.roles.former_seller || st.review) return null;
  const last = s.actions.find(
    (a) => a.kind === "owner_probe" && (a.state === "refused" || a.state === "confirmed"),
  );
  const ev = last?.evidence;
  return (
    <section className="card quiet" aria-labelledby="sale-probe-t">
      <h2 id="sale-probe-t" className="sale-h3">
        Your access after the sale
      </h2>
      {last && ev?.kind === "refused" && (
        <p>
          Refused by the contract: <code>{ev.reason}</code>
          {last.tx_hash && (
            <>
              {" "}
              · <TxId hash={last.tx_hash} />
            </>
          )}
        </p>
      )}
      {last && ev?.kind === "confirmed" && <p className="error-text">{ev.message}</p>}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={st.busy !== null || s.open.length > 0}
        data-focus="probe"
        onClick={() => void flow.review("owner_probe", {}, null, "probe")}
      >
        {last ? "Try again" : "Try an owner action"}
      </button>
    </section>
  );
}

/**
 * Read-only recovery for a request that can no longer take effect (Astra's browser review): its
 * own transaction ID, or a fresh check. Nothing is ever sent again from here, and it blocks
 * nothing else on the page.
 */
function HistoryRecovery({ flow, st, a }: { flow: SaleFlow; st: SaleFlowState; a: SaleAction }) {
  const [tx, setTx] = useState("");
  return (
    <form
      className="sale-recover"
      onSubmit={(e) => {
        e.preventDefault();
        void flow.checkWithTransaction(a.id, tx);
      }}
    >
      <label className="field">
        <span>Its transaction ID from your wallet's activity</span>
        <input
          className="input mono"
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <small>
          Read-only: this checks that one transaction and records it only if it is exactly this
          request. Nothing is sent.
        </small>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-secondary" disabled={st.busy !== null}>
          Check with this ID
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={st.busy !== null}
          onClick={() => void flow.checkOpen(a.id)}
        >
          Check again
        </button>
      </div>
    </form>
  );
}

function History({ flow, st, s }: { flow: SaleFlow; st: SaleFlowState; s: SaleSetup }) {
  if (s.actions.length === 0) return null;
  return (
    <section className="card quiet" aria-labelledby="sale-hist">
      <h2 id="sale-hist" className="sale-h3">
        Your wallet requests here
      </h2>
      <ul className="sale-history">
        {s.actions.map((a) => (
          <li key={a.id}>
            <strong>{KIND_LABEL[a.kind]}</strong> · {STATE_LABEL[a.state]}
            {a.evidence?.kind === "confirmed" && <span> · {a.evidence.result}</span>}
            {a.state !== "prepared" &&
              a.state !== "set_aside" &&
              (st.answers[a.id]?.resolution ?? a.evidence) && (
                <div className="muted">{(st.answers[a.id]?.resolution ?? a.evidence)?.message}</div>
              )}
            {a.state === "no_longer_possible" && <HistoryRecovery flow={flow} st={st} a={a} />}
            {a.tx_hash && (
              <div className="mono wrap muted" style={{ fontSize: 12 }}>
                {a.tx_hash}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SaleRoom({ id }: { id: string }) {
  const { account, walletBoundary, person, wallet } = useSession();
  const [flow, setFlow] = useState<SaleFlow | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one controller per business and account
  useEffect(() => {
    if (!account) return;
    const f = new SaleFlow(saleHttp, walletBoundary, { businessId: id, account });
    setFlow(f);
    void f.load();
    return () => {
      f.retire();
      setFlow((cur) => (cur === f ? null : cur));
    };
  }, [id, account]);
  const st = useSyncExternalStore(
    (fn) => (flow ? flow.subscribe(fn) : () => {}),
    () => (flow ? flow.getState() : EMPTY),
    () => EMPTY,
  );
  const [showTerms, setShowTerms] = useState(false);
  const router = useRouter();
  // Job 003wf3 (Astra 02:23): a handover in progress is followed while this page is open
  // (bounded; read-only; the controller's retirement on a route or account change ends it).
  const following = handoverInProgress(st.setup);
  useEffect(() => {
    if (flow && following) flow.watchHandover();
  }, [flow, following]);
  // After a review is set aside, focus returns to the control it was opened from.
  useEffect(() => {
    if (!flow || !st.focus || st.review) return;
    const el = document.querySelector<HTMLElement>(`[data-focus="${st.focus}"]`);
    if (el) {
      el.focus();
      flow.focused();
    }
  });

  if (!person || !account)
    return (
      <div className="page empty">
        <h2>Sign in with your NEAR account to see this sale.</h2>
      </div>
    );
  if (!flow || st.status === "loading")
    return (
      <div className="page muted" role="status">
        Reading the contract…
      </div>
    );
  const s = st.setup;
  if (st.status === "error" || !s)
    return (
      <div className="page empty" role="alert">
        <h2>This sale couldn't be shown</h2>
        <p>{st.notice?.text}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void flow.load()}>
          Try again
        </button>
        <p>
          <Link to="/handovers">Your handovers</Link>
        </p>
      </div>
    );
  const next = saleNext(st);
  const run = () => {
    switch (next.action) {
      case "check":
        return void flow.checkOpen(next.id);
      case "continue":
        return void flow.continuePrepared(next.id);
      case "retry":
        return void flow.load();
      case "apply":
        return void flow.apply(next.intent);
      case "terms":
        return setShowTerms(true);
      case "operate":
        return router.go(next.href);
      case "none":
        return undefined;
      default:
        return void flow.review(next.action, next.input ?? {}, null, "next");
    }
  };
  const status =
    st.busy === "wallet"
      ? "Waiting for your wallet… approve or close it there."
      : st.busy === "storing"
        ? "Storing the request you reviewed…"
        : st.busy === "checking"
          ? "Checking this request's own transaction…"
          : st.busy === "reviewing"
            ? "Preparing the exact request…"
            : null;
  return (
    <div className="page handover sale-workspace sale-room">
      <div className="row" style={{ marginBottom: 4 }}>
        {s.local_owner ? (
          <Link to={`/desk/${id}`} className="muted">
            Business desk
          </Link>
        ) : (
          <Link to="/handovers" className="muted">
            Your handovers
          </Link>
        )}
      </div>
      <header className="sale-head">
        <div className="eyebrow">
          Business sale · business contract on {chainWords(wallet, s.network)} · you are{" "}
          {saleRoleWords(s)}
        </div>
        <div className="sale-title-row">
          <h1 className="display sale-title">{s.business.name}</h1>
          {next.action !== "none" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={st.busy !== null}
              data-focus="next"
              onClick={run}
            >
              {next.label}
            </button>
          )}
        </div>
        <p className="sale-state" role="status">
          {saleSentence(s)}
        </p>
        {next.action === "none" && <p className="muted">{next.why}</p>}
        {next.action === "operate" && s.roles.seller && !s.control.live_deal && !showTerms && (
          <p>
            <button type="button" className="btn btn-secondary" onClick={() => setShowTerms(true)}>
              Propose a resale
            </button>
          </p>
        )}
        <p aria-live="polite" className={st.notice?.tone === "warn" ? "error-text" : "muted"}>
          {status ?? st.notice?.text ?? ""}
        </p>
      </header>
      <ol className="sale-steps" aria-label="Where the sale stands">
        {saleSteps(s).map((x) => (
          <li
            key={x.key}
            className={`sale-step is-${x.status === "done" ? "completed" : x.status}`}
          >
            <span className="sale-step-status">{STEP_WORD[x.status]}</span>
            <strong className="sale-step-title">{x.title}</strong>
            {x.detail && <span className="sale-step-detail">{x.detail}</span>}
          </li>
        ))}
      </ol>
      <div className="sale-grid">
        <div className="sale-main">
          <Review flow={flow} st={st} s={s} />
          {!st.review && <FirstShift s={s} chain={chainWords(wallet, s.network)} />}
          {s.handover && (
            <HandoverPanel
              s={s}
              checkedMs={st.handoverCheckedMs ?? null}
              onCheck={handoverInProgress(s) ? () => void flow.checkHandover() : undefined}
              checking={st.busy === "reading"}
              blocked={Boolean(st.review) || (st.busy !== null && st.busy !== "reading")}
            />
          )}
          {flow.resumableId && (
            <section className="card" aria-label="A request your wallet wasn't asked for yet">
              <p>
                Your wallet changed accounts before it was asked, so nothing was sent. Switch it
                back, then:
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={st.busy !== null}
                onClick={() => void flow.resume()}
              >
                Ask my wallet for this request
              </button>
            </section>
          )}
          {s.open.map((a) => (
            <OpenRequest key={a.id} flow={flow} st={st} a={a} />
          ))}
          {(showTerms || next.action === "terms") &&
            !st.review &&
            s.roles.seller &&
            !s.control.live_deal && <TermsForm flow={flow} st={st} s={s} revise={false} />}
          <LiveTerms s={s} />
          <OtherActions flow={flow} st={st} s={s} />
          <FormerOwnerCheck flow={flow} st={st} s={s} />
          <History flow={flow} st={st} s={s} />
        </div>
        <Continuity s={s} />
      </div>
    </div>
  );
}

export type { SalePreview };
