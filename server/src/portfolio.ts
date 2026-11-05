// Job 005d (M5): a person's portfolio across businesses, composed from records they're already
// allowed to read. Design: docs/design/PORTFOLIO.md.
//
// - Owned: businesses the viewer controls NOW (owner_id). How control arrived is shown from the
//   ownership record (founded here, or received by a recorded close), never inferred.
// - Considering: listings the viewer's buyer teams shortlisted. An anonymous or private listing
//   stays anonymous here: only what the listing itself shows publicly.
// - Former: businesses the viewer once controlled and passed on. History only (when and to whom
//   control moved); no current figures, products or customer data.
// - Figures are each business's own, in its own units; unknown is null, never zero; nothing is
//   summed across currencies, and no valuation is made here.
// - Private labels and notes are the viewer's own, append-only in their history.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { economics } from "./economics.ts";
import { currentCustomerWork } from "./operations.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const PORTFOLIO_SCHEMA = `
CREATE TABLE IF NOT EXISTS portfolio_notes (
  person_id TEXT NOT NULL REFERENCES people(id), business_id TEXT NOT NULL REFERENCES businesses(id),
  label TEXT NOT NULL, note TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (person_id, business_id)
) STRICT;
CREATE TABLE IF NOT EXISTS portfolio_note_history (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
  business_id TEXT NOT NULL REFERENCES businesses(id), label TEXT NOT NULL, note TEXT NOT NULL,
  version INTEGER NOT NULL, at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS portfolio_note_history_no_update BEFORE UPDATE ON portfolio_note_history
BEGIN SELECT RAISE(ABORT, 'portfolio note history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS portfolio_note_history_no_delete BEFORE DELETE ON portfolio_note_history
BEGIN SELECT RAISE(ABORT, 'portfolio note history is append-only'); END;
`;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LABELS = ["", "core", "watch", "improve", "exit", "research"] as const;

export class Portfolio {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {
    db.exec(PORTFOLIO_SCHEMA);
  }

  private notes(viewer: Person) {
    const rows = this.db
      .prepare(
        "SELECT business_id, label, note, version, updated_at FROM portfolio_notes WHERE person_id = ?",
      )
      .all(viewer.id) as {
      business_id: string;
      label: string;
      note: string;
      version: number;
      updated_at: string;
    }[];
    return new Map(rows.map((r) => [r.business_id, r]));
  }

  /** The business may be in the viewer's portfolio: owned now, formerly owned, or shortlisted. */
  private related(viewer: Person, businessId: string) {
    const owned = this.db
      .prepare("SELECT 1 FROM businesses WHERE id = ? AND owner_id = ?")
      .get(businessId, viewer.id);
    const former = this.db
      .prepare("SELECT 1 FROM ownership WHERE business_id = ? AND from_id = ?")
      .get(businessId, viewer.id);
    const listed = this.db
      .prepare(
        `SELECT 1 FROM shortlist s JOIN listings l ON l.id = s.listing_id JOIN buyers b ON b.id = s.buyer_id
          WHERE l.business_id = ? AND (b.owner_id = ? OR EXISTS (SELECT 1 FROM buyer_members m WHERE m.buyer_id = b.id AND m.person_id = ?))`,
      )
      .get(businessId, viewer.id, viewer.id);
    return Boolean(owned || former || listed);
  }

  view(viewer: Person) {
    const notes = this.notes(viewer);
    const now = new Date();
    const owned = (
      this.db
        .prepare(
          "SELECT id, name, slug, published_at, created_at FROM businesses WHERE owner_id = ? ORDER BY name LIMIT 100",
        )
        .all(viewer.id) as {
        id: string;
        name: string;
        slug: string;
        published_at: string | null;
        created_at: string;
      }[]
    ).map((b) => {
      const received = this.db
        .prepare(
          "SELECT from_id, deal_id, generation, tx, at FROM ownership WHERE business_id = ? AND to_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(b.id, viewer.id) as
        | {
            from_id: string;
            deal_id: string | null;
            generation: number | null;
            tx: string | null;
            at: string;
          }
        | undefined;
      const products = this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM product_projects WHERE business_id = ?) AS projects,
             (SELECT COUNT(*) FROM runtime_releases WHERE business_id = ? AND state = 'active') AS released,
             (SELECT COUNT(*) FROM customer_offers WHERE business_id = ? AND state = 'active') AS offers`,
        )
        .get(b.id, b.id, b.id) as { projects: number; released: number; offers: number };
      let econ: ReturnType<typeof economics> | null = null;
      let work: ReturnType<typeof currentCustomerWork> | null = null;
      try {
        econ = economics(this.db, b.id, 1, now);
        work = currentCustomerWork(this.db, b.id, now.toISOString(), now.getTime());
      } catch {
        econ = null; // unknown, never zero
      }
      const month = econ?.months.at(-1) ?? null;
      const attention: string[] = [];
      if (work && work.needs_attention > 0)
        attention.push(`${work.needs_attention} customer use(s) need attention`);
      if (econ && econ.recovery.items.length > 0)
        attention.push(`${econ.recovery.items.length} unresolved operation(s)`);
      if (products.released > 0 && products.offers === 0)
        attention.push("A released product has no active customer offer");
      if (products.projects > 0 && products.released === 0)
        attention.push("Nothing released to customers yet");
      const n = notes.get(b.id);
      return {
        business: { id: b.id, name: b.name, slug: b.slug, published: Boolean(b.published_at) },
        authority: "owner",
        control: received
          ? {
              how: received.deal_id || received.tx ? "received_by_close" : "received",
              at: received.at,
              from: this.name(received.from_id),
              receipt: { deal: received.deal_id, generation: received.generation, tx: received.tx },
            }
          : { how: "founded", at: b.created_at, from: null, receipt: null },
        products,
        // This month, per asset, exact; null when it couldn't be read.
        this_month: month
          ? {
              label: month.label,
              by_asset: month.by_asset,
              successful_uses: month.successful_uses,
              compute_known_microcents: month.compute.known_microcents,
              compute_unknown_calls: month.compute.unknown_cost_calls,
            }
          : null,
        owed: econ ? econ.obligations : null,
        attention,
        next_action: attention[0] ?? null,
        label: n?.label ?? "",
        note: n?.note ?? "",
        note_version: n?.version ?? 0,
      };
    });
    const considering = (
      this.db
        .prepare(
          `SELECT DISTINCT l.id AS listing_id, l.business_id, l.mode, b.name AS business_name, b.slug, s.created_at, buy.name AS team
             FROM shortlist s JOIN listings l ON l.id = s.listing_id JOIN buyers buy ON buy.id = s.buyer_id
             JOIN businesses b ON b.id = l.business_id
            WHERE (buy.owner_id = ? OR EXISTS (SELECT 1 FROM buyer_members m WHERE m.buyer_id = buy.id AND m.person_id = ?))
              AND b.owner_id <> ?
            ORDER BY s.created_at DESC LIMIT 100`,
        )
        .all(viewer.id, viewer.id, viewer.id) as {
        listing_id: string;
        business_id: string;
        mode: string;
        business_name: string;
        slug: string;
        created_at: string;
        team: string;
      }[]
    ).map((c) => {
      const named = c.mode === "named";
      const n = notes.get(c.business_id);
      return {
        listing: { id: c.listing_id, mode: c.mode },
        // An anonymous or private listing never reveals the business here.
        business: named ? { id: c.business_id, name: c.business_name, slug: c.slug } : null,
        team: c.team,
        shortlisted_at: c.created_at,
        label: named ? (n?.label ?? "") : "",
        note: named ? (n?.note ?? "") : "",
        note_version: named ? (n?.version ?? 0) : 0,
      };
    });
    const former = (
      this.db
        .prepare(
          `SELECT o.business_id, o.to_id, o.at, o.deal_id, b.name FROM ownership o JOIN businesses b ON b.id = o.business_id
            WHERE o.from_id = ? AND b.owner_id <> ? ORDER BY o.id DESC LIMIT 100`,
        )
        .all(viewer.id, viewer.id) as {
        business_id: string;
        to_id: string;
        at: string;
        deal_id: string | null;
        name: string;
      }[]
    ).map((f) => {
      const n = notes.get(f.business_id);
      return {
        business: { id: f.business_id, name: f.name },
        passed_on: { at: f.at, to: this.name(f.to_id), deal: f.deal_id },
        history_only: "You no longer control this business; only when it changed hands is shown.",
        label: n?.label ?? "",
        note: n?.note ?? "",
        note_version: n?.version ?? 0,
      };
    });
    return {
      as_of: now.toISOString(),
      owned,
      considering,
      former,
      attention: owned.flatMap((o) => o.attention.map((a) => ({ business: o.business, text: a }))),
      labels: LABELS.filter(Boolean),
      basis:
        "Each business's own records, in its own units. Unknown stays unknown; nothing is added across currencies, and no valuation is made here.",
    };
  }

  private name(id: string) {
    return (
      (
        this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(id) as
          | { display_name: string }
          | undefined
      )?.display_name ?? ""
    );
  }

  /** The viewer's own label and note for a business in their portfolio; versioned, history kept. */
  setNote(viewer: Person, businessId: string, input: Record<string, unknown>) {
    if (!this.related(viewer, businessId)) throw new HttpError(404, "Not in your portfolio");
    const label =
      typeof input.label === "string" && (LABELS as readonly string[]).includes(input.label)
        ? input.label
        : "";
    const note = typeof input.note === "string" ? input.note.replace(CONTROL, "").trim() : "";
    if (note.length > 1000)
      throw new HttpError(400, "The note is too long (at most 1000 characters)");
    const version = Number(input.version ?? 0);
    this.store.tx(() => {
      const cur = this.db
        .prepare("SELECT version FROM portfolio_notes WHERE person_id = ? AND business_id = ?")
        .get(viewer.id, businessId) as { version: number } | undefined;
      if ((cur?.version ?? 0) !== version)
        throw new HttpError(
          409,
          "Your note changed elsewhere. Reload, then save again.",
          "note_changed",
        );
      const t = new Date().toISOString();
      const next = version + 1;
      this.db
        .prepare(
          `INSERT INTO portfolio_notes (person_id, business_id, label, note, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (person_id, business_id) DO UPDATE SET label = excluded.label, note = excluded.note, version = excluded.version, updated_at = excluded.updated_at`,
        )
        .run(viewer.id, businessId, label, note, next, t);
      this.db
        .prepare(
          "INSERT INTO portfolio_note_history (id, person_id, business_id, label, note, version, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), viewer.id, businessId, label, note, next, t);
    });
    return this.view(viewer);
  }
}
