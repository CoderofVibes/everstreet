// Job 001d: publishing a digital business (docs/design/DIGITAL_PUBLICATION.md). The owner edits a
// draft; publishing copies one reviewed draft revision into the live snapshot customers see. The
// public section is built from that snapshot and from immutable released facts, with each
// product's Use target resolved from its active customer offer at read time. No draft, brief,
// prompt, provider, customer, cost or acquisition data is ever in the public view.

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
  name: string;
  family_label: string;
  released: boolean;
}
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

  /** What a draft would publish: names and families from released facts only. */
  private snapshot(businessId: string, d: ProfileDraft): LiveSnapshot {
    const products: LiveProduct[] = [];
    for (const id of d.products) {
      const p = this.db
        .prepare("SELECT foundation FROM product_projects WHERE id = ? AND business_id = ?")
        .get(id, businessId) as { foundation: Foundation } | undefined;
      if (!p) continue;
      const a = this.db
        .prepare(
          "SELECT a.content FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job WHERE r.project_id = ? AND r.state = 'active'",
        )
        .get(id) as { content: string } | undefined;
      let name: string | null = null;
      try {
        const n = a ? (JSON.parse(a.content) as { name?: unknown }).name : null;
        name = typeof n === "string" && n.trim() ? n.trim().slice(0, 120) : null;
      } catch {
        name = null;
      }
      products.push({
        project_id: id,
        name: name ?? "A product in development",
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
    const out = {
      draft,
      draft_rev: rev,
      draft_updated_at: r?.draft_updated_at ?? null,
      live_rev: r?.live_rev ?? null,
      live_published_at: r?.live_published_at ?? null,
      page_published: b.published_at !== null,
      live: r?.live ? this.section(JSON.parse(r.live) as LiveSnapshot, r.live_published_at) : null,
      preview: this.section(this.snapshot(businessId, draft), null),
      eligibility: this.eligibility(businessId, draft),
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
      const page = this.db
        .prepare("SELECT published_at FROM businesses WHERE id = ?")
        .get(businessId) as { published_at: string | null };
      if (r.live_rev === rev && page.published_at) {
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
        .run(
          JSON.stringify(this.snapshot(businessId, draft)),
          rev,
          t,
          epoch.generation,
          businessId,
        );
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

/** The public section from a snapshot; Use targets come from active offers right now. */
function sectionOf(db: Db, snap: LiveSnapshot, publishedAt: string | null) {
  const offerOf = db.prepare(
    "SELECT id FROM customer_offers WHERE project_id = ? AND state = 'active' ORDER BY created_at DESC, id LIMIT 1",
  );
  const products = snap.products.map((p) => {
    const o = p.released ? (offerOf.get(p.project_id) as { id: string } | undefined) : undefined;
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
