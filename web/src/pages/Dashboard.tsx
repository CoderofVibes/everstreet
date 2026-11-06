// Plan step 7 (design/dashboard/DECISION.md, direction C with Tony's changes): the owner's
// portfolio on GET /api/me/dashboard. Figures, inputs and actions; no narration. Acquisitions in
// process, each selectable for its steps; one larger performance chart (portfolio or one
// business); compute and operating costs in USD (never added to token revenue); short business
// cards that open a breakdown in a new tab.

import { useId, useState } from "react";
import { swatchClass } from "../chartSeries.ts";
import {
  acceptance,
  chartSeries,
  chartTotal,
  count,
  type Json,
  type Metric,
  nextAction,
  releaseMarks,
  runwayText,
  saleStatus,
  saleSteps,
  shortDay,
  stamp,
  symbolOf,
  tokenText,
  usdAverage,
  usdFromCents,
  usdFromMicrocents,
} from "../dashboardView.ts";
import { Link } from "../router.tsx";
import { groupDigits } from "../TokenAmount.tsx";
import { BarChart, seriesKey } from "./DashboardChart.tsx";

/** An (i) that explains a term on hover or keyboard focus. Use only where it isn't obvious. */
export function Info({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="db-info">
      <button type="button" aria-label={`About ${label}`} aria-describedby={id}>
        i
      </button>
      <span role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}

const Src = ({ children }: { children: string }) => <span className="db-src-tag">{children}</span>;

/** The first token an amount set uses (the chart and cards show one token at a time). */
const firstAsset = (d: Json, b?: Json) =>
  (Object.keys(b?.totals.revenue ?? {})[0] ??
    Object.keys(d.totals.revenue ?? {})[0] ??
    Object.keys(d.tokens ?? {})[0] ??
    "") as string;

// --- Summary ---------------------------------------------------------------------------------

export function Summary({ d, bs }: { d: Json; bs: Json[] }) {
  const a = firstAsset(d);
  const token = d.tokens?.[a];
  const revenue = bs.reduce((n, b) => n + BigInt(b.totals.revenue?.[a] ?? "0"), 0n).toString();
  const delivered = bs.reduce((n, b) => n + b.totals.delivered, 0);
  const tried = delivered + bs.reduce((n, b) => n + b.totals.not_charged, 0);
  const active = bs.reduce((n, b) => n + (b.customers?.active ?? 0), 0);
  const fresh = bs.reduce((n, b) => n + (b.customers?.new ?? 0), 0);
  const compute = bs.reduce((n, b) => n + BigInt(b.totals.compute_microcents ?? "0"), 0n);
  const credits = bs.filter((b) => b.credits);
  const creditAsset = credits[0]?.credits.asset as string | undefined;
  return (
    <section className="db-summary" aria-label="Summary">
      <Tile k="Earned" v={a ? tokenText(revenue, a, token) : "None"} src="contract" />
      <Tile
        k="Delivered"
        v={count(delivered)}
        sub={tried > 0 ? `${Math.round((delivered / tried) * 100)}% of ${count(tried)}` : undefined}
        src="runtime"
      />
      <Tile k="Customers" v={count(active)} sub={`${fresh} new`} src="app" />
      <Tile
        k="Customer compute"
        v={usdFromMicrocents(compute.toString()) ?? "unknown"}
        sub="USD"
        src="runtime"
      />
      <Tile
        k="Prepaid uses"
        v={groupDigits(String(credits.reduce((n, b) => n + (b.credits.units ?? 0), 0)))}
        sub={
          creditAsset
            ? tokenText(
                credits.reduce((n, b) => n + BigInt(b.credits.value ?? "0"), 0n).toString(),
                creditAsset,
                d.tokens?.[creditAsset],
              )
            : undefined
        }
        src="contract"
      />
    </section>
  );
}

function Tile({ k, v, sub, src }: { k: string; v: string; sub?: string; src: string }) {
  return (
    <div className="db-tile">
      <span className="db-k">{k}</span>
      <strong className="db-v">{v}</strong>
      {sub && <span className="db-d">{sub}</span>}
      <span className="db-src">
        <Src>{src}</Src>
      </span>
    </div>
  );
}

/** All compute in the period for a business (every purpose), microcents. */
const sumPurposes = (b: Json) =>
  Object.values((b.compute?.by_purpose ?? {}) as Record<string, Json>)
    .reduce((n, p) => n + BigInt(p.microcents), 0n)
    .toString();

// --- Acquisitions in process -----------------------------------------------------------------

/** A sale's detail. In the acquisitions list the row already shows price and escrow (inRow). */
export function AcquisitionDetail({ b, d, inRow = false }: { b: Json; d: Json; inRow?: boolean }) {
  const s = b.sale as Json;
  const asset = (s.asset ?? b.credits?.asset ?? firstAsset(d)) as string;
  const token = d.tokens?.[asset];
  const steps = saleSteps(s);
  const acc = acceptance(s);
  const funded = steps[1]?.state === "done";
  return (
    <div className="db-acq-detail">
      <dl className="db-facts">
        {!inRow && (
          <>
            <div>
              <dt>Price</dt>
              <dd>{tokenText(s.price, asset, token)}</dd>
            </div>
            <div className={funded ? "db-fact-ok" : undefined}>
              <dt>Escrow</dt>
              <dd>{tokenText(s.escrow, asset, token)}</dd>
            </div>
          </>
        )}
        <div className={acc.why ? "db-fact-wait" : undefined}>
          <dt>Accepted</dt>
          <dd>
            {acc.value}
            {acc.why && <Info label="acceptance" text={acc.why} />}
          </dd>
        </div>
        {!inRow && (
          <div>
            <dt>Offer expires</dt>
            <dd>{stamp(s.expires_at)}</dd>
          </div>
        )}
        {b.credits && (
          <div>
            <dt>Prepaid uses</dt>
            <dd>{groupDigits(String(b.credits.units ?? 0))}</dd>
          </div>
        )}
      </dl>
      <ol className="db-steps" aria-label="Steps">
        {steps.map((st, i) => (
          <li key={st.key} className={`db-step ${st.state}`}>
            <span className="db-dot" aria-hidden="true">
              {st.state === "done" ? "✓" : i + 1}
            </span>
            <span className="db-step-label">
              {st.label}
              <span className="sr-only">
                {st.state === "done"
                  ? ": done"
                  : st.state === "current"
                    ? ": current"
                    : ": pending"}
              </span>
            </span>
            {st.detail && <span className="db-step-detail">{st.detail}</span>}
          </li>
        ))}
      </ol>
      <div className="db-acq-actions">
        <Link to={`/sales/${b.id}`} className="btn btn-primary btn-sm">
          Review terms
        </Link>
      </div>
    </div>
  );
}

function Acquisitions({ d, selling }: { d: Json; selling: Json[] }) {
  const [open, setOpen] = useState<string | null>(selling[0]?.id ?? null);
  const uid = useId();
  return (
    <section className="card db-acq" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>Acquisitions in process</h2>
      <table className="db-acq-table">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Buyer</th>
            <th scope="col">Price</th>
            <th scope="col">Escrow</th>
            <th scope="col">Status</th>
            <th scope="col">Expires</th>
          </tr>
        </thead>
        {selling.map((b) => {
          const s = b.sale as Json;
          const asset = (s.asset ?? firstAsset(d, b)) as string;
          const token = d.tokens?.[asset];
          const isOpen = open === b.id;
          return (
            <tbody key={b.id} className={isOpen ? "open" : undefined}>
              <tr>
                <th scope="row">
                  <button
                    type="button"
                    className="db-acq-toggle"
                    aria-expanded={isOpen}
                    aria-controls={`${uid}-${b.id}`}
                    onClick={() => setOpen(isOpen ? null : b.id)}
                  >
                    <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span> {b.name}
                  </button>
                </th>
                <td className="mono" data-label="Buyer">
                  {s.buyer}
                </td>
                <td data-label="Price">{tokenText(s.price, asset, token)}</td>
                <td data-label="Escrow">{tokenText(s.escrow, asset, token)}</td>
                <td data-label="Status">
                  <span className="db-badge warm">{saleStatus(s)}</span>
                </td>
                <td data-label="Expires">{stamp(s.expires_at)}</td>
              </tr>
              <tr id={`${uid}-${b.id}`} hidden={!isOpen}>
                <td colSpan={6}>{isOpen && <AcquisitionDetail b={b} d={d} inRow />}</td>
              </tr>
            </tbody>
          );
        })}
      </table>
    </section>
  );
}

// --- Needs you today, ownership --------------------------------------------------------------

function NeedsYou({ bs }: { bs: Json[] }) {
  const items = bs.flatMap((b) =>
    (b.attention as Json[]).map((a): Json => ({ ...a, business: b.name })),
  );
  return (
    <section className="card db-needs" aria-labelledby="db-needs">
      <h2 id="db-needs">Needs you today</h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing.</p>
      ) : (
        <ul className="plain">
          {items.map((a) => (
            <li key={`${a.business}-${a.kind}`}>
              <span className="small muted">{a.business}</span>
              <strong>{a.text}</strong>
              <Link to={a.link} className="btn btn-quiet btn-sm">
                {nextAction({ attention: [a] }).text}
                <span className="sr-only">: {a.business}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <h3 className="db-sub">Ownership on NEAR</h3>
      <table className="db-own">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Owner</th>
            <th scope="col">
              Gen.
              <Info
                label="generation"
                text="How many times control of the business has passed to a new owner, plus one."
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {bs.map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.name}</th>
              <td className="mono">{b.ownership?.owner_account ?? "unknown"}</td>
              <td>{b.ownership?.generation ?? "?"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --- Performance -----------------------------------------------------------------------------

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Earned" },
  { key: "delivered", label: "Delivered" },
  { key: "compute", label: "Compute" },
];

export function Performance({ d, fixed }: { d: Json; fixed?: string }) {
  const bs = d.businesses as Json[];
  const [picked, setScope] = useState("all");
  const scope = fixed ?? picked;
  const [metric, setMetric] = useState<Metric>("revenue");
  const asset = firstAsset(d);
  const token = d.tokens?.[asset];
  const series = chartSeries(d, scope, metric, asset);
  const days = d.days as string[];
  const marks = metric === "compute" ? [] : releaseMarks(d, scope);
  const one = bs.find((b) => b.id === scope);
  const unit =
    metric === "revenue"
      ? symbolOf(asset, token)
      : metric === "delivered"
        ? "Requests"
        : "US cents";
  const noModel =
    metric === "compute" &&
    one &&
    one.totals.compute_microcents === "0" &&
    one.totals.compute_unknown_calls === 0;
  const total = chartTotal(d, scope, metric, asset);
  const mLabel = METRICS.find((m) => m.key === metric)?.label ?? "";
  const tableId = useId();
  return (
    <section className="card db-perf" aria-labelledby={`${tableId}-h`}>
      <div className="db-perf-head">
        <h2 id={`${tableId}-h`}>Performance</h2>
        <div className="db-total">
          <strong>
            {metric === "delivered" ? total : metric === "compute" ? `${total} USD` : total}
          </strong>
          <span className="small muted">
            {mLabel} · {shortDay(d.period.from)} – {shortDay(d.period.to)}
          </span>
        </div>
      </div>
      <div className="db-switch">
        {!fixed ? (
          <fieldset className="db-seg">
            <legend className="sr-only">Show</legend>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              Portfolio
            </button>
            {bs.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={scope === b.id}
                onClick={() => setScope(b.id)}
              >
                {b.name}
              </button>
            ))}
          </fieldset>
        ) : (
          <span />
        )}
        <fieldset className="db-seg">
          <legend className="sr-only">Measure</legend>
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
              <span className="db-unit">
                {m.key === "revenue" ? symbolOf(asset, token) : m.key === "compute" ? "USD" : ""}
              </span>
            </button>
          ))}
        </fieldset>
      </div>
      {series.length > 1 && (
        <ul className="db-legend plain" aria-label="Series">
          {series.map((s, i) => (
            <li key={s.id}>
              <span className={swatchClass(seriesKey(i))} aria-hidden="true" /> {s.name}
            </li>
          ))}
          {marks.length > 0 && (
            <li>
              <span className="db-mark-sw" aria-hidden="true" /> Release
            </li>
          )}
        </ul>
      )}
      {noModel ? (
        <p className="db-nomodel">No model cost</p>
      ) : (
        <BarChart
          series={series}
          days={days}
          marks={marks}
          unit={unit}
          partialLast
          label={`${one ? one.name : "Portfolio"}: ${mLabel} per day in ${unit}, ${total} in total.`}
        />
      )}
      <div className="db-perf-foot small">
        <Src>{metric === "revenue" ? "contract" : "runtime"}</Src>
        <details className="db-table">
          <summary id={tableId}>Daily figures</summary>
          <div className="db-table-wrap">
            <table aria-labelledby={tableId}>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {series.map((s) => (
                    <th key={s.id} scope="col">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day, i) => (
                  <tr key={day}>
                    <th scope="row">
                      {shortDay(day)}
                      {i === days.length - 1 ? " (so far)" : ""}
                    </th>
                    {series.map((s) => (
                      <td key={s.id}>{s.labels[i]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

// --- Costs (USD) -----------------------------------------------------------------------------

/** Compute and operating costs, per business (USD; never added to token revenue). */
export function Costs({ d, bs }: { d: Json; bs: Json[] }) {
  const all = (key: (b: Json) => bigint) => bs.reduce((n, b) => n + key(b), 0n).toString();
  const use = all((b) => BigInt(b.compute?.by_purpose?.customer_use?.microcents ?? "0"));
  const testing = all((b) =>
    Object.entries((b.compute?.by_purpose ?? {}) as Record<string, Json>)
      .filter(([k]) => k !== "customer_use")
      .reduce((n, [, p]) => n + BigInt(p.microcents), 0n),
  );
  const unbilled = all((b) => BigInt(b.compute?.unbilled_microcents ?? "0"));
  const opCents = bs.reduce(
    (n, b) =>
      n + ((b.operating_costs?.categories ?? []) as Json[]).reduce((m, c) => m + c.total_cents, 0),
    0,
  );
  const tokensIn = bs.reduce((n, b) => n + (b.compute?.tokens.input ?? 0), 0);
  const tokensOut = bs.reduce((n, b) => n + (b.compute?.tokens.output ?? 0), 0);
  const maxCompute = Math.max(1, ...bs.map((b) => Number(sumPurposes(b))));
  return (
    <section className="card db-costs" aria-labelledby="db-costs">
      <div className="db-perf-head">
        <h2 id="db-costs">Costs</h2>
        <span className="small muted">
          USD · {shortDay(d.period.from)} – {shortDay(d.period.to)}
        </span>
      </div>
      <div className="db-cost-tiles">
        <Tile k="Customer use" v={usdFromMicrocents(use) ?? "unknown"} src="runtime" />
        <Tile k="Testing" v={usdFromMicrocents(testing) ?? "unknown"} src="runtime" />
        <div className="db-tile">
          <span className="db-k">
            Unbilled
            <Info
              label="unbilled"
              text="Compute spent on customer requests that were refused or incomplete, so never charged."
            />
          </span>
          <strong className="db-v">{usdFromMicrocents(unbilled) ?? "unknown"}</strong>
          <span className="db-src">
            <Src>runtime</Src>
          </span>
        </div>
        <Tile
          k="Tokens"
          v={`${count(tokensIn)} in`}
          sub={`${count(tokensOut)} out`}
          src="runtime"
        />
        <Tile k="Operating" v={usdFromCents(opCents) ?? "unknown"} src="founder" />
        <Tile k="Network fees" v="Not recorded" src="—" />
      </div>
      <h3 className="db-sub">Compute by business</h3>
      <ul className="plain db-cbars" aria-label="Compute by business">
        {bs.map((b) => {
          const total = Number(sumPurposes(b));
          const billed =
            Number(b.compute?.by_purpose?.customer_use?.microcents ?? 0) -
            Number(b.compute?.unbilled_microcents ?? 0);
          const unb = Number(b.compute?.unbilled_microcents ?? 0);
          const test = total - billed - unb;
          const w = (v: number) => `${(Math.max(0, v) / maxCompute) * 100}%`;
          return (
            <li key={b.id}>
              <span className="db-cbar-name">{b.name}</span>
              <span className="db-cbar" aria-hidden="true">
                <span className="seg billed" style={{ width: w(billed) }} />
                <span className="seg unbilled" style={{ width: w(unb) }} />
                <span className="seg testing" style={{ width: w(test) }} />
              </span>
              <span className="db-cbar-v">
                {total === 0 ? "No model" : usdFromMicrocents(String(total))}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="db-legend plain" aria-label="Compute parts">
        <li>
          <span className="sw db-sw-billed" aria-hidden="true" /> Billed use
        </li>
        <li>
          <span className="sw db-sw-unbilled" aria-hidden="true" /> Unbilled use
        </li>
        <li>
          <span className="sw db-sw-testing" aria-hidden="true" /> Testing
        </li>
      </ul>
      <div className="db-table-wrap db-cost-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Business</th>
              <th scope="col">Model</th>
              <th scope="col">Calls</th>
              <th scope="col">Per call</th>
              <th scope="col">Per delivered</th>
              <th scope="col">Budget this month</th>
              <th scope="col">Build</th>
              <th scope="col">Operating</th>
            </tr>
          </thead>
          <tbody>
            {bs.map((b) => (
              <ComputeRow key={b.id} b={b} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComputeRow({ b }: { b: Json }) {
  const c = b.compute as Json;
  const noModel = sumPurposes(b) === "0";
  const op = ((b.operating_costs?.categories ?? []) as Json[]).reduce(
    (m, x) => m + x.total_cents,
    0,
  );
  return (
    <tr>
      <th scope="row">{b.name}</th>
      <td className="mono">{noModel ? "None" : (c.models as string[]).join(", ")}</td>
      <td>{count(c.calls)}</td>
      <td>
        {noModel
          ? "—"
          : `${usdAverage(c.per_call_microcents.median)} · p95 ${usdAverage(c.per_call_microcents.p95)}`}
      </td>
      <td>
        {b.cost_per_delivered_microcents === null || noModel
          ? "—"
          : usdAverage(b.cost_per_delivered_microcents)}
      </td>
      <td>
        <Budget c={c} />
      </td>
      <td>{c.build.jobs ? usdFromCents(c.build.cents) : "—"}</td>
      <td>{usdFromCents(op)}</td>
    </tr>
  );
}

export function Budget({ c }: { c: Json }) {
  const spent = usdFromMicrocents(c.budget.spent_this_month_microcents) ?? "unknown";
  if (c.budget.limit_cents === null) return <span>{spent} · no limit</span>;
  const used = Number(c.budget.spent_this_month_microcents) / 1_000_000 / c.budget.limit_cents;
  const pct = Math.min(100, Math.round(used * 100));
  return (
    <span className="db-budget">
      <span>
        {spent} of {usdFromCents(c.budget.limit_cents)}
      </span>
      <meter className="db-meter" min={0} max={100} value={pct} aria-label="Budget used">
        {pct}%
      </meter>
    </span>
  );
}

// --- Business cards --------------------------------------------------------------------------

function Spark({ values, label }: { values: number[]; label: string }) {
  const w = 220;
  const h = 44;
  const max = Math.max(...values, 0);
  const slot = w / Math.max(1, values.length);
  return (
    <svg
      className="db-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} stroke="var(--line-strong)" />
      {values.map((v, i) =>
        v > 0 && max > 0 ? (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per day, in order
            key={i}
            x={i * slot + slot * 0.15}
            width={slot * 0.7}
            y={h - (v / max) * (h - 2)}
            height={(v / max) * (h - 2)}
            fill="var(--data-primary)"
          />
        ) : null,
      )}
    </svg>
  );
}

function BusinessCard({ b, d }: { b: Json; d: Json }) {
  const asset = firstAsset(d, b);
  const series = chartSeries(d, b.id, "revenue", asset)[0];
  const earned = tokenText(b.totals.revenue?.[asset] ?? "0", asset, d.tokens?.[asset]);
  const next = nextAction(b);
  const status = b.sale
    ? { text: "Acquisition in process", cls: "db-badge warm" }
    : b.rehearsal?.state === "passed"
      ? { text: "Rehearsed", cls: "db-badge ok" }
      : null;
  return (
    <article className="card db-card" aria-labelledby={`card-${b.id}`}>
      <header>
        <h3 id={`card-${b.id}`}>
          <a href={`/portfolio/${b.id}`} target="_blank" rel="noopener">
            {b.name}
            <span className="sr-only"> (opens in a new tab)</span>
            <span aria-hidden="true" className="db-ext">
              ↗
            </span>
          </a>
        </h3>
        {status && <span className={status.cls}>{status.text}</span>}
      </header>
      <p className="db-what">
        <span className="db-kind">{b.product ?? "Business"}</span>
        {b.tagline ? ` · ${b.tagline}` : ""}
      </p>
      <div className="db-trend">
        <div>
          <strong>{earned}</strong>
          <span className="small muted">
            {b.totals.delivered} delivered
            {b.success_rate !== null && b.success_rate !== undefined
              ? ` · ${Math.round(b.success_rate * 100)}%`
              : ""}
          </span>
        </div>
        {series && <Spark values={series.values} label={`${b.name}: earned per day, ${earned}`} />}
      </div>
      {b.credits && (
        <p className="small muted db-meta">
          {groupDigits(String(b.credits.units ?? 0))} prepaid uses ·{" "}
          {runwayText(b.credits_runway_days)}
        </p>
      )}
      <footer>
        <Link to={next.link} className="btn btn-secondary btn-sm">
          {next.text}
          <span className="sr-only">: {b.name}</span>
        </Link>
      </footer>
    </article>
  );
}

// --- The page --------------------------------------------------------------------------------

export function Dashboard({ d, environment }: { d: Json; environment?: string }) {
  const bs = d.businesses as Json[];
  const selling = bs.filter((b) => b.sale);
  return (
    <div className="db">
      <header className="db-head">
        <h1 className="display">Portfolio</h1>
        <p className="db-chips">
          {environment && <span className="db-chip warm">{environment}</span>}
          <span className="db-chip">
            {shortDay(d.period.from)} – {shortDay(d.period.to)}
          </span>
          <span className="db-chip">{stamp(d.as_of)}</span>
        </p>
      </header>
      {bs.length === 0 ? (
        <p className="muted">No businesses yet.</p>
      ) : (
        <>
          <Summary d={d} bs={bs} />
          <div className="db-top">
            <div className="db-main">
              {selling.length > 0 && <Acquisitions d={d} selling={selling} />}
              <Performance d={d} />
            </div>
            <NeedsYou bs={bs} />
          </div>
          <Costs d={d} bs={bs} />
          <h2 className="section-title">Businesses</h2>
          <div className="db-cards">
            {bs.map((b) => (
              <BusinessCard key={b.id} b={b} d={d} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
