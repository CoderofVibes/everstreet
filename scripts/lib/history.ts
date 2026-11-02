// Fictional operating history for the example businesses, stored as "Seeded history" so every
// screen labels it as such. Paperfin's months are Astra's worked example (IntactProfiles §4):
// $12,000 earned, $3,600 direct costs, $900 overhead each month; founder replacement ~$1,000.
// Idempotent: months already seeded are left alone.

import { randomUUID } from "node:crypto";
import { addMonths, ym } from "../../server/src/books.ts";
import type { Store } from "../../server/src/store.ts";

interface Plan {
  slug: string;
  months: number;
  revenue: number;
  note: string;
  costs: { category: string; kind: "direct" | "overhead"; cents: number }[];
  settings?: { hours: number; rate: number; low: number; high: number; share: boolean };
}

const PLANS: Plan[] = [
  {
    slug: "juniper-print-studio",
    months: 3,
    revenue: 168_000,
    note: "Class tickets (48 × $35)",
    costs: [
      { category: "Materials", kind: "direct", cents: 27_000 },
      { category: "Space or venue", kind: "direct", cents: 48_000 },
      { category: "Marketing", kind: "overhead", cents: 2_000 },
    ],
  },
  {
    slug: "paperfin-api",
    months: 3,
    revenue: 1_200_000,
    note: "Metered renders (1,200,000 × $0.01)",
    costs: [
      { category: "Hosting and compute", kind: "direct", cents: 240_000 },
      { category: "Paid help", kind: "direct", cents: 120_000 },
      { category: "Software and tools", kind: "overhead", cents: 60_000 },
      { category: "Fees and admin", kind: "overhead", cents: 30_000 },
    ],
    settings: { hours: 4.62, rate: 5000, low: 2, high: 3, share: true },
  },
];

export function seedHistory(store: Store) {
  const db = store.db;
  let added = 0;
  for (const plan of PLANS) {
    const b = db.prepare("SELECT id FROM businesses WHERE slug = ?").get(plan.slug) as
      | { id: string }
      | undefined;
    if (!b) continue;
    for (let i = plan.months; i >= 1; i--) {
      const m = addMonths(ym(), -i);
      if (
        db.prepare("SELECT 1 FROM seeded_periods WHERE business_id = ? AND yyyymm = ?").get(b.id, m)
      )
        continue;
      db.prepare(
        "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, ?)",
      ).run(b.id, m, plan.revenue, plan.note);
      for (const c of plan.costs) {
        db.prepare(
          "INSERT INTO costs (id, business_id, yyyymm, category, kind, amount_cents, recurring, note, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, '', 'seeded', ?)",
        ).run(randomUUID(), b.id, m, c.category, c.kind, c.cents, new Date().toISOString());
      }
      added++;
    }
    if (
      plan.settings &&
      !db.prepare("SELECT 1 FROM value_settings WHERE business_id = ?").get(b.id)
    ) {
      const s = plan.settings;
      db.prepare(
        "INSERT INTO value_settings (business_id, founder_hours_week, hourly_rate_cents, multiple_low, multiple_high, share_numbers, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(b.id, s.hours, s.rate, s.low, s.high, s.share ? 1 : 0, new Date().toISOString());
    }
  }
  return added;
}
