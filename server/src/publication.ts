// Job 001d: publishing a digital business (docs/design/DIGITAL_PUBLICATION.md). The owner edits a
// draft; publishing copies one reviewed draft revision into the live snapshot customers see. The
// public section is built from that snapshot and from immutable released facts, with each
// product's Use target resolved from its active customer offer at read time. No draft, brief,
// prompt, provider, customer, cost or acquisition data is ever in the public view.

import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { FOUNDATION_DEFS, type Foundation } from "./products.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const PROFILE_LIMITS = {
  headline: 120,
  summary: 400,
  audience: 200,
  capability: 120,
  capabilities: 6,
  products: 6,
} as const;

export interface ProfileDraft {
  headline: string;
  summary: string;
  audience: string;
  capabilities: string[];
  /** Featured product projects of this business (ids; never shown publicly). */
  products: string[];
}

interface LiveProduct {
  project_id: string;
  /** Job 001d1: the release the reviewed name came from (internal; never shown publicly). */
  release_id?: string | null;
  name: string;
  family_label: string;
  released: boolean;
}

/**
 * Job 001d1: the identity of a review: the draft revision and the exact public content computed
 * from it (names and families from the then-active releases). Publish must present the same.
 */
export const reviewIdentity = (rev: number, snap: unknown) =>
  createHash("sha256").update(JSON.stringify({ rev, snap })).digest("hex");
interface LiveSnapshot extends Omit<ProfileDraft, "products"> {
  products: LiveProduct[];
}

const EMPTY: ProfileDraft = {
  headline: "",
  summary: "",
  audience: "",
  capabilities: [],
  products: [],
};
const now = () => new Date().toISOString();
const bad = (message: string, code?: string): never => {
  throw new HttpError(400, message, code);
};

function text(v: unknown, max: number, label: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") bad(`${label} must be text`);
  const t = (v as string).trim();
  if (t.length > max) bad(`${label} can be at most ${max} characters`);
  return t;
}

export class Publications {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  private row(businessId: string) {
    return this.db.prepare("SELECT * FROM public_profiles WHERE business_id = ?").get(businessId) as
      | {
          draft: string;
          draft_rev: number;
          draft_updated_at: string;
          live: string | null;
          live_rev: number | null;
          live_published_at: string | null;
        }
      | undefined;
  }

  /** Validates an owner's draft: bounded text and this business's own projects only. */
  private parseDraft(businessId: string, input: Record<string, unknown>): ProfileDraft {
    const caps = input.capabilities ?? [];
    if (!Array.isArray(caps)) bad("Capabilities must be a list");
    if ((caps as unknown[]).length > PROFILE_LIMITS.capabilities)
      bad(`At most ${PROFILE_LIMITS.capabilities} capabilities`);
    const products = input.products ?? [];
    if (!Array.isArray(products)) bad("Products must be a list");
    const ids = [...new Set((products as unknown[]).map(String))];
    if (ids.length > PROFILE_LIMITS.products)
      bad(`Feature at most ${PROFILE_LIMITS.products} products`);
    for (const id of ids) {
      const p = this.db
        .prepare("SELECT 1 AS ok FROM product_projects WHERE id = ? AND business_id = ?")
        .get(id, businessId);
      if (!p) bad("Feature only this business's own products", "unknown_product");
    }
    return {
      headline: text(input.headline, PROFILE_LIMITS.headline, "The headline"),
      summary: text(input.summary, PROFILE_LIMITS.summary, "What it does"),
      audience: text(input.audience, PROFILE_LIMITS.audience, "Who it helps"),
      capabilities: (caps as unknown[])
        .map((c, i) => text(c, PROFILE_LIMITS.capability, `Capability ${i + 1}`))
        .filter(Boolean),
      products: ids,
    };
  }

  private draftOf(businessId: string): { draft: ProfileDraft; rev: number } {
    const r = this.row(businessId);
    return r
      ? { draft: JSON.parse(r.draft) as ProfileDraft, rev: r.draft_rev }
      : { draft: EMPTY, rev: 0 };
  }

  /** A project's active release and its released (artifact spec) name. */
  private activeRelease(projectId: string): { id: string; name: string | null } | null {
    const a = this.db
      .prepare(
        "SELECT r.id, a.content FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job WHERE r.project_id = ? AND r.state = 'active'",
      )
      .get(projectId) as { id: string; content: string } | undefined;
    if (!a) return null;
    let name: string | null = null;
    try {
      const n = (JSON.parse(a.content) as { name?: unknown }).name;
      name = typeof n === "string" && n.trim() ? n.trim().slice(0, 120) : null;
    } catch {
      name = null;
    }
    return { id: a.id, name };
  }

  /**
   * Job 001d1: the owner's product choices, identifiable by the name customers would see (the
   * released name), with the private brief name beside it. Bounded.
   */
  private choices(businessId: string) {
    const rows = this.db
      .prepare(
        `SELECT p.id,
            (SELECT brief FROM product_revisions WHERE project_id = p.id ORDER BY number DESC LIMIT 1) AS brief,
            (SELECT COUNT(*) FROM customer_offers WHERE project_id = p.id AND state = 'active') AS offers
           FROM product_projects p WHERE p.business_id = ? ORDER BY p.updated_at DESC, p.id LIMIT 12`,
      )
      .all(businessId) as { id: string; brief: string | null; offers: number }[];
    return rows.map((r) => {
      const a = this.activeRelease(r.id);
      let briefName: string | null = null;
      try {
        const n = (JSON.parse(r.brief ?? "{}") as { name?: unknown }).name;
        briefName = typeof n === "string" && n.trim() ? n.trim() : null;
      } catch {
        briefName = null;
      }
      return {
        project_id: r.id,
        public_name: a?.name ?? "A product in development",
        brief_name: briefName,
        state: !a
          ? ("in_development" as const)
          : r.offers > 0
            ? ("offered" as const)
            : ("released" as const),
      };
    });
  }

  /** What a draft would publish: names and families from released facts only. */
  private snapshot(businessId: string, d: ProfileDraft): LiveSnapshot {
    const products: LiveProduct[] = [];
    for (const id of d.products) {
      const p = this.db
        .prepare("SELECT foundation FROM product_projects WHERE id = ? AND business_id = ?")
        .get(id, businessId) as { foundation: Foundation } | undefined;
      if (!p) continue;
      const a = this.activeRelease(id);
      products.push({
        project_id: id,
        release_id: a?.id ?? null,
        name: a?.name ?? "A product in development",
        family_label: FOUNDATION_DEFS[p.foundation]?.label ?? "Digital product",
        released: Boolean(a),
      });
    }
    return {
      headline: d.headline,
      summary: d.summary,
      audience: d.audience,
      capabilities: d.capabilities,
      products,
    };
  }

  private section(snap: LiveSnapshot, publishedAt: string | null) {
    return sectionOf(this.db, snap, publishedAt);
  }

  private eligibility(businessId: string, d: ProfileDraft) {
    const b = this.db.prepare("SELECT name FROM businesses WHERE id = ?").get(businessId) as {
      name: string;
    };
    const reasons: string[] = [];
    if (!b.name || b.name === "Untitled business") reasons.push("Give the business a name.");
    if (d.headline.length < 3) reasons.push("Write a headline (at least 3 characters).");
    if (d.summary.length < 10) reasons.push("Say what it does (at least 10 characters).");
    if (d.products.length === 0) reasons.push("Feature at least one product.");
    return { ok: reasons.length === 0, reasons };
  }

  /** The owner's editor view: draft, live, the exact preview and whether it can be published. */
  view(viewer: Person, businessId: string) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const r = this.row(businessId);
    const { draft, rev } = this.draftOf(businessId);
    const b = this.db
      .prepare("SELECT published_at FROM businesses WHERE id = ?")
      .get(businessId) as { published_at: string | null };
    const snap = this.snapshot(businessId, draft);
    const live = r?.live ? (JSON.parse(r.live) as LiveSnapshot) : null;
    // The live profile names a release that is no longer the product's active one.
    const outdated = Boolean(
      live?.products.some((p) => {
        const a = this.activeRelease(p.project_id);
        return (a?.id ?? null) !== (p.release_id ?? a?.id ?? null);
      }),
    );
    const out = {
      draft,
      draft_rev: rev,
      draft_updated_at: r?.draft_updated_at ?? null,
      live_rev: r?.live_rev ?? null,
      live_published_at: r?.live_published_at ?? null,
      page_published: b.published_at !== null,
      live: live ? this.section(live, r?.live_published_at ?? null) : null,
      live_outdated: outdated,
      preview: this.section(snap, null),
      /** Job 001d1: present this to publish exactly what the preview shows. */
      review: reviewIdentity(rev, snap),
      eligibility: this.eligibility(businessId, draft),
      choices: this.choices(businessId),
      limits: PROFILE_LIMITS,
    };
    this.store.stillControls(viewer, epoch);
    return out;
  }

  /** Saves the draft. A stale base is refused; an identical retry (a lost reply) is accepted. */
  saveDraft(viewer: Person, businessId: string, input: Record<string, unknown>) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const draft = this.parseDraft(businessId, (input.draft ?? {}) as Record<string, unknown>);
    const base = Number(input.base_rev);
    if (!Number.isInteger(base) || base < 0) bad("A base revision is required (base_rev)");
    this.store.stillControls(viewer, epoch);
    this.store.tx(() => {
      const { draft: current, rev } = this.draftOf(businessId);
      if (base !== rev) {
        if (rev === base + 1 && JSON.stringify(current) === JSON.stringify(draft)) return; // a retry
        throw new HttpError(
          409,
          "The draft changed since you opened it. Your edits are kept here; review the latest and save again.",
          "draft_changed",
          { draft_rev: rev },
        );
      }
      const t = now();
      this.db
        .prepare(
          `INSERT INTO public_profiles (business_id, draft, draft_rev, draft_updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(business_id) DO UPDATE SET draft = excluded.draft, draft_rev = excluded.draft_rev, draft_updated_at = excluded.draft_updated_at`,
        )
        .run(businessId, JSON.stringify(draft), rev + 1, t);
    });
    return this.view(viewer, businessId);
  }

  /** Publishes exactly the reviewed draft revision; sets the page published (nothing else). */
  publish(viewer: Person, businessId: string, input: Record<string, unknown>) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const reviewed = Number(input.draft_rev);
    const review = typeof input.review === "string" ? input.review : "";
    if (!/^[0-9a-f]{64}$/.test(review))
      bad("Publish the version you reviewed (its review identity is required)", "review_required");
    this.store.stillControls(viewer, epoch);
    let already = false;
    this.store.tx(() => {
      const r = this.row(businessId);
      const { draft, rev } = this.draftOf(businessId);
      if (!r || reviewed !== rev)
        throw new HttpError(
          409,
          "The draft changed after you reviewed it. Review the latest version, then publish.",
          "draft_changed",
          { draft_rev: rev },
        );
      // Job 001d1: the public content must be exactly what was reviewed (a release can change a
      // product's public name between review and publish).
      const snap = this.snapshot(businessId, draft);
      if (reviewIdentity(rev, snap) !== review)
        throw new HttpError(
          409,
          "What this version would show has changed since you reviewed it (a product's release changed). Review it again, then publish.",
          "review_changed",
          { draft_rev: rev },
        );
      const page = this.db
        .prepare("SELECT published_at FROM businesses WHERE id = ?")
        .get(businessId) as { published_at: string | null };
      // "Already" only when the live content is exactly this review (a release change may make
      // the same draft revision show different public content).
      if (r.live_rev === rev && page.published_at && r.live === JSON.stringify(snap)) {
        already = true;
        return;
      }
      const e = this.eligibility(businessId, draft);
      if (!e.ok) throw new HttpError(400, e.reasons.join(" "), "not_ready");
      const t = now();
      this.db
        .prepare(
          "UPDATE public_profiles SET live = ?, live_rev = ?, live_published_at = ?, live_owner_generation = ? WHERE business_id = ?",
        )
        .run(JSON.stringify(snap), rev, t, epoch.generation, businessId);
      // The page only: no legacy offering or idea, no stage, no listing, no release or price.
      this.db
        .prepare(
          "UPDATE businesses SET published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?",
        )
        .run(t, t, businessId);
      this.db
        .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
        .run("public_profile_published", businessId, viewer.id, JSON.stringify({ rev }), t);
    });
    return { ...this.view(viewer, businessId), already };
  }
}

/**
 * The public section from a snapshot. Content (names, text) is the reviewed snapshot's and never
 * changes; availability is deliberately dynamic: a Use target exists only while an active offer
 * exists for the very release that was reviewed (001d1), so a newer release's offer is never shown
 * under an older product's name. A snapshot from 001d without a release id matches by project.
 */
function sectionOf(db: Db, snap: LiveSnapshot, publishedAt: string | null) {
  const byRelease = db.prepare(
    "SELECT id FROM customer_offers WHERE project_id = ? AND release_id = ? AND state = 'active' ORDER BY created_at DESC, id LIMIT 1",
  );
  const byProject = db.prepare(
    "SELECT id FROM customer_offers WHERE project_id = ? AND state = 'active' ORDER BY created_at DESC, id LIMIT 1",
  );
  const products = snap.products.map((p) => {
    const o = !p.released
      ? undefined
      : ((p.release_id ? byRelease.get(p.project_id, p.release_id) : byProject.get(p.project_id)) as
          | { id: string }
          | undefined);
    const status = o ? "available" : p.released ? "not_open" : "in_development";
    return {
      name: p.name,
      family_label: p.family_label,
      status: status as "available" | "not_open" | "in_development",
      use_offer_id: o?.id ?? null,
    };
  });
  return {
    headline: snap.headline,
    summary: snap.summary,
    audience: snap.audience,
    capabilities: snap.capabilities,
    products,
    availability: products.some((p) => p.status === "available")
      ? ("available" as const)
      : ("coming_soon" as const),
    published_at: publishedAt,
  };
}

export type DigitalPublic = ReturnType<typeof sectionOf>;

/** The public digital section of a published business, or null. Read by publicBusiness. */
export function digitalPublic(db: Db, businessId: string): DigitalPublic | null {
  const r = db
    .prepare(
      "SELECT p.live, p.live_published_at FROM public_profiles p JOIN businesses b ON b.id = p.business_id WHERE p.business_id = ? AND b.published_at IS NOT NULL AND p.live IS NOT NULL",
    )
    .get(businessId) as { live: string; live_published_at: string } | undefined;
  return r ? sectionOf(db, JSON.parse(r.live) as LiveSnapshot, r.live_published_at) : null;
}
