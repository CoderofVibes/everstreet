// Job 002e: the Studio "Web app" view (docs/design/EXECUTABLE_PRODUCTS.md §1, §6). A founder
// generates or changes a small browser app (a budgeted build job), sees each immutable version
// with its isolated logic-check state in words, compares versions, makes one current (restore),
// runs logic checks (unpaid; never re-runs a generation) and previews it in a sandboxed frame
// from a separate site. Ordinary preview needs a real engine's pass; an unchecked version opens
// only through an explicit, warned choice. A preview is never presented as an isolation result.
//
// Job 001k: composed as a canvas (docs/design/CANVAS_STUDIO.md, "Executable canvas"). The working
// app is the stage, with one clearly named composer beside it ("Change the web app"). The version
// tools (picker, history, compare) are compact and keyboard-reachable. Selected, current and
// previewed versions are kept distinct by the pure rules in appCanvas.ts.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError } from "../api.ts";
import { type AppVersion, type AppVersionsView, appApi, newGenerationKey } from "../appApi.ts";
import {
  canvasReducer,
  currentOf,
  initialCanvas,
  rolesLine,
  rolesOf,
  selectedOf,
  stageOf,
} from "../appCanvas.ts";
import { Generations } from "../appGenerate.ts";
import { changedFiles, checkWords, lineDiff, previewMessage } from "../appView.ts";

const BUDGET = {
  max_input_tokens: 30_000,
  max_output_tokens: 8_000,
  max_seconds: 120,
  max_cost_cents: 100,
};
const POLL_MS = 1500;
const MAX_POLLS = 200;
export const COMPARE_OPEN_ID = "app-compare-open";
export const COMPARE_TITLE_ID = "app-compare-title";
export const HISTORY_ID = "app-history";
export const COMPOSER_ID = "app-composer-text";

/** One version in the history list: its roles, check state in words, and Select. */
export function AppVersionRow({
  v,
  roles,
  onSelect,
}: {
  v: AppVersion;
  roles: { selected: boolean; current: boolean; previewing: boolean };
  onSelect: () => void;
}) {
  const c = checkWords(v.latest_check?.state ?? null, v.latest_check?.test_double ?? false);
  return (
    <li className={`app-version${roles.selected ? " selected" : ""}`}>
      <div className="app-version-head">
        <button
          type="button"
          className="app-version-pick"
          aria-pressed={roles.selected}
          onClick={onSelect}
        >
          Version {v.number}: {v.name}
        </button>
        {roles.current && <span className="pill blue">Current</span>}
        {roles.selected && <span className="pill">Shown</span>}
        {roles.previewing && <span className="pill">In preview</span>}
        <span className={`pill ${c.tone}`}>{c.label}</span>
      </div>
      <p className="muted app-note">
        {v.files.length} files · digest <span className="mono">{v.digest.slice(0, 12)}</span>
        {v.instructions ? ` · asked: “${v.instructions.slice(0, 120)}”` : ""}
      </p>
    </li>
  );
}

/**
 * The sandboxed preview: opaque origin (no allow-same-origin), no popups, forms or top
 * navigation. Single page: any second load (the frame navigated itself) stops it.
 */
export function PreviewFrame({
  url,
  checked,
  version,
  onStop,
}: {
  url: string;
  checked: boolean;
  /** 001k: which version this frame is (the frame belongs to exactly one). */
  version?: number;
  onStop: (why: string | null) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (previewMessage(e, frame.current?.contentWindow ?? null) === "ready") setReady(true);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return (
    <section className="app-preview" aria-label="Preview">
      <div className="app-preview-bar">
        <strong>{version === undefined ? "Preview" : `Preview of version ${version}`}</strong>
        <span className={`pill ${checked ? "mint" : "caution"}`}>
          {checked ? "Logic checks passed" : "Unchecked"}
        </span>
        <span className="app-preview-state" role="status">
          {ready ? "Running in your browser" : "Loading…"}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStop(null)}>
          Stop
        </button>
      </div>
      <iframe
        ref={frame}
        className="app-preview-frame"
        title={version === undefined ? "Web app preview" : `Web app preview, version ${version}`}
        src={url}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => {
          loads.current++;
          if (loads.current > 1) onStop("The preview tried to open another page and was stopped.");
        }}
      />
      <p className="app-preview-note">
        It runs in your browser, sandboxed and from a separate site, with no network access and no
        access to Everstreet. Your browser doesn't limit its CPU or memory; Stop removes it.
      </p>
    </section>
  );
}

/** Comparison as a panel: focus moves to its title; Close or Escape returns it to Compare. */
function Compare({
  projectId,
  from,
  to,
  onClose,
}: {
  projectId: string;
  from: AppVersion;
  to: AppVersion;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<ReturnType<typeof changedFiles> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.getElementById(COMPARE_TITLE_ID)?.focus();
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([appApi.files(projectId, from.job_id), appApi.files(projectId, to.job_id)]).then(
      ([a, b]) => live && setFiles(changedFiles(a.bundle.files, b.bundle.files)),
      (e: unknown) =>
        live && setError(e instanceof Error ? e.message : "Couldn't load the versions"),
    );
    return () => {
      live = false;
    };
  }, [projectId, from.job_id, to.job_id]);
  return (
    <section
      className="card app-panel"
      aria-labelledby={COMPARE_TITLE_ID}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="app-version-head">
        <h3 id={COMPARE_TITLE_ID} tabIndex={-1} className="app-panel-title">
          What changed: version {from.number} → current version {to.number}
        </h3>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          Close comparison
        </button>
      </div>
      {error && <p className="notice error">{error}</p>}
      {!files && !error && <p className="muted">Loading both versions…</p>}
      {files?.length === 0 && <p className="muted">No file differs.</p>}
      {files?.map((f) => {
        const d = lineDiff(f.from, f.to);
        return (
          <div key={f.path} className="app-diff">
            <h4 className="mono">
              {f.path} <span className="muted">({f.status})</span>
            </h4>
            {d ? (
              <pre>
                {d
                  .filter((l) => l.kind !== "same")
                  .map((l, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity
                    <div key={i} className={`app-diff-${l.kind}`}>
                      {l.kind === "add" ? "+ " : "- "}
                      {l.text}
                    </div>
                  ))}
              </pre>
            ) : (
              <p className="muted">Too large to compare line by line here.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** A version's latest logic check in detail: each case and file, and cancel while it runs. */
export function CheckDetails({
  check,
  onCancel,
}: {
  check: AppVersionsView["checks"][number];
  onCancel: () => void;
}) {
  const r = check.result;
  return (
    <div className="app-check">
      {check.failure && (
        <p className="notice" role="status">
          {check.failure.detail || check.failure.code}
        </p>
      )}
      {r && (
        <ul className="app-cases">
          {r.syntax
            .filter((s) => !s.ok)
            .map((s) => (
              <li key={`s-${s.path}`}>
                <span className="pill error">Doesn't parse</span>{" "}
                <span className="mono">{s.path}</span> <span className="muted">{s.detail}</span>
              </li>
            ))}
          {r.cases.map((c) => (
            <li key={c.id}>
              <span className={`pill ${c.passed ? "mint" : "error"}`}>
                {c.passed ? "Matched" : "Didn't match"}
              </span>{" "}
              <span className="mono">{c.id}</span> <span className="muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {check.can_cancel && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          Cancel this check
        </button>
      )}
    </div>
  );
}

/**
 * The stage: the selected version running, the explicit unchecked choice, or a purposeful
 * placeholder with the real next action. Nothing here starts unchecked code by itself.
 */
export function AppStage({
  stage,
  busy,
  preview,
  onPreview,
  onOpenUnchecked,
  onDecline,
  onStop,
  hasDraft,
}: {
  stage: ReturnType<typeof stageOf>;
  busy: boolean;
  preview: { url: string; checked: boolean } | null;
  onPreview: () => void;
  onOpenUnchecked: () => void;
  onDecline: () => void;
  onStop: (why: string | null) => void;
  /** Whether the composer already holds a description (the empty stage says what to do). */
  hasDraft: boolean;
}) {
  let body: ReactNode;
  if (stage.kind === "empty")
    body = (
      <div className="app-stage-empty">
        <p className="app-stage-title">No web app yet</p>
        <p>
          {hasDraft
            ? "Your description is ready in the composer. Generating the first version uses this business's AI budget."
            : "Describe the app in “Change the web app” beside this stage, then generate its first version."}
        </p>
      </div>
    );
  else if (stage.kind === "preview" && preview)
    body = (
      <PreviewFrame
        key={preview.url}
        url={preview.url}
        checked={preview.checked}
        version={stage.version.number}
        onStop={onStop}
      />
    );
  else if (stage.kind === "unchecked_choice")
    body = (
      <div className="app-stage-empty" role="alert">
        <p className="app-stage-title">Version {stage.version.number} isn't checked</p>
        <p>
          Version {stage.version.number}'s logic checks haven't passed in the isolated worker, so it
          isn't opened as an ordinary preview. An unchecked preview runs its code in your browser,
          sandboxed, with nothing checked first.
        </p>
        <div className="app-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenUnchecked}>
            Open unchecked preview
          </button>
          <button type="button" className="btn btn-quiet on-ink" onClick={onDecline}>
            Not now
          </button>
        </div>
      </div>
    );
  else {
    const v = stage.version;
    const c = checkWords(v.latest_check?.state ?? null, v.latest_check?.test_double ?? false);
    body = (
      <div className="app-stage-empty">
        <p className="app-stage-title">
          Version {v.number}: {v.name}
        </p>
        <p>
          {stage.kind === "unconfigured"
            ? "Preview isn't configured on this server, so it can't run here."
            : `It isn't running. ${c.label}: ${c.detail}`}
        </p>
        {stage.kind === "ready" && (
          <div className="app-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onPreview}>
              Preview version {v.number}
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <section className="app-stage" aria-label="Web app stage">
      {body}
    </section>
  );
}

export function AppView({
  projectId,
  headRevision,
  scope,
  onShapeBrief,
}: {
  projectId: string;
  headRevision: number;
  /** person:project:owner-epoch (the parent's scope fence). */
  scope: string;
  /** 001k: go to the brief and its companion (the other, separately named assistant task). */
  onShapeBrief?: () => void;
}) {
  const [view, setView] = useState<AppVersionsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [c, dispatch] = useReducer(canvasReducer, initialCanvas);
  const [costCents, setCostCents] = useState(100);
  const polls = useRef(0);
  const seq = useRef(0);
  const [gen] = useState(
    () =>
      new Generations(appApi, {
        scope,
        storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
        newKey: newGenerationKey,
      }),
  );
  const g = useSyncExternalStore(gen.subscribe, gen.getState);

  // Ordered reads: only the newest answer lands. A definite 404 clears everything private; a
  // transient failure keeps the last view and offers Retry.
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const v = await appApi.versions(projectId);
      if (mine !== seq.current) return;
      setView(v);
      dispatch({ type: "versions", versions: v.versions });
      setLoadError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setGone(true);
        setView(null);
        dispatch({ type: "gone" });
        return;
      }
      setLoadError(e instanceof Error ? e.message : "Couldn't load the web app");
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Poll finitely, only while something is in flight.
  // 002e1: a job recovered after a reload is "unknown" until read; it counts as unfinished.
  const jobLive =
    g.job !== null && ["queued", "running", "validating", "unknown"].includes(g.job.state);
  const inFlight =
    jobLive || (view?.checks ?? []).some((x) => x.state === "queued" || x.state === "running");
  const [pollStopped, setPollStopped] = useState(false);
  const checkProgress = async () => {
    polls.current = 0;
    setPollStopped(false);
    await gen.refresh();
    await load();
  };
  useEffect(() => {
    if (!inFlight) {
      polls.current = 0;
      return;
    }
    const t = setTimeout(async () => {
      if (++polls.current > MAX_POLLS) {
        setPollStopped(true); // automatic checking stops; "Check progress" stays available
        return;
      }
      if (g.job) await gen.refresh();
      await load();
    }, POLL_MS);
    return () => clearTimeout(t);
  });

  // 001k: a finished generation's version is shown on the stage (once), current or not.
  const shownGeneration = useRef<string | null>(null);
  useEffect(() => {
    const j = g.job;
    if (j?.state !== "succeeded" || shownGeneration.current === j.id) return;
    shownGeneration.current = j.id;
    dispatch({ type: "generated", job: j.id });
    void load();
  }, [g.job, load]);

  // 001k: focus follows the comparison panel, and returns to the control that opened it.
  const compareReturn = useRef<string | null>(null);
  useEffect(() => {
    if (c.compare) compareReturn.current = c.compare.returnTo;
    else if (compareReturn.current) {
      document.getElementById(compareReturn.current)?.focus();
      compareReturn.current = null;
    }
  }, [c.compare]);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    dispatch({ type: "note", note: null });
    try {
      await f();
      await load();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "not_checked"))
        dispatch({ type: "note", note: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  };
  const current = currentOf(c.versions);
  const selected = selectedOf(c);
  const openPreview = (v: AppVersion, unchecked: boolean) =>
    act(async () => {
      dispatch({ type: "declineUnchecked" });
      try {
        const p = await appApi.preview(projectId, v.job_id, unchecked);
        dispatch({ type: "previewOpened", job: v.job_id, url: p.url, checked: p.checked });
      } catch (e) {
        if (e instanceof ApiError && e.code === "not_checked")
          dispatch({ type: "previewRefused", job: v.job_id });
        throw e;
      }
    });
  const budget = { ...BUDGET, max_cost_cents: costCents };
  const submit = () =>
    void gen.submit({
      project_id: projectId,
      revision: headRevision,
      base_job: current?.job_id ?? null,
      budget,
    });

  if (gone) return <p className="notice">This web app is no longer available to you here.</p>;
  if (!view)
    return loadError ? (
      <p className="notice error">
        {loadError}{" "}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
          Retry
        </button>
      </p>
    ) : (
      <p className="muted">Loading the web app…</p>
    );

  const stage = stageOf(c, view.preview_available);
  const selectedCheck = selected
    ? (view.checks.find((x) => x.id === selected.latest_check?.id) ?? null)
    : null;
  const selectedWords = selected
    ? checkWords(selected.latest_check?.state ?? null, selected.latest_check?.test_double ?? false)
    : null;
  const checkRunning =
    selected?.latest_check?.state === "queued" || selected?.latest_check?.state === "running";
  const compareFrom = c.compare
    ? (c.versions.find((v) => v.job_id === c.compare?.from) ?? null)
    : null;
  const compareTo = c.compare ? (c.versions.find((v) => v.job_id === c.compare?.to) ?? null) : null;

  return (
    <div className="app-canvas">
      {loadError && (
        <p className="notice" role="status">
          Couldn't refresh: {loadError}. Showing what was last read.{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {/* The version tools: compact, keyboard-reachable, above the stage. */}
      <section className="app-toolbar" aria-label="Version tools">
        {c.versions.length > 0 && selected && (
          <label className="app-pick">
            <span>Version</span>
            <select
              className="input"
              value={selected.job_id}
              onChange={(e) => dispatch({ type: "select", job: e.target.value })}
            >
              {[...c.versions]
                .sort((a, b) => b.number - a.number)
                .map((v) => (
                  <option key={v.job_id} value={v.job_id}>
                    Version {v.number}: {v.name}
                    {v.current ? " (current)" : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        {selected && selectedWords && (
          <span className="app-toolbar-pills">
            {selected.current ? (
              <span className="pill blue">Current</span>
            ) : (
              <span className="pill">Not current</span>
            )}
            <span className={`pill ${selectedWords.tone}`}>{selectedWords.label}</span>
          </span>
        )}
        <span className="spacer" />
        {selected && (
          <span className="app-toolbar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || checkRunning}
              onClick={() => act(() => appApi.check(projectId, selected.job_id))}
            >
              Run logic checks
            </button>
            {!selected.current && (
              <>
                <button
                  type="button"
                  id={COMPARE_OPEN_ID}
                  className="btn btn-quiet btn-sm"
                  aria-expanded={c.compare !== null}
                  onClick={() =>
                    dispatch(
                      c.compare
                        ? { type: "closeCompare" }
                        : { type: "openCompare", returnTo: COMPARE_OPEN_ID },
                    )
                  }
                >
                  Compare with current
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(() => appApi.setCurrent(projectId, selected.job_id, "Restored in Studio"))
                  }
                >
                  Make this the current version
                </button>
              </>
            )}
          </span>
        )}
        {c.versions.length > 0 && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-expanded={c.history}
            aria-controls={HISTORY_ID}
            onClick={() => dispatch({ type: "toggleHistory" })}
          >
            {c.history ? "Hide history" : `History (${c.versions.length})`}
          </button>
        )}
      </section>
      <p className="app-roles muted" aria-live="polite">
        {rolesLine(c)}
      </p>
      {c.note && (
        <p className="notice" role="status">
          {c.note}
        </p>
      )}

      <div className="app-work">
        <div className="app-stage-col">
          <AppStage
            stage={stage}
            busy={busy}
            preview={c.preview}
            hasDraft={g.draft.trim().length > 0}
            onPreview={() => selected && openPreview(selected, false)}
            onOpenUnchecked={() => selected && openPreview(selected, true)}
            onDecline={() => dispatch({ type: "declineUnchecked" })}
            onStop={(why) => dispatch({ type: "stop", why })}
          />
          {c.compare && compareFrom && compareTo && (
            <Compare
              projectId={projectId}
              from={compareFrom}
              to={compareTo}
              onClose={() => dispatch({ type: "closeCompare" })}
            />
          )}
          {c.history && (
            <section className="card app-panel" id={HISTORY_ID} aria-label="Version history">
              <h3 className="app-panel-title">Version history</h3>
              <p className="muted app-note">
                Selecting a version shows it here; it doesn't make it current or check it.
              </p>
              <ul className="app-versions">
                {[...c.versions]
                  .sort((a, b) => b.number - a.number)
                  .map((v) => (
                    <AppVersionRow
                      key={v.job_id}
                      v={v}
                      roles={rolesOf(c, v.job_id)}
                      onSelect={() => dispatch({ type: "select", job: v.job_id })}
                    />
                  ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="app-composer" aria-label="Change the web app">
          <div className="ctx-head">
            <span className="ctx-kicker">Assistant · code</span>
            <h3 className="ctx-title">Change the web app</h3>
          </div>
          <div className="app-composer-body">
            <p className="muted app-note">
              This writes new code for the app as a new version. It uses this business's AI budget;
              logic checks cost nothing.
              {onShapeBrief && (
                <>
                  {" "}
                  To change the business brief instead,{" "}
                  <button type="button" className="link-btn" onClick={onShapeBrief}>
                    shape the brief
                  </button>
                  .
                </>
              )}
            </p>
            {g.pending && g.unanswered ? (
              <div className="notice" role="status">
                <p>{g.notice ?? "Your earlier generation request didn't get an answer."}</p>
                <p className="muted app-note">Asked: “{g.pending.instructions.slice(0, 200)}”</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={g.busy}
                  onClick={submit}
                >
                  Recover my request
                </button>
              </div>
            ) : null}
            <label className="field">
              <span>{current ? "What should change in the app?" : "Describe the app"}</span>
              <textarea
                id={COMPOSER_ID}
                className="input"
                rows={4}
                maxLength={2000}
                value={g.draft}
                onChange={(e) => gen.setDraft(e.target.value)}
              />
            </label>
            {current && selected && !selected.current && (
              <p className="muted app-note">
                A change starts from the current version ({current.number}), not the one shown.
              </p>
            )}
            <label className="field app-budget">
              <span>Spend at most (cents of this business's AI budget)</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100000}
                value={costCents}
                onChange={(e) =>
                  setCostCents(
                    Math.max(1, Math.min(100_000, Math.floor(Number(e.target.value) || 1))),
                  )
                }
              />
              <small className="muted">
                Up to {BUDGET.max_input_tokens.toLocaleString()} input and{" "}
                {BUDGET.max_output_tokens.toLocaleString()} output tokens, {BUDGET.max_seconds}{" "}
                seconds. The provider's prices decide whether this limit fits.
              </small>
            </label>
            <div className="app-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={g.busy || jobLive || g.pending !== null || !g.draft.trim()}
                onClick={submit}
              >
                {current ? "Generate a changed version" : "Generate the first version"}
              </button>
              {jobLive && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={g.busy}
                  onClick={() => void gen.cancel()}
                >
                  Cancel the generation
                </button>
              )}
            </div>
            {g.job && (
              <div className="notice" role="status">
                <p>
                  {g.job.state === "unknown"
                    ? "A generation you started is still known here; reading its progress…"
                    : jobLive
                      ? `Generating: ${g.job.state}.`
                      : g.job.state === "succeeded"
                        ? "The new version is ready on the stage."
                        : `The generation ended (${g.job.state})${g.job.failure ? `: ${g.job.failure.detail}` : "."}`}
                  {g.readFailed && " Its progress couldn't be read just now."}
                  {pollStopped && jobLive && " Automatic checking has stopped."}
                </p>
                {jobLive && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={g.busy}
                    onClick={() => void checkProgress()}
                  >
                    Check progress
                  </button>
                )}
              </div>
            )}
            {g.notice && !g.unanswered && <p className="notice">{g.notice}</p>}
          </div>
          {selected && selectedWords && (
            <div className="app-composer-checks">
              <h4>Logic checks for version {selected.number}</h4>
              <p className="muted app-note">
                {selectedWords.detail} They run this version's own declared cases on its logic
                module in an isolated worker; they don't check the screens.
              </p>
              {selectedCheck && (
                <CheckDetails
                  check={selectedCheck}
                  onCancel={() => act(() => appApi.cancelCheck(selectedCheck.id))}
                />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
