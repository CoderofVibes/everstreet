// The studio's Builds view: persisted build jobs for this project, their events, usage and
// checked artifact. A build can be started only when a real, priced provider is connected;
// otherwise the view says so and offers nothing that looks like a build. While a job is live
// the view checks back with growing gaps (2 s up to 15 s) and stops after 60 checks.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import {
  ago,
  BUILD_STATE_LABEL,
  type BuildBudget,
  type BuildEventRow,
  type BuildJob,
  type BuildList,
  isLive,
  productsApi,
} from "../productsApi.ts";
import { money } from "../ui.tsx";

const MAX_POLLS = 60;
const newKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const cents = (n: number) => money(n) ?? "$0";

const STATE_CLASS: Record<BuildJob["state"], string> = {
  queued: "",
  running: "blue",
  validating: "blue",
  succeeded: "mint",
  failed: "caution",
  cancelled: "",
  needs_reconciliation: "caution",
};

function usageText(job: BuildJob) {
  if (job.usage_state === "reported")
    return `${cents(job.charged_cents)} · ${job.input_tokens.toLocaleString()} in / ${job.output_tokens.toLocaleString()} out tokens`;
  if (job.usage_state === "unknown")
    return `Unknown: ${cents(job.reserved_cents)} stays reserved until it is reconciled`;
  return job.dispatched ? "Not reported yet" : "None: nothing was sent";
}

function describe(e: BuildEventRow): string {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case "queued":
      return `Requested for revision ${d.revision}; up to ${cents(Number(d.reserved_cents))} reserved`;
    case "claimed":
      return `A worker took it (attempt ${e.attempt})`;
    case "dispatched":
      return "Sent to the provider";
    case "progress":
      return String(d.message ?? "");
    case "usage":
      return `Usage reported: ${d.input_tokens} in / ${d.output_tokens} out tokens, ${cents(Number(d.cents))}`;
    case "output_received":
      return "Output received";
    case "validating":
      return "Checking the output";
    case "checks": {
      const checks = (d.checks as { id: string; passed: boolean }[] | undefined) ?? [];
      return `Checks: ${checks.filter((c) => c.passed).length} of ${checks.length} passed`;
    }
    case "succeeded":
      return "Built and checked";
    case "failed":
      return `Failed (${String(d.code ?? "error").replace(/_/g, " ")})`;
    case "cancel_requested":
      return "Cancel requested";
    case "cancelled":
      return "Cancelled";
    case "fenced":
      return "Stopped: the business changed hands";
    case "recovery":
      return String(d.reason ?? "Recovered after a restart");
    case "needs_reconciliation":
      return "Outcome unknown; held for reconciliation";
    case "limit_exceeded":
      return String(d.detail ?? "The provider exceeded the request's limits");
    case "usage_unreadable":
      return "The provider sent usage that could not be read";
    default:
      return e.type.replace(/_/g, " ");
  }
}

function JobDetail({ summary, onChanged }: { summary: BuildJob; onChanged: () => void }) {
  const [full, setFull] = useState<BuildJob | null>(null);
  const [events, setEvents] = useState<BuildEventRow[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(() => newKey("retry"));
  const lastSeq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: state and event count are triggers: reload when the job moves
  useEffect(() => {
    let gone = false;
    productsApi
      .build(summary.id)
      .then((r) => !gone && setFull(r.job))
      .catch((e) => !gone && setError((e as Error).message));
    productsApi
      .buildEvents(summary.id, lastSeq.current)
      .then((r) => {
        if (gone) return;
        const fresh = r.events.filter((x) => x.seq > lastSeq.current);
        const last = fresh[fresh.length - 1];
        if (!last) return;
        lastSeq.current = last.seq;
        setEvents((prev) => [...prev, ...fresh]);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [summary.id, summary.event_count, summary.state]);

  const job = full ?? summary;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="check-group version-detail" style={{ margin: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <h3 style={{ fontSize: 17, margin: 0 }}>Build of revision {job.revision}</h3>
        <span className={`pill ${STATE_CLASS[job.state]}`}>{BUILD_STATE_LABEL[job.state]}</span>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Requested by {job.requested_by} {ago(job.created_at)} · {job.provider} · attempt{" "}
        {job.attempt || "not started"}
        {job.retry_of ? " · a retry" : ""}
      </p>
      <dl className="doc-grid" style={{ marginTop: 8 }}>
        <dt>Limits</dt>
        <dd>
          {job.budget.max_input_tokens.toLocaleString()} in /{" "}
          {job.budget.max_output_tokens.toLocaleString()} out tokens, {job.budget.max_seconds} s,
          cost limit {cents(job.budget.max_cost_cents)}
        </dd>
        <dt>Reserved</dt>
        <dd>{cents(job.reserved_cents)}</dd>
        <dt>Usage</dt>
        <dd>{usageText(job)}</dd>
        {job.failure && (
          <>
            <dt>Why</dt>
            <dd>{job.failure.detail}</dd>
          </>
        )}
        {job.artifact && (
          <>
            <dt>Artifact</dt>
            <dd>
              {job.artifact.kind}/{job.artifact.schema_version} ·{" "}
              <span className="mono" title={job.artifact.digest}>
                {job.artifact.digest.slice(0, 12)}
              </span>{" "}
              · {job.artifact.bytes.toLocaleString()} bytes
              <div className="muted" style={{ fontSize: 13 }}>
                A checked description of the service ({job.artifact.spec.fields?.length ?? 0}{" "}
                fields). It does not run yet; a managed runtime comes in a later slice.
              </div>
            </dd>
            <dt>Checks</dt>
            <dd>
              {job.artifact.checks.map((c) => (
                <div key={c.id}>
                  {c.passed ? "✓" : "✗"} {c.label}
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
      {error && <p className="error-text">{error}</p>}
      <div className="row" style={{ marginTop: 14, gap: 8 }}>
        {job.can_cancel && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || job.cancel_requested}
            onClick={() => act(() => productsApi.cancelBuild(job.id))}
          >
            {job.cancel_requested ? "Cancelling…" : "Cancel build"}
          </button>
        )}
        {job.can_retry && (
          <>
            {job.retry_needs_ack && (
              <label className="check" style={{ margin: 0, fontSize: 13.5 }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  The earlier attempt may have run and cost money. Start a new, separately reserved
                  attempt anyway.
                </span>
              </label>
            )}
            <button
              type="button"
              className="btn btn-dark"
              disabled={busy || (job.retry_needs_ack && !ack)}
              onClick={() =>
                act(async () => {
                  await productsApi.retryBuild(job.id, retryKey, ack);
                  setRetryKey(newKey("retry"));
                })
              }
            >
              Retry as a new build
            </button>
          </>
        )}
      </div>
      <h4 style={{ fontSize: 14, marginTop: 18 }}>Events</h4>
      <ol className="build-events">
        {events.map((e) => (
          <li key={e.seq}>
            <span className="muted mono">{new Date(e.at).toLocaleTimeString()}</span> {describe(e)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StartBuild({
  projectId,
  revision,
  list,
  onStarted,
}: {
  projectId: string;
  revision: number;
  list: BuildList;
  onStarted: (job: BuildJob) => void;
}) {
  const [budget, setBudget] = useState<BuildBudget>({
    max_input_tokens: 20_000,
    max_output_tokens: 4_000,
    max_seconds: 120,
    max_cost_cents: 0,
  });
  const [key, setKey] = useState(() => newKey("build"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = list.pricing;
  const worst = p
    ? Math.ceil(
        (budget.max_input_tokens * p.inputCentsPerMillionTokens +
          budget.max_output_tokens * p.outputCentsPerMillionTokens) /
          1_000_000,
      )
    : null;
  const costLimit = budget.max_cost_cents || worst || 0;
  const set = (k: keyof BuildBudget, v: string) =>
    setBudget({ ...budget, [k]: Math.max(0, Math.floor(Number(v) || 0)) });
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await productsApi.startBuild(projectId, {
        idempotency_key: key,
        revision,
        budget: { ...budget, max_cost_cents: costLimit },
      });
      setKey(newKey("build"));
      onStarted(r.job);
    } catch (e) {
      // The same key is kept, so trying again cannot start a second build.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fields: [keyof BuildBudget, string][] = [
    ["max_input_tokens", "Input tokens"],
    ["max_output_tokens", "Output tokens"],
    ["max_seconds", "Seconds"],
  ];
  return (
    <section className="check-group">
      <h3>
        <Icon name="spark" /> Build revision {revision}
      </h3>
      <div className="grid-2" style={{ gap: 8 }}>
        {fields.map(([k, label]) => (
          <label className="mini-field" key={k}>
            <span className="mini-label">{label}</span>
            <input
              className="input"
              inputMode="numeric"
              value={budget[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </label>
        ))}
        <label className="mini-field">
          <span className="mini-label">Cost limit (cents)</span>
          <input
            className="input"
            inputMode="numeric"
            value={costLimit}
            onChange={(e) => set("max_cost_cents", e.target.value)}
          />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Up to {worst === null ? "an unknown amount" : cents(worst)} at the provider's declared
        prices for these token limits is reserved before anything is sent. That bound holds only if
        the provider honours the limits; actual usage is recorded as reported.
      </p>
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>
        {busy ? "Starting…" : `Start build of revision ${revision}`}
      </button>
    </section>
  );
}

export function BuildsView({
  projectId,
  headRevision,
  dirty,
}: {
  projectId: string;
  headRevision: number;
  dirty: boolean;
}) {
  const [list, setList] = useState<BuildList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  const load = useCallback(
    () =>
      productsApi
        .builds(projectId)
        .then((l) => {
          setList(l);
          setError(null);
        })
        .catch((e) => setError((e as Error).message)),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const live = list?.jobs.some((j) => isLive(j.state)) ?? false;
  useEffect(() => {
    if (!live || polls >= MAX_POLLS) return;
    const delay = Math.min(15_000, 2_000 * 1.5 ** Math.min(polls, 6));
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") load();
      setPolls((n) => n + 1);
    }, delay);
    return () => window.clearTimeout(t);
  }, [live, polls, load]);

  const refresh = () => {
    setPolls(0);
    load();
  };

  if (error && !list) return <p className="error-text">{error}</p>;
  if (!list) return <p className="muted">Loading builds…</p>;
  const shown = list.jobs.find((j) => j.id === selected) ?? list.jobs[0];
  const b = list.budget;

  return (
    <div style={{ maxWidth: 1000 }}>
      {!list.availability.available && (
        <p className="notice">
          <strong>No build provider is connected.</strong> {list.availability.reason} Builds can't
          be started here, and none is simulated.
        </p>
      )}
      <section className="check-group">
        <h3>
          <Icon name="shield" /> Build budget
        </h3>
        <p>
          The build ledger: what AI building costs this business, kept apart from what customers
          use.
        </p>
        <div className="row" style={{ gap: 18, fontSize: 14 }}>
          <span>
            Limit <strong>{b.limit_cents === null ? "not set" : cents(b.limit_cents)}</strong>
          </span>
          <span>
            Reserved <strong>{cents(b.reserved_cents)}</strong>
          </span>
          <span>
            Charged <strong>{cents(b.charged_cents)}</strong>
          </span>
          {b.unresolved_cents > 0 && (
            <span className="unknown">Unresolved {cents(b.unresolved_cents)}</span>
          )}
        </div>
      </section>
      {list.availability.available && (
        <>
          {dirty && (
            <p className="notice info">
              Builds use saved revisions. Your unsaved changes are not part of revision{" "}
              {headRevision}.
            </p>
          )}
          <StartBuild
            projectId={projectId}
            revision={headRevision}
            list={list}
            onStarted={(job) => {
              setSelected(job.id);
              refresh();
            }}
          />
        </>
      )}
      {list.jobs.length === 0 ? (
        <p className="muted">No builds for this project.</p>
      ) : (
        <div className="versions">
          <div className="version-list">
            {list.jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                className="version-item"
                aria-pressed={shown?.id === j.id}
                onClick={() => setSelected(j.id)}
              >
                <span className="v-top">
                  Revision {j.revision}
                  <span className={`pill ${STATE_CLASS[j.state]}`}>
                    {BUILD_STATE_LABEL[j.state]}
                  </span>
                </span>
                <span className="v-meta">
                  {j.requested_by} · {ago(j.created_at)}
                </span>
              </button>
            ))}
          </div>
          {shown && <JobDetail key={shown.id} summary={shown} onChanged={refresh} />}
        </div>
      )}
      {live && polls >= MAX_POLLS && (
        <p className="muted" style={{ marginTop: 12 }}>
          Stopped checking automatically.{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={refresh}>
            Check now
          </button>
        </p>
      )}
    </div>
  );
}
