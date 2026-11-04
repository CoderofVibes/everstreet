// Job 003u: the buyer's Digital performance tab. Only the allowlisted aggregate the seller granted:
// customer uses by month and outcome, usable results, open work, and runtime cost serving
// customers beside the founder's own tests. Hidden small counts are a hatched marker and the words
// "Fewer than 3", never a value. No links into the seller's tools and no actions.

import { useId, useState } from "react";
import type { PerformanceEvidence } from "../api5.ts";
import { intScale, microcentsUsd } from "../operations.ts";
import {
  costShown,
  describeMonth,
  drawn,
  isHidden,
  performanceState,
  shownText,
} from "../performance.ts";
import { Scroll } from "./FinanceChart.tsx";

const W = 640;
const H = 200;
const LEFT = 64;
const TOP = 10;
const PLOT = H - 34 - TOP;

type Month = PerformanceEvidence["months"][number];

function MonthlyChart({
  months,
  title,
  series,
  axis,
  fmt,
}: {
  months: Month[];
  title: string;
  series: { label: string; fill: string; value: (m: Month) => number | "hidden" }[];
  axis: string;
  fmt: (t: number) => string;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = months.flatMap((m) =>
    series.map((s) => s.value(m)).filter((v): v is number => v !== "hidden"),
  );
  const scale = intScale(values);
  const band = (W - LEFT - 8) / Math.max(1, months.length);
  const bar = Math.min(24, band / (series.length + 1));
  const x = (i: number) => LEFT + band * i + band / 2;
  const shown = active === null ? null : months[active];
  return (
    <figure className="fin-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <strong>{title}</strong>
      </figcaption>
      <Scroll label={`${title} (scrolls sideways on small screens)`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="fin-svg">
          <title>{title}</title>
          <defs>
            <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 6 L6 0" stroke="var(--ink-3)" strokeWidth="1.5" />
            </pattern>
          </defs>
          {scale.ticks.map((t) => {
            const y = TOP + PLOT - (t / scale.max) * PLOT;
            return (
              <g key={t}>
                <line x1={LEFT} x2={W - 8} y1={y} y2={y} stroke="var(--line)" />
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
            {axis}
          </text>
          {months.map((m, i) => (
            // One keyboard stop per month; its label carries every figure shown for it.
            // biome-ignore lint/a11y/noStaticElementInteractions: focus only reveals the same text
            <g
              key={m.yyyymm}
              tabIndex={0}
              aria-label={describeMonth(m)}
              onFocus={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              className="fin-point"
            >
              <rect x={x(i) - band / 2} y={TOP} width={band} height={PLOT} fill="transparent" />
              {series.map((s, k) => {
                const v = s.value(m);
                const bx = x(i) - (series.length * (bar + 2)) / 2 + k * (bar + 2);
                if (v === "hidden")
                  return (
                    <rect
                      key={s.label}
                      x={bx}
                      y={TOP + PLOT - 18}
                      width={bar}
                      height={18}
                      fill={`url(#${id}-hatch)`}
                      stroke="var(--ink-3)"
                    />
                  );
                const h = (v / scale.max) * PLOT;
                return v === 0 ? null : (
                  <rect
                    key={s.label}
                    x={bx}
                    y={TOP + PLOT - h}
                    width={bar}
                    height={Math.max(1, h)}
                    fill={s.fill}
                    stroke={m.so_far ? "var(--ink-2)" : "none"}
                    strokeDasharray={m.so_far ? "4 3" : undefined}
                  />
                );
              })}
              <text x={x(i)} y={H - 18} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
                {m.label.replace(/ \d{4}$/, "")}
              </text>
              {m.so_far && (
                <text x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--ink-3)">
                  so far
                </text>
              )}
            </g>
          ))}
        </svg>
      </Scroll>
      <div className="fin-legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.label}>
            <i className="sw" style={{ background: s.fill }} /> {s.label}
          </span>
        ))}
        <span>
          <i className="sw sw-grey" /> Hatched: fewer than 3 (hidden)
        </span>
        <span>
          <i className="sw sw-dash" /> This month so far
        </span>
      </div>
      <p className="fin-detail" aria-live="polite">
        {shown ? describeMonth(shown) : "Focus or point at a month for its figures."}
      </p>
    </figure>
  );
}

export function RoomPerformance({ p }: { p: PerformanceEvidence | undefined }) {
  const state = performanceState(p);
  if (!p || state.kind === "not_granted")
    return (
      <section className="card">
        <h2>Digital performance</h2>
        <p className="muted">{state.text}</p>
      </section>
    );
  const t = p.cost;
  return (
    <section className="card fin-card">
      <h2>Digital performance</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        The seller's own records of customer uses and runtime calls, over {p.period.months}{" "}
        {p.period.buckets} as of {p.as_of.replace("T", " ").slice(0, 16)} UTC. {p.basis.not}
      </p>
      {state.kind === "nothing_recorded" && <p className="notice">{state.text}</p>}
      <div className="fin-tiles">
        <div className="fin-tile">
          <div className="k">Customer uses requested</div>
          <div className="v">{shownText(p.usage.requested)}</div>
          <div className="s">In the window, by the month each was requested</div>
        </div>
        <div className="fin-tile">
          <div className="k">Usable results</div>
          <div className="v">{shownText(p.execution.usable_result)}</div>
          <div className="s">
            of {shownText(p.execution.ran)} runs · {shownText(p.execution.not_usable)} not usable
          </div>
        </div>
        <div className="fin-tile">
          <div className="k">Open customer work now</div>
          <div className="v">{shownText(p.current.total)}</div>
          <div className="s">Not yet settled or needing attention (all time)</div>
        </div>
        <div className="fin-tile">
          <div className="k">Runtime cost serving customers</div>
          <div className={`v${isHidden(t.customers.microcents) ? " fin-unknown" : ""}`}>
            {costShown(t.customers.microcents)}
          </div>
          <div className="s">
            Founder trials and checks {microcentsUsd(t.founder.microcents)} (kept apart)
          </div>
        </div>
      </div>
      <h3 style={{ fontSize: 15 }}>Outcome of the uses requested in the window (as of now)</h3>
      <ul style={{ fontSize: 14, paddingLeft: 18 }}>
        {p.usage.split.map((s) => (
          <li key={s.key}>
            {s.label}: <strong>{shownText(s.value)}</strong>
          </li>
        ))}
      </ul>
      <MonthlyChart
        months={p.months}
        title="Customer uses by the month they were requested"
        axis="Uses"
        fmt={String}
        series={[
          {
            label: "Customer uses",
            fill: "var(--mint)",
            value: (m) => (isHidden(m.requested) ? "hidden" : drawn(m.requested)),
          },
        ]}
      />
      <MonthlyChart
        months={p.months}
        title="Runtime cost by month: serving customers beside founder trials and checks"
        axis="US dollars"
        fmt={(v) => microcentsUsd(BigInt(Math.round(v)).toString())}
        series={[
          {
            label: "Serving customers",
            fill: "var(--mint)",
            value: (m) =>
              isHidden(m.customers.microcents) ? "hidden" : Number(m.customers.microcents),
          },
          {
            label: "Founder trials and checks",
            fill: "var(--blue)",
            value: (m) => Number(m.founder.microcents),
          },
        ]}
      />
      <details style={{ marginTop: 12 }}>
        <summary>Every figure in this section, with its basis</summary>
        <Scroll className="fin-table-wrap" label="Digital performance by month, scrolls sideways">
          <table className="table fin-table">
            <caption className="sr-only">Digital performance by month</caption>
            <thead>
              <tr>
                <th scope="col">Month (UTC)</th>
                <th scope="col">Customer uses</th>
                <th scope="col">Calls serving customers</th>
                <th scope="col">Cost serving customers</th>
                <th scope="col">Founder calls</th>
                <th scope="col">Founder cost</th>
              </tr>
            </thead>
            <tbody>
              {p.months.map((m) => (
                <tr key={m.yyyymm}>
                  <th scope="row">
                    {m.label}
                    {m.so_far && <span className="muted"> (so far)</span>}
                  </th>
                  <td className="num">{shownText(m.requested)}</td>
                  <td className="num">{shownText(m.customers.calls)}</td>
                  <td className="num">{costShown(m.customers.microcents)}</td>
                  <td className="num">{m.founder.calls}</td>
                  <td className="num">{microcentsUsd(m.founder.microcents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
        <ul style={{ fontSize: 12.5, paddingLeft: 18 }} className="muted">
          <li>
            <strong>Open work:</strong>{" "}
            {p.current.groups.map((g) => `${g.label}: ${shownText(g.value)}`).join(" · ")}.{" "}
            {p.basis.current}
          </li>
          <li>
            <strong>Unknown cost:</strong> {shownText(t.customers.unknown_cost_calls)} calls serving
            customers (
            {isHidden(t.customers.unknown_held_cents)
              ? "amount held hidden"
              : `${t.customers.unknown_held_cents}¢ held`}
            ) and {t.founder.unknown_cost_calls} founder calls ({t.founder.unknown_held_cents}¢
            held) have unknown cost; they are not counted as zero.
          </li>
          <li>
            <strong>Uses:</strong> {p.basis.usage}
          </li>
          <li>
            <strong>Usable:</strong> {p.basis.execution}
          </li>
          <li>
            <strong>Cost:</strong> {p.basis.cost}
          </li>
          <li>
            <strong>Hidden counts:</strong> {p.suppression}
          </li>
          {p.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
