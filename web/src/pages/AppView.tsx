// Job 002e: the Studio "Web app" view (docs/design/EXECUTABLE_PRODUCTS.md §1, §6). A founder
// generates or changes a small browser app (a budgeted build job), sees each immutable version
// with its isolated logic-check state in words, compares versions, makes one current (restore),
// runs logic checks (unpaid; never re-runs a generation) and previews it in a sandboxed frame
// from a separate site. Ordinary preview needs a real engine's pass; an unchecked version opens
// only through an explicit, warned choice. A preview is never presented as an isolation result.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError } from "../api.ts";
import { type AppVersion, type AppVersionsView, appApi, newGenerationKey } from "../appApi.ts";
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

export function AppVersionRow({
  v,
  busy,
  onCurrent,
  onCheck,
  onPreview,
  onCompare,
  children,
}: {
  v: AppVersion;
  busy: boolean;
  onCurrent: () => void;
  onCheck: () => void;
  onPreview: () => void;
  onCompare: () => void;
  /** The version's check details, inside its list item. */
  children?: ReactNode;
}) {
  const c = checkWords(v.latest_check?.state ?? null, v.latest_check?.test_double ?? false);
  const running = v.latest_check?.state === "queued" || v.latest_check?.state === "running";
  return (
    <li className="app-version">
      <div className="app-version-head">
        <strong>
          Version {v.number}: {v.name}
        </strong>
        {v.current && <span className="pill blue">Current</span>}
        <span className={`pill ${c.tone}`}>{c.label}</span>
      </div>
      <p className="muted app-note">
        {c.detail} {v.files.length} files · digest{" "}
        <span className="mono">{v.digest.slice(0, 12)}</span>
        {v.instructions ? ` · asked: “${v.instructions.slice(0, 120)}”` : ""}
      </p>
      <div className="app-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || running}
          onClick={onCheck}
        >
          Run logic checks
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={onPreview}
        >
          Preview
        </button>
        {!v.current && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={onCurrent}
          >
            Make this the current version
          </button>
        )}
        {!v.current && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={onCompare}
          >
            Compare with current
          </button>
        )}
      </div>
      {children}
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
  onStop,
}: {
  url: string;
  checked: boolean;
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
    <section className="card app-preview" aria-label="Preview">
      <div className="app-version-head">
        <strong>Preview</strong>
        <span className={`pill ${checked ? "mint" : "caution"}`}>
          {checked ? "Logic checks passed" : "Unchecked"}
        </span>
        <span className="muted app-note" role="status">
          {ready ? "Running in your browser" : "Loading…"}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStop(null)}>
          Stop
        </button>
      </div>
      <p className="muted app-note">
        It runs in your browser, sandboxed and from a separate site, with no network access and no
        access to Everstreet. Your browser doesn't limit its CPU or memory; Stop removes it.
      </p>
      <iframe
        ref={frame}
        className="app-preview-frame"
        title="Web app preview"
        src={url}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => {
          loads.current++;
          if (loads.current > 1) onStop("The preview tried to open another page and was stopped.");
        }}
      />
    </section>
  );
}

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
    <section className="card" aria-label="Compare versions">
      <div className="app-version-head">
        <strong>
          Version {from.number} → version {to.number}
        </strong>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <p className="notice error">{error}</p>}
      {files?.length === 0 && <p className="muted">No file differs.</p>}
      {files?.map((f) => {
        const d = lineDiff(f.from, f.to);
        return (
          <div key={f.path} className="app-diff">
            <h3 className="mono">
              {f.path} <span className="muted">({f.status})</span>
            </h3>
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
      <p className="muted app-note">
        Logic checks run this version's own declared cases on its logic module, in an isolated
        worker. They don't check the screens: use Preview for that, and try it yourself.
      </p>
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

export function AppView({
  projectId,
  headRevision,
  scope,
}: {
  projectId: string;
  headRevision: number;
  /** person:project:owner-epoch (the parent's scope fence). */
  scope: string;
}) {
  const [view, setView] = useState<AppVersionsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; checked: boolean } | null>(null);
  const [offerUnchecked, setOfferUnchecked] = useState<AppVersion | null>(null);
  const [compare, setCompare] = useState<AppVersion | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setGone(true);
        setView(null);
        setPreview(null);
        setCompare(null);
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
    jobLive || (view?.checks ?? []).some((c) => c.state === "queued" || c.state === "running");
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

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
      await load();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "not_checked"))
        setNote(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const current = view?.versions.find((v) => v.current) ?? null;
  const openPreview = (v: AppVersion, unchecked: boolean) =>
    act(async () => {
      setOfferUnchecked(null);
      try {
        const p = await appApi.preview(projectId, v.job_id, unchecked);
        setPreview({ url: p.url, checked: p.checked });
      } catch (e) {
        if (e instanceof ApiError && e.code === "not_checked") setOfferUnchecked(v);
        throw e;
      }
    });
  const budget = { ...BUDGET, max_cost_cents: costCents };

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
  return (
    <div className="app-view">
      {loadError && (
        <p className="notice" role="status">
          Couldn't refresh: {loadError}. Showing what was last read.{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      <section className="card">
        <h2>Web app</h2>
        <p className="muted app-note">
          A small browser app generated from this product. Each version is kept. Generating uses
          this business's AI budget; logic checks cost nothing.
        </p>
        {g.pending && g.unanswered ? (
          <div className="notice" role="status">
            <p>{g.notice ?? "Your earlier generation request didn't get an answer."}</p>
            <p className="muted app-note">Asked: “{g.pending.instructions.slice(0, 200)}”</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={g.busy}
              onClick={() =>
                void gen.submit({
                  project_id: projectId,
                  revision: headRevision,
                  base_job: current?.job_id ?? null,
                  budget,
                })
              }
            >
              Recover my request
            </button>
          </div>
        ) : null}
        <label className="field">
          <span>{current ? "What should change?" : "Describe the app"}</span>
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            value={g.draft}
            onChange={(e) => gen.setDraft(e.target.value)}
          />
        </label>
        <label className="field app-budget">
          <span>Spend at most (cents of this business's AI budget)</span>
          <input
            className="input"
            type="number"
            min={1}
            max={100000}
            value={costCents}
            onChange={(e) =>
              setCostCents(Math.max(1, Math.min(100_000, Math.floor(Number(e.target.value) || 1))))
            }
          />
          <small className="muted">
            Up to {BUDGET.max_input_tokens.toLocaleString()} input and{" "}
            {BUDGET.max_output_tokens.toLocaleString()} output tokens, {BUDGET.max_seconds} seconds.
            The provider's prices decide whether this limit fits.
          </small>
        </label>
        <div className="app-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={g.busy || jobLive || g.pending !== null || !g.draft.trim()}
            onClick={() =>
              void gen.submit({
                project_id: projectId,
                revision: headRevision,
                base_job: current?.job_id ?? null,
                budget,
              })
            }
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
                    ? "The new version is ready below."
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
        {note && (
          <p className="notice" role="status">
            {note}
          </p>
        )}
      </section>

      {offerUnchecked && (
        <section className="card" role="alert">
          <p>
            Version {offerUnchecked.number}'s logic checks haven't passed in the isolated worker, so
            it isn't opened as an ordinary preview. An unchecked preview runs its code in your
            browser, sandboxed, with nothing checked first.
          </p>
          <div className="app-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openPreview(offerUnchecked, true)}
            >
              Open unchecked preview
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setOfferUnchecked(null)}>
              Not now
            </button>
          </div>
        </section>
      )}
      {preview && (
        <PreviewFrame
          key={preview.url}
          url={preview.url}
          checked={preview.checked}
          onStop={(why) => {
            setPreview(null);
            if (why) setNote(why);
          }}
        />
      )}
      {!view.preview_available && <p className="muted">Preview isn't configured here.</p>}
      {compare && current && (
        <Compare
          projectId={projectId}
          from={compare}
          to={current}
          onClose={() => setCompare(null)}
        />
      )}

      <section className="card">
        <h2>Versions</h2>
        {view.versions.length === 0 ? (
          <p className="muted">No version yet.</p>
        ) : (
          <ul className="app-versions">
            {view.versions.map((v) => {
              const check = view.checks.find((c) => c.id === v.latest_check?.id) ?? null;
              return (
                <AppVersionRow
                  key={v.job_id}
                  v={v}
                  busy={busy}
                  onCurrent={() =>
                    act(() => appApi.setCurrent(projectId, v.job_id, "Restored in Studio"))
                  }
                  onCheck={() => act(() => appApi.check(projectId, v.job_id))}
                  onPreview={() => openPreview(v, false)}
                  onCompare={() => setCompare(v)}
                >
                  {check && (
                    <CheckDetails
                      check={check}
                      onCancel={() => act(() => appApi.cancelCheck(check.id))}
                    />
                  )}
                </AppVersionRow>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
