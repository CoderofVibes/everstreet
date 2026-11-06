// Plan step 7: the founder's dashboard (design/dashboard/DECISION.md). Pure helpers for
// GET /api/me/dashboard: exact amounts, the handover's steps, the performance chart's series.
// TUSD and USD are never added or drawn on one axis; unknown stays unknown.

import { readable, usableScale } from "./TokenAmount.tsx";

// biome-ignore lint/suspicious/noExplicitAny: the dashboard answer, read field by field
export type Json = Record<string, any>;

const U = /^\d{1,40}$/;
const MICROCENTS_PER_CENT = 1_000_000n;

/** Exact USD from microcents: under a dollar in cents ("15.12¢"), else dollars ("$12.3456"). */
export function usdFromMicrocents(micro: string | null | undefined): string | null {
  if (typeof micro !== "string" || !U.test(micro)) return null;
  const m = BigInt(micro);
  if (m < 100n * MICROCENTS_PER_CENT) {
    const r = readable(micro, 6);
    return r === null ? null : `${r}¢`;
  }
  const r = readable(micro, 8);
  if (r === null) return null;
  const [whole, frac = ""] = r.split(".");
  return `$${whole}.${frac.padEnd(2, "0")}`;
}

/** A token amount, readable when the token's details are known: "22 TUSD"; else base units. */
export function tokenText(base: string | null | undefined, asset: string, token: unknown): string {
  if (typeof base !== "string" || !U.test(base)) return "unknown";
  const t = usableScale(token);
  const r = t ? readable(base, t.decimals) : null;
  if (t && r !== null) return `${withCents(r)} ${t.symbol}`;
  return `${base} base units of ${asset}`;
}

/** "22" → "22.00", "0.4" → "0.40": two places at least, never rounded. */
export function withCents(r: string): string {
  const [w, f = ""] = r.split(".");
  return `${w}.${f.padEnd(2, "0")}`;
}

/** The token's symbol, or the asset id when its details aren't usable. */
export const symbolOf = (asset: string, token: unknown) => usableScale(token)?.symbol ?? asset;

/** A base-unit amount as a plain number in whole tokens, for drawing only (never for labels). */
export function drawValue(base: string | null | undefined, token: unknown): number {
  if (typeof base !== "string" || !U.test(base)) return 0;
  const t = usableScale(token);
  return Number(base) / 10 ** (t?.decimals ?? 0);
}

/** How long prepaid credits last at the recent pace, in words. */
export function runwayText(days: number | null | undefined): string {
  if (days === null || days === undefined) return "no recent use to measure";
  if (days > 365) return "over a year";
  if (days >= 60) return `about ${Math.round(days / 30)} months`;
  if (days === 1) return "1 day";
  return `${days} days`;
}

export type StepState = "done" | "current" | "pending";
export interface SaleStep {
  key: string;
  label: string;
  state: StepState;
  detail: string;
}

/**
 * The five steps of a Direct sale, from the contract's live deal. Done steps are filled; the first
 * not done is current; the rest are pending (outlined, never filled).
 */
export function saleSteps(sale: Json, priceText: string): SaleStep[] {
  const funded = U.test(String(sale.escrow)) && BigInt(sale.escrow) >= BigInt(sale.price);
  const closing = sale.state === "closing";
  const raw: { key: string; label: string; done: boolean; doneText: string; waitText: string }[] = [
    {
      key: "proposed",
      label: "Terms proposed",
      done: true,
      doneText: `Done · ${priceText}`,
      waitText: "",
    },
    {
      key: "escrow",
      label: "Escrow funded",
      done: funded,
      doneText: `${priceText} held`,
      waitText: "Waiting on the buyer",
    },
    {
      key: "seller",
      label: "You accept",
      done: sale.seller_accepted === true,
      doneText: "Accepted",
      waitText: "Waiting on you",
    },
    {
      key: "buyer",
      label: "Buyer accepts",
      done: sale.buyer_accepted === true,
      doneText: "Accepted",
      waitText: "Waiting on the buyer",
    },
    {
      key: "transfer",
      label: "Ownership moves",
      done: false,
      doneText: "",
      waitText: closing ? "Closing on NEAR" : "After both accept",
    },
  ];
  let current = false;
  return raw.map((s) => {
    if (s.done) return { key: s.key, label: s.label, state: "done", detail: s.doneText };
    const state: StepState = current ? "pending" : "current";
    current = true;
    return {
      key: s.key,
      label: s.label,
      state,
      detail: state === "current" ? s.waitText : "Not yet",
    };
  });
}

/** Who has accepted, in words. */
export function acceptedBy(sale: Json): string {
  if (sale.seller_accepted && sale.buyer_accepted) return "Both sides";
  if (sale.seller_accepted) return "You, not the buyer yet";
  if (sale.buyer_accepted) return "The buyer, not you yet";
  return "Neither yet";
}

export type Metric = "revenue" | "delivered" | "compute";

export interface Series {
  id: string;
  name: string;
  values: number[];
  /** Exact readable value per day, for titles and the table. */
  labels: string[];
}

/** The chart's series for a scope (all businesses, or one) and metric. */
export function chartSeries(d: Json, scope: string, metric: Metric, asset: string): Series[] {
  const list = (d.businesses as Json[]).filter((b) => scope === "all" || b.id === scope);
  const token = d.tokens?.[asset];
  return list.map((b) => ({
    id: b.id,
    name: b.name,
    values: (b.daily as Json[]).map((x) =>
      metric === "revenue"
        ? drawValue(x.revenue?.[asset] ?? "0", token)
        : metric === "delivered"
          ? Number(x.delivered)
          : Number(x.compute_microcents) / 1_000_000,
    ),
    labels: (b.daily as Json[]).map((x) =>
      metric === "revenue"
        ? tokenText(x.revenue?.[asset] ?? "0", asset, token)
        : metric === "delivered"
          ? `${x.delivered} delivered`
          : `${usdFromMicrocents(x.compute_microcents) ?? "unknown"}${x.compute_unknown_calls ? ` + ${x.compute_unknown_calls} unknown` : ""}`,
    ),
  }));
}

/** The total for the chart's headline, exact, in the metric's own unit. */
export function chartTotal(d: Json, scope: string, metric: Metric, asset: string): string {
  const list = (d.businesses as Json[]).filter((b) => scope === "all" || b.id === scope);
  if (metric === "delivered") return String(list.reduce((n, b) => n + b.totals.delivered, 0));
  if (metric === "compute") {
    const sum = list.reduce((n, b) => n + BigInt(b.totals.compute_microcents), 0n);
    return usdFromMicrocents(sum.toString()) ?? "unknown";
  }
  const sum = list.reduce((n, b) => n + BigInt(b.totals.revenue?.[asset] ?? "0"), 0n);
  return tokenText(sum.toString(), asset, d.tokens?.[asset]);
}

/** Round axis ticks up to a readable maximum. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Releases that went live inside the period (after its first day), as chart markers. */
export function releaseMarks(
  d: Json,
  scope: string,
): { day: number; label: string; business: string }[] {
  const days = d.period?.days ?? (d.days as string[]).length;
  const first = (d.days as string[])[0];
  const out: { day: number; label: string; business: string }[] = [];
  for (const b of d.businesses as Json[]) {
    if (scope !== "all" && b.id !== scope) continue;
    for (const r of (b.releases ?? []) as Json[]) {
      const day = String(r.activated_at).slice(0, 10);
      const i = (d.days as string[]).indexOf(day);
      if (i > 0 && i < days && first && day > first)
        out.push({
          day: i,
          label: scope === "all" ? `${b.name} release ${r.number}` : `Release ${r.number}`,
          business: b.name,
        });
    }
  }
  return out;
}

/** The single next thing to do for a business. */
export function nextAction(b: Json): { text: string; link: string } {
  const a = (b.attention as Json[])?.[0];
  if (a) {
    const verb =
      a.kind === "sale"
        ? "Review the terms"
        : a.kind === "rehearsal"
          ? "Rehearse the handover"
          : a.kind === "open_cases"
            ? "Open the desk"
            : "Open";
    return { text: verb, link: a.link };
  }
  return { text: "Open the desk", link: `/desk/${b.id}` };
}

/** A short date, UTC ("Oct 15"). */
export const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Date and time, UTC ("Nov 6, 02:13 UTC"). */
export const stamp = (iso: string) =>
  `${shortDay(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;
