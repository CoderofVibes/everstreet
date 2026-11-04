// Job 002e: the Studio "Web app" view (docs/design/EXECUTABLE_PRODUCTS.md §1, §6). A founder
// generates or changes a small browser app (a budgeted build job), sees each immutable version
// with its isolated logic-check state in words, compares versions, makes one current (restore),
// runs logic checks (unpaid; never re-runs a generation) and previews it in a sandboxed frame
// from a separate site. Ordinary preview needs a real engine's pass; an unchecked version opens
// only through an explicit, warned choice. A preview is never presented as an isolation result.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { type AppVersion, type AppVersionsView, appApi } from "../appApi.ts";
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
}: {
  v: AppVersion;
  busy: boolean;
  onCurrent: () => void;
  onCheck: () => void;
  onPreview: () => void;
  onCompare: () => void;
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

export function AppView({ projectId, headRevision }: { projectId: string; headRevision: number }) {
  const [view, setView] = useState<AppVersionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; checked: boolean } | null>(null);
  const [offerUnchecked, setOfferUnchecked] = useState<AppVersion | null>(null);
  const [compare, setCompare] = useState<AppVersion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const polls = useRef(0);

  // Stable per project, so loading runs once per project (the view is keyed by scope).
  const load = useCallback(
    () =>
      appApi.versions(projectId).then(
        (v) => {
          setView(v);
          setError(null);
        },
        (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the web app"),
      ),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is in flight, and finitely.
  const inFlight =
    generating !== null ||
    (view?.checks ?? []).some((c) => c.state === "queued" || c.state === "running");
  useEffect(() => {
    if (!inFlight) {
      polls.current = 0;
      return;
    }
    const t = setTimeout(async () => {
      if (++polls.current > MAX_POLLS) return;
      if (generating) {
        const j = await appApi.build(generating).catch(() => null);
        if (
          j &&
          ["succeeded", "failed", "cancelled", "needs_reconciliation"].includes(j.job.state)
        ) {
          setGenerating(null);
          if (j.job.state !== "succeeded")
            setNote(j.job.failure?.detail ?? `The generation ended: ${j.job.state}`);
        }
      }
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
      if (e instanceof ApiError && e.code === "not_checked") return;
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

  if (error) return <p className="notice error">{error}</p>;
  if (!view) return <p className="muted">Loading the web app…</p>;
  return (
    <div className="app-view">
      <section className="card">
        <h2>Web app</h2>
        <p className="muted app-note">
          A small browser app generated from this product. Each version is kept. Logic checks run in
          an isolated worker and cost nothing; generating uses this business's AI budget.
        </p>
        <label className="field">
          <span>{current ? "What should change?" : "Describe the app"}</span>
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || generating !== null || !instructions.trim()}
          onClick={() =>
            act(async () => {
              const r = await appApi.generate(
                projectId,
                headRevision,
                instructions.trim(),
                current?.job_id ?? null,
                BUDGET,
              );
              setGenerating(r.job.id);
              setInstructions("");
            })
          }
        >
          {generating
            ? "Generating…"
            : current
              ? "Generate a changed version"
              : "Generate the first version"}
        </button>
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
            {view.versions.map((v) => (
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
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
