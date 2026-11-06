// The studio's Service tab (job 002c): run a checked version of the product on pasted text,
// see the validated result and its request record, keep test cases, check a version against
// them, and release or roll back. Owner-only private trials before customers are connected.
// With no runtime connected it says so; sample buttons only fill the text box.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import {
  type EvalRun,
  type Fixtures,
  type Invocation,
  type Releases,
  type RuntimeList,
  runtimeApi,
} from "../runtimeApi.ts";
import {
  type Attempt,
  describeAttempt,
  empty,
  inFlight,
  MAX_TRACKED,
  POLL,
  type Requests,
  recover,
  runAction,
  settle,
  start,
  unresolved,
} from "../serviceAttempt.ts";
import {
  caseFrom,
  OUTCOME_TEXT,
  resultJson,
  resultRows,
  SAMPLES,
  STATE_TEXT,
  short,
  usageLine,
} from "../serviceView.ts";
import { useSession } from "../session.tsx";
import { releasesSignature } from "../studioRecords.ts";
import { newKey } from "./Builds.tsx";
import { CustomerAccess } from "./CustomerAccess.tsx";
import { CustomerOffers } from "./CustomerOffers.tsx";

const SCORE_CLASS = { pass: "mint", fail: "caution", error: "caution", not_applicable: "" };
const SCORE_TEXT = {
  pass: "Passed",
  fail: "Failed",
  error: "Error (no answer to score)",
  not_applicable: "Doesn't apply to this version",
};
const when = (iso: string) => new Date(iso).toLocaleString();

function RequestRecord({ i }: { i: Invocation }) {
  return (
    <dl className="facts" style={{ gridTemplateColumns: "130px 1fr", fontSize: 13.5 }}>
      <dt>Version</dt>
      <dd>
        build {short(i.artifact_job)} · digest <code>{short(i.artifact_digest)}</code>
        {i.release_id ? " · released version" : " · trial of a candidate"}
      </dd>
      <dt>Status</dt>
      <dd>
        {STATE_TEXT[i.state]}
        {i.failure ? ` · ${i.failure.detail}` : ""}
      </dd>
      <dt>Time</dt>
      <dd>{i.elapsed_ms === null ? "—" : `${(i.elapsed_ms / 1000).toFixed(1)} s`}</dd>
      <dt>Model</dt>
      <dd>
        {i.validator === WORKFLOW_VALIDATOR ? "None (the workflow engine)" : (i.model ?? "—")} ·
        checks {i.validator}
      </dd>
      <dt>Usage</dt>
      <dd>{usageLine(i)}</dd>
      <dt>Input</dt>
      <dd>
        {i.input_chars.toLocaleString()} characters. {i.input_note}
      </dd>
    </dl>
  );
}

const WORKFLOW_VALIDATOR = "workflow-validator/1";

/** A workflow engine trial: the request it took, and the stage it opened in, or why it refused. */
function WorkflowResult({ i }: { i: Invocation }) {
  const r = i.result as unknown as {
    outcome: string;
    fields?: { key: string; label: string; value: string }[];
    stage?: string;
    reason?: string;
  } | null;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <strong>
          {r?.outcome === "accepted"
            ? "Accepted into the first stage"
            : r?.outcome === "refused"
              ? "Not accepted"
              : STATE_TEXT[i.state]}
        </strong>
        <span className="spacer" />
        <span className={`pill ${i.fulfilled ? "mint" : "caution"}`}>
          {i.fulfilled ? "A customer would be charged one unit" : "Not charged"}
        </span>
      </div>
      {r?.outcome === "accepted" && (
        <table className="table" style={{ width: "100%", marginTop: 10, fontSize: 14 }}>
          <tbody>
            {(r.fields ?? []).map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r?.outcome === "refused" && r.reason && <p style={{ fontSize: 14 }}>{r.reason}.</p>}
    </div>
  );
}

/** An analysis trial: its flags, or why it was refused or invalid. */
function AnalysisTrialResult({ i }: { i: Invocation }) {
  const r = i.result as unknown as {
    outcome: string;
    summary?: string;
    findings?: {
      title: string;
      severity: string;
      evidence: string;
      why: string;
      proposed_action: string;
    }[];
    problems?: string[];
    reason?: string | null;
  } | null;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <strong>
          {r?.outcome === "analyzed"
            ? r.summary
            : r?.outcome === "refused"
              ? "Not analyzed"
              : r?.outcome === "invalid"
                ? "The answer failed the platform's checks, so nothing is shown"
                : STATE_TEXT[i.state]}
        </strong>
        <span className="spacer" />
        <span className={`pill ${i.fulfilled ? "mint" : "caution"}`}>
          {i.fulfilled ? "A customer would be charged one unit" : "Not charged"}
        </span>
      </div>
      {(r?.findings ?? []).map((f) => (
        <div key={f.evidence} className="an-flag">
          <div className="row">
            <strong>{f.title}</strong>
            <span className={`pill ${f.severity === "high" ? "caution" : ""}`}>{f.severity}</span>
          </div>
          <blockquote className="an-quote">{f.evidence}</blockquote>
          <p>{f.why}</p>
          <p>
            <strong>Proposed:</strong> {f.proposed_action}
          </p>
        </div>
      ))}
      {r?.reason && <p style={{ fontSize: 14 }}>{r.reason}</p>}
      {(r?.problems ?? []).length > 0 && (
        <ul className="missing-list">
          {(r?.problems ?? []).map((p) => (
            <li key={p}>The answer {p}.</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Result({ i, onSaveCase }: { i: Invocation; onSaveCase?: () => void }) {
  const [copied, setCopied] = useState(false);
  if (i.validator === WORKFLOW_VALIDATOR) return <WorkflowResult i={i} />;
  if (i.validator === "analysis-validator/1") return <AnalysisTrialResult i={i} />;
  const r = i.result;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <strong>{r ? OUTCOME_TEXT[r.outcome] : STATE_TEXT[i.state]}</strong>
        <span className="spacer" />
        <span className={`pill ${i.fulfilled ? "mint" : "caution"}`}>
          {i.fulfilled ? "Clean result" : "Not a clean result"}
        </span>
      </div>
      {r && (r.outcome === "extracted" || r.outcome === "incomplete") && (
        <table className="table" style={{ width: "100%", marginTop: 10, fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Field</th>
              <th style={{ textAlign: "left" }}>Value</th>
              <th style={{ textAlign: "left" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {resultRows(r).map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className={row.missing ? "muted" : ""}>{row.value}</td>
                <td className="muted">{row.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r?.reason && <p style={{ fontSize: 14 }}>{r.reason}</p>}
      {r && r.problems.length > 0 && (
        <ul className="missing-list">
          {r.problems.map((p) => (
            <li key={p}>The answer {p}.</li>
          ))}
        </ul>
      )}
      {r && r.issues.length > 0 && r.outcome !== "refused" && (
        <p className="notice" style={{ fontSize: 13.5 }}>
          Noticed in the document (values kept as stated): {r.issues.join("; ")}
        </p>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        {r && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(resultJson(r)).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
        )}
        {r && onSaveCase && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onSaveCase}>
            Save as a test case (expects this result)
          </button>
        )}
      </div>
      <details className="advanced" style={{ marginTop: 8 }}>
        <summary>Request record</summary>
        <RequestRecord i={i} />
      </details>
    </div>
  );
}

export type ServiceTask = "try" | "evaluate" | "customers";
export const SERVICE_TASKS: { id: ServiceTask; label: string }[] = [
  { id: "try", label: "Try" },
  { id: "evaluate", label: "Evaluate and release" },
  { id: "customers", label: "Customer access" },
];

/**
 * Job 001b: what each task holds that the owner must not lose sight of. Shown on the task's
 * button, so moving to another task never hides an unresolved request, a running check or an
 * offer that needs recovering or an access check.
 */
export function serviceAttention(s: {
  lost: number;
  running: boolean;
  checkRunning: boolean;
  offers: boolean;
}): Record<ServiceTask, string | null> {
  return {
    try: s.lost > 0 ? "needs a check" : s.running ? "running" : null,
    evaluate: s.checkRunning ? "check running" : null,
    customers: s.offers ? "needs attention" : null,
  };
}

export function ServiceView({
  projectId,
  businessId,
  task: chosen,
  onTask,
  onRecords,
}: {
  projectId: string;
  businessId: string;
  /** Job 001b: the task shown; the others stay mounted (hidden), so nothing pending is lost. */
  task?: ServiceTask;
  onTask?: (t: ServiceTask) => void;
  /** Job 001b1: reports what releases/checks and offers now show, so the status follows them. */
  onRecords?: (source: "service" | "offers", signature: string) => void;
}) {
  const { person } = useSession();
  const [ownTask, setOwnTask] = useState<ServiceTask>("try");
  const task = chosen ?? ownTask;
  const chooseTask = (t: ServiceTask) => (onTask ? onTask(t) : setOwnTask(t));
  const [offerAttention, setOfferAttention] = useState(false);
  const [list, setList] = useState<RuntimeList | null>(null);
  const [rel, setRel] = useState<Releases | null>(null);
  const [fix, setFix] = useState<Fixtures | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  const [text, setText] = useState("");
  /** The latest answer shown, with the request it belongs to (which may be an earlier one). */
  const [last, setLast] = useState<{ invocation: Invocation; attempt: Attempt } | null>(null);
  /**
   * Requests with their fixed identities (serviceAttempt.ts), kept apart from the draft. This
   * view stays mounted across studio tabs (002c1); a lost one stays recoverable whatever the
   * draft holds (002c2).
   */
  const [requests, setRequests] = useState<Requests>(empty);
  const [budgetText, setBudgetText] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Job 003wf4: the plan "Set up customer access" confirmed, handed to the offer review below.
  const [offerPlan, setOfferPlan] = useState<{ id: number; at: number } | null>(null);
  const [polls, setPolls] = useState(0);
  const live = useRef(true);
  /** Loads can overlap; only the newest one's answer is used. */
  const loadSeq = useRef(0);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [l, r, f, e] = await Promise.all([
        runtimeApi.list(projectId),
        runtimeApi.releases(projectId),
        runtimeApi.fixtures(projectId),
        runtimeApi.runs(projectId),
      ]);
      if (!live.current || seq !== loadSeq.current) return;
      setList(l);
      setRel(r);
      setFix(f);
      setRuns(e.runs);
      setError(null);
      setVersion(
        (v) =>
          v ||
          (r.active ? "release" : r.candidates[0] ? `job:${r.candidates[0].artifact_job}` : ""),
      );
      setBudgetText(
        (b) => b || (l.budget.limit_cents === null ? "" : (l.budget.limit_cents / 100).toFixed(2)),
      );
    } catch (e) {
      if (!live.current || seq !== loadSeq.current) return;
      // Access lost (another person, a sale): clear everything private at once.
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        setList(null);
        setRel(null);
        setFix(null);
        setRuns([]);
        setLast(null);
        setRequests(empty());
        setText("");
      }
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);
  const recordsSig = rel ? releasesSignature(rel, runs[0]) : null;
  useEffect(() => {
    if (recordsSig !== null) onRecords?.("service", recordsSig);
  }, [recordsSig, onRecords]);

  // Follow running work (a check, or a request started here or in another tab) with growing
  // gaps, only while the page is visible, and at most POLL.maxPolls times.
  const running = runs.find((r) => r.state === "running");
  const pendingRequest = list?.invocations.some((i) => i.state === "running") ?? false;
  const following = Boolean(running) || pendingRequest || inFlight(requests) !== null;
  useEffect(() => {
    if (!following || polls >= POLL.maxPolls) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") load();
      setPolls((n) => n + 1);
    }, POLL.delay(polls));
    return () => window.clearTimeout(t);
  }, [following, polls, load]);

  if (error && !list)
    return (
      <div>
        <p className="error-text">{error}</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!list || !rel || !fix) return <p className="muted">Loading the service…</p>;
  const available = list.availability.available;
  // The workflow engine uses no model, so it needs no runtime budget (WORKFLOW_ENGINE.md).
  const workflow = list.engine === "workflow";
  // An agent service (AGENT_ANALYSIS.md): a form-shaped request, on the AI runtime.
  const analysis = list.engine === "analysis";
  const budgetSet = workflow || list.budget.limit_cents !== null;
  const candidates = rel.candidates;

  const action = runAction(requests);
  const busy = action === "wait";
  const lostOnes = unresolved(requests);
  const latest = requests.attempts.at(-1);

  /**
   * Sends one request from its own fixed fields (never the draft): new work, or the same key
   * again to ask about a recorded one. The draft is never read or changed here.
   */
  const send = async (a: Attempt) => {
    setPolls(0);
    setNotice(null);
    try {
      const { invocation } = await runtimeApi.invoke(projectId, {
        idempotency_key: a.key,
        text: a.text,
        ...(a.target === "release"
          ? { release: true }
          : { artifact_job: a.target.replace(/^job:/, "") }),
      });
      if (!live.current) return;
      setRequests((r) => settle(r, a.key, { ok: true, invocationId: invocation.id }));
      setLast({ invocation, attempt: a });
    } catch (e) {
      if (!live.current) return;
      const status = e instanceof ApiError ? e.status : 0;
      setRequests((r) => settle(r, a.key, { ok: false, status, message: (e as Error).message }));
      if (status === 401 || status === 404) setLast(null);
    }
    load();
  };
  /** New work from the draft; `explicitNew` only from the separately labelled paid action. */
  const run = (explicitNew = false) => {
    const s = start(
      requests,
      text,
      version,
      () => newKey("run"),
      new Date().toISOString(),
      explicitNew,
    );
    if (!s) return;
    setRequests(s.requests);
    send(s.attempt);
  };
  /** Recovers an earlier request from its stored fields; the draft stays as typed. */
  const recoverOne = (key: string) => {
    const s = recover(requests, key);
    if (!s) return;
    setRequests(s.requests);
    send(s.attempt);
  };

  const saveCase = async () => {
    if (!last?.invocation.result) return;
    const c = caseFrom(last.attempt.text, last.invocation.result, fix.cases);
    if (
      !window.confirm(
        `Save "${c.name}" as a test case expecting: ${c.expect.outcomes.join(" or ")}${
          c.expect.fields
            ? ` with ${Object.entries(c.expect.fields)
                .map(([k, v]) => `${k} = ${v ?? "missing"}`)
                .join(", ")}`
            : ""
        }?`,
      )
    )
      return;
    try {
      setFix(
        await runtimeApi.saveFixtures(projectId, {
          cases: [...fix.cases, c],
          base_version: fix.version,
        }),
      );
      setNotice(
        "Saved as a new version of your test cases. Earlier checks now need running again.",
      );
      load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const removeCase = async (id: string) => {
    try {
      setFix(
        await runtimeApi.saveFixtures(projectId, {
          cases: fix.cases.filter((c) => c.id !== id),
          base_version: fix.version,
        }),
      );
      load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const check = async (job: string) => {
    setChecking(job);
    setNotice(null);
    try {
      await runtimeApi.check(projectId, job);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setChecking(null);
    }
  };

  const act = async (fn: () => Promise<Releases>) => {
    setNotice(null);
    try {
      setRel(await fn());
      load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const latestRun = runs[0];
  // Job 001b: what needs attention per task, so changing task never hides unresolved work.
  const attention = serviceAttention({
    lost: lostOnes.length,
    running: pendingRequest || inFlight(requests) !== null,
    checkRunning: Boolean(running),
    offers: offerAttention,
  });

  return (
    <div className="service">
      <dl className="service-summary" aria-label="What decisions here depend on">
        <div>
          <dt>Active version</dt>
          <dd>
            {rel.active
              ? `Build ${short(rel.active.artifact_job)} since ${when(rel.active.activated_at)}`
              : "None released"}
          </dd>
        </div>
        <div>
          <dt>Running products</dt>
          <dd>{available ? "Available here" : "Not connected here"}</dd>
        </div>
        <div>
          <dt>Runtime budget</dt>
          <dd>
            {workflow
              ? "Not needed (no AI)"
              : list.budget.available_cents !== null
                ? `${list.budget.available_cents}¢ available`
                : budgetSet
                  ? "Set"
                  : "Not set"}
          </dd>
        </div>
      </dl>
      <fieldset className="seg service-tasks">
        <legend className="sr-only">Service tasks</legend>
        {SERVICE_TASKS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={task === t.id}
            onClick={() => chooseTask(t.id)}
          >
            {t.label}
            {attention[t.id] && (
              <span className="badge attention">
                <span className="sr-only">: </span>
                {attention[t.id]}
              </span>
            )}
          </button>
        ))}
      </fieldset>
      {!available && (
        <div className="notice">
          <strong>Running products isn't connected here.</strong> {list.availability.reason}
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}

      <p className="muted" style={{ fontSize: 13.5 }} hidden={task !== "try"}>
        {workflow
          ? "Your workflow takes a request through its form and opens it in the first stage. Only you can try it here. No AI is used, so trying it costs nothing."
          : analysis
            ? "Your agent reads what a customer submits through its form and returns flags, each quoting the submission. Only you can try it here. It runs on the AI runtime, under its own budget."
            : "Your product reads pasted text and returns the fields its checked version declares. Only you can run it here. Running it uses its own budget, separate from the AI that builds it."}
      </p>
      <section className="card" hidden={task !== "try"}>
        <h2>Try it</h2>
        {candidates.length === 0 ? (
          <p className="muted">No checked version yet.</p>
        ) : (
          <>
            <label className="field">
              <span>Version</span>
              <select
                className="input"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                {rel.active && (
                  <option value="release">
                    Released version (build {short(rel.active.artifact_job)})
                  </option>
                )}
                {candidates.map((c) => (
                  <option key={c.artifact_job} value={`job:${c.artifact_job}`}>
                    Build {short(c.artifact_job)} · revision {c.revision} · {c.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }} hidden={workflow || analysis}>
              <span className="muted" style={{ fontSize: 13 }}>
                Fill with a fictional sample:
              </span>
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setText(s.text)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>
                {workflow || analysis
                  ? 'A test request as JSON, one text value per form field, e.g. {"subject": "Export fails"}'
                  : "Pasted text (the text itself isn't stored; the result is kept)"}
              </span>
              <textarea
                className="input"
                rows={8}
                value={text}
                maxLength={list.limits.maxInputChars}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              {action === "full" ? (
                // Every tracked request is unresolved: no new paid work until one is checked.
                <p className="notice" role="status" style={{ fontSize: 13.5, margin: 0 }}>
                  <strong>Check an earlier request first.</strong> {MAX_TRACKED} earlier requests
                  have no answer yet, which is as many as this page keeps track of. Check on one
                  below (that won't run it again) before starting new paid work. Your text above
                  stays as it is.
                </p>
              ) : action === "new_paid_only" ? (
                // While an earlier request is unresolved, new work is only this explicit action.
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!text.trim() || !available || !budgetSet}
                  onClick={() => run(true)}
                >
                  Run this text as a new, separately paid request
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !text.trim() || !available || !budgetSet}
                  onClick={() => run()}
                >
                  {busy ? "Processing…" : "Run"}
                </button>
              )}
              <span className="muted" style={{ fontSize: 12.5 }}>
                {workflow
                  ? "No AI is used; nothing is held or spent."
                  : !budgetSet
                    ? "Set a runtime budget below first."
                    : `Each request holds up to ${list.budget.per_request_cents}¢ until it settles.`}
              </span>
            </div>
            {/* Lost answers stay recoverable from their own stored request, whatever the draft. */}
            {lostOnes.map((a) => (
              <div key={a.key} className="notice" style={{ fontSize: 13.5 }}>
                <strong>An earlier request has no answer yet</strong> ({describeAttempt(a)}).{" "}
                {a.message}{" "}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => recoverOne(a.key)}
                >
                  Check on that request (won't run it again)
                </button>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  Your current text above stays as it is.
                </div>
              </div>
            ))}
            {latest?.state === "refused" && latest.message && (
              <p className="error-text">{latest.message}</p>
            )}
            {list.invocations
              .filter((i) => i.state === "running")
              .map((i) => (
                <div key={i.id} className="notice" style={{ fontSize: 13.5 }}>
                  A request started {when(i.created_at)} on build {short(i.artifact_job)} is still
                  running{polls >= POLL.maxPolls ? " (stopped checking automatically)" : ""}.{" "}
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => {
                      setPolls(0);
                      load();
                    }}
                  >
                    Check now
                  </button>{" "}
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    disabled={i.cancel_requested}
                    onClick={async () => {
                      try {
                        await runtimeApi.cancel(i.id);
                      } catch (e) {
                        setNotice(`Couldn't stop it: ${(e as Error).message}`);
                      }
                      load();
                    }}
                  >
                    {i.cancel_requested
                      ? "Stopping…"
                      : "Stop it (anything already processed may still be charged)"}
                  </button>
                </div>
              ))}
            {last && (
              <div style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: 13, margin: "0 0 6px" }}>
                  {last.attempt.key === latest?.key && latest.state === "answered"
                    ? "Result of your latest request"
                    : "Result of an earlier request"}{" "}
                  ({describeAttempt(last.attempt)})
                </p>
                <Result
                  i={last.invocation}
                  onSaveCase={last.invocation.result ? saveCase : undefined}
                />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card" hidden={task !== "evaluate"}>
        <h2>Release checks</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          <strong>{fix.required.name}</strong> ({fix.required.policy}). {fix.required.note}
        </p>
        <details className="advanced">
          <summary>The {fix.required.cases.length} required cases</summary>
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {fix.required.cases.map((c) => (
              <li key={c.id} style={{ marginBottom: 4 }}>
                <strong>{c.name}</strong> — expects {c.expect.outcomes.join(" or ")}
                {c.why && <span className="muted"> · {c.why}</span>}
              </li>
            ))}
          </ul>
        </details>
        {workflow || analysis ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {workflow
              ? "A workflow is checked by the engine's own cases for its form; its decisions don't vary, so there are no test cases of your own to add."
              : "An analysis is checked by the platform's own cases for this kind of product. They are written for reviewing release notes; another kind of analysis would need its own checks, which aren't built yet."}
          </p>
        ) : (
          <>
            <h3 style={{ fontSize: 15, marginTop: 14 }}>
              Your own test cases {fix.version ? `· version ${fix.version}` : ""}
            </h3>
            <p className="muted" style={{ fontSize: 13.5 }}>
              {fix.note} They are added to the required checks, never instead of them.
            </p>
          </>
        )}
        {workflow || analysis ? null : fix.cases.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            None yet. After a trial, use "Save as a test case" to keep it as one.
          </p>
        ) : (
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {fix.cases.map((c) => (
              <li key={c.id} style={{ marginBottom: 6 }}>
                <strong>{c.name}</strong> — expects {c.expect.outcomes.join(" or ")}
                {c.expect.fields ? ` (${Object.keys(c.expect.fields).length} fields compared)` : ""}
                {c.why && <span className="muted"> · {c.why}</span>}{" "}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => removeCase(c.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" hidden={task !== "evaluate"}>
        <h2>Checks and release</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {rel.note}
        </p>
        {rel.active ? (
          <p>
            <span className="pill mint">Released</span> build {short(rel.active.artifact_job)} ·
            digest <code>{short(rel.active.artifact_digest)}</code> · since{" "}
            {when(rel.active.activated_at)}
            {!rel.active.checks_current && (
              <span className="error-text"> · {rel.active.reasons.join(". ")}</span>
            )}
          </p>
        ) : (
          <p className="muted">Nothing released yet.</p>
        )}
        {candidates.map((c) => (
          <div
            key={c.artifact_job}
            className="row"
            style={{
              borderTop: "1px solid var(--border)",
              padding: "8px 0",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>Build {short(c.artifact_job)}</strong>{" "}
              <span className="muted">
                revision {c.revision} · digest <code>{short(c.artifact_digest)}</code>
              </span>
              <div className="muted" style={{ fontSize: 13 }}>
                {c.latest_check
                  ? `Last check: ${c.latest_check.passed} of ${c.latest_check.total} passed${
                      c.latest_check.reasons.length ? ` · ${c.latest_check.reasons.join(". ")}` : ""
                    }`
                  : "Not checked yet"}
                {!c.current_owner && " · built under a previous owner"}
              </div>
            </div>
            <span
              className={`pill ${c.status === "active" ? "mint" : c.status === "checked" ? "blue" : ""}`}
            >
              {c.status === "active"
                ? "Released"
                : c.status === "checked"
                  ? "Checked"
                  : "Candidate"}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!available || Boolean(running) || checking !== null}
              onClick={() => check(c.artifact_job)}
            >
              {checking === c.artifact_job ? "Starting…" : "Run checks"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={c.status !== "checked" || !c.latest_check}
              onClick={() =>
                c.latest_check &&
                act(() => runtimeApi.release(projectId, c.artifact_job, c.latest_check?.id ?? ""))
              }
            >
              Release this version
            </button>
          </div>
        ))}
        {rel.releases.some((r) => r.state === "retired") && (
          <>
            <h3 style={{ fontSize: 15, marginTop: 14 }}>Earlier releases</h3>
            {rel.releases
              .filter((r) => r.state === "retired")
              .map((r) => (
                <div key={r.id} className="row" style={{ fontSize: 14, gap: 8, padding: "4px 0" }}>
                  <span>
                    Build {short(r.artifact_job)} · {when(r.activated_at)} to{" "}
                    {r.retired_at ? when(r.retired_at) : "—"}
                  </span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    disabled={!r.checks_current}
                    title={r.checks_current ? undefined : r.reasons.join(". ")}
                    onClick={() => act(() => runtimeApi.rollback(projectId, r.id))}
                  >
                    Roll back to this
                  </button>
                </div>
              ))}
          </>
        )}
      </section>

      {person && (
        <div hidden={task !== "customers"}>
          <CustomerAccess
            key={`access:${person.id}:${businessId}:${projectId}`}
            businessId={businessId}
            projectId={projectId}
            onOffer={(id) => setOfferPlan({ id, at: Date.now() })}
          />
          <CustomerOffers
            suggestedPlan={offerPlan}
            key={`${person.id}:${businessId}:${projectId}:${rel.active?.id ?? "none"}`}
            personId={person.id}
            businessId={businessId}
            projectId={projectId}
            onAttention={setOfferAttention}
            onRecords={onRecords}
          />
        </div>
      )}

      {latestRun && (
        <section className="card" hidden={task !== "evaluate"}>
          <h2>
            Latest check · build {short(latestRun.artifact_job)} ·{" "}
            {latestRun.state === "running"
              ? `running (${latestRun.results.length} of ${latestRun.total})`
              : `${latestRun.passed} of ${latestRun.total} passed`}
          </h2>
          <p className="muted" style={{ fontSize: 13 }}>
            {latestRun.basis} Release checks {latestRun.policy || "(older, now stale)"} · your cases
            version {latestRun.fixture_version || "none"} · model{" "}
            {latestRun.provider_config.model ?? "—"} · {latestRun.validator} · cost $
            {(latestRun.used_microcents / 100_000_000).toFixed(6)}
            {latestRun.held_cents ? ` plus ${latestRun.held_cents}¢ unresolved` : ""}
          </p>
          <p style={{ fontSize: 13.5 }}>
            {latestRun.invalid_answers > 0 &&
              `${latestRun.invalid_answers} answer${latestRun.invalid_answers === 1 ? "" : "s"} failed the platform's format checks (counted apart from wrong values). `}
            {latestRun.reasons.join(". ")}
          </p>
          {latestRun.results.map((r) => (
            <details key={r.id} className="advanced">
              <summary>
                <span className={`pill ${SCORE_CLASS[r.score]}`}>{SCORE_TEXT[r.score]}</span>{" "}
                {r.required ? "Required · " : "Yours · "}
                {r.name} — {r.explanation}
              </summary>
              <p className="muted" style={{ fontSize: 13 }}>
                What happened: {r.raw.state}
                {r.raw.outcome ? `, ${r.raw.outcome}` : ""}
                {r.raw.failure ? ` (${r.raw.failure})` : ""}
              </p>
              {r.fields.length > 0 && (
                <table className="table" style={{ fontSize: 13.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Field</th>
                      <th style={{ textAlign: "left" }}>Expected</th>
                      <th style={{ textAlign: "left" }}>Got</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.fields.map((f) => (
                      <tr key={f.key} className={f.match ? "" : "error-text"}>
                        <td>{f.key}</td>
                        <td>{f.expected ?? "missing"}</td>
                        <td>{f.actual === null ? "missing" : String(f.actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          ))}
        </section>
      )}

      <section className="card" hidden={task !== "try" || workflow}>
        <h2>Runtime budget</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {list.budget.basis}
        </p>
        <p style={{ fontSize: 14 }}>
          Used ${(list.budget.used_microcents / 100_000_000).toFixed(6)} · counted{" "}
          {list.budget.counted_cents}¢ · reserved {list.budget.reserved_cents}¢
          {list.budget.unresolved_cents ? ` (${list.budget.unresolved_cents}¢ unresolved)` : ""}
          {list.budget.available_cents !== null
            ? ` · ${list.budget.available_cents}¢ available`
            : ""}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 140 }}
            inputMode="decimal"
            placeholder="Dollars"
            value={budgetText}
            onChange={(e) => setBudgetText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={list.budget.max_settable_cents === null}
            onClick={async () => {
              try {
                await runtimeApi.setBudget(businessId, Math.round(Number(budgetText) * 100));
                load();
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            Set runtime budget
          </button>
        </div>
      </section>

      {list.invocations.length > 0 && (
        <section className="card" hidden={task !== "try"}>
          <h2>Your requests</h2>
          {list.invocations.map((i) => (
            <details key={i.id} className="advanced">
              <summary>
                {when(i.created_at)} · build {short(i.artifact_job)} ·{" "}
                {i.result ? OUTCOME_TEXT[i.result.outcome] : STATE_TEXT[i.state]}
              </summary>
              <Result i={i} />
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
