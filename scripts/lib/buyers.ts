// Fictional buyers and listings for the acquisition marketplace (Astra's Northline example).
// Paperfin is listed by name at $195,000; Small Hours Candles is an anonymous teaser; Juniper
// and Doorstep stay closed. Idempotent: anything already there is left alone.

import { randomUUID } from "node:crypto";
import type { Store } from "../../server/src/store.ts";

export function seedBuyers(store: Store) {
  const db = store.db;
  const at = new Date().toISOString();
  const personId = (name: string) => {
    const p = db.prepare("SELECT id FROM people WHERE display_name = ?").get(name) as
      | { id: string }
      | undefined;
    if (p) return p.id;
    const { person } = store.createPerson(name);
    return person.id;
  };
  const owen = personId("Owen Hart");
  store.updatePerson(owen, {
    headline: "Runs Northline Studio Tools",
    bio: "We build booking and billing tools for independent studios.",
  });
  const buyer = (
    name: string,
    owner: string,
    kind: string,
    intent: string,
    fields: Record<string, string>,
    members: [string, string][],
  ) => {
    const found = db.prepare("SELECT id FROM buyers WHERE name = ?").get(name) as
      | { id: string }
      | undefined;
    if (found) return found.id;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO buyers (id, owner_id, name, kind, intent, about, interests, time_available, skills, budget_basis, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      owner,
      name,
      kind,
      intent,
      fields.about ?? "",
      fields.interests ?? "",
      fields.time ?? "",
      fields.skills ?? "",
      fields.budget ?? "",
      at,
      at,
    );
    for (const [person, role] of members)
      db.prepare(
        "INSERT INTO buyer_members (buyer_id, person_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(id, person, role, at);
    return id;
  };
  const northline = buyer(
    "Northline Studio Tools",
    owen,
    "strategic",
    "add",
    {
      about:
        "A small software company serving independent studios. We'd keep what customers rely on and add it to our tools.",
      interests: "Software or services for independent studios; repeat customers; remote delivery",
      time: "One person, about 20 hours a week",
      skills: "API support, billing, studio onboarding",
      budget: "Company cash flow (fictional)",
    },
    [[personId("Sam Lee"), "research"]],
  );
  buyer(
    "Alder Lane Makers Co-op",
    personId("Ana Ruiz"),
    "cooperative",
    "team",
    {
      about:
        "Regulars of the Alder Lane studios, pooling interest in keeping a local class running if its founder ever moves on.",
      interests: "Local classes and workshops we already go to",
      time: "Eight members, a few hours each",
      skills: "Teaching, bookkeeping, running a waitlist",
      budget: "Interest only for now; no pooled money",
    },
    [[personId("Theo Park"), "evidence"]],
  );
  if (!db.prepare("SELECT 1 FROM mandates WHERE buyer_id = ?").get(northline))
    db.prepare(
      "INSERT INTO mandates (id, buyer_id, name, text, criteria, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      northline,
      "Studio tools",
      "Software or services for independent studios, remote, up to $200k asking",
      JSON.stringify({
        families: ["software", "service"],
        remote: true,
        max_asking_cents: 20_000_000,
      }),
      at,
      at,
    );
  const list = (slug: string, l: Record<string, unknown>) => {
    const b = db.prepare("SELECT id FROM businesses WHERE slug = ?").get(slug) as
      | { id: string }
      | undefined;
    if (!b || db.prepare("SELECT 1 FROM listings WHERE business_id = ?").get(b.id)) return;
    db.prepare(
      "INSERT INTO listings (id, business_id, mode, openness, asking_cents, reason, transition, disclose, listed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      b.id,
      l.mode as string,
      l.openness as string,
      (l.asking ?? null) as number | null,
      (l.reason ?? "") as string,
      (l.transition ?? "") as string,
      JSON.stringify(l.disclose),
      at,
      at,
    );
  };
  list("paperfin-api", {
    mode: "named",
    openness: "open",
    asking: 19_500_000,
    reason:
      "I want to go back to building new things. Paperfin deserves an owner who will grow it.",
    transition: "Four weeks of handover support, including the template library",
    disclose: ["revenue", "profit", "value", "founder_hours", "history"],
  });
  list("small-hours-candles", {
    mode: "anonymous",
    openness: "curious",
    disclose: ["revenue", "value", "history"],
  });
}
