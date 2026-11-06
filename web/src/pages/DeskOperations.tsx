// Job 003t: Digital operations in the owner's books. Customer uses by the UTC month they were
// requested, with their current recorded outcome, and runtime cost by purpose, exact to a
// millionth of a cent. Same conventions as the books charts: one keyboard stop per month whose
// label carries every figure, patterns as well as colour, the current month marked "so far", and a
// table holding every value. Counts and sums only: no customer, document, result or reference.

import { useId, useState } from "react";
import type { Operations, OpsMonth } from "../api4.ts";
import {
  CHART_SERIES,
  type SeriesKey,
  seriesFill,
  seriesStroke,
  swatchClass,
} from "../chartSeries.ts";
import {
  costText,
  currentWork,
  describeCost,
  describeUsage,
  intScale,
  microcentsUsd,
  openReserved,
  usageSegments,
} from "../operations.ts";
import { Link } from "../router.tsx";
import { when } from "../when.ts";
import { Scroll } from "./FinanceChart.tsx";
import { SeriesPatterns } from "./SeriesPatterns.tsx";

const W = 640;
const H = 220;
const LEFT = 64;
const BOTTOM = 34;
const TOP = 10;
const PLOT = H - BOTTOM - TOP;

// Job 001h: charged and returned are distinct data series (colour AND pattern), no longer both
// the brand cobalt.
const FILL: Record<string, { fill: string; stroke?: string; dash?: string }> = {
  charged: { fill: "series:primary" },
  returned: { fill: "series:returned" },
  settling: { fill: "hatch", stroke: "var(--amber)" },
  attention: { fill: "var(--error)" },
  open: { fill: "var(--paper)", stroke: "var(--ink-2)", dash: "3 2" },
  never: { fill: "var(--line)" },
};

function YAxis({
  ticks,
  max,
  label,
  fmt,
}: {
  ticks: number[];
  max: number;
  label: string;
  fmt: (t: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => {
        const y = TOP + PLOT - (t / max) * PLOT;
        return (
          <g key={t}>
            <line
              x1={LEFT}
              x2={W - 8}
              y1={y}
              y2={y}
              stroke={t === 0 ? "var(--ink-2)" : "var(--line)"}
              strokeWidth={t === 0 ? 1.4 : 1}
            />
            <text x={LEFT - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
              {fmt(t)}
            </text>
          </g>
        );
      })}
      <text
        x={12}
        y={TOP + PLOT / 2}
        fontSize="11"
        fill="var(--ink-3)"
        transform={`rotate(-90 12 ${TOP + PLOT / 2})`}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

function MonthLabel({ m, cx }: { m: OpsMonth; cx: number }) {
  return (
    <>
      <text x={cx} y={H - 16} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
        {m.label.replace(/ \d{4}$/, "")}
      </text>
      {m.so_far && (
        <text x={cx} y={H - 4} fontSize="10" textAnchor="middle" fill="var(--ink-3)">
          so far
        </text>
      )}
    </>
  );
}

/** A segment's fill and outline: a data series, the hatch, or a plain colour. */
function segmentPaint(key: string, id: string) {
  const f = FILL[key] as (typeof FILL)[string];
  if (f.fill.startsWith("series:")) {
    const s = f.fill.slice(7) as SeriesKey;
    return { fill: seriesFill(s, id), stroke: seriesStroke(s), dash: undefined };
  }
  return {
    fill: f.fill === "hatch" ? `url(#${id}-hatch)` : f.fill,
    stroke: f.stroke ?? "var(--paper)",
    dash: f.dash,
  };
}

/** Uses per month, stacked by current outcome. A recorded zero month is drawn as a "0". */
export function UsageChart({ months }: { months: OpsMonth[] }) {
  const present = new Set(
    months.flatMap((m) =>
      usageSegments(m.usage)
        .filter((x) => x.value > 0)
        .map((x) => x.key as string),
    ),
  );
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const scale = intScale(months.map((m) => m.usage.requested));
  const band = (W - LEFT - 8) / Math.max(1, months.length);
  const bar = Math.min(34, band / 2);
  const x = (i: number) => LEFT + band * i + band / 2;
  const h = (v: number) => (v / scale.max) * PLOT;
  const shown = active === null ? null : months[active];
  const title = "Customer uses by the month they were requested, by current outcome";
  return (
    <figure className="fin-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <strong>Customer uses</strong> · by the UTC month they were requested · current outcome
      </figcaption>
      <Scroll label={`${title} (scrolls sideways on small screens)`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="fin-svg">
          <title>{title}</title>
          <defs>
            <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="var(--amber-soft)" />
              <path d="M0 6 L6 0" stroke="var(--amber)" strokeWidth="1.5" />
            </pattern>
            <SeriesPatterns chartId={id} keys={CHART_SERIES["customer uses"] ?? []} />
          </defs>
          <YAxis ticks={scale.ticks} max={scale.max} label="Uses" fmt={String} />
          {months.map((m, i) => {
            const cx = x(i);
            let y = TOP + PLOT;
            return (
              // One keyboard stop per month; its label carries every figure. Focus and hover only
              // reveal the same figures in the detail line; nothing is actionable.
              // biome-ignore lint/a11y/noStaticElementInteractions: see above
              <g
                key={m.yyyymm}
                tabIndex={0}
                aria-label={describeUsage(m)}
                onFocus={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                className="fin-point"
              >
                <rect x={cx - band / 2} y={TOP} width={band} height={PLOT} fill="transparent" />
                {/* First-use review #50: empty months carry no "0"; a month with uses carries its
                    total above the bar. */}
                {m.usage.requested === 0 ? null : (
                  <text
                    x={cx}
                    y={TOP + PLOT - h(m.usage.requested) - 6}
                    fontSize="11"
                    textAnchor="middle"
                    fill="var(--ink-2)"
                  >
                    {m.usage.requested}
                  </text>
                )}
                {m.usage.requested === 0
                  ? null
                  : usageSegments(m.usage).map((s) => {
                      if (s.value === 0) return null;
                      const sh = h(s.value);
                      y -= sh;
                      const p = segmentPaint(s.key, id);
                      return (
                        <rect
                          key={s.key}
                          data-series={s.key}
                          x={cx - bar / 2}
                          y={y}
                          width={bar}
                          height={Math.max(1, sh)}
                          fill={p.fill}
                          stroke={p.stroke}
                          strokeWidth={1}
                          strokeDasharray={p.dash}
                        />
                      );
                    })}
                {m.so_far && m.usage.requested > 0 && (
                  <rect
                    x={cx - bar / 2 - 3}
                    y={TOP + PLOT - h(m.usage.requested) - 3}
                    width={bar + 6}
                    height={h(m.usage.requested) + 3}
                    fill="none"
                    stroke="var(--ink-2)"
                    strokeDasharray="4 3"
                  />
                )}
                <MonthLabel m={m} cx={cx} />
              </g>
            );
          })}
        </svg>
      </Scroll>
      {/* Review #50: the legend names only what the chart shows. */}
      <div className="fin-legend" aria-hidden="true">
        {present.has("charged") && (
          <span>
            <i className={swatchClass("primary")} /> Charged
          </span>
        )}
        {present.has("returned") && (
          <span>
            <i className={swatchClass("returned")} /> Returned
          </span>
        )}
        {present.has("settling") && (
          <span>
            <i className="sw sw-hatch" /> Awaiting settlement
          </span>
        )}
        {present.has("attention") && (
          <span>
            <i className="sw sw-error" /> Needs attention
          </span>
        )}
        {present.has("open") && (
          <span>
            <i className="sw sw-dash" /> Reserved, not yet settled
          </span>
        )}
        {present.has("never") && (
          <span>
            <i className="sw sw-grey" /> Never reserved
          </span>
        )}
        {months.some((m) => m.so_far && m.usage.requested > 0) && (
          <span>Dashed frame: this month so far</span>
        )}
      </div>
      <p className="fin-detail" aria-live="polite">
        {shown ? describeUsage(shown) : "Focus or point at a month for its figures."}
      </p>
    </figure>
  );
}

/** Runtime cost per month, serving customers beside founder trials and checks. */
export function CostChart({ months }: { months: OpsMonth[] }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const v = (s: string) => Number(s);
  const scale = intScale(
    months.flatMap((m) => [v(m.cost.customers.microcents), v(m.cost.founder.microcents)]),
  );
  const band = (W - LEFT - 8) / Math.max(1, months.length);
  const bar = Math.min(26, band / 3);
  const x = (i: number) => LEFT + band * i + band / 2;
  const h = (n: number) => (n / scale.max) * PLOT;
  const shown = active === null ? null : months[active];
  const title = "Runtime cost by month: serving customers and founder trials and checks";
  const one = (m: OpsMonth, which: "customers" | "founder", bx: number, series: SeriesKey) => {
    const c = m.cost[which];
    const ht = h(v(c.microcents));
    const top = TOP + PLOT - Math.max(1, ht);
    return (
      <>
        {c.calls > 0 && (
          <rect
            data-series={which}
            x={bx}
            y={top}
            width={bar}
            height={Math.max(1, ht)}
            fill={seriesFill(series, id)}
            stroke={m.so_far ? "var(--ink-2)" : seriesStroke(series)}
            strokeDasharray={m.so_far ? "4 3" : undefined}
          />
        )}
        {c.unknown_cost_calls > 0 && (
          <text
            x={bx + bar / 2}
            y={top - 4}
            fontSize="12"
            textAnchor="middle"
            fill="var(--amber)"
            fontWeight="600"
          >
            ?
          </text>
        )}
      </>
    );
  };
  return (
    <figure className="fin-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <strong>Runtime cost</strong> · US dollars, exact · by the UTC month of each call · not an
        invoice
      </figcaption>
      <Scroll label={`${title} (scrolls sideways on small screens)`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="fin-svg">
          <title>{title}</title>
          <defs>
            <SeriesPatterns chartId={id} keys={CHART_SERIES["runtime cost"] ?? []} />
          </defs>
          <YAxis
            ticks={scale.ticks}
            max={scale.max}
            label="US dollars"
            fmt={(t) => microcentsUsd(BigInt(Math.round(t)).toString())}
          />
          {months.map((m, i) => {
            const cx = x(i);
            const none = m.cost.customers.calls === 0 && m.cost.founder.calls === 0;
            return (
              // One keyboard stop per month; see UsageChart.
              // biome-ignore lint/a11y/noStaticElementInteractions: see above
              <g
                key={m.yyyymm}
                tabIndex={0}
                aria-label={describeCost(m)}
                onFocus={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                className="fin-point"
              >
                <rect x={cx - band / 2} y={TOP} width={band} height={PLOT} fill="transparent" />
                {none ? (
                  <text
                    x={cx}
                    y={TOP + PLOT - 6}
                    fontSize="11"
                    textAnchor="middle"
                    fill="var(--ink-3)"
                  >
                    0
                  </text>
                ) : (
                  <>
                    {one(m, "customers", cx - bar - 2, "primary")}
                    {one(m, "founder", cx + 2, "founder")}
                  </>
                )}
                <MonthLabel m={m} cx={cx} />
              </g>
            );
          })}
        </svg>
      </Scroll>
      <div className="fin-legend" aria-hidden="true">
        <span>
          <i className={swatchClass("primary")} /> Serving customers (solid, left)
        </span>
        <span>
          <i className={swatchClass("founder")} /> Founder trials and release checks (dotted, right)
        </span>
        <span>? Some calls with unknown cost (held, not counted as zero)</span>
        <span>
          <i className="sw sw-dash" /> This month so far
        </span>
      </div>
      <p className="fin-detail" aria-live="polite">
        {shown ? describeCost(shown) : "Focus or point at a month for its figures."}
      </p>
    </figure>
  );
}

export function DeskOperations({ ops, businessId }: { ops: Operations; businessId: string }) {
  const t = ops.totals;
  const span = `the last ${ops.period.months} ${ops.period.months === 1 ? "month" : "months"}`;
  const links = (
    <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {ops.products.map((p) => (
        <Link
          key={p.project_id}
          to={`/build/${p.project_id}?view=service&task=customers`}
          className="btn btn-quiet btn-sm"
        >
          Customer access and settling ({p.active_offers} active
          {p.retired_offers ? `, ${p.retired_offers} retired` : ""})
        </Link>
      ))}
      <Link to={`/desk/${businessId}/continuity`} className="btn btn-quiet btn-sm">
        Ownership and continuity
      </Link>
      <Link to={`/desk/${businessId}/handover`} className="btn btn-quiet btn-sm">
        Sale and handover
      </Link>
    </div>
  );
  if (ops.state === "not_started")
    return (
      <div className="fin-ops">
        <h3 style={{ fontSize: 15, marginTop: 18 }}>Digital operations</h3>
        <div className="notice">
          <strong>No customer product yet.</strong>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Founder trials and checks so far: {costText(t.cost.founder)}.
        </p>
      </div>
    );
  return (
    <div className="fin-ops">
      <h3 style={{ fontSize: 15, marginTop: 18 }}>Digital operations</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        {span} · as of {when(ops.as_of)}
      </p>
      {/* First-use review #48: the figures and usage chart are on the Overview; here, cost. */}
      <CostChart months={ops.months} />
      <OpsTable ops={ops} />
      {links}
    </div>
  );
}

/** Job 001h: the four operating figures, shared by the overview and the performance view. */
export function OpsTiles({ ops }: { ops: Operations }) {
  const t = ops.totals;
  const span = `the last ${ops.period.months} ${ops.period.months === 1 ? "month" : "months"}`;
  const attention = ops.current.needs_attention;
  const work = currentWork(ops.current);
  return (
    <div className="fin-tiles">
      <div className="fin-tile">
        <div className="k">Customer uses requested</div>
        <div className="v">{t.usage.requested}</div>
        <div className="s">
          {t.usage.charged} charged · {t.usage.returned} returned, in {span}
        </div>
      </div>
      <div className="fin-tile">
        <div className="k">Usable results delivered</div>
        <div className="v">{t.execution.usable_result}</div>
        <div className="s">
          of {t.execution.ran} runs · {t.execution.not_usable} not usable
        </div>
      </div>
      <div className="fin-tile">
        <div className="k">Current customer work (all time)</div>
        <div className={`v${attention ? " fin-unknown" : ""}`}>{work.total}</div>
        <div className="s">
          {work.parts.length
            ? work.parts.map((p) => `${p.value} ${p.label}`).join(" · ")
            : "Nothing waiting"}
        </div>
      </div>
      <div className="fin-tile">
        <div className="k">Runtime cost serving customers</div>
        <div className={`v${t.cost.customers.unknown_cost_calls ? " fin-unknown" : ""}`}>
          {microcentsUsd(t.cost.customers.microcents)}
          {t.cost.customers.unknown_cost_calls ? " + ?" : ""}
        </div>
        <div className="s">
          {t.cost.customers.calls} calls · founder trials and checks{" "}
          {microcentsUsd(t.cost.founder.microcents)}
          {t.cost.founder.unknown_cost_calls ? " + ?" : ""}
        </div>
      </div>
    </div>
  );
}

function OpsTable({ ops }: { ops: Operations }) {
  return (
    <details style={{ marginTop: 12 }}>
      <summary>Every operations figure, with its basis</summary>
      <Scroll className="fin-table-wrap" label="Digital operations by month, scrolls sideways">
        <table className="table fin-table">
          <caption className="sr-only">Digital operations by month</caption>
          <thead>
            <tr>
              <th scope="col">Month (UTC)</th>
              <th scope="col">Requested</th>
              <th scope="col">Charged</th>
              <th scope="col">Returned</th>
              <th scope="col">Awaiting settlement</th>
              <th scope="col">Needs attention</th>
              <th scope="col">Reserved, not settled</th>
              <th scope="col">Never reserved</th>
              <th scope="col">Ran / usable</th>
              <th scope="col">Serving customers</th>
              <th scope="col">Founder trials and checks</th>
            </tr>
          </thead>
          <tbody>
            {ops.months.map((m) => (
              <tr key={m.yyyymm}>
                <th scope="row">
                  {m.label}
                  {m.so_far && <span className="muted"> (so far)</span>}
                </th>
                <td className="num">{m.usage.requested}</td>
                <td className="num">{m.usage.charged}</td>
                <td className="num">{m.usage.returned}</td>
                <td className="num">{m.usage.settling}</td>
                <td className="num">{m.usage.needs_attention}</td>
                <td className="num">{openReserved(m.usage)}</td>
                <td className="num">{m.usage.never_reserved}</td>
                <td className="num">
                  {m.execution.ran} / {m.execution.usable_result}
                </td>
                {(["customers", "founder"] as const).map((g) => (
                  <td
                    key={g}
                    className={`num${m.cost[g].unknown_cost_calls ? " fin-unknown" : ""}`}
                  >
                    {costText(m.cost[g])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <ul style={{ fontSize: 12.5, paddingLeft: 18 }} className="muted">
        <li>
          <strong>Uses:</strong> {ops.basis.usage}
        </li>
        <li>
          <strong>Current work:</strong> {ops.basis.current}
        </li>
        <li>
          <strong>Usable:</strong> {ops.basis.execution}
        </li>
        <li>
          <strong>Cost:</strong> {ops.basis.cost}
        </li>
        <li>
          <strong>Value:</strong> {ops.basis.value}
        </li>
      </ul>
    </details>
  );
}
