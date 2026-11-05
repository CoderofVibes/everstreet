// Job 003q: a customer's workspace for one released digital product. Everything here comes from
// the real customer-use API through CustomerWorkspace (customerWorkspace.ts): the document stays
// in memory, the browser checks a request itself before any authorization, and units are shown
// only as the contract's views reported them, with their block and time.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { customerHttp, type ResultView, type UseView } from "../customerApi.ts";
import { type CustomerAuthorizer, pageAuthorizer } from "../customerAuthorizer.ts";
import {
  activeCustomerStep,
  CUSTOMER_STEP_WORD,
  type CustomerStep,
  customerSteps,
} from "../customerView.ts";
import {
  type Action,
  CustomerWorkspace,
  nextStep,
  type WorkspaceState,
} from "../customerWorkspace.ts";
import { tokenAmount } from "../purchase.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";
import { DeviceKeyPanel } from "./DeviceKeyPanel.tsx";
import { PurchasePanel } from "./PurchasePanel.tsx";

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
        <dt>Your document</dt>
        <dd>
          {use.input.chars.toLocaleString()} characters, bound to this request by its fingerprint
          (under Technical details)
        </dd>
        <dt>Units</dt>
        <dd>Exactly one, charged only if you get a result</dd>
        <dt>Price of one unit</dt>
        <dd>
          <span className="mono">{t.unit_price}</span> base units of{" "}
          <span className="mono">{t.asset}</span>
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
            ? "Checked by your browser: every byte you'd authorize matches these details and your document."
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

export function CustomerResult({ r }: { r: ResultView }) {
  const res = r.result;
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
        {use ? use.headline.title : s.unanswered ? "Request not answered" : "Your document"}
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
}: {
  use: UseView | null;
  result: ResultView | null;
  fields: string[];
  inDoubt?: boolean;
}) {
  if (result) return <CustomerResult r={result} />;
  // 001j1: no instruction from the stale state while a lost answer is in doubt.
  if (inDoubt)
    return (
      <p className="use-placeholder">
        Not known until this request is checked: it may already have a result.
      </p>
    );
  const x = use?.execution;
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
      ? "Running on your document…"
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
  const [token, setToken] = useState<{ symbol: string; decimals: number } | null>(null);
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

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to use this product</h2>
        <p>Your documents and results are private to you.</p>
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
  const fields = offer?.product.fields.map((f) => f.label) ?? [];
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
              <dd>Pasted text, up to {offer.product.max_chars.toLocaleString()} characters</dd>
            </div>
            <div>
              <dt>You get</dt>
              <dd>{fields.length > 0 ? fields.join(", ") : "Structured fields"}</dd>
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
                    </strong>{" "}
                    <span className="muted mono">
                      ({offer.terms.unit_price} base units of {offer.terms.asset})
                    </span>
                  </>
                ) : (
                  <>
                    One unit: <span className="mono">{offer.terms.unit_price}</span> base units of{" "}
                    <span className="mono">{offer.terms.asset}</span>
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
      </header>

      <CustomerProgress steps={steps} active={active} />

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
          {needsDocument && (
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
          {identity === "verified" && offer && (
            <>
              {/* Job 003web: a fresh customer buys uses first; the device panel then re-reads. */}
              <PurchasePanel
                offerId={offer.offer_id}
                onChanged={() => setReadKey((k) => k + 1)}
                onToken={setToken}
              />
              <DeviceKeyPanel
                key={`device-${readKey}`}
                offerId={offer.offer_id}
                onAuthorizer={onAuthorizer}
              />
            </>
          )}
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
            inDoubt={!!use && s.inDoubt?.useId === use.id}
          />
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
