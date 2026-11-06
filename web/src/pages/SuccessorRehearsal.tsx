// Job 006c (docs/design/SUCCESSOR_REHEARSAL.md): the owner's successor rehearsal page. Start one,
// follow it (bounded polling while it runs), and read what happened: each step's expectation and
// observation, each dependency's responsibility and status, the boundaries, and the record. Reads
// are bound to the person, their session and the business.

import { useEffect, useRef, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { type Rehearsal, rehearsalApi } from "../rehearsalApi.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { ago } from "../via.ts";

const STATE_WORDS: Record<string, { label: string; tone: string }> = {
  running: { label: "Running", tone: "" },
  passed: { label: "Passed", tone: "mint" },
  failed: { label: "Failed", tone: "error" },
  interrupted: { label: "Interrupted", tone: "caution" },
  stale: { label: "Out of date", tone: "caution" },
};
const STEP_WORDS: Record<string, { label: string; tone: string }> = {
  passed: { label: "As expected", tone: "mint" },
  failed: { label: "Not as expected", tone: "error" },
  not_run: { label: "Not run", tone: "" },
};
const DEP_WORDS: Record<string, string> = {
  rehearsed: "Rehearsed",
  failed_then_corrected: "Failed, then corrected",
  failed: "Failed",
  pending_external: "Pending external transfer",
  not_rehearsed: "Not rehearsed",
  not_run: "Not run",
};
const WHO: Record<string, string> = {
  contract: "The business contract",
  owner_appointed: "Appointed by the owner",
  platform: "Everstreet",
  external: "Outside Everstreet",
};
const MAX_POLLS = 120;

export function SuccessorRehearsalPage({ businessId }: { businessId: string }) {
  const { person, sessionEpoch, requireSignIn } = useSession();
  const scope = person ? `${person.id}#${sessionEpoch}|${businessId}` : null;
  const read = useActorRead(scope, (w) => rehearsalApi.list(w.slice(w.lastIndexOf("|") + 1)));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const polls = useRef(0);
  const view = read.state.data;
  const running = view?.rehearsals.some((r) => r.state === "running") ?? false;

  // Follow a running rehearsal, finitely; "Check again" stays available after.
  useEffect(() => {
    if (!running) {
      polls.current = 0;
      return;
    }
    if (polls.current >= MAX_POLLS) return;
    const t = setTimeout(() => {
      polls.current += 1;
      read.retry();
    }, 1500);
    return () => clearTimeout(t);
  });

  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to rehearse a handover</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to rehearse a handover.")}
        >
          Sign in or join
        </button>
      </div>
    );
  if (!view)
    return (
      <div className="page" role="status">
        {read.state.error ? (
          <p className="notice error">
            {read.state.error}{" "}
            <button type="button" className="btn btn-quiet btn-sm" onClick={read.retry}>
              Retry
            </button>
          </p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );

  const start = async () => {
    if (busy || running) return;
    setBusy(true);
    setNote(null);
    try {
      await rehearsalApi.start(businessId);
      setNote("Started. It runs on its own copy and takes a moment.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
      polls.current = 0;
      read.retry();
    }
  };
  const latest = view.rehearsals[0] ?? null;
  const earlier = view.rehearsals.slice(1);
  const canRun = view.available && view.product?.supported === true;

  return (
    <div className="page narrow rehearsal-page">
      <div className="eyebrow">
        <Link to={`/desk/${businessId}`}>Back to the desk</Link>
      </div>
      <h1 className="display" style={{ fontSize: 36 }}>
        Successor rehearsal
      </h1>
      <p>
        A disposable rehearsal of your buyer's first shift: a fictional successor takes over a copy
        of your released product, serves an existing customer, runs into a dependency only you set
        up, fixes it, and releases a checked version.
      </p>
      <p className="notice info" role="note">
        Synthetic: it runs in a separate process with fictional people and a synthetic contract. It
        never reads or changes your live business, contacts no customer and signs nothing. It can't
        complete NEAR control or any transfer outside Everstreet.
      </p>

      <section className="card" aria-labelledby="rh-run">
        <h2 id="rh-run">Rehearse</h2>
        {view.product ? (
          <p className="muted">
            Product:{" "}
            {view.product.kind === "workflow_spec"
              ? "SaaS workflow"
              : view.product.kind === "web_app_bundle"
                ? "Web app"
                : "AI product"}{" "}
            · version <span className="mono">{view.product.artifact_digest.slice(0, 12)}</span>
          </p>
        ) : null}
        {!view.available && <p className="notice">{view.unavailable_reason}</p>}
        {view.product && !view.product.supported && <p className="notice">{view.product.reason}</p>}
        {!view.product && (
          <p className="notice">Nothing is released, so there is nothing to rehearse.</p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || running || !canRun}
          disabled={!canRun}
          onClick={start}
        >
          {running ? "Running…" : "Run a rehearsal"}
        </button>
        {running && polls.current >= MAX_POLLS && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={read.retry}>
            Check again
          </button>
        )}
        {note && (
          <p className="notice" role="status">
            {note}
          </p>
        )}
      </section>

      {latest && <RehearsalReport businessId={businessId} r={latest} />}

      {earlier.length > 0 && (
        <details className="card">
          <summary>Earlier rehearsals ({earlier.length})</summary>
          <ul className="team-list">
            {earlier.map((r) => (
              <li key={r.id}>
                <span className={`pill ${STATE_WORDS[r.state]?.tone ?? ""}`}>
                  {STATE_WORDS[r.state]?.label ?? r.state}
                </span>{" "}
                <span className="muted">
                  {ago(r.started_at)}
                  {r.detail ? ` · ${r.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RehearsalReport({ businessId, r }: { businessId: string; r: Rehearsal }) {
  const s = STATE_WORDS[r.state] ?? { label: r.state, tone: "" };
  return (
    <section className="card" aria-labelledby="rh-latest" aria-live="polite">
      <div className="row">
        <h2 id="rh-latest" style={{ margin: 0 }}>
          Latest rehearsal
        </h2>
        <span className="spacer" />
        <span className={`pill ${s.tone}`}>{s.label}</span>
      </div>
      <p className="muted">
        Started {ago(r.started_at)}
        {r.finished_at ? `, finished ${ago(r.finished_at)}` : ""}.
      </p>
      {r.detail && <p>{r.detail}</p>}
      {r.steps.length > 0 && (
        <ol className="rh-steps">
          {r.steps.map((st) => {
            const w = STEP_WORDS[st.outcome] ?? { label: st.outcome, tone: "" };
            return (
              <li key={st.key}>
                <div className="row">
                  <strong>{st.title}</strong>
                  <span className="spacer" />
                  <span className={`pill ${w.tone}`}>{w.label}</span>
                </div>
                <div className="muted">Expected: {st.expected}</div>
                <div>Observed: {st.observed}</div>
              </li>
            );
          })}
        </ol>
      )}
      {r.dependencies.length > 0 && (
        <>
          <h3>Dependencies</h3>
          <ul className="rh-deps">
            {r.dependencies.map((d) => (
              <li key={d.key}>
                <div className="row">
                  <strong>{d.label}</strong>
                  <span className="spacer" />
                  <span className="pill">{DEP_WORDS[d.status] ?? d.status}</span>
                </div>
                <div className="muted">
                  {WHO[d.responsibility] ?? d.responsibility} · {d.note}
                </div>
                {d.observed && <div>{d.observed}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.outcome && (
        <p className="muted">
          {r.outcome.summary} {r.outcome.boundaries}
        </p>
      )}
      {r.record_digest && (
        <p>
          <a href={rehearsalApi.recordUrl(businessId, r.id)} download>
            Download the record
          </a>{" "}
          <span className="muted mono">{r.record_digest.slice(0, 16)}…</span>
          <span className="muted"> · also included in the handover record</span>
        </p>
      )}
    </section>
  );
}
