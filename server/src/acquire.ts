// Acquisitions (Astra: LaunchPad §4, PlatformVision §4, IntactProfiles §7 C and G): buying
// profiles with teams, saved briefs, the seller's own choice of who may discover the business,
// a separate acquisition index, compare, named access requests, time-boxed grants and an
// evidence room that reads the same books and estimate as the founder's Value screen.
//
// Privacy rules live here, not in the UI:
//  - Customer search and public pages never read listings; this index is separate.
//  - Sharing numbers on a public page does not list a business. Listing is its own choice.
//  - Anonymous teasers are shown and filtered only by coarse bands, never exact values.
//  - Fields a seller did not disclose read "Not shared", and no filter can reach them.
//  - The room checks membership, role, grant status and expiry on every request.

import { randomUUID } from "node:crypto";
import { firstName } from "./bookings.ts";
import { BOOKS_BASIS, type Books, financialMonth, revenueOf } from "./books.ts";
import type { Chain } from "./chain.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { type Estimate, estimate, type Overrides, type Valuation, withOverrides } from "./value.ts";

const now = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;

export const BUYER_KINDS = {
  individual: "Owner-operator",
  strategic: "A business buying a business",
  fund: "Small investment firm",
  cooperative: "Customer or community cooperative",
} as const;
export const INTENTS = {
  operate: "Operate it myself",
  add: "Add it to my business",
  team: "Acquire with a team",
} as const;
export const ROLES = {
  research: "Research: search, shortlist and compare",
  evidence: "Evidence: also open granted evidence rooms",
  approve: "Approve: also ask sellers for access for the team",
} as const;
export const MODES = {
  closed: "Closed to approaches",
  private: "Private introductions",
  anonymous: "Anonymous teaser",
  named: "Named acquisition profile",
} as const;
export const OPENNESS = {
  curious: "Curious",
  open: "Open to offers",
  seeking: "Actively seeking a successor",
} as const;
/** What a listing may show anyone who can see it (disclosure wording version 2). */
export const DISCLOSE = {
  revenue: "Monthly revenue",
  profit: "Monthly operating profit",
  value: "Everstreet estimate (the range only)",
  calculation:
    "How the estimate is calculated (shows monthly revenue, costs and operating profit; needs revenue and profit shared too)",
  founder_hours: "Your hours a week",
  history: "Months of history and their sources",
} as const;
/** The wording a version-1 listing was saved under, shown so the seller knows what it covers. */
export const DISCLOSE_V1_VALUE = "Everstreet estimate and its calculation";
/** What a grant opens (scope wording version 2). */
export const CATEGORIES = {
  financials:
    "Monthly books (earned revenue, costs, money in and out, owner withdrawals and sale proceeds), the estimate's inputs, and the contract's balances (customer money held, available)",
  costs: "Every cost line and where it came from",
  customers: "Customer activity in aggregate (no names)",
  operations: "Owner work, helpers, customer promises and what transfers (no balances)",
} as const;
/** The wording a version-1 grant was made under: operations also showed balances. */
export const CATEGORIES_V1_OPERATIONS = "Owner work, helpers, customer promises and what transfers";
/**
 * Scope wording versions: 1 operations included balances; 2 balances moved to financials
 * (003p); 3 financials also covers money in and out, owner withdrawals and sale proceeds
 * (003f1). Each grant keeps the scope of the wording it was made under.
 */
export const SCOPE_VERSION = 3;

type BuyerKind = keyof typeof BUYER_KINDS;
type Intent = keyof typeof INTENTS;
type Role = keyof typeof ROLES;
type Mode = keyof typeof MODES;
type Openness = keyof typeof OPENNESS;
type Disclosed = keyof typeof DISCLOSE;
type Category = keyof typeof CATEGORIES;

const RANK: Record<Role, number> = { research: 1, evidence: 2, approve: 3 };
const FAMILY_LABEL: Record<string, string> = {
  class: "Class or workshop",
  service: "Service",
  product: "Physical product",
  software: "Software or API",
  undecided: "New business",
};

export interface Criteria {
  families?: string[];
  remote?: boolean;
  max_asking_cents?: number;
  require_asking?: boolean;
  value_min_cents?: number;
  value_max_cents?: number;
  value_mode?: "overlap" | "within";
  include_unestimated?: boolean;
  min_months?: number;
  verified_only?: boolean;
  max_founder_hours?: number;
  openness?: string[];
}

/** One figure as a buyer may see it: shown, deliberately not shared, or not known. */
export interface Fig {
  status: "shown" | "not_shared" | "unknown";
  text: string;
  source?: string;
}

export interface CandidateView {
  listing_id: string;
  mode: "named" | "anonymous" | "private";
  yours: boolean;
  title: string;
  tagline: string | null;
  family: string;
  family_label: string;
  stage: string;
  remote: boolean | null;
  openness: Openness;
  openness_label: string;
  reason: string | null;
  transition: string | null;
  founder: string | null;
  slug: string | null;
  updated_at: string;
  asking: Fig;
  revenue: Fig;
  profit: Fig;
  value: Fig & { basis?: string; low_cents?: number; high_cents?: number };
  founder_hours: Fig;
  history: Fig & { months?: number | null; verified?: boolean | null };
}

interface ListingRow {
  id: string;
  business_id: string;
  mode: Mode;
  openness: Openness;
  asking_cents: number | null;
  reason: string;
  transition: string;
  disclose: string;
  /** 1: saved under the earlier wording, where "value" also showed the calculation. */
  disclose_version?: number;
  listed_at: string | null;
  updated_at: string;
}

interface BizRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  family: string;
  stage: string;
  owner_id: string;
  published_at: string | null;
}

interface BuyerRow {
  id: string;
  owner_id: string;
  name: string;
  kind: BuyerKind;
  intent: Intent;
  about: string;
  interests: string;
  time_available: string;
  skills: string;
  budget_basis: string;
  created_at: string;
}

interface RequestRow {
  id: string;
  buyer_id: string;
  listing_id: string;
  requested_by: string;
  categories: string;
  purpose: string;
  days: number;
  status: "pending" | "granted" | "declined" | "revoked" | "withdrawn";
  granted: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decision_note: string;
  revoked_at: string | null;
  created_at: string;
  /** Changes on every decision; an in-flight read compares it before returning. */
  access_version: number;
  /** 1: granted under the earlier wording, where operations also showed balances. */
  scope_version: number;
}

/** What the index may filter on: exact for named listings, bands for anonymous ones. */
interface Indexed {
  view: CandidateView;
  family: string;
  asking: { lo: number; hi: number } | null;
  value: { lo: number; hi: number } | null;
  /** Null when not shared or not known; `unknown` says which. */
  months: number | null;
  verified: boolean | null;
  hours: number | null;
  /** The books couldn't be read: history and revenue are unknown, not absent (003f1). */
  unknown: boolean;
}

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const short = (c: number) => {
  const d = c / 100;
  if (d >= 1_000_000) return `$${Number((d / 1_000_000).toFixed(1))}M`;
  if (d >= 1000) return `$${Number((d / 1000).toFixed(1))}k`;
  return `$${Math.round(d)}`;
};
const VALUE_EDGES = [0, 2_500_000, 10_000_000, 25_000_000, 100_000_000, Number.POSITIVE_INFINITY];
const REVENUE_EDGES = [0, 100_000, 500_000, 2_500_000, 10_000_000, Number.POSITIVE_INFINITY];
const HOURS_EDGES = [0, 5, 15, 30, Number.POSITIVE_INFINITY];
function bandOf(x: number, edges: number[]) {
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i] as number;
    const hi = edges[i + 1] as number;
    if (x < hi) return { lo, hi };
  }
  return { lo: edges[edges.length - 2] as number, hi: Number.POSITIVE_INFINITY };
}
const bandText = (b: { lo: number; hi: number }, fmt: (n: number) => string) =>
  b.hi === Number.POSITIVE_INFINITY
    ? `Over ${fmt(b.lo)}`
    : b.lo === 0
      ? `Under ${fmt(b.hi)}`
      : `${fmt(b.lo)}–${fmt(b.hi)}`;
const hoursText = (h: number) => `${h} h`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Words in a buying brief → the same visible filters the form edits. */
export function interpretAcquire(text: string): Criteria {
  let q = ` ${text.toLowerCase()} `;
  const c: Criteria = {};
  const families: string[] = [];
  if (/\b(software|apis?|saas|apps?|tools?)\b/.test(q)) families.push("software");
  if (/\b(class|classes|workshops?|courses?)\b/.test(q)) families.push("class");
  if (/\b(services?|repairs?|consult\w*)\b/.test(q)) families.push("service");
  if (/\b(products?|goods|candles?|crafts?)\b/.test(q)) families.push("product");
  if (families.length) c.families = families;
  if (/\b(remote|online|virtual|anywhere)\b/.test(q)) c.remote = true;
  const hours = q.match(
    /(?:under|less than|at most|up to|max(?:imum)?)\s*(\d+)\s*(?:h|hrs?|hours?)\b/,
  );
  if (hours) {
    c.max_founder_hours = Number(hours[1]);
    q = q.replace(hours[0], " ");
  }
  const money = q.match(
    /(?:under|below|up to|at most|max(?:imum)?|less than|budget(?: of)?)\s*\$?\s*([\d][\d,.]*)\s*(k|m|thousand|million)?/,
  );
  if (money) {
    const n = Number((money[1] as string).replace(/,/g, ""));
    const unit = money[2] ?? "";
    const mult =
      unit === "k" || unit === "thousand" ? 1000 : unit === "m" || unit === "million" ? 1e6 : 1;
    if (Number.isFinite(n) && n > 0) c.max_asking_cents = Math.round(n * mult * 100);
  }
  const months = q.match(/(\d+)\+?\s*(?:or more\s*)?months?/);
  if (months) c.min_months = Number(months[1]);
  if (/\bverified\b/.test(q)) c.verified_only = true;
  if (/\b(seeking|successor|retiring)\b/.test(q)) c.openness = ["seeking"];
  return c;
}

export class Acquisitions {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly books: Books,
    private readonly valuation: Valuation,
    private readonly chain: Chain | null,
  ) {}

  meta() {
    return {
      buyer_kinds: BUYER_KINDS,
      intents: INTENTS,
      roles: ROLES,
      modes: MODES,
      openness: OPENNESS,
      disclose: DISCLOSE,
      categories: CATEGORIES,
    };
  }

  // ---------- buying profiles and their teams ----------

  private buyerRow(id: string) {
    return this.db.prepare("SELECT * FROM buyers WHERE id = ?").get(id) as BuyerRow | undefined;
  }

  /** The viewer's role on a buying team; the creator approves. Anyone else gets a 404. */
  role(viewer: Person, buyerId: string, min: Role = "research"): Role {
    const b = this.buyerRow(buyerId);
    if (!b) throw new HttpError(404, "No such buying profile");
    let role: Role | null = b.owner_id === viewer.id ? "approve" : null;
    if (!role) {
      const m = this.db
        .prepare("SELECT role FROM buyer_members WHERE buyer_id = ? AND person_id = ?")
        .get(buyerId, viewer.id) as { role: Role } | undefined;
      role = m?.role ?? null;
    }
    if (!role) throw new HttpError(404, "No such buying profile");
    if (RANK[role] < RANK[min])
      throw new HttpError(
        403,
        `Your role on this team is ${role}. This needs the ${min} role or higher; ask the team's lead.`,
      );
    return role;
  }

  private buyerIdsOf(viewer: Person | null): string[] {
    if (!viewer) return [];
    return (
      this.db
        .prepare(
          "SELECT id FROM buyers WHERE owner_id = ? UNION SELECT buyer_id FROM buyer_members WHERE person_id = ?",
        )
        .all(viewer.id, viewer.id) as { id: string }[]
    ).map((r) => r.id);
  }

  myBuyers(viewer: Person) {
    return this.buyerIdsOf(viewer).map((id) => {
      const b = this.buyerRow(id) as BuyerRow;
      return {
        id,
        name: b.name,
        kind: b.kind,
        kind_label: BUYER_KINDS[b.kind],
        intent_label: INTENTS[b.intent],
        role: this.role(viewer, id),
      };
    });
  }

  private clean(fields: Partial<BuyerRow>, existing?: BuyerRow) {
    const text = (v: unknown, max: number) =>
      String(v ?? "")
        .trim()
        .slice(0, max);
    const name = text(fields.name ?? existing?.name, 80);
    if (!name) throw new HttpError(400, "Give the buying profile a name");
    const kind = (fields.kind ?? existing?.kind) as BuyerKind;
    if (!(kind in BUYER_KINDS)) throw new HttpError(400, "Choose what kind of buyer this is");
    const intent = (fields.intent ?? existing?.intent) as Intent;
    if (!(intent in INTENTS)) throw new HttpError(400, "Choose how you would own it");
    return {
      name,
      kind,
      intent,
      about: text(fields.about ?? existing?.about, 600),
      interests: text(fields.interests ?? existing?.interests, 300),
      time_available: text(fields.time_available ?? existing?.time_available, 120),
      skills: text(fields.skills ?? existing?.skills, 300),
      budget_basis: text(fields.budget_basis ?? existing?.budget_basis, 200),
    };
  }

  createBuyer(viewer: Person, fields: Partial<BuyerRow>) {
    const f = this.clean(fields);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO buyers (id, owner_id, name, kind, intent, about, interests, time_available, skills, budget_basis, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        viewer.id,
        f.name,
        f.kind,
        f.intent,
        f.about,
        f.interests,
        f.time_available,
        f.skills,
        f.budget_basis,
        now(),
        now(),
      );
    return this.workspace(viewer, id);
  }

  updateBuyer(viewer: Person, buyerId: string, fields: Partial<BuyerRow>) {
    this.role(viewer, buyerId, "approve");
    const f = this.clean(fields, this.buyerRow(buyerId));
    this.db
      .prepare(
        "UPDATE buyers SET name = ?, kind = ?, intent = ?, about = ?, interests = ?, time_available = ?, skills = ?, budget_basis = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        f.name,
        f.kind,
        f.intent,
        f.about,
        f.interests,
        f.time_available,
        f.skills,
        f.budget_basis,
        now(),
        buyerId,
      );
    return this.workspace(viewer, buyerId);
  }

  private members(buyerId: string) {
    const b = this.buyerRow(buyerId) as BuyerRow;
    const rows = this.db
      .prepare(
        "SELECT m.person_id, m.role, p.display_name FROM buyer_members m JOIN people p ON p.id = m.person_id WHERE m.buyer_id = ? ORDER BY m.created_at",
      )
      .all(buyerId) as { person_id: string; role: Role; display_name: string }[];
    return [
      {
        person_id: b.owner_id,
        name: this.store.person(b.owner_id).display_name,
        role: "approve" as Role,
        lead: true,
      },
      ...rows.map((r) => ({
        person_id: r.person_id,
        name: r.display_name,
        role: r.role,
        lead: false,
      })),
    ];
  }

  /** How the team appears to a seller who received its request. */
  private profile(buyerId: string) {
    const b = this.buyerRow(buyerId) as BuyerRow;
    return {
      id: b.id,
      name: b.name,
      kind_label: BUYER_KINDS[b.kind],
      intent_label: INTENTS[b.intent],
      about: b.about,
      interests: b.interests,
      time_available: b.time_available,
      skills: b.skills,
      budget_basis: b.budget_basis,
      members: this.members(buyerId).map((m) => ({ name: m.name, role: m.role, lead: m.lead })),
    };
  }

  addMember(viewer: Person, buyerId: string, personId: string, role: Role) {
    this.role(viewer, buyerId, "approve");
    if (!(role in ROLES)) throw new HttpError(400, "Choose a role");
    const b = this.buyerRow(buyerId) as BuyerRow;
    if (personId === b.owner_id) throw new HttpError(409, "They lead this team already");
    this.store.person(personId);
    this.db
      .prepare(
        "INSERT INTO buyer_members (buyer_id, person_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(buyer_id, person_id) DO UPDATE SET role = excluded.role",
      )
      .run(buyerId, personId, role, now());
    return this.workspace(viewer, buyerId);
  }

  removeMember(viewer: Person, buyerId: string, personId: string) {
    this.role(viewer, buyerId, "approve");
    this.db
      .prepare("DELETE FROM buyer_members WHERE buyer_id = ? AND person_id = ?")
      .run(buyerId, personId);
    return this.workspace(viewer, buyerId);
  }

  async workspace(viewer: Person, buyerId: string) {
    const role = this.role(viewer, buyerId);
    const b = this.buyerRow(buyerId) as BuyerRow;
    const mandates = (
      this.db
        .prepare("SELECT * FROM mandates WHERE buyer_id = ? ORDER BY updated_at DESC")
        .all(buyerId) as {
        id: string;
        name: string;
        text: string;
        criteria: string;
        last_seen_at: string | null;
        updated_at: string;
      }[]
    ).map((m) => ({ ...m, criteria: JSON.parse(m.criteria) as Criteria }));
    const shortlistIds = (
      this.db
        .prepare("SELECT listing_id FROM shortlist WHERE buyer_id = ? ORDER BY created_at")
        .all(buyerId) as { listing_id: string }[]
    ).map((r) => r.listing_id);
    const shortlist: CandidateView[] = [];
    for (const id of shortlistIds) {
      const row = this.listingRow(id);
      if (row && this.visibleTo(row, buyerId)) shortlist.push((await this.index(row, viewer)).view);
    }
    return {
      buyer: {
        id: b.id,
        name: b.name,
        kind: b.kind,
        intent: b.intent,
        kind_label: BUYER_KINDS[b.kind],
        intent_label: INTENTS[b.intent],
        about: b.about,
        interests: b.interests,
        time_available: b.time_available,
        skills: b.skills,
        budget_basis: b.budget_basis,
      },
      role,
      members: this.members(buyerId),
      mandates,
      shortlist,
      requests: this.requestsOfBuyer(buyerId),
    };
  }

  saveMandate(
    viewer: Person,
    buyerId: string,
    m: { id?: string; name?: string; text?: string; criteria?: Criteria },
  ) {
    this.role(viewer, buyerId);
    const name =
      String(m.name ?? "")
        .trim()
        .slice(0, 80) || "My brief";
    const criteria = JSON.stringify(this.criteria(m.criteria ?? {}));
    const text = String(m.text ?? "").slice(0, 500);
    if (m.id) {
      const r = this.db
        .prepare(
          "UPDATE mandates SET name = ?, text = ?, criteria = ?, updated_at = ? WHERE id = ? AND buyer_id = ?",
        )
        .run(name, text, criteria, now(), m.id, buyerId);
      if (r.changes === 0) throw new HttpError(404, "No such brief");
    } else {
      this.db
        .prepare(
          "INSERT INTO mandates (id, buyer_id, name, text, criteria, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), buyerId, name, text, criteria, now(), now());
    }
    return this.workspace(viewer, buyerId);
  }

  deleteMandate(viewer: Person, buyerId: string, mandateId: string) {
    this.role(viewer, buyerId);
    this.db.prepare("DELETE FROM mandates WHERE id = ? AND buyer_id = ?").run(mandateId, buyerId);
    return this.workspace(viewer, buyerId);
  }

  setShortlist(viewer: Person, buyerId: string, listingId: string, on: boolean) {
    this.role(viewer, buyerId);
    const row = this.listingRow(listingId);
    if (!row || !this.visibleTo(row, buyerId)) throw new HttpError(404, "No such listing");
    if (on)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO shortlist (buyer_id, listing_id, created_at) VALUES (?, ?, ?)",
        )
        .run(buyerId, listingId, now());
    else
      this.db
        .prepare("DELETE FROM shortlist WHERE buyer_id = ? AND listing_id = ?")
        .run(buyerId, listingId);
    return this.workspace(viewer, buyerId);
  }

  // ---------- the seller's choice ----------

  private listingRow(id: string) {
    return this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as ListingRow | undefined;
  }

  private listingOf(businessId: string): ListingRow {
    return (
      (this.db.prepare("SELECT * FROM listings WHERE business_id = ?").get(businessId) as
        | ListingRow
        | undefined) ?? {
        id: "",
        business_id: businessId,
        mode: "closed",
        openness: "open",
        asking_cents: null,
        reason: "",
        transition: "",
        disclose: JSON.stringify(["revenue", "profit", "value", "history"]),
        disclose_version: 2,
        listed_at: null,
        updated_at: now(),
      }
    );
  }

  /**
   * What a listing actually shows, under the wording it was saved with. A version-1 "value"
   * ("Everstreet estimate and its calculation") keeps showing the calculation, so an earlier
   * choice is neither narrowed nor widened; it is labelled until the seller saves again.
   */
  private disclosed(row: ListingRow): Set<Disclosed> {
    const out = new Set(
      (JSON.parse(row.disclose) as string[]).filter((d): d is Disclosed => d in DISCLOSE),
    );
    if ((row.disclose_version ?? 1) < 2 && out.has("value")) out.add("calculation");
    return out;
  }

  private biz(businessId: string) {
    return this.db
      .prepare("SELECT * FROM businesses WHERE id = ?")
      .get(businessId) as unknown as BizRow;
  }

  private invited(listingId: string) {
    return (
      this.db
        .prepare("SELECT buyer_id FROM listing_invites WHERE listing_id = ?")
        .all(listingId) as { buyer_id: string }[]
    ).map((r) => r.buyer_id);
  }

  /** Whether a buying team may see this listing at all. */
  private visibleTo(row: ListingRow, buyerId: string | null) {
    const b = this.biz(row.business_id);
    if (!b.published_at) return false;
    if (row.mode === "named" || row.mode === "anonymous") return true;
    if (row.mode === "private") return buyerId !== null && this.invited(row.id).includes(buyerId);
    return false;
  }

  private visibleToViewer(row: ListingRow, viewer: Person | null) {
    if (viewer && this.store.isOwnerOf(viewer, row.business_id)) return true;
    if (this.visibleTo(row, null)) return true;
    return this.buyerIdsOf(viewer).some((id) => this.visibleTo(row, id));
  }

  async listing(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const row = this.listingOf(businessId);
    const offer = this.store.offerOf(businessId);
    const payments = this.chainRow(businessId);
    const warnings = ["Anonymity is a disclosure setting, not a guarantee."];
    if (!/(online|remote|virtual|anywhere)/i.test(offer.where_text))
      warnings.push("A business of this kind in one area can be recognizable to people nearby.");
    if (payments)
      warnings.push(
        "Its NEAR account and payments are public on testnet; anyone who knows the account can see its activity.",
      );
    const as = async (mode: Mode) =>
      (await this.index({ ...row, mode, id: row.id || "00000000" }, founder, false)).view;
    return {
      listing: {
        mode: row.mode,
        openness: row.openness,
        asking_cents: row.asking_cents,
        reason: row.reason,
        transition: row.transition,
        disclose: [...this.disclosed(row)],
        disclose_version: row.disclose_version ?? 1,
        disclose_note:
          (row.disclose_version ?? 1) < 2 && this.disclosed(row).has("value")
            ? `Saved under the earlier wording "${DISCLOSE_V1_VALUE}". That includes the calculation, which shows monthly revenue, costs and operating profit, so it is shown checked here. Saving applies the current wording.`
            : null,
        listed_at: row.listed_at,
        invites: row.id ? this.invited(row.id) : [],
      },
      preview: { named: await as("named"), anonymous: await as("anonymous") },
      anonymous_warnings: warnings,
      share_numbers: this.valuation.settings(businessId).share_numbers,
      buyers: (
        this.db.prepare("SELECT id, name, kind FROM buyers ORDER BY name").all() as {
          id: string;
          name: string;
          kind: BuyerKind;
        }[]
      ).map((b) => ({ ...b, kind_label: BUYER_KINDS[b.kind] })),
      requests: row.id ? this.requestsOfListing(row.id) : [],
    };
  }

  updateListing(
    founder: Person,
    businessId: string,
    patch: {
      mode?: Mode;
      openness?: Openness;
      asking_cents?: number | null;
      reason?: string;
      transition?: string;
      disclose?: string[];
      invites?: string[];
    },
  ) {
    const b = this.store.business(founder, businessId).business;
    const row = this.listingOf(businessId);
    const mode = patch.mode ?? row.mode;
    if (!(mode in MODES)) throw new HttpError(400, "Choose who may discover it");
    if (mode !== "closed" && !b.published_at)
      throw new HttpError(409, "Publish the business before buyers can find it");
    const openness = patch.openness ?? row.openness;
    if (!(openness in OPENNESS)) throw new HttpError(400, "Choose how open you are");
    let asking = patch.asking_cents === undefined ? row.asking_cents : patch.asking_cents;
    if (asking !== null) {
      asking = Math.round(Number(asking));
      if (!Number.isFinite(asking) || asking <= 0 || asking > 100_000_000_00)
        throw new HttpError(400, "Use an asking price above $0, or leave it blank");
    }
    // A saved choice keeps the wording it was made under until the seller chooses again.
    const version = patch.disclose ? 2 : (row.disclose_version ?? 1);
    const disclose = patch.disclose
      ? [...new Set(patch.disclose)].filter((d) => d in DISCLOSE)
      : (JSON.parse(row.disclose) as string[]);
    if (
      version >= 2 &&
      disclose.includes("calculation") &&
      !(disclose.includes("revenue") && disclose.includes("profit"))
    )
      throw new HttpError(
        400,
        "The calculation shows monthly revenue and operating profit. Share both, or leave the calculation off.",
      );
    const id = row.id || randomUUID();
    const listedAt = mode === "closed" ? row.listed_at : (row.listed_at ?? now());
    this.db
      .prepare(
        `INSERT INTO listings (id, business_id, mode, openness, asking_cents, reason, transition, disclose, disclose_version, listed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id) DO UPDATE SET mode = excluded.mode, openness = excluded.openness,
           asking_cents = excluded.asking_cents, reason = excluded.reason, transition = excluded.transition,
           disclose = excluded.disclose, disclose_version = excluded.disclose_version,
           listed_at = excluded.listed_at, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        businessId,
        mode,
        openness,
        asking,
        String(patch.reason ?? row.reason).slice(0, 400),
        String(patch.transition ?? row.transition).slice(0, 300),
        JSON.stringify(disclose),
        version,
        listedAt,
        now(),
      );
    if (patch.invites) {
      this.db.prepare("DELETE FROM listing_invites WHERE listing_id = ?").run(id);
      for (const buyerId of patch.invites)
        if (this.buyerRow(buyerId))
          this.db
            .prepare(
              "INSERT INTO listing_invites (listing_id, buyer_id, created_at) VALUES (?, ?, ?)",
            )
            .run(id, buyerId, now());
    }
    return this.listing(founder, businessId);
  }

  // ---------- the acquisition index ----------

  private chainRow(businessId: string) {
    return this.db
      .prepare(
        "SELECT account_id, rules, tx, created_at FROM chain_accounts WHERE owner_kind = 'business' AND owner_id = ?",
      )
      .get(businessId) as
      | { account_id: string; rules: string; tx: string; created_at: string }
      | undefined;
  }

  async facts(businessId: string) {
    const { months, chain_error } = await this.books.months(businessId, 12);
    // A buyer's read never writes the owner's estimate history (job 003f).
    const e = await this.valuation.current(businessId, months, { snapshot: false });
    const used = months.filter((m) => e.inputs.months_used.includes(m.yyyymm));
    const n = used.length;
    // Monthly averages over the months the estimate used; unknown when none or when the books
    // couldn't be read (those months are never counted as zero).
    const total = n ? revenueOf(used, this.books.decimals) : null;
    const costs = used.reduce((a, m) => a + m.direct_cents + m.overhead_cents, 0);
    const revenue = total === null ? null : Math.round(total / n);
    const profit = total === null ? null : Math.round((total - costs) / n);
    const sources = [...new Set(used.flatMap((m) => m.revenue_sources))];
    const s = this.valuation.settings(businessId);
    return {
      months,
      chain_error,
      estimate: e,
      used,
      revenue,
      profit,
      sources,
      // Verified only when every month used was read from the contract and none mixes in
      // fictional seeded figures.
      verified: n > 0 && used.every((m) => m.revenue_basis === "observed" && !m.mixed),
      hours: s.founder_hours_week,
      /**
       * Job 003f1: the books couldn't be read (an outage, or no chain connected), so history,
       * revenue and profit are unknown, never "no history" or zero.
       */
      unknown: e.inputs.stage === "unavailable",
    };
  }

  /** One listing as this viewer may see it, plus the values the index may filter on. */
  private async index(
    given: ListingRow,
    viewer: Person | null,
    /** False only for the seller's own preview of a mode they haven't chosen yet. */
    reread = true,
  ): Promise<Indexed> {
    const f = await this.facts(given.business_id);
    // Job 003f1: what is disclosed is decided after the slow reads, from the listing as it is
    // now, so a change to anonymous or to fewer disclosures while they ran is respected.
    const current = reread && given.id ? this.listingRow(given.id) : undefined;
    const row: ListingRow = current ?? given;
    const b = this.biz(row.business_id);
    const offer = this.store.offerOf(row.business_id);
    const disclose = this.disclosed(row);
    const anonymous = row.mode === "anonymous";
    const where = `${offer.where_text} ${offer.delivery}`.trim();
    const remote = where ? /(online|remote|virtual|anywhere)/i.test(where) : null;
    const notShared: Fig = { status: "not_shared", text: "Not shared" };
    const basis = f.estimate.label;
    const historySource = f.sources.join(" + ") || undefined;

    let asking: Indexed["asking"] = null;
    let askingFig: Fig = { status: "unknown", text: "No asking price set" };
    if (row.asking_cents !== null) {
      if (anonymous) {
        asking = bandOf(row.asking_cents, VALUE_EDGES);
        askingFig = {
          status: "shown",
          text: `${bandText(asking, short)} (band)`,
          source: "Founder supplied",
        };
      } else {
        asking = { lo: row.asking_cents, hi: row.asking_cents };
        askingFig = { status: "shown", text: usd(row.asking_cents), source: "Founder supplied" };
      }
    }

    const UNREAD = "Unknown right now: some months' books couldn't be read";
    const money = (key: Disclosed, cents: number | null, perMonth = true): Fig => {
      if (!disclose.has(key)) return notShared;
      if (f.unknown) return { status: "unknown", text: UNREAD };
      if (cents === null) return { status: "unknown", text: "No complete month yet" };
      const text = anonymous
        ? key === "profit" && cents <= 0
          ? "Not yet profitable"
          : `${bandText(bandOf(cents, REVENUE_EDGES), short)}${perMonth ? " a month" : ""} (band)`
        : `${usd(cents)}${perMonth ? " a month" : ""}`;
      return { status: "shown", text, source: historySource };
    };

    let value: Indexed["value"] = null;
    let valueFig: CandidateView["value"] = notShared;
    if (disclose.has("value")) {
      const { low_cents: lo, high_cents: hi } = f.estimate;
      if (lo === null || hi === null || f.estimate.inputs.stage === "plan") {
        valueFig = {
          status: "unknown",
          text:
            f.estimate.inputs.stage === "plan"
              ? "No estimate yet (no earned month)"
              : f.estimate.inputs.stage === "unavailable"
                ? "Unknown right now: some months' books couldn't be read"
                : "No earnings-based estimate yet",
          basis,
        };
      } else if (anonymous) {
        value = bandOf((lo + hi) / 2, VALUE_EDGES);
        valueFig = {
          status: "shown",
          text: `${bandText(value, short)} (band)`,
          source: "Estimate",
          basis,
        };
      } else {
        value = { lo, hi };
        valueFig = {
          status: "shown",
          text: `${usd(lo)}–${usd(hi)}`,
          source: "Estimate",
          basis,
          low_cents: lo,
          high_cents: hi,
        };
      }
    }

    let hours: number | null = null;
    let hoursFig: Fig = notShared;
    if (disclose.has("founder_hours")) {
      if (f.hours === null) hoursFig = { status: "unknown", text: "Not set by the founder" };
      else {
        hours = f.hours;
        hoursFig = {
          status: "shown",
          text: anonymous
            ? `${bandText(bandOf(f.hours, HOURS_EDGES), hoursText)} a week (band)`
            : `${Number(f.hours.toFixed(1))} h a week`,
          source: "Founder supplied",
        };
      }
    }

    let months: number | null = null;
    let verified: boolean | null = null;
    let historyFig: CandidateView["history"] = notShared;
    if (disclose.has("history") && f.unknown) {
      // Unknown, not "no history": months and verification stay null with that reason.
      historyFig = { status: "unknown", text: UNREAD, months: null, verified: null };
    } else if (disclose.has("history")) {
      months = f.used.length;
      verified = f.verified;
      historyFig = {
        status: months ? "shown" : "unknown",
        text: months
          ? `${plural(months, "complete month")} used${f.verified ? " · includes revenue verified on NEAR testnet" : ""}`
          : "No complete month with earnings yet",
        source: historySource,
        months,
        verified,
      };
    }

    const code = `ES-${(row.id.replace(/-/g, "").slice(0, 4) || "0000").toUpperCase()}`;
    const view: CandidateView = {
      listing_id: row.id,
      mode: row.mode === "closed" ? "named" : row.mode,
      yours: Boolean(viewer && b.owner_id === viewer.id),
      title: anonymous ? `${FAMILY_LABEL[b.family] ?? "Business"} · ${code}` : b.name,
      tagline: anonymous ? null : b.tagline,
      family: b.family,
      family_label: FAMILY_LABEL[b.family] ?? b.family,
      stage: b.stage,
      remote,
      openness: row.openness,
      openness_label: OPENNESS[row.openness],
      reason: anonymous ? null : row.reason || null,
      transition: row.transition || null,
      founder: anonymous ? null : firstName(this.store.person(b.owner_id)),
      slug: anonymous ? null : b.slug,
      updated_at: row.updated_at,
      asking: askingFig,
      revenue: money("revenue", f.revenue),
      profit: money("profit", f.profit),
      value: valueFig,
      founder_hours: hoursFig,
      history: historyFig,
    };
    return {
      view,
      family: b.family,
      asking,
      value,
      months,
      verified,
      hours,
      unknown: f.unknown && disclose.has("history"),
    };
  }

  private criteria(c: Criteria): Criteria {
    const out: Criteria = {};
    const num = (v: unknown) => {
      if (v === null || v === undefined || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    if (Array.isArray(c.families)) out.families = c.families.filter((f) => f in FAMILY_LABEL);
    if (c.remote) out.remote = true;
    const set = <K extends keyof Criteria>(k: K, v: Criteria[K] | undefined) => {
      if (v !== undefined) out[k] = v;
    };
    set("max_asking_cents", num(c.max_asking_cents));
    if (c.require_asking) out.require_asking = true;
    set("value_min_cents", num(c.value_min_cents));
    set("value_max_cents", num(c.value_max_cents));
    out.value_mode = c.value_mode === "within" ? "within" : "overlap";
    if (c.include_unestimated) out.include_unestimated = true;
    set("min_months", num(c.min_months));
    if (c.verified_only) out.verified_only = true;
    set("max_founder_hours", num(c.max_founder_hours));
    if (Array.isArray(c.openness)) out.openness = c.openness.filter((o) => o in OPENNESS);
    return out;
  }

  /**
   * Search the acquisition index. Unknowns stay visible and are labelled; only the estimate
   * filter excludes businesses without an estimate, and it says how many it set aside.
   */
  async search(
    viewer: Person | null,
    raw: Criteria,
    opts: { buyerId?: string; mandateId?: string; sort?: string } = {},
  ) {
    const c = this.criteria(raw);
    if (opts.buyerId && viewer) this.role(viewer, opts.buyerId);
    const rows = (
      this.db
        .prepare(
          "SELECT l.* FROM listings l JOIN businesses b ON b.id = l.business_id WHERE l.mode != 'closed' AND b.published_at IS NOT NULL",
        )
        .all() as unknown as ListingRow[]
    ).filter((r) =>
      opts.buyerId ? this.visibleTo(r, opts.buyerId) : this.visibleToViewer(r, viewer),
    );
    const mandate =
      opts.mandateId && opts.buyerId
        ? (this.db
            .prepare("SELECT last_seen_at FROM mandates WHERE id = ? AND buyer_id = ?")
            .get(opts.mandateId, opts.buyerId) as { last_seen_at: string | null } | undefined)
        : undefined;
    const shortlisted = new Set(
      opts.buyerId
        ? (
            this.db
              .prepare("SELECT listing_id FROM shortlist WHERE buyer_id = ?")
              .all(opts.buyerId) as { listing_id: string }[]
          ).map((r) => r.listing_id)
        : [],
    );
    const ruledOut: Record<string, number> = {};
    const out = (k: string) => {
      ruledOut[k] = (ruledOut[k] ?? 0) + 1;
    };
    const valueFilter = c.value_max_cents !== undefined || c.value_min_cents !== undefined;
    let unestimated = 0;
    let noAsking = 0;
    let unverifiable = 0;
    const results: (CandidateView & {
      reasons: string[];
      unknowns: string[];
      shortlisted: boolean;
      is_new: boolean;
    })[] = [];
    // What each result may be sorted by: the same exact values or bands it shows, never more.
    const sortable = new Map<string, Indexed>();
    for (const row of rows) {
      const x = await this.index(row, viewer);
      // Still listed and visible to this viewer after the reads (003f1)?
      const now = this.listingRow(row.id);
      if (
        !now ||
        now.mode === "closed" ||
        !(opts.buyerId ? this.visibleTo(now, opts.buyerId) : this.visibleToViewer(now, viewer))
      )
        continue;
      const v = x.view;
      sortable.set(v.listing_id, x);
      const reasons: string[] = [];
      const unknowns: string[] = [];
      if (c.families?.length) {
        if (!c.families.includes(x.family)) {
          out("kind");
          continue;
        }
        reasons.push(v.family_label);
      }
      if (c.remote) {
        if (v.remote === false) {
          out("remote");
          continue;
        }
        if (v.remote === null) unknowns.push("Whether it can run remotely isn't stated");
        else reasons.push("Runs remotely");
      }
      if (c.openness?.length) {
        if (!c.openness.includes(v.openness)) {
          out("openness");
          continue;
        }
        reasons.push(v.openness_label);
      }
      if (c.max_asking_cents !== undefined || c.require_asking) {
        if (!x.asking) {
          if (c.require_asking) {
            noAsking++;
            continue;
          }
          unknowns.push("No asking price set");
        } else if (c.max_asking_cents !== undefined) {
          if (x.asking.lo > c.max_asking_cents) {
            out("asking price");
            continue;
          }
          reasons.push(
            v.mode === "anonymous"
              ? `Asking band ${v.asking.text.replace(" (band)", "")} may fit ${usd(c.max_asking_cents)}`
              : `Asking ${v.asking.text}, within ${usd(c.max_asking_cents)}`,
          );
        }
      }
      if (valueFilter) {
        const min = c.value_min_cents ?? 0;
        const max = c.value_max_cents ?? Number.POSITIVE_INFINITY;
        if (!x.value) {
          if (!c.include_unestimated) {
            unestimated++;
            continue;
          }
          unknowns.push("No estimate shared or available");
        } else {
          const ok =
            c.value_mode === "within"
              ? x.value.lo >= min && x.value.hi <= max
              : x.value.lo <= max && x.value.hi >= min;
          if (!ok) {
            out("estimate");
            continue;
          }
          reasons.push(
            `Estimate ${v.value.text.replace(" (band)", "")} ${c.value_mode === "within" ? "within" : "overlaps"} your range`,
          );
        }
      }
      if (c.min_months !== undefined) {
        // Unknown history is kept and labelled (like history that isn't shared); only a known
        // shorter history is ruled out (job 003f1).
        if (x.unknown) unknowns.push("History couldn't be read right now (kept, not ruled out)");
        else if (x.months === null) unknowns.push("History not shared");
        else if (x.months < c.min_months) {
          out("months of history");
          continue;
        } else reasons.push(`${plural(x.months, "complete month")} of history`);
      }
      if (c.verified_only) {
        // Verification can't come from missing observations: unknown is set aside, and counted
        // separately so the buyer knows why.
        if (x.unknown) {
          unverifiable++;
          continue;
        }
        if (x.verified !== true) {
          out("verified on NEAR");
          continue;
        }
        reasons.push("Revenue verified on NEAR testnet");
      }
      if (c.max_founder_hours !== undefined) {
        if (x.hours === null) unknowns.push("Founder's hours not shared");
        else if (x.hours > c.max_founder_hours) {
          out("founder's hours");
          continue;
        } else reasons.push(`About ${Number(x.hours.toFixed(1))} h a week of owner work`);
      }
      results.push({
        ...v,
        reasons,
        unknowns,
        shortlisted: shortlisted.has(v.listing_id),
        is_new: Boolean(mandate && (!mandate.last_seen_at || v.updated_at > mandate.last_seen_at)),
      });
    }
    // Anonymous listings sort by their band's low edge, so the order inside a band reveals
    // nothing about the exact hidden figure; ties keep a fixed order unrelated to the value.
    const key = (r: (typeof results)[number]) => {
      const x = sortable.get(r.listing_id);
      if (opts.sort === "asking") return x?.asking ? x.asking.lo : Number.POSITIVE_INFINITY;
      if (opts.sort === "value") return x?.value ? -x.value.lo : Number.POSITIVE_INFINITY;
      if (opts.sort === "newest") return -Date.parse(r.updated_at);
      return -(r.reasons.length * 10 - r.unknowns.length);
    };
    results.sort((a, b) => key(a) - key(b));
    if (mandate && opts.mandateId)
      this.db
        .prepare("UPDATE mandates SET last_seen_at = ? WHERE id = ?")
        .run(now(), opts.mandateId);
    const hidden: { text: string; relax: Partial<Record<keyof Criteria, unknown>> }[] = [];
    if (unestimated)
      hidden.push({
        text: `${plural(unestimated, "business", "businesses")} without an estimate ${unestimated === 1 ? "is" : "are"} set aside by the estimate filter`,
        relax: { include_unestimated: true },
      });
    if (noAsking)
      hidden.push({
        text: `${plural(noAsking, "business", "businesses")} without an asking price ${noAsking === 1 ? "is" : "are"} set aside`,
        relax: { require_asking: false },
      });
    if (unverifiable)
      hidden.push({
        text: `${plural(unverifiable, "business", "businesses")} whose books couldn't be read right now ${unverifiable === 1 ? "is" : "are"} set aside by the verified filter: verification can't come from missing records`,
        relax: { verified_only: false },
      });
    return {
      criteria: c,
      results,
      hidden,
      ruled_out: Object.entries(ruledOut).map(([filter, count]) => ({ filter, count })),
      total_listed: rows.length,
    };
  }

  /** A candidate's overview: what customers buy, why it's open, and could I operate it? */
  async candidate(viewer: Person | null, listingId: string, buyerId?: string) {
    const visible = (r: ListingRow | undefined): r is ListingRow =>
      Boolean(
        r &&
          r.mode !== "closed" &&
          (buyerId ? this.visibleTo(r, buyerId) : this.visibleToViewer(r, viewer)),
      );
    const before = this.listingRow(listingId);
    if (buyerId && viewer) this.role(viewer, buyerId);
    if (!visible(before)) throw new HttpError(404, "No such listing");
    const x = await this.index(before, viewer);
    const f = await this.facts(before.business_id);
    // Checked again after the reads (003f1): visibility, role and what is disclosed now.
    const row = this.listingRow(listingId);
    if (buyerId && viewer) this.role(viewer, buyerId);
    if (!visible(row)) throw new HttpError(404, "No such listing");
    const anonymous = row.mode === "anonymous";
    const offer = this.store.offerOf(row.business_id);
    const disclose = this.disclosed(row);
    const helpers = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM team WHERE business_id = ? AND revoked_at IS NULL")
        .get(row.business_id) as { n: number }
    ).n;
    const myBuyers = this.buyerIdsOf(viewer);
    const requests = (
      this.db
        .prepare("SELECT * FROM access_requests WHERE listing_id = ? ORDER BY created_at DESC")
        .all(listingId) as unknown as RequestRow[]
    )
      .filter((r) => myBuyers.includes(r.buyer_id))
      .map((r) => this.requestView(r));
    return {
      candidate: x.view,
      offer: anonymous
        ? { outcome: offer.outcome, audience: offer.audience, price_unit: offer.price_unit }
        : {
            title: offer.title,
            outcome: offer.outcome,
            audience: offer.audience,
            deliverable: offer.deliverable,
            price_cents: offer.first_free ? 0 : offer.price_cents,
            price_unit: offer.price_unit,
            when_text: offer.when_text,
            where_text: offer.where_text,
          },
      calculation:
        !anonymous && disclose.has("calculation") && f.estimate.low_cents !== null
          ? {
              explanation: f.estimate.explanation,
              label: f.estimate.label,
              missing: f.estimate.missing,
            }
          : null,
      operate: {
        founder_hours: x.view.founder_hours,
        helpers,
        payments_on_near: Boolean(this.chainRow(row.business_id)),
        family: x.view.family_label,
      },
      requests,
      categories: CATEGORIES,
    };
  }

  async compare(viewer: Person, buyerId: string, ids: string[]) {
    this.role(viewer, buyerId);
    const out: CandidateView[] = [];
    for (const id of ids.slice(0, 3)) {
      const row = this.listingRow(id);
      if (row && this.visibleTo(row, buyerId)) out.push((await this.index(row, viewer)).view);
    }
    return {
      candidates: out,
      basis:
        "Same model (scenario-v1), same currency (test dollars, no value), each business's last complete months. Unknown stays unknown.",
    };
  }

  // ---------- access requests and grants ----------

  private statusOf(r: RequestRow) {
    if (r.status === "granted" && r.expires_at && r.expires_at <= now()) return "expired";
    return r.status;
  }

  private requestView(r: RequestRow) {
    const listing = this.listingRow(r.listing_id) as ListingRow;
    const granted = this.statusOf(r) === "granted";
    const b = this.biz(listing.business_id);
    const opens = this.db
      .prepare(
        "SELECT COUNT(*) AS n, MAX(at) AS last FROM events WHERE type = 'room.opened' AND subject = ?",
      )
      .get(r.id) as { n: number; last: string | null };
    return {
      id: r.id,
      listing_id: r.listing_id,
      title:
        listing.mode === "anonymous" && !granted && r.status !== "revoked"
          ? `${FAMILY_LABEL[b.family] ?? "Business"} · ES-${listing.id.replace(/-/g, "").slice(0, 4).toUpperCase()}`
          : b.name,
      buyer: this.profile(r.buyer_id),
      requested_by: this.store.person(r.requested_by).display_name,
      categories: JSON.parse(r.categories) as Category[],
      granted: r.granted ? (JSON.parse(r.granted) as Category[]) : null,
      purpose: r.purpose,
      days: r.days,
      status: this.statusOf(r),
      expires_at: r.expires_at,
      decided_at: r.decided_at,
      decision_note: r.decision_note,
      revoked_at: r.revoked_at,
      created_at: r.created_at,
      opened: { count: opens.n, last_at: opens.last },
    };
  }

  private requestsOfBuyer(buyerId: string) {
    return (
      this.db
        .prepare("SELECT * FROM access_requests WHERE buyer_id = ? ORDER BY created_at DESC")
        .all(buyerId) as unknown as RequestRow[]
    ).map((r) => this.requestView(r));
  }

  private requestsOfListing(listingId: string) {
    return (
      this.db
        .prepare("SELECT * FROM access_requests WHERE listing_id = ? ORDER BY created_at DESC")
        .all(listingId) as unknown as RequestRow[]
    ).map((r) => this.requestView(r));
  }

  private categoriesOf(v: unknown): Category[] {
    const list = Array.isArray(v)
      ? [...new Set(v)].filter((c): c is Category => c in CATEGORIES)
      : [];
    if (list.length === 0) throw new HttpError(400, "Choose at least one kind of evidence");
    return list;
  }

  requestAccess(
    viewer: Person,
    buyerId: string,
    listingId: string,
    input: { categories?: string[]; purpose?: string; days?: number },
  ) {
    this.role(viewer, buyerId, "approve");
    const row = this.listingRow(listingId);
    if (!row || !this.visibleTo(row, buyerId)) throw new HttpError(404, "No such listing");
    if (this.biz(row.business_id).owner_id === viewer.id)
      throw new HttpError(409, "This is your own business");
    const categories = this.categoriesOf(input.categories);
    const purpose = String(input.purpose ?? "")
      .trim()
      .slice(0, 400);
    if (purpose.length < 10) throw new HttpError(400, "Say what you need the evidence for");
    const days = Math.round(Number(input.days ?? 7));
    if (!(days >= 1 && days <= 30)) throw new HttpError(400, "Ask for 1 to 30 days");
    const open = (
      this.db
        .prepare(
          "SELECT * FROM access_requests WHERE buyer_id = ? AND listing_id = ? AND status IN ('pending','granted')",
        )
        .all(buyerId, listingId) as unknown as RequestRow[]
    ).filter((r) => this.statusOf(r) !== "expired");
    if (open.length)
      throw new HttpError(409, "Your team already has an open request for this business");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO access_requests (id, buyer_id, listing_id, requested_by, categories, purpose, days, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(id, buyerId, listingId, viewer.id, JSON.stringify(categories), purpose, days, now());
    return this.requestView(this.requestRow(id));
  }

  private requestRow(id: string) {
    const r = this.db.prepare("SELECT * FROM access_requests WHERE id = ?").get(id) as
      | RequestRow
      | undefined;
    if (!r) throw new HttpError(404, "No such request");
    return r;
  }

  private sellerOf(founder: Person, requestId: string) {
    const r = this.requestRow(requestId);
    const listing = this.listingRow(r.listing_id) as ListingRow;
    if (!this.store.isOwnerOf(founder, listing.business_id))
      throw new HttpError(404, "No such request");
    return { r, listing };
  }

  /** The seller grants what was asked, narrows it (fewer kinds, fewer days) or declines. */
  decide(
    founder: Person,
    requestId: string,
    input: { action?: string; categories?: string[]; days?: number; note?: string },
  ) {
    const { r } = this.sellerOf(founder, requestId);
    if (r.status !== "pending") throw new HttpError(409, `This request is ${this.statusOf(r)}`);
    const note = String(input.note ?? "").slice(0, 300);
    if (input.action === "decline") {
      this.db
        .prepare(
          "UPDATE access_requests SET status = 'declined', decided_at = ?, decision_note = ?, access_version = access_version + 1 WHERE id = ?",
        )
        .run(now(), note, requestId);
      return this.requestView(this.requestRow(requestId));
    }
    if (input.action !== "grant") throw new HttpError(400, "Grant or decline");
    const asked = JSON.parse(r.categories) as Category[];
    const granted = input.categories ? this.categoriesOf(input.categories) : asked;
    if (granted.some((c) => !asked.includes(c)))
      throw new HttpError(400, "You can narrow what they asked for, not add to it");
    const days = Math.round(Number(input.days ?? r.days));
    if (!(days >= 1 && days <= r.days)) throw new HttpError(400, `Grant 1 to ${r.days} days`);
    this.db
      .prepare(
        "UPDATE access_requests SET status = 'granted', granted = ?, expires_at = ?, decided_at = ?, decision_note = ?, scope_version = ?, access_version = access_version + 1 WHERE id = ?",
      )
      .run(
        JSON.stringify(granted),
        new Date(Date.now() + days * DAY).toISOString(),
        now(),
        note,
        SCOPE_VERSION,
        requestId,
      );
    return this.requestView(this.requestRow(requestId));
  }

  revoke(founder: Person, requestId: string) {
    const { r } = this.sellerOf(founder, requestId);
    if (r.status !== "granted") throw new HttpError(409, `This request is ${this.statusOf(r)}`);
    this.db
      .prepare(
        "UPDATE access_requests SET status = 'revoked', revoked_at = ?, access_version = access_version + 1 WHERE id = ?",
      )
      .run(now(), requestId);
    return this.requestView(this.requestRow(requestId));
  }

  withdraw(viewer: Person, requestId: string) {
    const r = this.requestRow(requestId);
    this.role(viewer, r.buyer_id, "approve");
    if (r.status !== "pending") throw new HttpError(409, `This request is ${this.statusOf(r)}`);
    this.db
      .prepare(
        "UPDATE access_requests SET status = 'withdrawn', access_version = access_version + 1 WHERE id = ?",
      )
      .run(requestId);
    return this.requestView(this.requestRow(requestId));
  }

  // ---------- the evidence room ----------

  /** Every room read passes here: team role, grant status and expiry, checked each time. */
  private grantFor(viewer: Person, requestId: string) {
    const r = this.requestRow(requestId);
    const role = this.role(viewer, r.buyer_id, "evidence");
    const status = this.statusOf(r);
    const day = (iso: string | null) =>
      iso
        ? `${new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`
        : "";
    if (status === "pending") throw new HttpError(403, "The seller hasn't decided yet");
    if (status === "declined") throw new HttpError(403, "The seller declined this request");
    if (status === "withdrawn") throw new HttpError(403, "Your team withdrew this request");
    if (status === "revoked")
      throw new HttpError(403, `The seller ended this access on ${day(r.revoked_at)}`);
    if (status === "expired") throw new HttpError(403, `This access ended on ${day(r.expires_at)}`);
    const listing = this.listingRow(r.listing_id) as ListingRow;
    const owner = this.biz(listing.business_id).owner_id;
    // Everything the answer depends on. If any of it differs after the reads, the grant
    // changed while they were in flight (revoked, re-decided, narrowed, role or team changed,
    // business sold), and nothing read under the old grant is returned.
    const stamp = JSON.stringify([
      r.access_version,
      r.status,
      r.granted,
      r.expires_at,
      r.scope_version,
      role,
      listing.business_id,
      owner,
    ]);
    return {
      r,
      listing,
      role,
      stamp,
      granted: new Set(JSON.parse(r.granted ?? "[]") as Category[]),
    };
  }

  /**
   * The one gate for evidence reads: the room, its export, scenarios and any future chart of the
   * seller's figures. It checks the grant, runs the asynchronous reads, then checks again after
   * the last await and before anything private is serialized or written. A grant that ended or
   * changed while the reads were in flight gets a 403 and no data.
   */
  private async withGrant<T>(
    viewer: Person,
    requestId: string,
    need: Category | null,
    read: (g: ReturnType<Acquisitions["grantFor"]>) => Promise<T>,
  ) {
    const before = this.grantFor(viewer, requestId);
    if (need && !before.granted.has(need))
      throw new HttpError(403, `This grant doesn't include ${need}`);
    const out = await read(before);
    const g = this.grantFor(viewer, requestId); // throws the current refusal, if there is one
    if (g.stamp !== before.stamp)
      throw new HttpError(
        403,
        "Access changed while this was loading, so nothing was shown. Open the room again.",
      );
    return { g, out };
  }

  private suppress(n: number) {
    return n > 0 && n < 3 ? "Fewer than 3" : String(n);
  }

  async room(viewer: Person, requestId: string, log = true) {
    const { g, out } = await this.withGrant(viewer, requestId, null, async (g) => {
      const f = await this.facts(g.listing.business_id);
      const ops =
        g.granted.has("operations") || g.granted.has("financials")
          ? await this.operations(g.listing.business_id, f.hours)
          : null;
      return { f, ops };
    });
    if (log)
      this.db
        .prepare(
          "INSERT INTO events (type, subject, actor, payload, at) VALUES ('room.opened', ?, ?, '{}', ?)",
        )
        .run(requestId, viewer.id, now());
    return this.scopeRoom(g, out.f, out.ops);
  }

  /**
   * What a grant shows, from data already read: one function for the room and its export.
   * Scope wording 2: balances (customer money held, available) belong to financials;
   * operations shows promises and what transfers without amounts. A grant made under wording 1
   * keeps the balances it was agreed with, and says so.
   */
  private scopeRoom(
    g: ReturnType<Acquisitions["grantFor"]>,
    f: Awaited<ReturnType<Acquisitions["facts"]>>,
    ops: Awaited<ReturnType<Acquisitions["operations"]>> | null,
  ) {
    const { r, listing, granted } = g;
    const b = this.biz(listing.business_id);
    const e = f.estimate;
    const room: Record<string, unknown> = {
      request: this.requestView(r),
      business: {
        name: b.name,
        slug: b.slug,
        family_label: FAMILY_LABEL[b.family],
        tagline: b.tagline,
      },
      asking:
        listing.asking_cents === null
          ? null
          : { cents: listing.asking_cents, source: "Founder supplied" },
      chain_error: f.chain_error,
    };
    if (granted.has("financials")) {
      room.financials = {
        // Scope 3 (003f1) includes money in and out, owner withdrawals and sale proceeds. A
        // grant made under earlier wording ("monthly books") keeps exactly what it covered.
        months: f.months.map((m) => {
          const fm = financialMonth(m);
          return r.scope_version >= 3 ? fm : { ...fm, cash: null };
        }),
        cash_included: r.scope_version >= 3,
        ...(r.scope_version < 3
          ? {
              cash_note:
                "This access was granted under earlier wording that didn't include money in and out, owner withdrawals or sale proceeds, so they aren't shown.",
            }
          : {}),
        basis: BOOKS_BASIS,
        estimate: {
          low_cents: e.low_cents,
          high_cents: e.high_cents,
          label: e.label,
          explanation: e.explanation,
          missing: e.missing,
          sources: e.sources,
        },
        reproduce: {
          months: f.used.map((m) => ({
            label: m.label,
            revenue_cents: m.revenue_cents,
            direct_cents: m.direct_cents,
            overhead_cents: m.overhead_cents,
          })),
          // The exact totals the estimate used (chain amounts summed in base units and
          // converted once), so the buyer's check uses the same arithmetic as the owner's.
          revenue_cents: e.inputs.revenue_cents,
          costs_cents: e.inputs.costs_cents,
          labor_month_cents: e.inputs.labor_month_cents,
          annualize_by: e.inputs.annualize_by,
          multiple_low: e.inputs.multiple_low,
          multiple_high: e.inputs.multiple_high,
          stage: e.inputs.stage,
        },
        base: {
          founder_hours_week: e.inputs.founder_hours_week,
          hourly_rate_cents: e.inputs.hourly_rate_cents,
          multiple_low: e.inputs.multiple_low,
          multiple_high: e.inputs.multiple_high,
        },
        scenarios: this.buyerScenarios(r.buyer_id, listing.business_id),
        balances: ops?.treasury ?? null,
      };
    }
    if (granted.has("costs")) {
      room.costs = f.months
        .filter((m) => m.lines.some((l) => l.kind !== "revenue"))
        .map((m) => ({
          label: m.label,
          lines: m.lines.filter((l) => l.kind !== "revenue"),
        }));
    }
    if (granted.has("customers")) room.customers = this.customers(listing.business_id);
    if (granted.has("operations") && ops) {
      const legacy = r.scope_version < 2;
      const balances = legacy || granted.has("financials");
      room.operations = balances
        ? ops
        : {
            ...ops,
            treasury: null,
            manifest: {
              ...ops.manifest,
              stays: ops.manifest.stays.map((i) =>
                i.name === "Customer money held by the contract"
                  ? { ...i, detail: "Amount shown with financials access" }
                  : i,
              ),
            },
          };
      if (legacy)
        room.scope_note = `Granted under the earlier wording "${CATEGORIES_V1_OPERATIONS}", which also showed the contract's balances.`;
    }
    return room;
  }

  private customers(businessId: string) {
    const orders = this.db
      .prepare(
        "SELECT person_id, status FROM payments WHERE business_id = ? AND status IN ('paid','delivered','kept','refunded')",
      )
      .all(businessId) as { person_id: string; status: string }[];
    const per = new Map<string, number>();
    for (const o of orders) per.set(o.person_id, (per.get(o.person_id) ?? 0) + 1);
    const bookings = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM bookings WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    const upcoming = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sessions_offered WHERE business_id = ? AND starts_at > ?",
        )
        .get(businessId, now()) as { n: number }
    ).n;
    const count = (s: string) => orders.filter((o) => o.status === s).length;
    return {
      rows: [
        { label: "Paying customers", value: this.suppress(per.size) },
        { label: "Paid orders", value: this.suppress(orders.length) },
        { label: "Delivered", value: this.suppress(count("delivered")) },
        { label: "Refunded", value: this.suppress(count("refunded")) },
        {
          label: "Customers with 2 or more orders",
          value: this.suppress([...per.values()].filter((n) => n >= 2).length),
        },
        { label: "Bookings through OpenSeat", value: this.suppress(bookings) },
        { label: "Upcoming sessions", value: String(upcoming) },
      ],
      source:
        orders.length || bookings
          ? "Orders: Everstreet's records of NEAR testnet payments. Bookings: OpenSeat (connected service)."
          : "No customer records through Everstreet yet. Seeded history has revenue totals only.",
      note: 'Counts of 1 or 2 are shown as "Fewer than 3" so nobody can be singled out.',
    };
  }

  async operations(businessId: string, hours: number | null) {
    const b = this.biz(businessId);
    const founder = this.store.person(b.owner_id).display_name;
    const helpers = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM team WHERE business_id = ? AND revoked_at IS NULL")
        .get(businessId) as { n: number }
    ).n;
    const account = this.chainRow(businessId);
    const integration = this.db
      .prepare("SELECT provider FROM integrations WHERE business_id = ?")
      .get(businessId) as { provider: string } | undefined;
    let treasury: { customer_money: string; available: string; source: string } | null = null;
    let promises: string[] = [];
    if (account) {
      const rules = JSON.parse(account.rules) as { refund_hours?: number; reserve_cents?: number };
      promises = [
        `Customers can cancel for a full refund until ${rules.refund_hours ?? 0} hours before; the contract refunds by itself.`,
        `A reserve of ${usd(rules.reserve_cents ?? 0)} can never be withdrawn by the owner.`,
        "Customer money stays held until the order is delivered.",
      ];
      if (this.chain) {
        try {
          const t = await this.chain.treasury(account.account_id);
          const per = 10n ** BigInt(this.chain.decimals - 2);
          const cents = (v: string) => Number(BigInt(v) / per);
          treasury = {
            customer_money: usd(cents(t.customer_credit) + cents(t.unearned_orders)),
            available: usd(cents(t.available)),
            source: "Verified on NEAR · testnet (read now)",
          };
        } catch (e) {
          treasury = {
            customer_money: "Unknown",
            available: "Unknown",
            source: `NEAR testnet could not be read: ${(e as Error).message}`,
          };
        }
      }
    }
    const item = (
      name: string,
      status: "Ready" | "Pending" | "Blocked" | "Excluded",
      detail: string,
      enforced: string,
    ) => ({ name, status, detail, enforced });
    return {
      founder_hours:
        hours === null
          ? { text: "Not set by the founder", source: "Unknown" }
          : { text: `${Number(hours.toFixed(1))} h a week`, source: "Founder supplied" },
      helpers: {
        text: helpers ? plural(helpers, "helper") : "No helpers appointed",
        source: account ? "Appointed on the business's contract" : "Everstreet",
      },
      contract: account
        ? {
            account_id: account.account_id,
            url: `https://testnet.nearblocks.io/address/${account.account_id}`,
            created_url: `https://testnet.nearblocks.io/txns/${account.tx}`,
          }
        : null,
      treasury,
      promises,
      manifest: {
        note: "Preliminary: what a sale would cover today. Exact terms are agreed and accepted later.",
        receive: [
          account
            ? item(
                "Owner role on the business's contract",
                "Ready",
                account.account_id,
                "Enforced by the contract",
              )
            : item(
                "Owner role on NEAR",
                "Blocked",
                "Payments are off, so ownership isn't on a contract yet. The seller turns payments on first.",
                "Not yet on NEAR",
              ),
          item(
            "The right to appoint the next team",
            account ? "Ready" : "Blocked",
            "Helpers are contract operators; a sale voids old ones",
            account ? "Enforced by the contract" : "Not yet on NEAR",
          ),
          item(
            "Business page, offer, updates and records on Everstreet",
            "Ready",
            b.name,
            "Enforced by Everstreet (service)",
          ),
        ],
        stays: [
          ...(treasury
            ? [
                item(
                  "Customer money held by the contract",
                  "Ready",
                  treasury.customer_money,
                  "Enforced by the contract",
                ),
              ]
            : []),
          item(
            "Customers' bookings and accepted terms",
            "Ready",
            "Existing customers keep their places and refund rights",
            account ? "Enforced by the contract and OpenSeat" : "Enforced by Everstreet",
          ),
        ],
        separate: [
          ...(integration
            ? [
                item(
                  "Booking service account (OpenSeat studio)",
                  "Pending",
                  "Everstreet holds the studio key for the business, so it moves with the business on Everstreet at close; not on NEAR",
                  "Enforced by the service",
                ),
              ]
            : []),
          item(
            "Anything outside Everstreet: code, accounts, premises, inventory",
            "Pending",
            "Not listed yet; the seller adds them before terms",
            "Outside Everstreet",
          ),
        ],
        excluded: [
          item(
            `${founder}'s personal account and other businesses`,
            "Excluded",
            "Never part of a sale",
            "—",
          ),
          item(
            "Customers' personal rights and data",
            "Excluded",
            "Customers' own; buyers see aggregates only",
            "—",
          ),
        ],
      },
    };
  }

  private buyerScenarios(buyerId: string, businessId: string) {
    return (
      this.db
        .prepare(
          "SELECT * FROM buyer_scenarios WHERE buyer_id = ? AND business_id = ? ORDER BY created_at DESC",
        )
        .all(buyerId, businessId) as {
        id: string;
        name: string;
        overrides: string;
        result: string;
        created_by: string;
        created_at: string;
      }[]
    ).map((s) => {
      const e = JSON.parse(s.result) as Estimate;
      return {
        id: s.id,
        name: s.name,
        overrides: JSON.parse(s.overrides) as Overrides,
        low_cents: e.low_cents,
        high_cents: e.high_cents,
        by: this.store.person(s.created_by).display_name,
        created_at: s.created_at,
      };
    });
  }

  /** The buyer's own assumptions on the seller's inputs; the founder's estimate never changes. */
  async tryScenario(viewer: Person, requestId: string, o: Overrides) {
    return (await this.scenario(viewer, requestId, o)).out;
  }

  private async scenario(viewer: Person, requestId: string, o: Overrides) {
    const clean: Overrides = {};
    for (const k of [
      "founder_hours_week",
      "hourly_rate_cents",
      "multiple_low",
      "multiple_high",
      "extra_monthly_costs_cents",
    ] as const) {
      const v = o[k];
      if (v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0)
        clean[k] = Number(v);
    }
    return this.withGrant(viewer, requestId, "financials", async (g) => {
      const base = await this.valuation.inputs(g.listing.business_id);
      return {
        base: estimate(base),
        scenario: estimate(withOverrides(base, clean)),
        overrides: clean,
      };
    });
  }

  async saveScenario(viewer: Person, requestId: string, name: string, o: Overrides) {
    // Checked after the last await by `scenario`; the write below runs before anything else
    // can change the grant. Only the team's own assumptions and the resulting range are kept,
    // not the seller's inputs.
    const { g, out: result } = await this.scenario(viewer, requestId, o);
    const { r, listing } = g;
    this.db
      .prepare(
        "INSERT INTO buyer_scenarios (id, buyer_id, business_id, name, overrides, result, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        r.buyer_id,
        listing.business_id,
        (name || "Our assumptions").slice(0, 80),
        JSON.stringify(result.overrides),
        JSON.stringify({
          low_cents: result.scenario.low_cents,
          high_cents: result.scenario.high_cents,
        }),
        viewer.id,
        now(),
      );
    return this.buyerScenarios(r.buyer_id, listing.business_id);
  }

  async exportRoom(viewer: Person, requestId: string) {
    const room = await this.room(viewer, requestId, false);
    return {
      exported_at: now(),
      notice:
        "A permitted snapshot. Fictional example; test dollars have no value. Ending access stops future reads through Everstreet; it cannot recall a copy already downloaded.",
      ...room,
    };
  }

  /** For the founder's desk: a one-line summary of the acquisition setting. */
  summary(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const row = this.listingOf(businessId);
    const pending = row.id
      ? (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM access_requests WHERE listing_id = ? AND status = 'pending'",
            )
            .get(row.id) as { n: number }
        ).n
      : 0;
    return { mode: row.mode, mode_label: MODES[row.mode], pending };
  }
}
