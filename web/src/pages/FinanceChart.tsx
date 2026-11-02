// Job 003f: accessible SVG charts for the books, used by the owner's desk and, with the same
// scoped data, by a buyer's evidence room. Unknown months are drawn as a hatched "couldn't
// read" marker, never as zero; months still in progress are outlined. Every month is a
// keyboard stop with its full figures; the table beside it holds every value. Colour is never
// the only signal: patterns, outlines and labels carry the same meaning.

import { useId, useState } from "react";
import {
  type FinMonth,
  missingReason,
  money,
  niceScale,
  partial,
  segments,
  yOf,
} from "../finance.ts";

const W = 640;
const H = 220;
const LEFT = 64;
const BOTTOM = 34;
const TOP = 10;
const PLOT = H - BOTTOM - TOP;

function Axis({ scale, label }: { scale: ReturnType<typeof niceScale>; label: string }) {
  return (
    <g>
      {scale.ticks.map((t) => {
        const y = TOP + yOf(scale, t, PLOT);
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
              {money(t).replace(".00", "")}
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

function describe(m: FinMonth) {
  const parts = [
    m.revenue_cents === null
      ? `earned unknown (${missingReason(m)})`
      : `earned ${money(m.revenue_cents)}${m.revenue_basis === "seeded" ? " (fictional example history)" : ""}`,
    `costs ${money(m.direct_cents + m.overhead_cents)}`,
    `contribution ${money(m.profit_cents)}`,
  ];
  if (partial(m)) parts.push("not a whole month of records");
  if (m.mixed) parts.push(`fictional history of ${money(m.seeded_cents)} shown separately`);
  return `${m.label}: ${parts.join("; ")}`;
}

/** Monthly earned revenue beside operating costs, with the demo contribution line. */
export function EarnedCostChart({ months, title }: { months: FinMonth[]; title: string }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const scale = niceScale(
    months.flatMap((m) => [m.revenue_cents, m.direct_cents + m.overhead_cents, m.profit_cents]),
  );
  const band = (W - LEFT - 8) / Math.max(1, months.length);
  const bar = Math.min(26, band / 3);
  const x = (i: number) => LEFT + band * i + band / 2;
  const zero = TOP + yOf(scale, 0, PLOT);
  const rect = (v: number) => {
    const y = TOP + yOf(scale, v, PLOT);
    return { y: Math.min(y, zero), height: Math.max(1, Math.abs(zero - y)) };
  };
  const shown = active === null ? null : months[active];
  return (
    <figure className="fin-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <strong>{title}</strong>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        <title>{title}</title>
        <defs>
          <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 6 L6 0" stroke="var(--amber)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <Axis scale={scale} label="US dollars (test dollars 1:1)" />
        {months.map((m, i) => {
          const cx = x(i);
          const costs = m.direct_cents + m.overhead_cents;
          const isPartial = partial(m);
          return (
            // One keyboard stop per month; its label carries every figure. Focus and hover only
            // reveal the same figures in the detail line; nothing is actionable.
            // biome-ignore lint/a11y/noStaticElementInteractions: see above
            <g
              key={m.yyyymm}
              tabIndex={0}
              aria-label={describe(m)}
              onFocus={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              className="fin-point"
            >
              <rect x={cx - band / 2} y={TOP} width={band} height={PLOT} fill="transparent" />
              {m.revenue_cents === null ? (
                <>
                  <rect
                    x={cx - bar - 2}
                    y={TOP + PLOT * 0.25}
                    width={bar}
                    height={PLOT * 0.5}
                    fill={`url(#${id}-hatch)`}
                    stroke="var(--amber)"
                  />
                  <text
                    x={cx - bar / 2 - 2}
                    y={TOP + PLOT * 0.25 - 4}
                    fontSize="12"
                    textAnchor="middle"
                    fill="var(--amber)"
                  >
                    ?
                  </text>
                </>
              ) : (
                <rect
                  x={cx - bar - 2}
                  {...rect(m.revenue_cents)}
                  width={bar}
                  fill={m.revenue_basis === "seeded" ? "var(--mint-soft)" : "var(--mint)"}
                  stroke={isPartial ? "var(--ink-2)" : "none"}
                  strokeDasharray={isPartial ? "4 3" : undefined}
                />
              )}
              <rect
                x={cx + 2}
                {...rect(costs)}
                width={bar}
                fill="var(--blue)"
                stroke={isPartial ? "var(--ink-2)" : "none"}
                strokeDasharray={isPartial ? "4 3" : undefined}
              />
              <text x={cx} y={H - 16} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
                {m.label.replace(/ \d{4}$/, "")}
              </text>
              {isPartial && (
                <text x={cx} y={H - 4} fontSize="10" textAnchor="middle" fill="var(--ink-3)">
                  so far
                </text>
              )}
            </g>
          );
        })}
        {segments(months).map((seg) => (
          <g key={seg[0]?.index}>
            <polyline
              fill="none"
              stroke="var(--ink)"
              strokeWidth="2"
              points={seg.map((p) => `${x(p.index)},${TOP + yOf(scale, p.value, PLOT)}`).join(" ")}
            />
            {seg.map((p) => (
              <circle
                key={p.index}
                cx={x(p.index)}
                cy={TOP + yOf(scale, p.value, PLOT)}
                r={3.5}
                fill={p.value < 0 ? "var(--error)" : "var(--ink)"}
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="fin-legend" aria-hidden="true">
        <span>
          <i className="sw sw-mint" /> Earned (test dollars)
        </span>
        <span>
          <i className="sw sw-blue" /> Costs (US dollars you entered)
        </span>
        <span>
          <i className="sw sw-line" /> Contribution (demo, 1:1)
        </span>
        <span>
          <i className="sw sw-hatch" /> Couldn't be read
        </span>
        <span>
          <i className="sw sw-dash" /> Month in progress
        </span>
      </div>
      <p className="fin-detail" aria-live="polite">
        {shown ? describe(shown) : "Focus or point at a month for its figures."}
      </p>
    </figure>
  );
}

/** Money in and out of the contract by month: cash, not revenue. */
export function CashChart({ months }: { months: FinMonth[] }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const out = (m: FinMonth) =>
    m.cash ? m.cash.returned_cents + m.cash.owner_withdrawals_cents : null;
  const scale = niceScale(
    months.flatMap((m) => [
      m.cash?.cash_in_cents ?? null,
      out(m) === null ? null : -(out(m) as number),
    ]),
  );
  const band = (W - LEFT - 8) / Math.max(1, months.length);
  const bar = Math.min(30, band / 2);
  const x = (i: number) => LEFT + band * i + band / 2;
  const zero = TOP + yOf(scale, 0, PLOT);
  const at = (v: number) => TOP + yOf(scale, v, PLOT);
  const shown = active === null ? null : months[active];
  const text = (m: FinMonth) =>
    m.cash
      ? `${m.label}: ${money(m.cash.cash_in_cents)} in (orders ${money(m.cash.orders_in_cents)}, prepayments ${money(m.cash.prepaid_in_cents)}); ${money(m.cash.returned_cents)} returned before delivery; ${money(m.cash.owner_withdrawals_cents)} withdrawn by the owner${m.cash.sale_proceeds_cents ? `; sale proceeds ${money(m.cash.sale_proceeds_cents)} (an ownership event, not income)` : ""}`
      : `${m.label}: ${missingReason({ ...m, revenue_cents: null }) ?? "not read"}`;
  return (
    <figure className="fin-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <strong>Money in and out of the contract</strong> · test dollars · cash, not revenue
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        <title>Money in and out of the contract by month</title>
        <defs>
          <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 6 L6 0" stroke="var(--amber)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <Axis scale={scale} label="Test dollars" />
        {months.map((m, i) => {
          const cx = x(i);
          const o = out(m);
          return (
            // One keyboard stop per month; its label carries every figure. Focus and hover only
            // reveal the same figures in the detail line; nothing is actionable.
            // biome-ignore lint/a11y/noStaticElementInteractions: see above
            <g
              key={m.yyyymm}
              tabIndex={0}
              aria-label={text(m)}
              onFocus={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
              className="fin-point"
            >
              <rect x={cx - band / 2} y={TOP} width={band} height={PLOT} fill="transparent" />
              {m.cash ? (
                <>
                  <rect
                    x={cx - bar / 2}
                    y={at(m.cash.cash_in_cents)}
                    width={bar}
                    height={Math.max(1, zero - at(m.cash.cash_in_cents))}
                    fill="var(--mint)"
                  />
                  <rect
                    x={cx - bar / 2}
                    y={zero}
                    width={bar}
                    height={Math.max(1, at(-(o ?? 0)) - zero)}
                    fill="var(--amber-soft)"
                    stroke="var(--amber)"
                  />
                </>
              ) : (
                m.chain !== "not_applicable" && (
                  <rect
                    x={cx - bar / 2}
                    y={TOP + PLOT * 0.25}
                    width={bar}
                    height={PLOT * 0.5}
                    fill={`url(#${id}-hatch)`}
                    stroke="var(--amber)"
                  />
                )
              )}
              <text x={cx} y={H - 16} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
                {m.label.replace(/ \d{4}$/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="fin-legend" aria-hidden="true">
        <span>
          <i className="sw sw-mint" /> In: orders and prepayments
        </span>
        <span>
          <i className="sw sw-amber" /> Out: returned before delivery and owner withdrawals
        </span>
        <span>
          <i className="sw sw-hatch" /> Couldn't be read
        </span>
      </div>
      <p className="fin-detail" aria-live="polite">
        {shown ? text(shown) : "Focus or point at a month for its figures."}
      </p>
    </figure>
  );
}

/** Costs by category as labelled horizontal bars (the numbers are written, not just drawn). */
export function CategoryBars({
  rows,
}: {
  rows: { category: string; cents: number; share: number }[];
}) {
  if (!rows.length) return <p className="muted">No costs entered for these months.</p>;
  return (
    <ul className="fin-cats">
      {rows.map((r) => (
        <li key={r.category}>
          <span className="fin-cat-label">{r.category}</span>
          <span className="fin-cat-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
          </span>
          <span className="fin-cat-value">
            {money(r.cents)} · {Math.round(r.share * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
