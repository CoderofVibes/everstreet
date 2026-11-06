// Plan step 7: the dashboard's bar chart, drawn at real pixels so it stays legible on a phone.
// Series carry colour and pattern; release markers are labelled; the partial last day is hatched.

import { useEffect, useId, useRef, useState } from "react";
import { type SeriesKey, seriesFill, seriesStroke } from "../chartSeries.ts";
import { niceTicks, type Series, shortDay } from "../dashboardView.ts";
import { SeriesPatterns } from "./SeriesPatterns.tsx";

const ORDER: SeriesKey[] = ["primary", "returned", "founder", "cost"];
export const seriesKey = (i: number) => ORDER[i % ORDER.length] as SeriesKey;

/** The element's width, for drawing at real pixels (charts stay legible on a phone). */
export function useWidth<T extends HTMLElement>(fallback: number) {
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

export function BarChart({
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
