// Job 003q: a customer's workspace for one released digital product. Everything here comes from
// the real customer-use API through CustomerWorkspace (customerWorkspace.ts): the document stays
// in memory, the browser checks a request itself before any authorization, and units are shown
// only as the contract's views reported them, with their block and time.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { customerHttp, type OfferView, type ResultView, type UseView } from "../customerApi.ts";
import { type CustomerAuthorizer, pageAuthorizer } from "../customerAuthorizer.ts";
import {
  activeCustomerStep,
  CUSTOMER_STEP_WORD,
  type CustomerStep,
  customerSteps,
  endedNeutrally,
  sentWord,
  WONT_RUN_RESULT,
  wontRun,
} from "../customerView.ts";
import {
  type Action,
  CustomerWorkspace,
  nextStep,
  type WorkspaceState,
} from "../customerWorkspace.ts";
import type { Readiness } from "../deviceKey.ts";
import { tokenAmount } from "../purchase.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { TokenAmount } from "../TokenAmount.tsx";
import { canonicalSubmission } from "../workflowApi.ts";
import { DeviceKeyPanel } from "./DeviceKeyPanel.tsx";
import { PurchasePanel } from "./PurchasePanel.tsx";
import { CustomerCaseTrack } from "./WorkflowCaseBoard.tsx";

const UNIT_WORDS: Record<UseView["units"]["unit"], { label: string; tone: string; text: string }> =
  {
    not_held: {
      label: "Nothing held",
      tone: "",
      text: "No unit is reserved for this request. Nothing is held until you authorize one use and the contract confirms it.",
    },
    reservation_pending: {
      label: "Reservation pending",
      tone: "blue",
      text: "Your authorization was sent. Waiting for the contract to show whether one unit is held.",
    },
    reserved_awaiting_settlement: {
      label: "One unit reserved",
      tone: "blue",
      text: "Held for this use. It's charged only if you get a result; otherwise it comes back.",
    },
    charge_pending: {
      label: "Charging one unit",
      tone: "blue",
      text: "Waiting for the contract to confirm the charge.",
    },
    release_pending: {
      label: "Returning your unit",
      tone: "blue",
      text: "Waiting for the contract to confirm the return.",
    },
    charged: {
      label: "One unit used",
      tone: "mint",
      text: "The contract shows this use charged exactly one unit.",
    },
    returned: {
      label: "Unit returned",
      tone: "mint",
      text: "The contract shows the unit back with you; nothing was charged.",
    },
    conflict: {
      label: "Needs checking",
      tone: "caution",
      text: "The contract's records disagree. Nothing is charged or returned on a guess.",
    },
    unknown: {
      label: "Not known yet",
      tone: "caution",
      text: "The contract's records can't show what happened to this unit yet. Nothing is charged or refunded on a guess.",
    },
  };

const time = (ms: string) => new Date(Number(ms)).toLocaleString();

/** 006a: what a customer sends for an access pass: nothing of theirs, one fixed request. */
export const PASS_REQUEST = "Access pass";

function Consent({
  use,
  check,
}: {
  use: UseView;
  check: { ok: boolean; problem: string | null } | null;
}) {
  const e = use.envelope;
  const t = use.offer.terms;
  return (
    <div className="use-consent">
      <h3>What you'd authorize</h3>
      <dl className="use-terms">
        <dt>Product</dt>
        <dd>
          {use.offer.product.name} · <span className="muted">{use.offer.business.name}</span>
        </dd>
        <dt>Your {sentWord(use.offer.product.kind)}</dt>
        <dd>
          {use.input.chars.toLocaleString()} characters, bound to this request by its fingerprint
          (under Technical details)
        </dd>
        <dt>Units</dt>
        <dd>Exactly one, charged only if you get a result</dd>
        <dt>Price of one unit</dt>
        <dd>
          <TokenAmount base={t.unit_price} asset={t.asset} token={t.token} />
        </dd>
        <dt>Result kept for</dt>
        <dd>
          {t.retention_days} days, readable only by you here
          <div className="muted use-note">
            How long this product keeps your result for you to open. It isn't a statement about
            copies kept by any service it uses.
          </div>
        </dd>
        <dt>Account</dt>
        <dd className="mono">
          {use.reservation.customer_account} on {t.network}
        </dd>
        {e && (
          <>
            <dt>Authorize by</dt>
            <dd>{time(e.consent.sign_by_ms)}</dd>
          </>
        )}
      </dl>
      {check && (
        <p className={`use-check ${check.ok ? "ok" : "bad"}`}>
          {check.ok
            ? `Checked by your browser: every byte you'd authorize matches these details and your ${sentWord(use.offer.product.kind)}.`
            : check.problem}
        </p>
      )}
      <details className="advanced use-tech">
        <summary>Technical details</summary>
        <dl className="use-terms">
          <dt>Document fingerprint</dt>
          <dd className="mono">sha256 {use.input.sha256}</dd>
          <dt>Contract</dt>
          <dd className="mono">{t.contract}</dd>
          <dt>Hold number</dt>
          <dd className="mono">{use.reservation.hold_seq}</dd>
          <dt>Served until</dt>
          <dd>{time(use.reservation.serve_until_ms)}</dd>
          <dt>Settled by</dt>
          <dd>{time(use.reservation.settle_until_ms)}</dd>
        </dl>
      </details>
    </div>
  );
}

export function CustomerResult({
  r,
  workflow = false,
  analysis = false,
  pass = false,
}: {
  r: ResultView;
  workflow?: boolean;
  analysis?: boolean;
  pass?: boolean;
}) {
  const res = r.result;
  // 006a: an access pass: the app's private address, until the pass ends.
  if (pass || res.outcome === "granted") return <PassAnswer r={r} />;
  // The analysis engine: flags, each quoting what the customer submitted.
  if (analysis || res.outcome === "analyzed") return <AnalysisAnswer r={r} />;
  // The workflow engine: a request is accepted into the first stage, or refused (never charged).
  if (workflow || res.outcome === "accepted") return <WorkflowAnswer r={r} />;
  const json = JSON.stringify(res, null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "result.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const complete = res.outcome === "extracted";
  return (
    <div className={`use-answer ${complete ? "is-complete" : "is-partial"}`}>
      {!complete && (
        <p className="use-answer-warning" role="note">
          <strong>Not a complete extraction.</strong>{" "}
          {res.missing.length > 0
            ? `Missing: ${res.missing.map((k) => res.fields.find((f) => f.key === k)?.label ?? k).join(", ")}. `
            : "The product couldn't read every required field. "}
          Don't rely on it without checking your document.
        </p>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${complete ? "mint" : "caution"}`}>
          {complete
            ? "Every required field found"
            : res.outcome === "incomplete"
              ? "Some fields missing"
              : res.outcome === "refused"
                ? "Not this kind of document"
                : "Not a usable answer"}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => navigator.clipboard?.writeText(json)}
        >
          Copy JSON
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={download}>
          Download
        </button>
      </div>
      {res.fields.length > 0 && (
        <table className="use-fields">
          <tbody>
            {res.fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td>
                  {f.value === null ? (
                    <span className="muted">Not stated{f.required ? " (required)" : ""}</span>
                  ) : (
                    String(f.value)
                  )}
                  {f.note && <div className="muted use-note">{f.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {res.reason && <p className="notice info">{res.reason}</p>}
      {res.issues.length > 0 && (
        <div className="use-issues">
          <h3>Noticed in your document</h3>
          <ul>
            {res.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
      {res.problems.length > 0 && (
        <div className="use-issues">
          <h3>Why it isn't usable</h3>
          <ul>
            {res.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted use-note">
        Kept for you until {time(r.retention_until_ms)}. A checked answer isn't a guarantee: compare
        it with your document.
      </p>
    </div>
  );
}

/** 006a: a granted access pass (or why none was granted; never charged then). */
function PassAnswer({ r }: { r: ResultView }) {
  const p = r.result.pass;
  if (!p)
    return (
      <div className="use-answer is-partial">
        <p className="notice info">
          {r.result.reason ?? "No pass was granted."} Nothing is charged for it.
        </p>
      </div>
    );
  const ended = Date.parse(p.expires_at) <= Date.now();
  return (
    <div className={`use-answer ${ended ? "is-partial" : "is-complete"}`}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${ended ? "" : "mint"}`}>
          {ended ? "Pass ended" : `${p.pass_days}-day pass`}
        </span>
      </div>
      <dl className="use-consent-list">
        <dt>Started</dt>
        <dd>{new Date(p.starts_at).toLocaleString()}</dd>
        <dt>{ended ? "Ended" : "Open until"}</dt>
        <dd>{new Date(p.expires_at).toLocaleString()}</dd>
      </dl>
      {!ended && (
        <p>
          <a className="btn btn-primary" href={p.url} target="_blank" rel="noopener noreferrer">
            Open the app
          </a>
        </p>
      )}
      <p className="muted use-note">
        This address is private to you: anyone with it can open the app until the pass ends, so
        don't share it. It keeps the version you bought, even if the business changes the app. Kept
        for you until {time(r.retention_until_ms)}.
      </p>
    </div>
  );
}

/** The analysis engine's answer: flags with their quotes, reasons and proposed actions. */
function AnalysisAnswer({ r }: { r: ResultView }) {
  const res = r.result;
  if (res.outcome !== "analyzed")
    return (
      <div className="use-answer is-partial">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="pill caution">Not analyzed</span>
        </div>
        <p className="notice info">
          {res.outcome === "refused"
            ? `${res.reason ?? "This isn't the kind of text this service reviews"}.`
            : "The answer failed Everstreet's checks, so nothing from it is shown."}{" "}
          Nothing is charged for it.
        </p>
      </div>
    );
  return (
    <div className="use-answer is-complete">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill mint">
          {res.findings.length === 0
            ? "Nothing flagged"
            : `${res.findings.length} flag${res.findings.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {res.summary && <p>{res.summary}</p>}
      {res.findings.map((f) => (
        <div key={f.evidence} className="an-flag">
          <div className="row">
            <strong>{f.title}</strong>
            <span className={`pill ${f.severity === "high" ? "caution" : ""}`}>
              {f.severity} severity
            </span>
          </div>
          <blockquote className="an-quote">{f.evidence}</blockquote>
          <p>{f.why}</p>
          <p>
            <strong>Proposed next step:</strong> {f.proposed_action}
          </p>
        </div>
      ))}
      <p className="muted use-note">
        Proposals only: nothing was sent, changed or scheduled for you. Every quote is checked word
        for word against what you submitted. Kept for you until {time(r.retention_until_ms)}.
      </p>
    </div>
  );
}

/** The workflow engine's answer: what was received, or why the request wasn't accepted. */
function WorkflowAnswer({ r }: { r: ResultView }) {
  const res = r.result;
  const ok = res.outcome === "accepted";
  return (
    <div className={`use-answer ${ok ? "is-complete" : "is-partial"}`}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${ok ? "mint" : "caution"}`}>
          {ok ? "Request received" : "Not accepted"}
        </span>
      </div>
      {ok ? (
        <table className="use-fields">
          <tbody>
            {res.fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {String(f.value ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="notice info">
          {res.reason} Nothing is charged for it; you can send a corrected request.
        </p>
      )}
      <p className="muted use-note">Kept for you until {time(r.retention_until_ms)}.</p>
    </div>
  );
}

/** A workflow product's request form. The browser checks each field before anything is sent. */
function WorkflowForm({
  fields,
  values,
  onChange,
}: {
  fields: OfferView["product"]["fields"];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div className="wf-form">
      {fields.map((f) => {
        const id = `wf-${f.key}`;
        const v = values[f.key] ?? "";
        const set = (x: string) => onChange({ ...values, [f.key]: x });
        return (
          <label className="field" key={f.key} htmlFor={id}>
            <span>
              {f.label}
              {f.required && <span className="muted"> (required)</span>}
            </span>
            {f.type === "choice" ? (
              <select id={id} className="input" value={v} onChange={(e) => set(e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === "long_text" ? (
              <textarea
                id={id}
                className="input"
                rows={5}
                value={v}
                maxLength={f.max_chars}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <input
                id={id}
                className="input"
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={v}
                maxLength={f.max_chars}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

/**
 * The active step card's heading: the request's own headline. 001j1 (Astra's recovery review):
 * while a lost answer is in doubt that headline is from before it, so it is shown only as the
 * last reading, never as the current instruction.
 */
export function StepHeading({ s }: { s: WorkspaceState }) {
  const use = s.use;
  if (use && s.inDoubt?.useId === use.id)
    return (
      <>
        <h2 id="use-compose-title">Check this request</h2>
        <p className="muted">
          Your last request didn't get an answer, so what it did isn't known here yet. As last read
          before it: {use.headline.title.toLowerCase()}.
        </p>
      </>
    );
  return (
    <>
      <h2 id="use-compose-title">
        {use
          ? use.headline.title
          : s.unanswered
            ? "Request not answered"
            : s.offer && s.offer.product.kind !== "extraction"
              ? "Your request"
              : "Your document"}
      </h2>
      {use && <p className="muted">{use.headline.detail}</p>}
    </>
  );
}

export function ResultArea({
  use,
  result,
  fields,
  inDoubt = false,
  workflow = false,
  analysis = false,
  pass = false,
}: {
  use: UseView | null;
  result: ResultView | null;
  fields: string[];
  inDoubt?: boolean;
  workflow?: boolean;
  analysis?: boolean;
  pass?: boolean;
}) {
  if (result)
    return <CustomerResult r={result} workflow={workflow} analysis={analysis} pass={pass} />;
  // 001j1: no instruction from the stale state while a lost answer is in doubt.
  if (inDoubt)
    return (
      <p className="use-placeholder">
        Not known until this request is checked: it may already have a result.
      </p>
    );
  const x = use?.execution;
  // Astra 02:43: a use that won't run (its unit returned or returning, or the request ended)
  // never invites a run or promises a result.
  const ended = wontRun(use);
  if (ended)
    return (
      <p className={`use-placeholder ${endedNeutrally(use) ? "is-ended" : "is-stopped"}`}>
        {WONT_RUN_RESULT[ended]}
      </p>
    );
  // Job 001j: nothing has run: a compact placeholder that says what will appear, not a tall blank.
  if (!x)
    return (
      <p className="use-placeholder">
        {use?.state === "reserved" ? "Reserved. Run it when you're ready." : "Nothing has run yet."}
        {fields.length > 0 && <> You'll get: {fields.join(", ")}.</>}
      </p>
    );
  const stopped = x.state !== "running" && x.result !== "available" && x.result !== "pending";
  const text =
    x.state === "running"
      ? `Running on your ${sentWord(use?.offer.product.kind)}…`
      : x.result === "available"
        ? "Your result is ready. Show it when you like: only you can read it."
        : x.result === "pending"
          ? "Your result is being saved privately."
          : x.result === "expired"
            ? "This result was kept for its retention time and has been removed."
            : x.state === "unknown"
              ? "We can't tell whether this run finished. It is never run again automatically, and it isn't charged."
              : x.state === "cancelled"
                ? "Cancelled. Nothing is charged for it."
                : "This run didn't produce a result you can use. It isn't charged.";
  return <p className={`use-placeholder${stopped ? " is-stopped" : ""}`}>{text}</p>;
}

/**
 * The active step's controls: the one next action, and the secondary choices the state allows.
 * 001j1: while an answer for this request was lost, only "Check what happened" is offered: no
 * cancel or return based on the state from before it.
 */
export function StepActions({
  s,
  onAction,
}: {
  s: WorkspaceState;
  onAction: (a: Action | null) => void;
}) {
  const next = nextStep(s);
  const use = s.use;
  const busy = s.busy !== null;
  const settled = next.action !== "check_request";
  return (
    <>
      <div className="use-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={busy || next.action === null || (next.action === "prepare" && !s.draft.trim())}
          onClick={() => onAction(next.action)}
        >
          {busy ? "Working…" : next.label}
        </button>
        {settled && use?.state === "prepared" && next.action !== "cancel" && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => onAction("cancel")}
          >
            Cancel this request
          </button>
        )}
        {settled &&
          use?.state === "reserved" &&
          !use.execution &&
          use.units.unit === "reserved_awaiting_settlement" && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => onAction("release")}
            >
              Don't run it: return my unit
            </button>
          )}
      </div>
      <p className="muted use-why">{next.why}</p>
    </>
  );
}

/** Job 001j: the use's steps, each status a word (never colour alone). */
export function CustomerProgress({
  steps,
  active,
}: {
  steps: CustomerStep[];
  active: CustomerStep["key"];
}) {
  return (
    <ol className="use-steps" aria-label="Where this use stands">
      {steps.map((st) => (
        <li
          key={st.key}
          className={`use-step is-${st.status}`}
          aria-current={st.key === active ? "step" : undefined}
        >
          <span className="use-step-status">{CUSTOMER_STEP_WORD[st.status]}</span>
          <strong className="use-step-title">{st.title}</strong>
          <span className="use-step-detail">{st.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function CustomerProduct({ offerId, useId }: { offerId?: string; useId?: string }) {
  const { person, requireSignIn, identity } = useSession();
  const { go } = useRouter();
  // Job 003w-e2: in verified mode the authorizer is this device's enrolled key (DeviceKeyPanel),
  // only while the contract shows it ready; the preview keeps its labelled synthetic one.
  const device = useRef<CustomerAuthorizer | null>(null);
  // Job 003wea (Astra's WalletBrowserRepeat: "Loading…" after the first sign-in). The workspace's
  // lifetime belongs to WHO is acting and WHAT is open, as strings: the person's id, the offer or
  // use, and the identity mode. A session refresh for the same person hands over a new person
  // OBJECT; that must change nothing (the typed draft, the request and the device readiness stay).
  // Before, the effect depended on the object, so such a refresh retired the one workspace for
  // good and then "started" it again (a retired workspace ignores everything): stuck on Loading,
  // or dead to typing. Each effect run now owns its own workspace (so StrictMode's dev re-run is
  // fine too), and a real identity change retires the old one (the page is also keyed by person).
  const personId = person?.id ?? null;
  const [readKey, setReadKey] = useState(0);
  // Job 003web (Astra's PurchaseBrowserReview 4): what the contract last showed about this device,
  // for where getting ready sits on the page. Unknown (null) until the device panel has read it.
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const setupNeeded = readiness !== null && readiness.kind !== "ready";
  // Shown while anything is needed or still unknown. Once this device is ready it is folded unless
  // the person opens it, except that a section that was needed in this view stays open (nothing
  // folds away under the person's eyes when the device becomes ready).
  const [wasNeeded, setWasNeeded] = useState(false);
  useEffect(() => {
    if (setupNeeded) setWasNeeded(true);
  }, [setupNeeded]);
  const setupShown = setupNeeded || wasNeeded || readiness === null || setupOpen === true;
  // A different person or offer starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per person and offer
  useEffect(() => {
    setReadiness(null);
    setSetupOpen(null);
    setWasNeeded(false);
  }, [personId, offerId]);
  const [token, setToken] = useState<{ symbol: string; decimals: number } | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [w, setW] = useState<CustomerWorkspace | null>(null);
  useEffect(() => {
    if (!personId) return;
    const ws = new CustomerWorkspace(customerHttp, {
      personId,
      offerId,
      useId,
      authorizer: identity === "verified" ? () => device.current : pageAuthorizer,
      storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
    });
    setW(ws);
    void ws.start();
    return () => {
      ws.retire();
      setW((cur) => (cur === ws ? null : cur));
    };
  }, [personId, offerId, useId, identity]);
  const subscribe = useCallback((fn: () => void) => (w ? w.subscribe(fn) : () => {}), [w]);
  const snapshot = useCallback(() => (w ? w.getState() : null), [w]);
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  // Stable per workspace, so the device panel's effects don't re-run on every page update.
  const onAuthorizer = useCallback(
    (a: CustomerAuthorizer | null) => {
      device.current = a;
      w?.refreshAuthorizer();
    },
    [w],
  );

  // 006a: a pass request is fixed; it is the draft as soon as the offer is known.
  const passOffer = s?.offer?.product.kind === "web_app";
  const draft = s?.draft;
  useEffect(() => {
    if (w && passOffer && draft !== PASS_REQUEST) w.setDraft(PASS_REQUEST);
  }, [w, passOffer, draft]);

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to use this product</h2>
        <p>What you send and the results are private to you.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to use this product.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!w || !s || s.status === "loading")
    return (
      <div className="page muted" role="status">
        Loading…
      </div>
    );
  if (s.status === "gone" || s.status === "error")
    return (
      <div className="page empty" role="status">
        <h2>{s.status === "gone" ? "Not available" : "Couldn't load this"}</h2>
        <p>{s.notice?.message ?? "This product isn't offered here."}</p>
        <Link to="/activity">My activity</Link>
      </div>
    );

  const offer = s.offer;
  const use = s.use;
  const run = (a: Action | null) => {
    if (!a) return;
    if (a === "start_another") {
      w.startAnother();
      if (useId && offer) go(`/use/${offer.offer_id}`);
      return;
    }
    const map: Record<Exclude<Action, "start_another">, () => unknown> = {
      prepare: () => w.prepare(),
      recover_original: () => w.recoverOriginal(),
      match_document: () => w.matchDocument(),
      authorize: () => w.authorize(),
      check_reservation: () => w.checkReservation(),
      run: () => w.run(),
      show_result: () => w.showResult(),
      check_unit: () => w.checkUnit(),
      release: () => w.release(),
      cancel: () => w.cancel(),
      refresh: () => w.refresh(),
      check_request: () => w.checkRequest(),
    };
    void map[a]();
  };
  const unit = use ? UNIT_WORDS[use.units.unit] : null;
  const needsDocument = !use || (use.state === "prepared" && s.accepted === null);
  const max = offer?.product.max_chars ?? 0;
  const isWorkflow = offer?.product.kind === "workflow";
  const isAnalysis = offer?.product.kind === "analysis";
  const isPass = offer?.product.kind === "web_app";
  const app = offer?.product.app ?? null;
  const isForm = isWorkflow || isAnalysis;
  const fields = isForm ? [] : (offer?.product.fields.map((f) => f.label) ?? []);
  const formFields = offer?.product.fields ?? [];
  // A workflow's form: the draft is the canonical submission once every required field is filled
  // (until then there is nothing to send).
  const setForm = (v: Record<string, string>) => {
    setFormValues(v);
    const complete = formFields.every((f) => !f.required || (v[f.key] ?? "").trim() !== "");
    w.setDraft(complete ? canonicalSubmission(v) : "");
  };
  // Job 001j: one resolution of where this use stands, for the step strip and the page's emphasis.
  const steps = customerSteps(s);
  const active = activeCustomerStep(s);

  return (
    <div className="page use-page">
      <header className="use-head">
        {offer && (
          <div className="eyebrow">
            <Link to={`/b/${offer.business.slug}`}>{offer.business.name}</Link>
          </div>
        )}
        <h1 className="display">{offer?.product.name ?? "Product"}</h1>
        {offer && (
          <dl className="use-offer-summary">
            <div>
              <dt>You give it</dt>
              <dd>
                {isPass
                  ? "Nothing of yours: one unit starts your pass"
                  : isForm
                    ? `A request: ${formFields.map((f) => f.label).join(", ")}`
                    : `Pasted text, up to ${offer.product.max_chars.toLocaleString()} characters`}
              </dd>
            </div>
            <div>
              <dt>You get</dt>
              <dd>
                {isPass && app
                  ? `${app.pass_days} days of access to the app, at a private address. Charged when access starts.`
                  : isAnalysis
                    ? `${offer.product.result_title ?? "Flags"}: up to 8, each quoting your text, with why it matters and a proposed next step`
                    : isWorkflow
                      ? `A tracked request: ${offer.product.stages.map((st) => st.label).join(" → ")}`
                      : fields.length > 0
                        ? fields.join(", ")
                        : "Structured fields"}
              </dd>
            </div>
            <div>
              <dt>Each use</dt>
              <dd>
                {/* Job 003web: in token terms once the token's VALIDATED metadata is read (the
                    purchase panel); until then the exact base units, never a guessed scale. */}
                {token ? (
                  <>
                    One unit:{" "}
                    <strong>
                      {tokenAmount(offer.terms.unit_price, token.decimals)} {token.symbol}
                    </strong>
                  </>
                ) : (
                  <>
                    One unit:{" "}
                    <TokenAmount
                      base={offer.terms.unit_price}
                      asset={offer.terms.asset}
                      token={offer.terms.token}
                    />
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Your results</dt>
              <dd>
                Kept {offer.terms.retention_days} days, for you only
                {offer.offer_state === "retired" && " · no longer offered for new uses"}
              </dd>
            </div>
          </dl>
        )}
        {app && (
          <div className="use-app-terms" role="note">
            <p>
              <strong>What this app is.</strong> {app.platform_limitations} A pass grants access to
              the app; it isn't a service result.
              {app.limitations && <> {app.limitations}</>}
            </p>
            {app.stand_in && (
              <p className="notice">
                Stand-in release: its logic checks ran on a test double, not an isolated worker.
              </p>
            )}
          </div>
        )}
      </header>

      <CustomerProgress steps={steps} active={active} />

      {identity === "verified" && offer && (
        // Getting ready to use the product (buy uses, enroll this device) is the first step for a
        // new customer, so it comes before the workspace, full width: the document can be
        // written meanwhile and is kept. The panels stay mounted in one place whatever the
        // section shows (a wallet request in progress is never torn down by a re-layout).
        <section className="use-setup" aria-labelledby="use-setup-title">
          <div className="row">
            <h2 id="use-setup-title">
              {readiness?.kind === "ready" ? "Your uses and this device" : "Before your first use"}
            </h2>
            <span className="spacer" />
            {!(setupNeeded || wasNeeded) && readiness !== null && (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                aria-expanded={setupShown}
                aria-controls="use-setup-panels"
                onClick={() => setSetupOpen(!setupShown)}
              >
                {setupShown ? "Hide" : "Show"}
              </button>
            )}
          </div>
          <p className="muted use-setup-why">
            {readiness?.kind === "ready"
              ? "This device is enrolled. Buy more uses or manage its key here."
              : "Buy uses with your own wallet, then enroll this device so it can authorize one use at a time. You can fill in what you'll send below meanwhile; it's kept on this page."}
          </p>
          {/* Hidden, never unmounted: a wallet request in progress isn't torn down. */}
          <div id="use-setup-panels" className="use-setup-panels" hidden={!setupShown}>
            <PurchasePanel
              offerId={offer.offer_id}
              onChanged={() => setReadKey((k) => k + 1)}
              onToken={setToken}
              unitKey={use ? `${use.id}:${use.units.unit}` : null}
            />
            <DeviceKeyPanel
              offerId={offer.offer_id}
              onAuthorizer={onAuthorizer}
              onReadiness={setReadiness}
              refresh={readKey}
            />
          </div>
        </section>
      )}

      <div className="use-grid">
        <section className="card use-compose" aria-labelledby="use-compose-title">
          <StepHeading s={s} />
          {!use && s.unanswered && (
            <p className="notice info" role="note">
              Your request for a {s.unanswered.chars.toLocaleString()}-character document was sent,
              but no answer came back. Recover it first: it's the same request, so nothing is made
              twice. Your typed text below is kept.
            </p>
          )}
          {needsDocument && isPass && (
            <p className="muted">
              {use
                ? "This is the same pass request: check it before authorizing."
                : "Review one use to see exactly what you'd authorize. Nothing of yours is sent."}
            </p>
          )}
          {needsDocument && isForm && (
            <>
              {use && (
                <p className="muted">Fill in the same request to check it before it's sent.</p>
              )}
              <WorkflowForm fields={formFields} values={formValues} onChange={setForm} />
            </>
          )}
          {needsDocument && !isForm && !isPass && (
            <label className="field">
              <span>{use ? "Paste the same document to check it" : "Document"}</span>
              <textarea
                className="input use-textarea"
                value={s.draft}
                maxLength={Math.max(max, 1) + 1000}
                onChange={(e) => w.setDraft(e.target.value)}
                rows={10}
                placeholder="Paste one document, e.g. a supplier invoice"
                aria-describedby="use-count"
              />
              <small id="use-count">
                {s.draft.length.toLocaleString()} of {max.toLocaleString()} characters. It isn't
                stored in your browser.
              </small>
            </label>
          )}
          {use?.state === "prepared" && <Consent use={use} check={s.check} />}

          <StepActions s={s} onAction={run} />
          {s.authorizer?.synthetic && (
            <p className="use-provenance" role="note">
              <strong>{s.authorizer.label}.</strong> Authorizing here makes a synthetic test
              signature, not a wallet signature, and nothing happens on a real network.
            </p>
          )}
          {!use && s.waiting?.request_id && (
            <p className="muted use-note">
              <Link to={`/uses/${s.waiting.request_id}`}>Open the stopped request</Link>
            </p>
          )}
          <div role="status" aria-live="polite">
            {s.notice && (
              <p
                className={`notice ${s.notice.tone === "error" ? "error" : s.notice.tone === "ok" ? "ok" : ""}`}
              >
                {s.notice.message}
              </p>
            )}
          </div>
        </section>

        <section className="card use-unit" aria-labelledby="use-unit-title">
          <h2 id="use-unit-title">Your unit</h2>
          {unit && use ? (
            <>
              {s.inDoubt?.useId === use.id && (
                <p className="notice use-unit-doubt" role="note">
                  As last read, before your last request lost its answer. Check this request to see
                  the unit now.
                </p>
              )}
              <span className={`pill ${unit.tone}`}>{unit.label}</span>
              <p className="use-note">{unit.text}</p>
              {use.units.source ? (
                <p className="muted use-note">
                  {use.units.source.observed.free !== null &&
                    `${use.units.source.observed.free} units free, ${use.units.source.observed.consumed} used, `}
                  as read from NEAR block{" "}
                  <span className="mono">{use.units.source.block.height}</span> at{" "}
                  {time(use.units.source.block.timestamp_ms)}.
                </p>
              ) : (
                <p className="muted use-note">Not read from the contract yet.</p>
              )}
            </>
          ) : (
            <p className="muted use-note">Nothing is reserved until you authorize one use.</p>
          )}
        </section>

        <section className="card use-result" aria-labelledby="use-result-title" aria-live="polite">
          <h2 id="use-result-title">{s.result ? "Your result" : "Result"}</h2>
          <ResultArea
            use={use}
            result={s.result}
            fields={fields}
            workflow={isWorkflow}
            analysis={isAnalysis}
            pass={isPass}
            inDoubt={!!use && s.inDoubt?.useId === use.id}
          />
          {isWorkflow && use?.execution?.fulfilled && <CustomerCaseTrack requestId={use.id} />}
        </section>

        <section className="card use-recent-card" aria-labelledby="use-recent-title">
          <h2 id="use-recent-title">Recent uses</h2>
          {s.recent.length === 0 ? (
            <p className="muted use-note">None yet.</p>
          ) : (
            <ul className="use-recent">
              {s.recent.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link to={`/uses/${r.id}`}>{r.product.name}</Link>
                  <span className="muted">
                    {" "}
                    · {r.headline.title.toLowerCase()} ·{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
