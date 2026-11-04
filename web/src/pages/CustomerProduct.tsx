// Job 003q: a customer's workspace for one released digital product. Everything here comes from
// the real customer-use API through CustomerWorkspace (customerWorkspace.ts): the document stays
// in memory, the browser checks a request itself before any authorization, and units are shown
// only as the contract's views reported them, with their block and time.

import { useEffect, useState, useSyncExternalStore } from "react";
import { customerHttp, type ResultView, type UseView } from "../customerApi.ts";
import { pageAuthorizer } from "../customerAuthorizer.ts";
import { type Action, CustomerWorkspace, nextStep } from "../customerWorkspace.ts";
import { Link, useRouter } from "../router.tsx";
import { useSession } from "../session.tsx";

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
const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

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
          {use.input.chars.toLocaleString()} characters ·{" "}
          <span className="mono">sha256 {short(use.input.sha256)}</span>
        </dd>
        <dt>Units</dt>
        <dd>Exactly one, charged only if you get a result</dd>
        <dt>Price of one unit</dt>
        <dd>
          <span className="mono">{t.unit_price}</span> base units of{" "}
          <span className="mono">{t.asset}</span>
        </dd>
        <dt>Result kept for</dt>
        <dd>{t.retention_days} days, readable only by you</dd>
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
    </div>
  );
}

function Result({ r }: { r: ResultView }) {
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
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${res.outcome === "extracted" ? "mint" : "caution"}`}>
          {res.outcome === "extracted"
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

function ResultArea({ use, result }: { use: UseView | null; result: ResultView | null }) {
  if (result) return <Result r={result} />;
  const x = use?.execution;
  const text = !use
    ? "Your structured result appears here: each field the product reads, with notes and anything it noticed."
    : !x
      ? use.state === "reserved"
        ? "Reserved. Run it when you're ready."
        : "Nothing has run yet."
      : x.state === "running"
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
  return <p className="use-placeholder">{text}</p>;
}

export function CustomerProduct({ offerId, useId }: { offerId?: string; useId?: string }) {
  const { person, requireSignIn } = useSession();
  const { go } = useRouter();
  const [w] = useState(
    () =>
      new CustomerWorkspace(customerHttp, {
        personId: person?.id ?? "anon",
        offerId,
        useId,
        authorizer: pageAuthorizer,
        storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
      }),
  );
  const s = useSyncExternalStore(w.subscribe, w.getState);
  useEffect(() => {
    if (person) void w.start();
    return () => w.retire();
  }, [w, person]);

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
  if (s.status === "loading")
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
  const next = nextStep(s);
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
    };
    void map[a]();
  };
  const busy = s.busy !== null;
  const unit = use ? UNIT_WORDS[use.units.unit] : null;
  const needsDocument = !use || (use.state === "prepared" && s.accepted === null);
  const max = offer?.product.max_chars ?? 0;

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
          <p className="muted">
            One unit per use · <span className="mono">{offer.terms.unit_price}</span> base units of{" "}
            <span className="mono">{offer.terms.asset}</span> · results kept{" "}
            {offer.terms.retention_days} days for you only
            {offer.offer_state === "retired" && " · no longer offered for new uses"}
          </p>
        )}
      </header>

      {s.authorizer?.synthetic && (
        <p className="notice use-synthetic" role="note">
          <strong>{s.authorizer.label}.</strong> This is a local preview: authorizations are
          synthetic test signatures, not a wallet, and nothing happens on a real network.
        </p>
      )}

      <div className="use-grid">
        <section className="card use-compose" aria-labelledby="use-compose-title">
          <h2 id="use-compose-title">
            {use ? use.headline.title : s.unanswered ? "Request not answered" : "Your document"}
          </h2>
          {use && <p className="muted">{use.headline.detail}</p>}
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
          {!use && offer && offer.product.fields.length > 0 && (
            <p className="muted use-note">
              You'll get: {offer.product.fields.map((f) => f.label).join(", ")}.
            </p>
          )}
          {use?.state === "prepared" && <Consent use={use} check={s.check} />}

          <div className="use-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={
                busy || next.action === null || (next.action === "prepare" && !s.draft.trim())
              }
              onClick={() => run(next.action)}
            >
              {busy ? "Working…" : next.label}
            </button>
            {use?.state === "prepared" && next.action !== "cancel" && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => run("cancel")}
              >
                Cancel this request
              </button>
            )}
            {use?.state === "reserved" &&
              !use.execution &&
              use.units.unit === "reserved_awaiting_settlement" && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => run("release")}
                >
                  Don't run it: return my unit
                </button>
              )}
          </div>
          <p className="muted use-why">{next.why}</p>
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

        <section className="card use-result" aria-labelledby="use-result-title" aria-live="polite">
          <h2 id="use-result-title">Result</h2>
          <ResultArea use={use} result={s.result} />
        </section>

        <aside className="use-side">
          <section className="card" aria-labelledby="use-unit-title">
            <h2 id="use-unit-title">Your unit</h2>
            {unit && use ? (
              <>
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
          <section className="card" aria-labelledby="use-recent-title">
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
        </aside>
      </div>
    </div>
  );
}
