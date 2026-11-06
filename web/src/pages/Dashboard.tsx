// Plan step 7 (design/dashboard/DECISION.md, direction C with Tony's changes): the founder's
// dashboard on GET /api/me/dashboard. The month at a glance; a sale that needs a decision as the
// hero, its steps from funded escrow to ownership transfer; one larger performance chart that
// switches between the portfolio and a single business; short cards that lead with what each
// business does, one trend and its next action. TUSD and USD are never added or share an axis;
// unknown stays unknown; detail lives in each business's workspace.

import { useEffect, useId, useRef, useState } from "react";
import { type SeriesKey, seriesFill, seriesStroke, swatchClass } from "../chartSeries.ts";
import {
  acceptedBy,
  chartSeries,
  chartTotal,
  type Json,
  type Metric,
  nextAction,
  niceTicks,
  releaseMarks,
  runwayText,
  type Series,
  saleSteps,
  shortDay,
  stamp,
  symbolOf,
  tokenText,
  usdFromMicrocents,
} from "../dashboardView.ts";
import { Link } from "../router.tsx";
import { groupDigits } from "../TokenAmount.tsx";
import { SeriesPatterns } from "./SeriesPatterns.tsx";

const ORDER: SeriesKey[] = ["primary", "returned", "founder", "cost"];
const seriesKey = (i: number) => ORDER[i % ORDER.length] as SeriesKey;

/** The element's width, for drawing at real pixels (charts stay legible on a phone). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(260, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// --- The month at a glance -------------------------------------------------------------------

function Summary({ d }: { d: Json }) {
  const assets = Object.keys(d.totals.revenue ?? {});
  const bs = d.businesses as Json[];
  const delivered = bs.reduce((n, b) => n + b.totals.delivered, 0);
  const tried = delivered + bs.reduce((n, b) => n + b.totals.not_charged, 0);
  const active = bs.reduce((n, b) => n + (b.customers?.active ?? 0), 0);
  const fresh = bs.reduce((n, b) => n + (b.customers?.new ?? 0), 0);
  const unknownCalls = bs.reduce((n, b) => n + b.totals.compute_unknown_calls, 0);
  const credits = bs.filter((b) => b.credits);
  const creditUnits = credits.reduce((n, b) => n + (b.credits.units ?? 0), 0);
  const creditAssets = [...new Set(credits.map((b) => b.credits.asset as string))];
  const observed = credits
    .map((b) => b.credits.observed_at as string)
    .sort()
    .at(-1);
  return (
    <section className="db-summary" aria-label="The month at a glance">
      <div className="db-tile">
        <span className="db-k">Earned revenue</span>
        {assets.length === 0 ? (
          <strong className="db-v">None yet</strong>
        ) : (
          assets.map((a) => (
            <strong key={a} className="db-v">
              {tokenText(d.totals.revenue[a], a, d.tokens?.[a])}
            </strong>
          ))
        )}
        <span className="db-d">
          {bs
            .map((b) => {
              const a = assets[0];
              return a
                ? `${b.name} ${tokenText(b.totals.revenue?.[a] ?? "0", a, d.tokens?.[a]).split(" ")[0]}`
                : b.name;
            })
            .join(" · ")}
        </span>
        <span className="db-src">Source: business contracts</span>
      </div>
      <div className="db-tile">
        <span className="db-k">Delivered</span>
        <strong className="db-v">
          {delivered} <small>requests</small>
        </strong>
        <span className="db-d">
          {tried > 0
            ? `${Math.round((delivered / tried) * 100)}% of ${tried} finished`
            : "None finished"}{" "}
          · {tried - delivered} not charged
        </span>
        <span className="db-src">Source: runtime records</span>
      </div>
      <div className="db-tile">
        <span className="db-k">Active customers</span>
        <strong className="db-v">{active}</strong>
        <span className="db-d">{fresh} new · counted per business</span>
        <span className="db-src">Source: app records</span>
      </div>
      <div className="db-tile">
        <span className="db-k">Known compute cost</span>
        <strong className="db-v">
          {usdFromMicrocents(d.totals.compute_microcents) ?? "unknown"} <small>USD</small>
        </strong>
        <span className="db-d">
          {unknownCalls === 0
            ? "No calls of unknown cost"
            : `${unknownCalls} calls of unknown cost`}{" "}
          · kept apart from token revenue · network fees not recorded
        </span>
        <span className="db-src">Source: runtime records</span>
      </div>
      <div className="db-tile">
        <span className="db-k">Customer credits prepaid</span>
        <strong className="db-v">
          {groupDigits(String(creditUnits))} <small>uses</small>
        </strong>
        <span className="db-d">
          {creditAssets.length === 1
            ? `${tokenText(
                credits.reduce((n, b) => n + BigInt(b.credits.value ?? "0"), 0n).toString(),
                creditAssets[0] as string,
                d.tokens?.[creditAssets[0] as string],
              )} owed to customers`
            : "Owed to customers, per business"}
        </span>
        <span className="db-src">
          Source: contract treasuries{observed ? ` · seen ${stamp(observed)}` : ""}
        </span>
      </div>
    </section>
  );
}

// --- The handover, while it needs a decision --------------------------------------------------

function Handover({ b, d }: { b: Json; d: Json }) {
  const s = b.sale as Json;
  const asset = (s.asset ?? b.credits?.asset ?? Object.keys(d.tokens ?? {})[0]) as string;
  const token = d.tokens?.[asset];
  const price = tokenText(s.price, asset, token);
  const steps = saleSteps(s, price);
  const funded = steps[1]?.state === "done";
  return (
    <section className="card db-hero" aria-labelledby={`hero-${b.id}`}>
      <p className="db-hero-eyebrow">
        <span>Handover in progress</span>
        <span className="db-pill">
          {s.state === "closing" ? "Closing" : "Proposed"} · nothing has moved yet
        </span>
      </p>
      <h2 id={`hero-${b.id}`} className="db-hero-title">
        {b.name} <span aria-hidden="true">→</span>
        <span className="sr-only"> to </span> <span className="mono">{s.buyer}</span>
      </h2>
      <p className="muted">
        A Direct sale of the whole business: its release, customers and prepaid uses. Seller{" "}
        <span className="mono">{b.ownership?.owner_account}</span> (you).
      </p>
      <dl className="db-facts">
        <div>
          <dt>Price</dt>
          <dd>{price}</dd>
        </div>
        <div className={funded ? "db-fact-ok" : undefined}>
          <dt>Escrow</dt>
          <dd>{tokenText(s.escrow, asset, token)}</dd>
          <span className="small">
            {funded ? "Funded by the buyer, held by the contract" : "Not funded yet"}
          </span>
        </div>
        <div className="db-fact-wait">
          <dt>Accepted by</dt>
          <dd>{acceptedBy(s)}</dd>
          <span className="small">Both sides must accept before anything moves</span>
        </div>
        <div>
          <dt>Offer expires</dt>
          <dd>{shortDay(s.expires_at)}</dd>
          <span className="small">{stamp(s.expires_at)} · escrow returns if it lapses</span>
        </div>
      </dl>
      <ol className="db-steps" aria-label="Steps of the sale">
        {steps.map((st, i) => (
          <li key={st.key} className={`db-step ${st.state}`}>
            <span className="db-dot" aria-hidden="true">
              {st.state === "done" ? "✓" : i + 1}
            </span>
            <span className="db-step-label">{st.label}</span>
            <span className="db-step-detail">
              <span className="sr-only">
                {st.state === "done"
                  ? "Done: "
                  : st.state === "current"
                    ? "Current: "
                    : "Pending: "}
              </span>
              {st.detail}
            </span>
          </li>
        ))}
      </ol>
      <div className="db-hero-foot">
        <p>
          <strong>Customers keep what they paid for.</strong>{" "}
          {b.credits
            ? `${b.credits.units ?? "An unknown number of"} prepaid uses (${tokenText(b.credits.value, b.credits.asset, d.tokens?.[b.credits.asset])}) stay with their customers and carry over to the new owner.`
            : "Prepaid uses carry over to the new owner."}{" "}
          Release {b.release?.number ?? ""} keeps running through the transfer.
        </p>
        <Link to={`/sales/${b.id}`} className="btn btn-primary">
          Review the terms
        </Link>
      </div>
    </section>
  );
}

// --- Needs you today, and who holds what ----------------------------------------------------

function NeedsYou({ d }: { d: Json }) {
  const items = (d.businesses as Json[]).flatMap((b) =>
    (b.attention as Json[]).map((a): Json => ({ ...a, business: b.name })),
  );
  return (
    <section className="card db-needs" aria-labelledby="db-needs">
      <h2 id="db-needs">Needs you today</h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing waits on you.</p>
      ) : (
        <ul className="plain">
          {items.map((a) => (
            <li key={`${a.business}-${a.kind}`}>
              <div>
                <strong>{a.text}</strong>
                <span className="small muted">{a.business}</span>
              </div>
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
            <th scope="col">Gen.</th>
            <th scope="col">Transfers</th>
          </tr>
        </thead>
        <tbody>
          {(d.businesses as Json[]).map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.name}</th>
              <td className="mono">
                {b.ownership?.owner_account ?? "unknown"}
                {b.ownership?.sale_in_progress && (
                  <span className="db-own-note">sale pending: no change yet</span>
                )}
              </td>
              <td>{b.ownership?.generation ?? "?"}</td>
              <td>{b.ownership?.transfers ?? "?"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Generation counts handovers. Network fees: not recorded.</p>
    </section>
  );
}

// --- Performance: one larger chart, portfolio or one business --------------------------------

function BarChart({
  series,
  days,
  marks,
  unit,
  label,
  partialLast,
}: {
  series: Series[];
  days: string[];
  marks: { day: number; label: string }[];
  unit: string;
  label: string;
  partialLast: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>(760);
  const height = width < 520 ? 220 : 300;
  const pad = { l: 44, r: 12, t: marks.length ? 30 : 22, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const totals = days.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks.at(-1) ?? 1;
  const slot = plotW / days.length;
  const barW = Math.max(3, Math.min(22, slot * 0.68));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const every = width < 520 ? 10 : 7;
  const keys = series.map((_, i) => seriesKey(i));
  return (
    <div ref={ref} className="db-chart">
      <svg width={width} height={height} role="img" aria-label={label}>
        <defs>
          <SeriesPatterns chartId={id} keys={keys} />
          <pattern id={`${id}-today`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 6 L6 0" stroke="var(--line-strong)" strokeWidth="1" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="db-axis">
              {t}
            </text>
          </g>
        ))}
        <text x={4} y={marks.length ? 12 : pad.t - 9} className="db-axis">
          {unit}
        </text>
        {partialLast && (
          <rect
            x={pad.l + slot * (days.length - 1)}
            y={pad.t}
            width={slot}
            height={plotH}
            fill={`url(#${id}-today)`}
            opacity="0.6"
          />
        )}
        {days.map((day, i) => {
          let base = 0;
          const x = pad.l + slot * i + (slot - barW) / 2;
          return (
            <g key={day}>
              <title>
                {`${shortDay(day)}${partialLast && i === days.length - 1 ? " (today so far)" : ""}: ${series.map((s) => `${s.name} ${s.labels[i]}`).join(", ")}`}
              </title>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const y0 = y(base);
                base += v;
                const y1 = y(base);
                const k = keys[si] as SeriesKey;
                return (
                  <rect
                    key={s.id}
                    x={x}
                    y={y1}
                    width={barW}
                    height={Math.max(1, y0 - y1)}
                    fill={seriesFill(k, id)}
                    stroke={seriesStroke(k)}
                    strokeWidth="0.8"
                  />
                );
              })}
            </g>
          );
        })}
        {marks.map((m) => {
          const x = pad.l + slot * m.day + slot / 2;
          return (
            <g key={m.label}>
              <line
                x1={x}
                x2={x}
                y1={pad.t - 6}
                y2={pad.t + plotH}
                stroke="var(--data-founder)"
                strokeDasharray="3 3"
              />
              <text x={x + 4} y={pad.t - 9} className="db-mark">
                {m.label} · {shortDay(days[m.day] as string)}
              </text>
            </g>
          );
        })}
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + plotH}
          y2={pad.t + plotH}
          stroke="var(--line-strong)"
        />
        {days.map((day, i) =>
          (i % every === 0 && days.length - 1 - i >= every / 2) || i === days.length - 1 ? (
            <text
              key={day}
              x={pad.l + slot * i + slot / 2}
              y={height - 8}
              textAnchor="middle"
              className="db-axis"
            >
              {shortDay(day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Earned revenue" },
  { key: "delivered", label: "Delivered" },
  { key: "compute", label: "Compute cost" },
];

function Performance({ d }: { d: Json }) {
  const bs = d.businesses as Json[];
  const [scope, setScope] = useState("all");
  const [metric, setMetric] = useState<Metric>("revenue");
  const asset = (Object.keys(d.totals.revenue ?? {})[0] ??
    Object.keys(d.tokens ?? {})[0] ??
    "") as string;
  const token = d.tokens?.[asset];
  const series = chartSeries(d, scope, metric, asset);
  const days = d.days as string[];
  const marks = releaseMarks(d, scope);
  const one = bs.find((b) => b.id === scope);
  const unit =
    metric === "revenue"
      ? symbolOf(asset, token)
      : metric === "delivered"
        ? "Requests"
        : "US cents";
  const scaled: Series[] =
    metric === "compute" ? series.map((s) => ({ ...s, values: s.values.map((v) => v) })) : series;
  const source =
    metric === "revenue"
      ? "Business contracts: charged for delivered results, pending charges not counted"
      : metric === "delivered"
        ? "Runtime records: delivered and charged requests"
        : "Runtime records: known compute cost in USD, its own axis, never added to token revenue";
  const noModel =
    metric === "compute" &&
    one &&
    one.totals.compute_microcents === "0" &&
    one.totals.compute_unknown_calls === 0;
  const scopeName = one ? one.name : "All businesses";
  const total = chartTotal(d, scope, metric, asset);
  const tableId = useId();
  return (
    <section className="card db-perf" aria-labelledby="db-perf">
      <div className="db-perf-head">
        <div>
          <h2 id="db-perf">Performance</h2>
          <p className="small muted">
            {d.period.from ? `${shortDay(d.period.from)} – ${shortDay(d.period.to)}` : ""} ·{" "}
            {d.period.days} days · as of {stamp(d.as_of)}
          </p>
        </div>
        <div className="db-total">
          <span className="small muted">
            {scopeName} · {METRICS.find((m) => m.key === metric)?.label}
          </span>
          <strong>
            {metric === "delivered"
              ? `${total} requests`
              : metric === "compute"
                ? `${total} USD`
                : total}
          </strong>
        </div>
      </div>
      <div className="db-switch">
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
              <span className="db-mark-sw" aria-hidden="true" /> Release went live
            </li>
          )}
        </ul>
      )}
      {noModel ? (
        <p className="db-nomodel">
          <strong>No model cost.</strong> {one.name} runs no AI model, so its compute cost is
          genuinely zero. Network fees: not recorded.
        </p>
      ) : (
        <BarChart
          series={scaled}
          days={days}
          marks={metric === "compute" ? [] : marks}
          unit={unit}
          partialLast
          label={`${scopeName}: ${METRICS.find((m) => m.key === metric)?.label} per day in ${unit}, ${total} in total. The daily figures are in the table below.`}
        />
      )}
      <p className="db-source small">
        <span className="db-src-tag">Source</span> {source}. The last day is today so far.
      </p>
      <details className="db-table">
        <summary id={tableId}>Daily figures as a table</summary>
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
      <p className="small">
        Detailed records:{" "}
        {one ? (
          <Link to={`/desk/${one.id}`}>{one.name}'s workspace</Link>
        ) : (
          bs.map((b, i) => (
            <span key={b.id}>
              {i > 0 && " · "}
              <Link to={`/desk/${b.id}`}>{b.name}</Link>
            </span>
          ))
        )}
      </p>
    </section>
  );
}

// --- Short business cards -------------------------------------------------------------------

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
  const asset = (Object.keys(b.totals.revenue ?? {})[0] ??
    Object.keys(d.totals.revenue ?? {})[0] ??
    "") as string;
  const token = d.tokens?.[asset];
  const series = chartSeries(d, b.id, "revenue", asset)[0];
  const earned = tokenText(b.totals.revenue?.[asset] ?? "0", asset, token);
  const next = nextAction(b);
  const status = b.sale
    ? { text: "Handover in progress", cls: "db-badge warm" }
    : b.rehearsal?.state === "passed"
      ? { text: "Rehearsal passed", cls: "db-badge ok" }
      : { text: "Owner", cls: "db-badge" };
  return (
    <article className="card db-card" aria-labelledby={`card-${b.id}`}>
      <header>
        <h3 id={`card-${b.id}`}>
          <Link to={`/desk/${b.id}`}>{b.name}</Link>
        </h3>
        <span className={status.cls}>{status.text}</span>
      </header>
      <p className="db-what">
        <span className="db-kind">{b.product ?? "Business"}</span>
        {b.tagline ? ` · ${b.tagline}` : ""}
      </p>
      <div className="db-trend">
        <div>
          <strong>{earned}</strong>
          <span className="small muted">earned in {d.period.days} days</span>
          <span className="small muted">
            {b.totals.delivered} delivered
            {b.success_rate !== null && b.success_rate !== undefined
              ? ` · ${Math.round(b.success_rate * 100)}% charged`
              : ""}
          </span>
        </div>
        {series && (
          <Spark
            values={series.values}
            label={`${b.name}: earned per day over ${d.period.days} days, ${earned} in total`}
          />
        )}
      </div>
      <p className="small muted db-meta">
        Release {b.release?.number ?? "none"}
        {b.release?.activated_at ? ` · since ${shortDay(b.release.activated_at)}` : ""}
        {b.credits ? ` · credits last ${runwayText(b.credits_runway_days)}` : ""}
      </p>
      <footer>
        <Link to={next.link} className="btn btn-secondary btn-sm">
          {next.text}
          <span className="sr-only">: {b.name}</span>
        </Link>
        <Link to={`/desk/${b.id}`} className="btn btn-quiet btn-sm">
          Workspace<span className="sr-only">: {b.name}</span>
        </Link>
      </footer>
    </article>
  );
}

// --- The page section ------------------------------------------------------------------------

export function Dashboard({ d, environment }: { d: Json; environment?: string }) {
  const bs = d.businesses as Json[];
  const selling = bs.filter((b) => b.sale);
  return (
    <div className="db">
      <header className="db-head">
        <div>
          <p className="eyebrow">Operate · Portfolio</p>
          <h1 className="display">Portfolio</h1>
          <p className="muted">
            {bs.length} business{bs.length === 1 ? "" : "es"}, from launch to handover
            {selling.length
              ? `. ${selling.length === 1 ? "One is" : `${selling.length} are`} being handed over now.`
              : "."}
          </p>
        </div>
        <p className="db-chips">
          {environment && <span className="db-chip warm">{environment}</span>}
          <span className="db-chip">
            {shortDay(d.period.from)} – {shortDay(d.period.to)}
          </span>
          <span className="db-chip">As of {stamp(d.as_of)}</span>
        </p>
      </header>
      {bs.length === 0 ? (
        <p className="muted">You don't control a business yet.</p>
      ) : (
        <>
          <Summary d={d} />
          <div className={`db-top${selling.length ? "" : " no-hero"}`}>
            <div className="db-main">
              {selling.map((b) => (
                <Handover key={b.id} b={b} d={d} />
              ))}
              {selling.length === 0 && <Performance d={d} />}
            </div>
            <NeedsYou d={d} />
          </div>
          {selling.length > 0 && <Performance d={d} />}
          <h2 className="section-title">Your businesses</h2>
          <div className="db-cards">
            {bs.map((b) => (
              <BusinessCard key={b.id} b={b} d={d} />
            ))}
          </div>
          <p className="small muted db-foot">{d.definitions?.totals}</p>
        </>
      )}
    </div>
  );
}
