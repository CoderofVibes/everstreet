// Job 001c: the digital business desk (docs/design/DIGITAL_DESK.md). One owner-only, read-only
// projection over this business's own records: its products (saved brief, release, customer
// offers), imported products, the legacy page offering, and the work waiting now, each item saying
// whether it needs the founder or is waiting on the system. Bounded queries; no call to a
// provider, wallet, chain writer or worker; no customer identity, document or result.

import type { Db } from "./db.ts";
import type { MaintenanceHealth } from "./maintenance.ts";
import { currentCustomerWork, type SettlementWorker } from "./operations.ts";
import { FOUNDATION_DEFS, type Foundation } from "./products.ts";
import { publicPageOutdated } from "./publication.ts";
import { tokenMetaOf } from "./tokenMeta.ts";

export const DESK_PRODUCTS = 12;

export type ProductStatus = "brief_only" | "released" | "offered" | "offer_retired";

export interface DeskWork {
  key: string;
  /** "you": the founder can act; "system": waiting on a service or worker, not a task. */
  who: "you" | "system";
  count: number;
  label: string;
  link: {
    to:
      | "customers"
      | "studio"
      | "inquiries"
      | "checklist"
      | "continuity"
      | "cases"
      | "sale"
      | "public"
      | "allowance";
    project?: string;
  };
}

/** The live sale on the business's contract, as last observed here; null when none. */
export function liveDeal(
  db: Db,
  businessId: string,
): { state: string; seller_accepted: boolean; buyer_accepted: boolean } | null {
  const row = db
    .prepare(
      "SELECT o.snapshot FROM v3_projection p JOIN v3_observations o ON o.id = p.observation_id WHERE p.business_id = ?",
    )
    .get(businessId) as { snapshot: string } | undefined;
  if (!row) return null;
  try {
    const d = (
      JSON.parse(row.snapshot) as {
        control?: {
          live_deal?: { state: string; seller_accepted: boolean; buyer_accepted: boolean } | null;
        };
      }
    ).control?.live_deal;
    return d
      ? {
          state: d.state,
          seller_accepted: d.seller_accepted === true,
          buyer_accepted: d.buyer_accepted === true,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * First-use review #52: whether this business's live product can be rehearsed here (a SaaS
 * workflow, or a web app sold as a pass), the same cases successorRehearsal.ts accepts.
 */
export function rehearsable(db: Db, businessId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job
         LEFT JOIN app_release_terms t ON t.release_id = r.id
        WHERE r.business_id = ? AND r.state = 'active'
          AND (a.kind = 'workflow_spec' OR (a.kind = 'web_app_bundle' AND t.access = 'pass'))
        LIMIT 1`,
    )
    .get(businessId);
}

const isDigits = (s: unknown): s is string => typeof s === "string" && /^[0-9]{1,40}$/.test(s);

export function digitalDesk(
  db: Db,
  businessId: string,
  asOf: Date,
  service: { nowMs: number; health: MaintenanceHealth | null },
) {
  const iso = asOf.toISOString();
  const b = db
    .prepare("SELECT family, published_at FROM businesses WHERE id = ?")
    .get(businessId) as { family: string; published_at: string | null };
  const count = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number }).n;

  const totalProducts = count(
    "SELECT COUNT(*) AS n FROM product_projects WHERE business_id = ?",
    businessId,
  );
  // Newest first, capped; each with its head brief's name, release and offer facts in one query.
  const rows = db
    .prepare(
      `SELECT p.id, p.foundation, p.updated_at,
          (SELECT MAX(number) FROM product_revisions WHERE project_id = p.id) AS revision,
          (SELECT brief FROM product_revisions WHERE project_id = p.id ORDER BY number DESC LIMIT 1) AS brief,
          (SELECT activated_at FROM runtime_releases WHERE project_id = p.id AND state = 'active') AS active_since,
          (SELECT COUNT(*) FROM runtime_releases WHERE project_id = p.id) AS releases,
          (SELECT COUNT(*) FROM customer_offers WHERE project_id = p.id AND state = 'active') AS active_offers,
          (SELECT COUNT(*) FROM customer_offers WHERE project_id = p.id AND state = 'retired') AS retired_offers
         FROM product_projects p WHERE p.business_id = ?
        ORDER BY p.updated_at DESC, p.id LIMIT ${DESK_PRODUCTS}`,
    )
    .all(businessId) as {
    id: string;
    foundation: Foundation;
    updated_at: string;
    revision: number | null;
    brief: string | null;
    active_since: string | null;
    releases: number;
    active_offers: number;
    retired_offers: number;
  }[];
  const newestOffer = db.prepare(
    "SELECT id, plan_id, plan, asset, network FROM customer_offers WHERE project_id = ? AND state = 'active' ORDER BY created_at DESC, id LIMIT 1",
  );
  // Job 001h: the active release's own identity (its built artifact's name and the brief revision
  // it was built from), the same source customers see (customerUse.productName). A newer draft
  // brief never relabels it.
  const releasedOf = db.prepare(
    `SELECT a.content, j.revision FROM runtime_releases r
       JOIN build_artifacts a ON a.job_id = r.artifact_job
       JOIN build_jobs j ON j.id = r.artifact_job
      WHERE r.project_id = ? AND r.state = 'active'`,
  );
  const released = (projectId: string): { name: string | null; revision: number } | null => {
    const a = releasedOf.get(projectId) as { content: string; revision: number } | undefined;
    if (!a) return null;
    let name: string | null = null;
    try {
      const n = (JSON.parse(a.content) as { name?: unknown }).name;
      name = typeof n === "string" && n.trim() ? n.trim().slice(0, 120) : null;
    } catch {
      name = null;
    }
    return { name, revision: a.revision };
  };
  const products = rows.map((r) => {
    let name: string | null = null;
    try {
      const n = (JSON.parse(r.brief ?? "{}") as { name?: unknown }).name;
      name = typeof n === "string" && n.trim() ? n.trim() : null;
    } catch {
      name = null;
    }
    const status: ProductStatus =
      r.active_offers > 0
        ? "offered"
        : r.retired_offers > 0
          ? "offer_retired"
          : r.active_since
            ? "released"
            : "brief_only";
    const o = r.active_offers
      ? (newestOffer.get(r.id) as
          | { id: string; plan_id: number; plan: string; asset: string; network: string }
          | undefined)
      : undefined;
    let unitPrice: string | null = null;
    try {
      const u = o ? (JSON.parse(o.plan) as { unit_price?: unknown }).unit_price : null;
      unitPrice = isDigits(u) ? u : null;
    } catch {
      unitPrice = null;
    }
    return {
      project_id: r.id,
      name,
      foundation_label: FOUNDATION_DEFS[r.foundation]?.label ?? "Digital product",
      revision: r.revision ?? 0,
      updated_at: r.updated_at,
      release: r.active_since
        ? { state: "active" as const, activated_at: r.active_since }
        : { state: r.releases > 0 ? ("retired_only" as const) : ("none" as const) },
      offers: { active: r.active_offers, retired: r.retired_offers },
      // Exact contract base units and the asset's identity, as recorded with the offer.
      offer: o
        ? {
            id: o.id,
            plan_id: o.plan_id,
            unit_price: unitPrice,
            asset: o.asset,
            // As read on the chain (ft_metadata), or null: never a guessed scale.
            token: tokenMetaOf(db, o.network, o.asset),
          }
        : null,
      released: r.active_since ? released(r.id) : null,
      status,
    };
  });

  const imports = count(
    "SELECT COUNT(*) AS n FROM import_workspaces WHERE business_id = ?",
    businessId,
  );
  const legacy = db
    .prepare(
      "SELECT title, price_cents FROM offers WHERE business_id = ? ORDER BY version DESC LIMIT 1",
    )
    .get(businessId) as { title: string; price_cents: number | null } | undefined;
  const legacyConfigured = Boolean(legacy && (legacy.title.trim() || legacy.price_cents !== null));
  const kind =
    totalProducts > 0 || imports > 0 || b.family === "software"
      ? ("digital" as const)
      : ("legacy" as const);

  const c = currentCustomerWork(db, businessId, iso, service.nowMs);
  const h = service.health;
  const worker: SettlementWorker = h ? h.worker.state : "unknown";
  const paused = h?.work.paused_by_authority ?? 0;
  const unanswered = count(
    "SELECT COUNT(*) AS n FROM inquiries WHERE business_id = ? AND reply IS NULL",
    businessId,
  );
  const openTasks = count(
    "SELECT COUNT(*) AS n FROM tasks WHERE business_id = ? AND done_at IS NULL",
    businessId,
  );
  // The product the customer links go to: the newest offered one, else the newest released one.
  const servicing =
    products.find((p) => p.status === "offered") ?? products.find((p) => p.status !== "brief_only");
  const customers = servicing ? { to: "customers" as const, project: servicing.project_id } : null;
  const waitingOnSystem = c.awaiting_settlement + c.reserved_not_settled + c.awaiting_reservation;
  const work: DeskWork[] = [];
  const add = (w: DeskWork) => {
    if (w.count > 0) work.push(w);
  };
  if (customers) {
    add({
      key: "attention",
      who: "you",
      count: c.needs_attention,
      label: "customer uses need attention",
      link: customers,
    });
    add({
      key: "paused",
      who: "you",
      count: paused,
      label:
        "customer obligations paused: the platform isn't allowed to meter on the business's contract",
      link: { to: "continuity" },
    });
  }
  // First-use review #38/#41: open customer requests (a SaaS workflow's cases) and a sale in
  // progress are work too; the desk never says "nothing is waiting" while they are.
  add({
    key: "cases",
    who: "you",
    count: count(
      "SELECT COUNT(*) AS n FROM workflow_cases WHERE business_id = ? AND closed_at IS NULL",
      businessId,
    ),
    label: "open customer requests",
    link: { to: "cases" },
  });
  // First-use review (Nov 7, findings 52 and 66): a public page naming a superseded release sends
  // customers to an offer that refuses every use; the desk never says "nothing is waiting" then.
  add({
    key: "public_page",
    who: "you",
    count: publicPageOutdated(db, businessId) ? 1 : 0,
    label: "public page names a superseded release: republish it",
    link: { to: "public" },
  });
  const deal = liveDeal(db, businessId);
  if (deal)
    add({
      key: "sale",
      who: deal.seller_accepted ? "system" : "you",
      count: 1,
      label: deal.seller_accepted
        ? "sale in progress: waiting for the buyer"
        : "sale in progress: waiting for your acceptance",
      link: { to: "sale" },
    });
  add({
    key: "inquiries",
    who: "you",
    count: unanswered,
    label: "unanswered messages",
    link: { to: "inquiries" },
  });
  for (const p of products) {
    if (p.status === "brief_only")
      add({
        key: `build:${p.project_id}`,
        who: "you",
        count: 1,
        label: `${p.name ?? "Unnamed product"}: saved brief, no release yet (build and test a version)`,
        link: { to: "studio", project: p.project_id },
      });
    if (p.status === "released" || p.status === "offer_retired")
      add({
        key: `offer:${p.project_id}`,
        who: "you",
        count: 1,
        label: `${p.name ?? "Unnamed product"}: released, not offered to customers`,
        link: { to: "customers", project: p.project_id },
      });
  }
  if (customers) {
    add({
      key: "system",
      who: "system",
      count: waitingOnSystem,
      label:
        worker === "running"
          ? "customer uses being reserved or settled by the background worker"
          : "customer uses waiting to be reserved or settled; the background worker isn't running here",
      link: customers,
    });
    add({
      key: "signature",
      who: "system",
      count: c.awaiting_signature,
      label: "preparations waiting for the customer's signature",
      link: customers,
    });
  }
  add({
    key: "checklist",
    who: "you",
    count: openTasks,
    label: "open checklist items",
    link: { to: "checklist" },
  });

  return {
    as_of: iso,
    kind,
    page: { published: b.published_at !== null },
    rehearsable: rehearsable(db, businessId),
    products: { total: totalProducts, shown: products },
    imports: { total: imports },
    legacy_offering: { configured: legacyConfigured, title: legacy?.title.trim() || null },
    work,
    current: c,
    settlement: {
      worker,
      heartbeat_at: h?.worker.heartbeat_at ?? null,
      paused_by_authority: paused,
    },
  };
}

export type DigitalDesk = ReturnType<typeof digitalDesk>;
