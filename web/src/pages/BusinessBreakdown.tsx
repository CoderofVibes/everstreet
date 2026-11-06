// Plan step 7: one business in detail, opened from the portfolio in a new tab
// (GET /api/me/dashboard/businesses/:id). What it is, performance, clients, costs (compute and
// operating, USD), operations and ownership. Figures, not narration.

import { useActorRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import {
  count,
  type Json,
  runwayText,
  shortDay,
  stamp,
  tokenText,
  usdAverage,
  usdFromCents,
  usdFromMicrocents,
} from "../dashboardView.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { groupDigits } from "../TokenAmount.tsx";
import { AcquisitionDetail, Budget, Info, Performance } from "./Dashboard.tsx";

const PURPOSE: Record<string, string> = {
  customer_use: "Customer use",
  evaluation: "Testing",
  trial: "Trials",
  release: "Release checks",
};
const OUTCOME: Record<string, string> = {
  extracted: "Delivered",
  accepted: "Delivered",
  analyzed: "Delivered",
  granted: "Delivered",
  refused: "Refused",
  incomplete: "Incomplete",
  invalid: "Invalid",
  unfinished: "Unfinished",
};
const STAGE = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function BusinessBreakdown({ id }: { id: string }) {
  const { person, requireSignIn } = useSession();
  const { state, retry } = useActorRead(person?.id ?? null, async (): Promise<Json> => {
    const r = await fetch(`/api/me/dashboard/businesses/${encodeURIComponent(id)}?days=30`, {
      credentials: "same-origin",
    });
    const d = (await r.json().catch(() => ({}))) as Json;
    if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`, d.code);
    return d;
  });
  if (!person)
    return (
      <div className="page empty">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => requireSignIn("Sign in to see this business.")}
        >
          Sign in
        </button>
      </div>
    );
  const d = state.data;
  if (!d && (state.status === "failed" || state.status === "refused"))
    return (
      <div className="page">
        <p className="error" role="alert">
          {state.error ?? "Couldn't be read."}{" "}
          <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
            Try again
          </button>
        </p>
      </div>
    );
  if (!d) return <div className="page muted">Loading…</div>;
  const b = (d.businesses as Json[])[0] as Json;
  const asset = (Object.keys(b.totals.revenue ?? {})[0] ??
    Object.keys(d.tokens ?? {})[0] ??
    "") as string;
  const token = d.tokens?.[asset];
  const tried = b.totals.delivered + b.totals.not_charged;
  const c = b.compute as Json;
  const op = b.operating_costs as Json;
  const opTotal = ((op?.categories ?? []) as Json[]).reduce((n, x) => n + x.total_cents, 0);
  return (
    <div className="page page-wide db">
      <p className="db-crumb small">
        <Link to="/portfolio">Portfolio</Link> / {b.name}
      </p>
      <header className="db-head">
        <div>
          <h1 className="display">{b.name}</h1>
          <p className="db-what">
            <span className="db-kind">{b.product ?? "Business"}</span>
            {b.tagline ? ` · ${b.tagline}` : ""}
          </p>
          {b.about && <p className="db-about">{b.about}</p>}
        </div>
        <p className="db-chips">
          <span className="db-chip">
            Release {b.release?.number ?? "none"}
            {b.release ? ` · ${shortDay(b.release.activated_at)}` : ""}
          </span>
          <span className="db-chip">Founded {shortDay(b.founded_at)}</span>
          <Link to={`/desk/${b.id}`} className="btn btn-secondary btn-sm">
            Workspace
          </Link>
        </p>
      </header>

      <section className="db-summary" aria-label="Summary">
        <div className="db-tile">
          <span className="db-k">Earned</span>
          <strong className="db-v">
            {tokenText(b.totals.revenue?.[asset] ?? "0", asset, token)}
          </strong>
        </div>
        <div className="db-tile">
          <span className="db-k">Delivered</span>
          <strong className="db-v">{count(b.totals.delivered)}</strong>
          {tried > 0 && (
            <span className="db-d">
              {Math.round((b.totals.delivered / tried) * 100)}% of {count(tried)}
            </span>
          )}
        </div>
        <div className="db-tile">
          <span className="db-k">Customers</span>
          <strong className="db-v">{b.customers.active}</strong>
          <span className="db-d">{b.customers.new} new</span>
        </div>
        <div className="db-tile">
          <span className="db-k">Prepaid uses</span>
          <strong className="db-v">
            {b.credits ? groupDigits(String(b.credits.units ?? 0)) : "unknown"}
          </strong>
          {b.credits && <span className="db-d">{runwayText(b.credits_runway_days)}</span>}
        </div>
        <div className="db-tile">
          <span className="db-k">Costs</span>
          <strong className="db-v">
            {usdFromMicrocents(
              Object.values((c.by_purpose ?? {}) as Record<string, Json>)
                .reduce((n, p) => n + BigInt(p.microcents), 0n)
                .toString(),
            )}
          </strong>
          <span className="db-d">compute · {usdFromCents(opTotal)} operating</span>
        </div>
      </section>

      {b.sale && (
        <section className="card db-acq" aria-labelledby="bb-acq">
          <h2 id="bb-acq">
            Acquisition in process · <span className="mono">{b.sale.buyer}</span>
          </h2>
          <AcquisitionDetail b={b} d={d} />
        </section>
      )}

      <Performance d={d} fixed={b.id} />

      <div className="bb-grid">
        <section className="card" aria-labelledby="bb-clients">
          <h2 id="bb-clients">Clients</h2>
          {(b.clients as Json[]).length === 0 ? (
            <p className="muted small">None in this period.</p>
          ) : (
            <div className="db-table-wrap bb-flat">
              <table className="bb-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Requests</th>
                    <th scope="col">Delivered</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {(b.clients as Json[]).map((x) => (
                    <tr key={x.account}>
                      <th scope="row">
                        {x.name ?? <span className="mono">{x.account}</span>}
                        {x.name && <span className="bb-acct mono">{x.account}</span>}
                      </th>
                      <td>{count(x.requests)}</td>
                      <td>{count(x.delivered)}</td>
                      <td>{tokenText(x.revenue?.[asset] ?? "0", asset, token)}</td>
                      <td>{shortDay(x.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="bb-compute">
          <h2 id="bb-compute">Compute</h2>
          {c.calls === 0 ||
          Number(c.by_purpose?.customer_use?.microcents ?? 0) +
            Number(c.by_purpose?.evaluation?.microcents ?? 0) ===
            0 ? (
            <p className="muted small">No model cost · {count(c.calls)} calls</p>
          ) : (
            <>
              <dl className="bb-dl">
                <div>
                  <dt>Model</dt>
                  <dd className="mono">{(c.models as string[]).join(", ")}</dd>
                </div>
                <div>
                  <dt>Per call</dt>
                  <dd>
                    {usdAverage(c.per_call_microcents.median)} · p95{" "}
                    {usdAverage(c.per_call_microcents.p95)}
                  </dd>
                </div>
                <div>
                  <dt>Per delivered</dt>
                  <dd>
                    {b.cost_per_delivered_microcents === null
                      ? "unknown"
                      : usdAverage(b.cost_per_delivered_microcents)}
                  </dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    {count(c.tokens.input)} in · {count(c.tokens.output)} out
                  </dd>
                </div>
                <div>
                  <dt>Time per call</dt>
                  <dd>
                    {c.per_call_ms.median ?? "?"} ms · p95 {c.per_call_ms.p95 ?? "?"} ms
                  </dd>
                </div>
                <div>
                  <dt>Budget this month</dt>
                  <dd>
                    <Budget c={c} />
                  </dd>
                </div>
                <div>
                  <dt>Build</dt>
                  <dd>
                    {c.build.jobs ? `${usdFromCents(c.build.cents)} · ${c.build.jobs} builds` : "—"}
                  </dd>
                </div>
              </dl>
              <table className="bb-table">
                <caption className="sr-only">Compute by purpose and outcome</caption>
                <thead>
                  <tr>
                    <th scope="col">Spent on</th>
                    <th scope="col">Calls</th>
                    <th scope="col">USD</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries((c.customer_use_by_outcome ?? {}) as Record<string, Json>).map(
                    ([k, v]) => (
                      <tr key={`o-${k}`}>
                        <th scope="row">
                          Customer use · {OUTCOME[k] ?? k}
                          {OUTCOME[k] && OUTCOME[k] !== "Delivered" && (
                            <span className="bb-unbilled">unbilled</span>
                          )}
                        </th>
                        <td>{count(v.calls)}</td>
                        <td>{usdFromMicrocents(v.microcents)}</td>
                      </tr>
                    ),
                  )}
                  {Object.entries((c.by_purpose ?? {}) as Record<string, Json>)
                    .filter(([k]) => k !== "customer_use")
                    .map(([k, v]) => (
                      <tr key={`p-${k}`}>
                        <th scope="row">{PURPOSE[k] ?? k}</th>
                        <td>{count(v.calls)}</td>
                        <td>{usdFromMicrocents(v.microcents)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="bb-op">
          <h2 id="bb-op">Operating costs</h2>
          {((op?.categories ?? []) as Json[]).length === 0 ? (
            <p className="muted small">None recorded.</p>
          ) : (
            <table className="bb-table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  {(op.months as number[]).map((m) => (
                    <th key={m} scope="col">
                      {new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 1)).toLocaleDateString(
                        "en-US",
                        { month: "short", timeZone: "UTC" },
                      )}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {(op.categories as Json[]).map((x) => (
                  <tr key={x.category}>
                    <th scope="row">
                      {x.category}
                      <span className="bb-kind">{x.kind}</span>
                    </th>
                    {(op.months as number[]).map((m) => (
                      <td key={m}>{x.by_month[m] ? usdFromCents(x.by_month[m]) : "—"}</td>
                    ))}
                    <td>{usdFromCents(x.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small bb-fees">
            Network fees: <strong>Not recorded</strong>
          </p>
        </section>

        <section className="card" aria-labelledby="bb-ops">
          <h2 id="bb-ops">Operations</h2>
          <dl className="bb-dl">
            {b.cases && (
              <>
                <div>
                  <dt>Open cases</dt>
                  <dd>
                    {b.cases.open}
                    {Object.keys(b.cases.open_by_stage).length > 0 &&
                      ` · ${Object.entries(b.cases.open_by_stage as Record<string, number>)
                        .map(([k, v]) => `${v} ${STAGE(k).toLowerCase()}`)
                        .join(", ")}`}
                  </dd>
                </div>
                <div>
                  <dt>Resolved</dt>
                  <dd>
                    {b.cases.resolved_in_period} of {b.cases.opened_in_period}
                  </dd>
                </div>
                <div>
                  <dt>Median to resolve</dt>
                  <dd>
                    {b.cases.median_hours_to_resolve === null
                      ? "—"
                      : `${b.cases.median_hours_to_resolve} h`}
                  </dd>
                </div>
              </>
            )}
            {((b.not_charged_reasons ?? []) as Json[]).length > 0 && (
              <div>
                <dt>Not charged</dt>
                <dd>
                  {(b.not_charged_reasons as Json[])
                    .map((r) => `${r.n} ${(OUTCOME[r.outcome] ?? r.outcome).toLowerCase()}`)
                    .join(" · ")}
                </dd>
              </div>
            )}
            <div>
              <dt>Team</dt>
              <dd>
                {b.team_members === 0 ? "Just you" : `You + ${b.team_members}`}{" "}
                <Link to={`/desk/${b.id}/team`} className="small">
                  Team
                </Link>
              </dd>
            </div>
            <div>
              <dt>Rehearsal</dt>
              <dd>
                {b.rehearsal
                  ? `${STAGE(b.rehearsal.state)} · ${shortDay(b.rehearsal.finished_at)}`
                  : "None"}{" "}
                <Link to={`/desk/${b.id}/rehearsal`} className="small">
                  Rehearse
                </Link>
              </dd>
            </div>
            <div>
              <dt>Releases</dt>
              <dd>
                {(b.releases as Json[])
                  .map(
                    (r) =>
                      `${r.number} · ${shortDay(r.activated_at)}${r.retired_at ? ` → ${shortDay(r.retired_at)}` : " (live)"}`,
                  )
                  .join("; ")}
              </dd>
            </div>
            <div>
              <dt>
                Owner
                <Info
                  label="generation"
                  text="How many times control of the business has passed to a new owner, plus one."
                />
              </dt>
              <dd>
                <span className="mono">{b.ownership?.owner_account ?? "unknown"}</span> · gen{" "}
                {b.ownership?.generation ?? "?"} · {b.ownership?.transfers ?? 0} transfers
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <p className="small muted">{stamp(d.as_of)}</p>
    </div>
  );
}
