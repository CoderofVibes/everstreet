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
import { type Attempt, begin, nextAction, POLL, settle } from "../serviceAttempt.ts";
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
import { newKey } from "./Builds.tsx";

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
        {i.model ?? "—"} · checks {i.validator}
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

function Result({ i, onSaveCase }: { i: Invocation; onSaveCase?: () => void }) {
  const [copied, setCopied] = useState(false);
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

export function ServiceView({ projectId, businessId }: { projectId: string; businessId: string }) {
  const [list, setList] = useState<RuntimeList | null>(null);
  const [rel, setRel] = useState<Releases | null>(null);
  const [fix, setFix] = useState<Fixtures | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  const [text, setText] = useState("");
  const [last, setLast] = useState<Invocation | null>(null);
  const [lastText, setLastText] = useState("");
  /**
   * The request's fixed identity (serviceAttempt.ts). This view stays mounted across studio tabs
   * (job 002c1), so leaving Service and coming back keeps the text, target and request.
   */
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        setAttempt(null);
        setText("");
      }
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  // Follow running work (a check, or a request started here or in another tab) with growing
  // gaps, only while the page is visible, and at most POLL.maxPolls times.
  const running = runs.find((r) => r.state === "running");
  const pendingRequest = list?.invocations.some((i) => i.state === "running") ?? false;
  const following = Boolean(running) || pendingRequest || attempt?.state === "sending";
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
  const budgetSet = list.budget.limit_cents !== null;
  const candidates = rel.candidates;

  const action = nextAction(attempt, text, version);
  const busy = attempt?.state === "sending";

  /** Sends one attempt: a new request, or the same key again to ask about a recorded one. */
  const send = async (a: Attempt) => {
    setAttempt(a);
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
      setAttempt(settle(a, { ok: true, invocationId: invocation.id }));
      setLast(invocation);
      setLastText(a.text);
    } catch (e) {
      if (!live.current) return;
      const status = e instanceof ApiError ? e.status : 0;
      setAttempt(settle(a, { ok: false, status, message: (e as Error).message }));
      if (status === 401 || status === 404) setLast(null);
    }
    load();
  };
  const run = () => {
    const a = begin(attempt, text, version, () => newKey("run"));
    if (a) send(a);
  };
  /** After a lost answer: new paid work only by this explicit choice. */
  const runNew = () => {
    if (!text.trim() || busy) return;
    send({
      key: newKey("run"),
      text,
      target: version,
      state: "sending",
      invocationId: null,
      message: null,
    });
  };

  const saveCase = async () => {
    if (!last?.result) return;
    const c = caseFrom(lastText, last.result, fix.cases);
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

  return (
    <div className="service">
      <p className="muted" style={{ fontSize: 13.5 }}>
        Your product reads pasted text and returns the fields its checked version declares. Only you
        can run it until customers are connected. Running it uses its own budget, separate from the
        AI that builds it.
      </p>
      {!available && (
        <div className="notice">
          <strong>Running products isn't connected here.</strong> {list.availability.reason}
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}

      <section className="card">
        <h2>Try it</h2>
        {candidates.length === 0 ? (
          <p className="muted">
            No checked version yet. Build one on the Builds tab; a version appears here once its
            specification passes the platform's checks.
          </p>
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
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
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
              <span>Pasted text (the text itself isn't stored; the result is kept)</span>
              <textarea
                className="input"
                rows={8}
                value={text}
                maxLength={list.limits.maxInputChars}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !text.trim() || (action === "run" && (!available || !budgetSet))}
                onClick={run}
              >
                {busy
                  ? "Processing…"
                  : action === "check"
                    ? "Check on the earlier request (won't run it again)"
                    : "Run"}
              </button>
              {action === "check" && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={!available || !budgetSet}
                  onClick={runNew}
                >
                  Run it as a new, separately paid request
                </button>
              )}
              <span className="muted" style={{ fontSize: 12.5 }}>
                {!budgetSet
                  ? "Set a runtime budget below first."
                  : `Each request holds up to ${list.budget.per_request_cents}¢ until it settles.`}
              </span>
            </div>
            {attempt?.message && (
              <p className={attempt.state === "refused" ? "error-text" : "notice"}>
                {attempt.message}
              </p>
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
                <Result i={last} onSaveCase={last.result ? saveCase : undefined} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
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
        <h3 style={{ fontSize: 15, marginTop: 14 }}>
          Your own test cases {fix.version ? `· version ${fix.version}` : ""}
        </h3>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {fix.note} They are added to the required checks, never instead of them.
        </p>
        {fix.cases.length === 0 ? (
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

      <section className="card">
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

      {latestRun && (
        <section className="card">
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

      <section className="card">
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
        <section className="card">
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
