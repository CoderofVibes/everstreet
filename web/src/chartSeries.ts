// Job 001h: data-series tokens for charts, separate from the brand action colour, each with its
// own pattern, so series stay distinct in colour, in grayscale and without colour. Before this,
// "charged" and "returned" (and customer versus founder cost, and earned versus costs) both drew in
// the same cobalt, because the old --mint and --blue names both map to it.

export type SeriesKey = "primary" | "returned" | "founder" | "cost";
export type Pattern = "solid" | "stripes" | "dots" | "hlines";

export const SERIES: Record<SeriesKey, { token: string; soft: string; pattern: Pattern }> = {
  primary: { token: "--data-primary", soft: "--data-primary-soft", pattern: "solid" },
  returned: { token: "--data-returned", soft: "--data-returned-soft", pattern: "stripes" },
  founder: { token: "--data-founder", soft: "--data-founder-soft", pattern: "dots" },
  cost: { token: "--data-cost", soft: "--data-cost-soft", pattern: "hlines" },
};

/** Which series each chart draws side by side or stacked (each pair must stay distinct). */
export const CHART_SERIES: Record<string, SeriesKey[]> = {
  "customer uses": ["primary", "returned"],
  "runtime cost": ["primary", "founder"],
  "earned and costs": ["primary", "cost"],
  "buyer runtime cost": ["primary", "founder"],
};

/** The SVG fill for a series: its colour when solid, else its pattern defined in this chart. */
export function seriesFill(key: SeriesKey, chartId: string): string {
  const s = SERIES[key];
  return s.pattern === "solid" ? `var(${s.token})` : `url(#${chartId}-${key})`;
}

/** Its outline: the series colour, so a patterned bar has a clear edge. */
export const seriesStroke = (key: SeriesKey) => `var(${SERIES[key].token})`;

/** The legend swatch's class (styles.css draws the same pattern). */
export const swatchClass = (key: SeriesKey) => `sw sw-data-${key}`;
