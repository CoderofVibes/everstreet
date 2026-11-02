// The studio's Service tab (job 002c): run a checked version of the product on pasted text,
// see the validated result and its request record, keep test cases, check a version against
// them, and release or roll back. Owner-only private trials before customers are connected.
// With no runtime connected it says so; sample buttons only fill the text box.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import {
  type Candidate,
  type EvalRun,
  type Fixtures,
  type Invocation,
  type Releases,
  type RuntimeList,
  runtimeApi,
} from "../runtimeApi.ts";
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
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Invocation | null>(null);
  const [lastText, setLastText] = useState("");
  /** The request in progress: same text and version reuse its key, so a resend isn't new work. */
  const attempt = useRef<{ key: string; text: string; version: string } | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const [l, r, f, e] = await Promise.all([
        runtimeApi.list(projectId),
        runtimeApi.releases(projectId),
        runtimeApi.fixtures(projectId),
        runtimeApi.runs(projectId),
      ]);
      if (!live.current) return;
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
      if (live.current) setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  // Follow a running check until it finishes.
  const running = runs.find((r) => r.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(load, 1500);
    return () => window.clearTimeout(t);
  }, [running, load]);

  if (error && !list) return <p className="error-text">{error}</p>;
  if (!list || !rel || !fix) return <p className="muted">Loading the service…</p>;
  const available = list.availability.available;
  const budgetSet = list.budget.limit_cents !== null;
  const candidates = rel.candidates;
  const chosen: Candidate | undefined = version.startsWith("job:")
    ? candidates.find((c) => `job:${c.artifact_job}` === version)
    : undefined;

  const run = async () => {
    if (!text.trim() || busy) return;
    const same =
      attempt.current && attempt.current.text === text && attempt.current.version === version;
    const key = same && attempt.current ? attempt.current.key : newKey("run");
    attempt.current = { key, text, version };
    setBusy(true);
    setNotice(null);
    try {
      const { invocation } = await runtimeApi.invoke(projectId, {
        idempotency_key: key,
        text,
        ...(version === "release" ? { release: true } : { artifact_job: chosen?.artifact_job }),
      });
      attempt.current = null; // answered: the next run is new work
      setLast(invocation);
      setLastText(text);
      load();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status >= 400 && status < 500) attempt.current = null;
      setNotice(
        status >= 400 && status < 500
          ? (e as Error).message
          : "No answer arrived. Run again with the same text to check on it; it won't be processed twice.",
      );
    } finally {
      setBusy(false);
    }
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
              <span>Pasted text (not stored after processing)</span>
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
                disabled={!available || !budgetSet || busy || !text.trim()}
                onClick={run}
              >
                {busy ? "Processing…" : "Run"}
              </button>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {!budgetSet
                  ? "Set a runtime budget below first."
                  : `Each request holds up to ${list.budget.per_request_cents}¢ until it settles.`}
              </span>
            </div>
            {last && (
              <div style={{ marginTop: 12 }}>
                <Result i={last} onSaveCase={last.result ? saveCase : undefined} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Test cases {fix.version ? `· version ${fix.version}` : ""}</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {fix.note}
        </p>
        {fix.version === null ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              try {
                setFix(
                  await runtimeApi.saveFixtures(projectId, {
                    source: "curated",
                    base_version: null,
                  }),
                );
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            Use the {fix.curated.name.toLowerCase()} ({fix.curated.cases.length} cases)
          </button>
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
              disabled={!available || fix.version === null || Boolean(running) || checking !== null}
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
            {latestRun.basis} Test cases version {latestRun.fixture_version} · model{" "}
            {latestRun.provider_config.model ?? "—"} · {latestRun.validator} · cost $
            {(latestRun.used_microcents / 100_000_000).toFixed(6)}
            {latestRun.held_cents ? ` plus ${latestRun.held_cents}¢ unresolved` : ""}
          </p>
          {latestRun.results.map((r) => (
            <details key={r.id} className="advanced">
              <summary>
                <span className={`pill ${SCORE_CLASS[r.score]}`}>{SCORE_TEXT[r.score]}</span>{" "}
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
