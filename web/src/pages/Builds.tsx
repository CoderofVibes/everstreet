// The studio's Builds view: persisted build jobs for this project, their events, usage and
// checked artifact. A build can be started only when a real, priced provider is connected;
// otherwise the view says so and offers nothing that looks like a build. While a job is live
// the view checks back with growing gaps (2 s up to 15 s) and stops after 60 checks.

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import {
  type AiBudget,
  ago,
  BUILD_STATE_LABEL,
  type BuildBudget,
  type BuildEventRow,
  type BuildJob,
  type BuildList,
  exactUsd,
  isLive,
  productsApi,
  usd,
} from "../productsApi.ts";
import { buildsSignature } from "../studioRecords.ts";

export const MAX_POLLS = 60;
export const newKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const cents = usd;
/** Event pages loaded automatically before offering "Show more" (100 events each). */
const AUTO_PAGES = 5;

export const STATE_CLASS: Record<BuildJob["state"], string> = {
  queued: "",
  running: "blue",
  validating: "blue",
  succeeded: "mint",
  failed: "caution",
  cancelled: "",
  needs_reconciliation: "caution",
};

const exact = exactUsd;

export function usageText(job: BuildJob) {
  const tokens = `${job.input_tokens.toLocaleString()} in / ${job.output_tokens.toLocaleString()} out tokens`;
  if (job.usage_state === "final")
    return `${exact(job.charged_microcents)} computed from the provider's final receipt (${tokens}); not an invoice`;
  if (job.usage_state === "partial")
    return `At least ${exact(job.charged_microcents)} (${tokens}). Final cost not yet known; ${cents(job.reserved_cents)} stays reserved`;
  if (job.usage_state === "unknown")
    return `Unknown: ${cents(job.reserved_cents)} stays reserved until it is reconciled`;
  return job.dispatched ? "Not reported yet" : "None: nothing was sent";
}

export function describe(e: BuildEventRow): string {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case "queued":
      return `Requested for revision ${d.revision}; up to ${cents(Number(d.reserved_cents))} reserved (worst case)`;
    case "claimed":
      return `A worker took it (attempt ${e.attempt})`;
    case "dispatched":
      return "Sent to the provider";
    case "progress":
      return String(d.message ?? "");
    case "usage":
      return `Provisional usage: ${d.input_tokens} in / ${d.output_tokens} out tokens, at least ${exact(Number(d.microcents ?? 0))} so far`;
    case "usage_final":
      return `Final receipt: ${d.input_tokens} in / ${d.output_tokens} out tokens, ${exact(Number(d.microcents ?? 0))} computed`;
    case "proposal_recorded":
      return "Proposal ready to review";
    case "usage_duplicate":
      return "The same final receipt again; counted once";
    case "usage_mismatch":
      return "A receipt disagreed with earlier usage; the higher figure is kept";
    case "usage_after_final":
      return "Usage reported after the final receipt; ignored";
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
  const [more, setMore] = useState(false);
  const lastSeq = useRef(0);

  /** Reads event pages after what is already shown, up to `pages` pages. */
  const loadEvents = useCallback(
    async (pages: number, gone: () => boolean) => {
      for (let i = 0; i < pages; i++) {
        const r = await productsApi.buildEvents(summary.id, lastSeq.current);
        if (gone()) return;
        const fresh = r.events.filter((x) => x.seq > lastSeq.current);
        const last = fresh[fresh.length - 1];
        if (last) {
          lastSeq.current = last.seq;
          setEvents((prev) => [...prev, ...fresh]);
        }
        setMore(r.has_more);
        if (!r.has_more || !last) return;
      }
    },
    [summary.id],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: state and event count are triggers: reload when the job moves
  useEffect(() => {
    let gone = false;
    productsApi
      .build(summary.id)
      .then((r) => !gone && setFull(r.job))
      .catch((e) => !gone && setError((e as Error).message));
    loadEvents(AUTO_PAGES, () => gone).catch(() => {});
    return () => {
      gone = true;
    };
  }, [summary.id, summary.event_count, summary.state, loadEvents]);

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
        <dt>Cost</dt>
        <dd>{usageText(job)}</dd>
        <dt>Reserved</dt>
        <dd>
          {job.reserved_cents > 0
            ? `${cents(job.reserved_cents)} held (worst case, not a charge)`
            : "Nothing held"}
        </dd>
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
                {job.artifact.kind === "analysis_spec"
                  ? `A compiled analysis: customers submit ${job.artifact.spec.source?.label ?? "their text"}${job.artifact.spec.context?.length ? ` and ${job.artifact.spec.context.map((c) => c.label).join(", ")}` : ""}, and get up to 8 flags back. Check and release it on the Service tab.`
                  : job.artifact.kind === "workflow_spec"
                    ? `A compiled workflow: a request form with ${job.artifact.spec.intake?.fields.length ?? 0} fields, moving through ${(job.artifact.spec.stages ?? []).map((st) => st.label).join(" → ")}. Check and release it on the Service tab.`
                    : `A checked description of the service (${job.artifact.spec.fields?.length ?? 0} fields). Check and release it on the Service tab.`}
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
      <details className="advanced">
        <summary>Advanced: limits and provider</summary>
        <dl className="doc-grid">
          <dt>Limits</dt>
          <dd>
            {job.provider.endsWith("-compiler")
              ? "None needed: the workflow engine compiles it without AI, so nothing is sent or spent."
              : `${job.budget.max_input_tokens.toLocaleString()} input / ${job.budget.max_output_tokens.toLocaleString()} output tokens, ${job.budget.max_seconds} s, cost limit ${cents(job.budget.max_cost_cents)}`}
          </dd>
          <dt>Provider</dt>
          <dd className="mono">
            {job.provider_config
              ? `${job.provider_config.id ?? ""} · ${job.provider_config.model ?? ""} · ${job.provider_config.version ?? ""}`
              : job.provider}
          </dd>
          <dt>Tokens</dt>
          <dd>
            {job.input_tokens.toLocaleString()} input / {job.output_tokens.toLocaleString()} output
          </dd>
        </dl>
      </details>
      <h4 style={{ fontSize: 14, marginTop: 18 }}>
        Events · {events.length} of {job.event_count}
      </h4>
      <ol className="build-events">
        {events.map((e) => (
          <li key={e.seq}>
            <span className="muted mono">{new Date(e.at).toLocaleTimeString()}</span> {describe(e)}
          </li>
        ))}
      </ol>
      {more && (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => loadEvents(AUTO_PAGES, () => false).catch(() => {})}
        >
          Show more events
        </button>
      )}
    </div>
  );
}

/**
 * The business's AI budget in money: exact use, what the budget is charged (rounded up per
 * job), what is held for unsettled work, and a way to set the limit within the operator's.
 */
export function BudgetPanel({
  businessId,
  budget,
  onChanged,
}: {
  businessId: string;
  budget: AiBudget;
  onChanged: (b: AiBudget) => void;
}) {
  const [text, setText] = useState(
    budget.limit_cents === null ? "" : (budget.limit_cents / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const most = budget.max_settable_cents;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return setError("Enter an amount in dollars, like 2.00");
    setBusy(true);
    setError(null);
    try {
      onChanged(await productsApi.setBudget(businessId, Math.round(n * 100)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="check-group budget-panel" aria-label="AI budget">
      <h3>
        <Icon name="shield" /> AI budget for this business
      </h3>
      <div className="budget-tiles">
        <div>
          <span>Limit</span>
          <strong>{budget.limit_cents === null ? "Not set" : cents(budget.limit_cents)}</strong>
        </div>
        <div>
          <span>Used (computed)</span>
          <strong>{exact(budget.used_microcents)}</strong>
        </div>
        <div>
          <span>Counted against limit</span>
          <strong>{cents(budget.counted_cents)}</strong>
        </div>
        <div>
          <span>Held for unsettled work</span>
          <strong>{cents(budget.reserved_cents)}</strong>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0" }}>
        Used is computed from reported tokens at the provider's declared prices; it is not an
        invoice. The limit is counted in whole cents per request, rounded up, and each request holds
        its worst case until it settles.
        {budget.unresolved_cents > 0 &&
          ` ${cents(budget.unresolved_cents)} is held for requests whose final cost is unknown.`}
      </p>
      <form className="row" style={{ gap: 8 }} onSubmit={save}>
        <label className="sr-only" htmlFor={`budget-${businessId}`}>
          Limit in US dollars
        </label>
        <span aria-hidden="true">$</span>
        <input
          id={`budget-${businessId}`}
          className="input"
          inputMode="decimal"
          style={{ width: 110 }}
          value={text}
          placeholder="2.00"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
          {budget.limit_cents === null ? "Set limit" : "Change limit"}
        </button>
        {most !== null && <span className="muted">Up to {cents(most)} here</span>}
      </form>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

/** The workflow engine: compile a saved revision (no provider, nothing held or spent). */
function StartCompile({
  kind,
  projectId,
  revision,
  onStarted,
}: {
  kind: "workflow" | "analysis";
  projectId: string;
  revision: number;
  onStarted: (job: BuildJob) => void;
}) {
  const [key, setKey] = useState(() => newKey("build"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // No budget: a compile sends nothing anywhere (the server records zero limits).
      const r = await productsApi.startBuild(projectId, { idempotency_key: key, revision });
      setKey(newKey("build"));
      onStarted(r.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="check-group">
      <h3>
        <Icon name="spark" /> Compile revision {revision}
      </h3>
      <p style={{ fontSize: 14 }}>
        {kind === "analysis"
          ? "Your form becomes what customers submit, and your agent result screen names the flags they get back."
          : "Your form becomes the request customers fill in, and your board's stages become the steps each request moves through."}
      </p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>
        {busy ? "Compiling…" : `Compile revision ${revision}`}
      </button>
      {error && <p className="error-text">{error}</p>}
    </section>
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
      <p style={{ fontSize: 14 }}>
        Holds up to <strong>{worst === null ? "an unknown amount" : cents(worst)}</strong> of the
        budget until it settles; you are charged what it actually uses.
      </p>
      <p className="muted" style={{ fontSize: 12.5 }}>
        The hold is the worst case at the provider's declared prices. It is a real bound only if the
        provider keeps to the limits; actual use is recorded as reported.
      </p>
      <details className="advanced">
        <summary>Advanced: token and time limits</summary>
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
        {list.provider && (
          <p className="muted mono" style={{ fontSize: 12 }}>
            {list.provider.id} · {list.provider.model} · {list.provider.version}
          </p>
        )}
      </details>
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>
        {busy ? "Starting…" : `Start build of revision ${revision}`}
      </button>
    </section>
  );
}

export function BuildsView({
  projectId,
  businessId,
  headRevision,
  dirty,
  onRecords,
}: {
  projectId: string;
  businessId: string;
  headRevision: number;
  dirty: boolean;
  /** Job 001b1: reports what the build list now shows, so the studio status follows it. */
  onRecords?: (source: "builds", signature: string) => void;
}) {
  const [list, setList] = useState<BuildList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const signature = list ? buildsSignature(list.jobs) : null;
  useEffect(() => {
    if (signature !== null) onRecords?.("builds", signature);
  }, [signature, onRecords]);

  const load = useCallback(
    () =>
      productsApi
        .builds(projectId, "build")
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

  return (
    <div style={{ maxWidth: 1000 }}>
      {list.engine === "model" && (
        <p className="muted" style={{ maxWidth: "75ch" }}>
          A build turns a saved revision into a checked service specification. Check and release it
          on the Service tab to run it.
        </p>
      )}
      {list.engine === "analysis" && (
        <p className="notice info">
          <strong>An agent service runs on Everstreet's analysis engine.</strong> Building compiles
          your saved form and agent result into a fixed analysis without AI. Its customers' requests
          run on the AI runtime, which checks every flag against what was submitted.
        </p>
      )}
      {list.engine === "workflow" && (
        <p className="notice info">
          <strong>A SaaS workflow runs on Everstreet's workflow engine.</strong> Building compiles
          your saved form and board into a fixed workflow: no AI is used, nothing is spent, and the
          same revision always compiles to the same result.
        </p>
      )}
      {!list.availability.available && (
        <p className="notice">
          <strong>Builds can't be started here.</strong> {list.availability.reason}
        </p>
      )}
      {list.engine !== "workflow" && list.engine !== "analysis" && (
        <BudgetPanel
          key={String(list.budget.limit_cents)}
          businessId={businessId}
          budget={list.budget}
          onChanged={() => refresh()}
        />
      )}
      {list.availability.available && (
        <>
          {dirty && (
            <p className="notice info">
              Builds use saved revisions. Your unsaved changes are not part of revision{" "}
              {headRevision}.
            </p>
          )}
          {list.engine === "workflow" || list.engine === "analysis" ? (
            <StartCompile
              kind={list.engine}
              projectId={projectId}
              revision={headRevision}
              onStarted={(job) => {
                setSelected(job.id);
                refresh();
              }}
            />
          ) : (
            <StartBuild
              projectId={projectId}
              revision={headRevision}
              list={list}
              onStarted={(job) => {
                setSelected(job.id);
                refresh();
              }}
            />
          )}
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
