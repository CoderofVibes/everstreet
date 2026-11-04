// Job 001f: pure rules for Discover. Which published product leads the stage, and the one honest
// line each listing shows: digital profiles by their availability (from active offers), legacy
// businesses by their offering and stage. Only published content; nothing invented.

import type { PublicBusiness } from "./api.ts";
import { AVAILABILITY_LABEL } from "./publication.ts";
import { FAMILY_LABEL, money, STAGE_LABEL } from "./ui.tsx";

/**
 * The stage's featured product: a published digital profile with an owner-written example
 * first, then any digital profile that is open for use, then any digital profile. None: null.
 */
export function featured(list: PublicBusiness[]): PublicBusiness | null {
  const digital = list.filter((b) => b.digital);
  return (
    digital.find((b) => b.digital?.example) ??
    digital.find((b) => b.digital?.availability === "available") ??
    digital[0] ??
    null
  );
}

export interface MarketLine {
  status: string;
  tone: "success" | "caution" | "neutral";
  line: string | null;
  detail: string | null;
  meta: string;
  example: boolean;
}

const OPEN = "Open for customers";

/**
 * One listing's honest summary. Job 001f1: its status agrees with the Explore tab the server puts
 * it in (community.ts exploreClass). A mixed business whose digital product is not open but whose
 * legacy offering takes requests is open, and says which part is.
 */
export function marketLine(b: PublicBusiness): MarketLine {
  const by = `by ${b.founder.display_name}`;
  if (b.digital) {
    const d = b.digital;
    const legacyOpen = d.availability !== "available" && b.action.kind === "question";
    return {
      status: legacyOpen ? OPEN : AVAILABILITY_LABEL[d.availability],
      tone: d.availability === "available" || legacyOpen ? "success" : "caution",
      line: d.headline,
      detail: legacyOpen
        ? `${b.offer?.title ?? "Its offering"} takes requests now; the digital product is not open for use yet.`
        : (d.capabilities[0] ?? null),
      meta: [d.products[0]?.family_label ?? FAMILY_LABEL[b.family], by].join(" · "),
      example: Boolean(d.example),
    };
  }
  const price = b.offer
    ? b.offer.first_free
      ? "first one free"
      : b.offer.price_cents !== null
        ? `${money(b.offer.price_cents)} ${b.offer.price_unit}`
        : null
    : null;
  // Taking requests: its stage once launched or growing; an earlier stage label ("Shaping",
  // "Testing interest") would contradict the Open tab, so it reads Open for customers.
  const later = b.stage === "launch" || b.stage === "grow";
  return {
    status:
      b.action.kind === "interest"
        ? "Testing interest"
        : later
          ? (STAGE_LABEL[b.stage] ?? OPEN)
          : OPEN,
    tone: b.action.kind === "interest" ? "caution" : "neutral",
    line: b.offer?.title ?? null,
    detail: null,
    meta: [FAMILY_LABEL[b.family], by, price].filter(Boolean).join(" · "),
    example: false,
  };
}

/** Digital first (open ones first), then everything else, in published order otherwise. */
export function marketOrder(list: PublicBusiness[]): PublicBusiness[] {
  const rank = (b: PublicBusiness) =>
    b.digital ? (b.digital.availability === "available" ? 0 : 1) : b.family === "software" ? 2 : 3;
  return list
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i)
    .map((x) => x.b);
}
