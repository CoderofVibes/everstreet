// Job 001c: pure rules for the digital business desk. The status line never says "all caught
// up" while work exists, a saved brief is never a release, and a published page is never a
// working service. Every link targets an existing route or an anchor on the desk.

import type { DeskProduct, DeskWorkItem, DigitalDeskView } from "./api4.ts";

export const PRODUCT_STATUS_LABEL: Record<DeskProduct["status"], string> = {
  brief_only: "Saved brief, no release yet",
  released: "Released, not offered to customers",
  offered: "Offered to customers",
  offer_retired: "Offer retired, not offered now",
};

export const productName = (p: DeskProduct) => p.name ?? "Unnamed product";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The header line, from the desk's own work items. */
export function deskStatusLine(d: Pick<DigitalDeskView, "work">): string {
  const you = d.work.filter((w) => w.who === "you").reduce((a, w) => a + w.count, 0);
  const system = d.work.filter((w) => w.who === "system").reduce((a, w) => a + w.count, 0);
  if (you === 0 && system === 0) return "Nothing is waiting right now.";
  const parts = [
    you > 0 ? `${plural(you, "thing needs", "things need")} you` : "Nothing needs you right now",
  ];
  if (system > 0) parts.push(`${system} waiting on the system`);
  return `${parts.join(" · ")}.`;
}

// ---------- job 001h: the operating workspace's views ----------

export type DeskView = "overview" | "performance" | "products" | "growth";

export const DESK_VIEWS: { id: DeskView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "products", label: "Products" },
  { id: "growth", label: "Customers" },
];

/** The view a query names; anything else (or nothing) is the overview. */
export function deskViewFromSearch(search: string): DeskView {
  let v: string | null = null;
  try {
    v = new URLSearchParams(search).get("view");
  } catch {
    v = null;
  }
  return DESK_VIEWS.some((x) => x.id === v) ? (v as DeskView) : "overview";
}

/** A link to one view of this desk (optionally to a section in it). */
export const deskViewHref = (businessId: string, view: DeskView, section?: string) =>
  `/desk/${businessId}${view === "overview" ? "" : `?view=${view}`}${section ? `#${section}` : ""}`;

/** Where a work item leads: an existing route, or a section in one of this desk's views. */
export function workHref(w: Pick<DeskWorkItem, "link">, businessId: string): string {
  const p = w.link.project;
  switch (w.link.to) {
    case "customers":
      return p ? `/build/${p}?view=service&task=customers` : `/desk/${businessId}`;
    case "studio":
      return p ? `/build/${p}` : `/build?business=${businessId}`;
    case "continuity":
      return `/desk/${businessId}/continuity`;
    case "inquiries":
      return deskViewHref(businessId, "growth", "desk-inquiries");
    // First-use review #38/#41: the request board, and the sale where the seller accepts.
    case "cases":
      return deskViewHref(businessId, "products", "desk-cases");
    case "sale":
      return `/sales/${businessId}`;
    case "public":
      return `/desk/${businessId}/public`;
    case "allowance":
      return `/desk/${businessId}/allowance`;
    default:
      return deskViewHref(businessId, "growth", "desk-checklist");
  }
}

/** The studio action: the product itself, a choice among several, or a start. */
export function studioAction(
  d: Pick<DigitalDeskView, "products">,
  businessId: string,
): { label: string; to: string; anchor: boolean } {
  const [only] = d.products.shown;
  if (d.products.total === 1 && only)
    return { label: "Open product studio", to: `/build/${only.project_id}`, anchor: false };
  if (d.products.total > 1)
    return {
      label: "Choose a product",
      to: deskViewHref(businessId, "products", "desk-products"),
      anchor: false,
    };
  return { label: "Start a product in Studio", to: `/build?business=${businessId}`, anchor: false };
}

/**
 * Job 001h: the header's one next action. The first thing that needs the founder, else the studio
 * action. A "system" item is never offered as something to do.
 */
export function nextAction(
  d: Pick<DigitalDeskView, "products" | "work">,
  businessId: string,
): { label: string; to: string } {
  const first = d.work.find((w) => w.who === "you");
  if (first)
    return {
      label: first.key.includes(":") ? first.label : `${first.count} ${first.label}`,
      to: workHref(first, businessId),
    };
  const s = studioAction(d, businessId);
  return { label: s.label, to: s.to };
}

/**
 * Job 001h: a product's identity. With an active release, its title is the released name (what
 * customers see); a draft brief named differently is labelled as a draft, never shown as the
 * product. Without a release, the brief's name is the title and it is a draft.
 */
export function productIdentity(p: DeskProduct): {
  title: string;
  released: boolean;
  draft: string | null;
} {
  const brief = p.name ?? "Unnamed product";
  const r = p.released;
  if (!r) return { title: brief, released: false, draft: null };
  const title = r.name ?? `Released build of revision ${r.revision}`;
  const differs = p.name !== null && p.name !== r.name;
  return {
    title,
    released: true,
    draft: differs
      ? `Draft brief (revision ${p.revision}): ${p.name}`
      : p.revision > r.revision
        ? `Draft brief (revision ${p.revision}) changed since this release (revision ${r.revision})`
        : null,
  };
}

/** The header's product facts: releases and customer offers, apart from the page's state. */
export function productFacts(d: Pick<DigitalDeskView, "products">): string {
  const shown = d.products.shown;
  if (d.products.total === 0) return "No product yet";
  const released = shown.filter((p) => p.release.state === "active").length;
  const offered = shown.filter((p) => p.status === "offered").length;
  const more = d.products.total > shown.length ? ` (newest ${shown.length} read)` : "";
  return `${plural(d.products.total, "product", "products")}${more} · ${released} released · ${offered} offered to customers`;
}
