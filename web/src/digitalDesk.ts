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

/** Where a work item leads: an existing route, or an anchor on this desk. */
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
      return "#desk-inquiries";
    default:
      return "#desk-checklist";
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
    return { label: "Choose a product", to: "#desk-products", anchor: true };
  return { label: "Start a product in Studio", to: `/build?business=${businessId}`, anchor: false };
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
