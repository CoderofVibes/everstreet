// Job 001h: the SVG patterns for patterned data series, defined once per chart (ids are scoped by
// the chart's own id). See web/src/chartSeries.ts.

import { SERIES, type SeriesKey } from "../chartSeries.ts";

export function SeriesPatterns({ chartId, keys }: { chartId: string; keys: SeriesKey[] }) {
  return (
    <>
      {keys.map((k) => {
        const s = SERIES[k];
        if (s.pattern === "solid") return null;
        const ink = `var(${s.token})`;
        const soft = `var(${s.soft})`;
        return (
          <pattern
            key={k}
            id={`${chartId}-${k}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill={soft} />
            {s.pattern === "stripes" && <path d="M0 6 L6 0" stroke={ink} strokeWidth="2" />}
            {s.pattern === "dots" && <circle cx="3" cy="3" r="1.4" fill={ink} />}
            {s.pattern === "hlines" && <path d="M0 3 L6 3" stroke={ink} strokeWidth="1.6" />}
          </pattern>
        );
      })}
    </>
  );
}
