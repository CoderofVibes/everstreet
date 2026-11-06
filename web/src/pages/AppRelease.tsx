// Job 006a (docs/design/WEB_APP_RELEASE.md): releasing a web app version to customers, from the
// web app view. The founder chooses free access or an access pass, reviews the exact customer
// terms (the server's digest), and releases on purpose; later they can release an update, roll
// back to an earlier release, or withdraw the app. Every action reads the releases back; nothing
// here is assumed from a request that didn't answer.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppVersion } from "../appApi.ts";
import { type AppTerms, type Releases, runtimeApi } from "../runtimeApi.ts";

type Access = "free" | "pass";

export function AppRelease({
  projectId,
  versions,
  selected,
}: {
  projectId: string;
  versions: AppVersion[];
  /** The version shown on the stage: the one a release would publish. */
  selected: AppVersion | null;
}) {
  const [view, setView] = useState<Releases | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>("pass");
  const [days, setDays] = useState(30);
  const [limitations, setLimitations] = useState("");
  const [reviewed, setReviewed] = useState<{
    job: string;
    terms: AppTerms & { app: string };
    digest: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const v = await runtimeApi.releases(projectId);
      if (mine !== seq.current) return;
      setView(v);
      setLoadError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setLoadError(e instanceof Error ? e.message : "Couldn't read the releases");
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Changed terms, or another version on the stage, always need a fresh review.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the inputs a review covers
  useEffect(() => setReviewed(null), [access, days, limitations, selected?.job_id]);

  const terms = () =>
    access === "pass"
      ? { access, pass_days: days, limitations: limitations.trim() }
      : { access, limitations: limitations.trim() };

  const act = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
      if (done) setNote(done);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
      await load(); // whatever happened, show what the server has now
    }
  };

  const numberOf = (job: string) => versions.find((v) => v.job_id === job)?.number ?? null;
  const label = (job: string) => {
    const n = numberOf(job);
    return n === null ? "An earlier version" : `Version ${n}`;
  };
  const accessWords = (t: AppTerms | null | undefined) =>
    !t ? "" : t.access === "free" ? "free to open" : `${t.pass_days}-day access pass`;

  const active = view?.active ?? null;
  const appReleases = (view?.releases ?? []).filter((r) => r.app_terms);
  const passed = selected?.latest_check?.state === "passed";

  return (
    <section className="card app-panel app-release" aria-labelledby="app-release-title">
      <h3 className="app-panel-title" id="app-release-title">
        Release to customers
      </h3>
      {loadError && (
        <p className="notice" role="status">
          Couldn't read the releases: {loadError}{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {view && (
        <p aria-live="polite">
          {active?.app_terms ? (
            <>
              <strong>{label(active.artifact_job)}</strong> is released,{" "}
              {accessWords(active.app_terms)}.{" "}
              {active.stand_in && <span className="pill caution">Stand-in release</span>}{" "}
              {!active.checks_current && (
                <span className="pill caution">Needs checking again: not serving</span>
              )}
            </>
          ) : appReleases.length > 0 ? (
            "Withdrawn: customers can't open the app. Passes already started keep working until they end."
          ) : (
            "Not released. Only you can open it, in the preview."
          )}
        </p>
      )}
      {active?.app_terms?.access === "free" && view?.app?.free_url && (
        <p>
          Customers open it at{" "}
          <a href={view.app.free_url} target="_blank" rel="noopener noreferrer">
            its address
          </a>
          . The address stays the same through updates, rollbacks and a sale.
        </p>
      )}
      {active?.app_terms?.access === "pass" && (
        <p className="muted app-note">
          Customers get a pass from an offer on your desk; each pass keeps the version it was bought
          on until it ends.
        </p>
      )}
      {active?.stand_in && (
        <p className="notice" role="note">
          Stand-in release: its logic checks ran on a test double, not an isolated worker. Every
          customer page says so.
        </p>
      )}

      {selected && (
        <fieldset className="app-release-form" disabled={busy}>
          <legend>
            Release version {selected.number}
            {active?.artifact_job === selected.job_id && " again, with new terms"}
          </legend>
          {!passed && (
            <p className="muted app-note">
              Its logic checks must pass in the isolated worker before it can be released.
            </p>
          )}
          <div role="radiogroup" aria-label="How customers get it" className="row">
            <label>
              <input
                type="radio"
                name="app-access"
                checked={access === "pass"}
                onChange={() => setAccess("pass")}
              />{" "}
              An access pass (one unit buys a number of days)
            </label>
            <label>
              <input
                type="radio"
                name="app-access"
                checked={access === "free"}
                onChange={() => setAccess("free")}
              />{" "}
              Free to open
            </label>
          </div>
          {access === "pass" && (
            <label className="field">
              <span>Days a pass lasts (1 to 365)</span>
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) =>
                  setDays(Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1))))
                }
              />
            </label>
          )}
          <label className="field">
            <span>Your own limitations, shown to customers (optional)</span>
            <textarea
              className="input"
              rows={2}
              maxLength={600}
              value={limitations}
              onChange={(e) => setLimitations(e.target.value)}
              placeholder="e.g. Estimates only; final prices are confirmed by email."
            />
          </label>
          <div className="app-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                act(async () => {
                  const r = await runtimeApi.appTerms(projectId, selected.job_id, terms());
                  setReviewed({ job: selected.job_id, terms: r.terms, digest: r.terms_digest });
                })
              }
            >
              Review customer terms
            </button>
          </div>
          {reviewed && reviewed.job === selected.job_id && (
            <section className="app-terms-review" aria-label="Customer terms">
              <dl className="use-consent-list">
                <dt>App</dt>
                <dd>{reviewed.terms.app}</dd>
                <dt>Access</dt>
                <dd>
                  {reviewed.terms.access === "free"
                    ? "Free to open, no account or charge"
                    : `One unit buys a ${reviewed.terms.pass_days}-day pass, charged when access starts`}
                </dd>
                <dt>What it is</dt>
                <dd>
                  {reviewed.terms.platform_limitations}
                  {reviewed.terms.limitations && ` ${reviewed.terms.limitations}`}
                </dd>
              </dl>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  act(async () => {
                    const run = await runtimeApi.check(projectId, selected.job_id);
                    await runtimeApi.releaseApp(projectId, {
                      artifact_job: selected.job_id,
                      eval_run: run.run.id,
                      app_terms: terms(),
                      terms_digest: reviewed.digest,
                    });
                    setReviewed(null); // released: these reviewed terms are now the release's own
                  }, `Version ${selected.number} is released.`)
                }
              >
                Release version {selected.number} to customers
              </button>
            </section>
          )}
        </fieldset>
      )}

      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}

      {active?.app_terms && (
        <p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() =>
              act(
                () => runtimeApi.withdraw(projectId),
                "Withdrawn. New customers can't open it; started passes keep working until they end.",
              )
            }
          >
            Withdraw the app
          </button>
        </p>
      )}

      {appReleases.length > 1 && (
        <details>
          <summary>Earlier releases ({appReleases.length - 1})</summary>
          <ul className="app-versions">
            {appReleases
              .filter((r) => r.id !== active?.id)
              .map((r) => (
                <li key={r.id} className="row">
                  <span>
                    {label(r.artifact_job)}, {accessWords(r.app_terms)}, released{" "}
                    {new Date(r.activated_at).toLocaleDateString()}
                  </span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => runtimeApi.rollback(projectId, r.id),
                        `Rolled back to ${label(r.artifact_job).toLowerCase()}.`,
                      )
                    }
                  >
                    Roll back to this
                  </button>
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
