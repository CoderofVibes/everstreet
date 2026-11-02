// Job 003p: evidence stays within the seller's disclosure choices. Astra's reproduction
// (docs/astra/reports/2026-11-02_evidence-access-review.md) as regressions: a read that started
// under a grant must not return private evidence if the grant ends or changes before it
// finishes. Fictional people, an in-memory database and the FakeChain double; monthly reads are
// held on a gate while access changes. Unit evidence only.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { termsHash } from "../src/deals.ts";
import { count, fundedDeal, gate, type Json, world } from "./deal-world.ts";

type W = ReturnType<typeof world>;
type Call = Awaited<ReturnType<W["join"]>>;

/** A business with payments on NEAR, listed privately to a team that was granted `categories`. */
async function grantedRoom(categories: string[] = ["financials", "costs", "operations"]) {
  const w = world();
  const mara = await w.join("Mara Solis");
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  const id = p.business.id as string;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults new to printmaking",
    outcome: "Three linocut prints",
    deliverable: "90 minutes",
    price: "$35",
    when: "Saturdays",
    where: "14 Alder Lane",
    capacity: "6",
    confirmed: true,
  });
  await mara(`/api/businesses/${id}`, "PATCH", { family: "class" });
  await mara(`/api/businesses/${id}/publish`, "POST");
  await mara(`/api/businesses/${id}/payments/activate`, "POST", {
    refund_hours: 24,
    reserve_cents: 0,
  });
  const ana = await w.join("Ana Ruiz");
  const ben = await w.join("Ben Okafor");
  const coop = (
    await ana("/api/acquire/buyers", "POST", {
      name: "Alder Lane Makers Co-op",
      kind: "cooperative",
      intent: "team",
    })
  ).body.buyer.id as string;
  await ana(`/api/acquire/buyers/${coop}/members`, "POST", { person_id: ben.id, role: "evidence" });
  await mara(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] });
  const listing = (await ana("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
    .listing_id as string;
  const ask = async (cats: string[]) => {
    const req = (
      await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
        buyer_id: coop,
        categories: cats,
        purpose: "Could our co-op keep these classes running?",
        days: 7,
      })
    ).body.request.id as string;
    expect(
      (await mara(`/api/acquire/requests/${req}/decide`, "POST", { action: "grant" })).status,
    ).toBe(200);
    return req;
  };
  const req = await ask(categories);
  return { ...w, mara, ana, ben, id, coop, listing, req, ask };
}
type R = Awaited<ReturnType<typeof grantedRoom>>;

/** The four evidence reads Astra reproduced, as the buyer's calls. */
const READS = {
  room: (s: R, who: Call) => who(`/api/acquire/rooms/${s.req}`),
  export: (s: R, who: Call) => who(`/api/acquire/rooms/${s.req}/export`),
  try: (s: R, who: Call) =>
    who(`/api/acquire/rooms/${s.req}/try`, "POST", { overrides: { multiple_low: 1 } }),
  save: (s: R, who: Call) =>
    who(`/api/acquire/rooms/${s.req}/scenarios`, "POST", {
      name: "Cautious",
      overrides: { multiple_low: 1 },
    }),
} as const;
type Read = keyof typeof READS;

/** Starts `read`, holds it inside its monthly reads, runs `change`, then lets it finish. */
async function inFlight(s: R, read: Read, change: () => Promise<unknown> | unknown, who?: Call) {
  const g = gate();
  s.chain.periodEntered = gate();
  s.chain.periodGate = g.opened;
  const pending = READS[read](s, who ?? s.ana);
  await s.chain.periodEntered.opened;
  await change();
  s.chain.periodGate = null;
  g.open();
  return pending;
}

const leaked = (body: Json) =>
  ["financials", "costs", "operations", "customers", "base", "scenario", "scenarios"].filter(
    (k) => k in body,
  );
const scenarios = (s: R) =>
  count(s, "SELECT COUNT(*) AS n FROM buyer_scenarios WHERE buyer_id = ?", s.coop);
const sql = (s: Pick<R, "store">, q: string, ...args: string[]) =>
  s.store.db.prepare(q).run(...args);

describe("a grant that ends while a read is in flight returns nothing private", () => {
  for (const read of Object.keys(READS) as Read[]) {
    it(`${read}: revoked mid-read → 403, no evidence`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(s, read, () =>
        s.mara(`/api/acquire/requests/${s.req}/revoke`, "POST"),
      );
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/ended this access/);
      expect(leaked(r.body)).toEqual([]);
      expect(scenarios(s)).toBe(0);
    });

    it(`${read}: expired mid-read → 403`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(s, read, () =>
        sql(
          s,
          "UPDATE access_requests SET expires_at = ? WHERE id = ?",
          "2000-01-01T00:00:00.000Z",
          s.req,
        ),
      );
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/This access ended/);
      expect(leaked(r.body)).toEqual([]);
      expect(scenarios(s)).toBe(0);
    });

    it(`${read}: narrowed mid-read (same request, fewer kinds) → 403`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(s, read, () =>
        sql(
          s,
          `UPDATE access_requests SET granted = '["costs"]', access_version = access_version + 1 WHERE id = ?`,
          s.req,
        ),
      );
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/Access changed while this was loading/);
      expect(leaked(r.body)).toEqual([]);
    });

    it(`${read}: revoked and re-granted identically mid-read → still refused (version fence)`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(s, read, () =>
        // Two decisions that leave every visible field as it was; only the version moved.
        sql(
          s,
          "UPDATE access_requests SET access_version = access_version + 2 WHERE id = ?",
          s.req,
        ),
      );
      expect(r.status).toBe(403);
      expect(leaked(r.body)).toEqual([]);
    });

    it(`${read}: the reader leaves the team mid-read → refused`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(
        s,
        read,
        () =>
          sql(
            s,
            "DELETE FROM buyer_members WHERE buyer_id = ? AND person_id = ?",
            s.coop,
            s.ben.id,
          ),
        s.ben,
      );
      expect([403, 404]).toContain(r.status);
      expect(leaked(r.body)).toEqual([]);
    });

    it(`${read}: the reader's role drops below evidence mid-read → 403`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(
        s,
        read,
        () =>
          sql(
            s,
            "UPDATE buyer_members SET role = 'research' WHERE buyer_id = ? AND person_id = ?",
            s.coop,
            s.ben.id,
          ),
        s.ben,
      );
      expect(r.status).toBe(403);
      expect(leaked(r.body)).toEqual([]);
    });

    it(`${read}: the business changes hands mid-read → 403`, async () => {
      const s = await grantedRoom();
      const r = await inFlight(s, read, () =>
        sql(s, "UPDATE businesses SET owner_id = ? WHERE id = ?", s.ana.id, s.id),
      );
      expect(r.status).toBe(403);
      expect(leaked(r.body)).toEqual([]);
    });
  }

  it("controls: with nothing changed, the same held reads succeed", async () => {
    const s = await grantedRoom();
    for (const read of Object.keys(READS) as Read[]) {
      const r = await inFlight(s, read, () => undefined);
      expect([read, r.status]).toEqual([read, 200]);
    }
    expect(scenarios(s)).toBe(1);
  });

  it("concurrent reads by two team members are all refused after one revocation", async () => {
    const s = await grantedRoom();
    const g = gate();
    s.chain.periodEntered = gate();
    s.chain.periodGate = g.opened;
    const all = Promise.all([
      READS.room(s, s.ana),
      READS.export(s, s.ben),
      READS.try(s, s.ana),
      READS.save(s, s.ben),
    ]);
    await s.chain.periodEntered.opened;
    await s.mara(`/api/acquire/requests/${s.req}/revoke`, "POST");
    s.chain.periodGate = null;
    g.open();
    const out = await all;
    expect(out.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(out.flatMap((r) => leaked(r.body))).toEqual([]);
    expect(scenarios(s)).toBe(0);
  });

  it("sequential: after revocation every read is refused; a fresh narrower grant shows only that", async () => {
    const s = await grantedRoom(["financials"]);
    await s.mara(`/api/acquire/requests/${s.req}/revoke`, "POST");
    for (const read of Object.keys(READS) as Read[])
      expect((await READS[read](s, s.ana)).status).toBe(403);
    const narrower = await s.ask(["costs"]);
    const room = (await s.ana(`/api/acquire/rooms/${narrower}`)).body;
    expect(Object.keys(room)).toContain("costs");
    expect(room.financials).toBeUndefined();
    // Scenarios need financials, on the new grant too.
    const t = await s.ana(`/api/acquire/rooms/${narrower}/try`, "POST", { overrides: {} });
    expect(t.status).toBe(403);
    const sv = await s.ana(`/api/acquire/rooms/${narrower}/scenarios`, "POST", { overrides: {} });
    expect(sv.status).toBe(403);
  });
});

describe("what each grant and listing shows", () => {
  it("saved scenarios keep the team's assumptions and range, not the seller's inputs", async () => {
    const s = await grantedRoom(["financials"]);
    expect((await READS.save(s, s.ana)).status).toBe(200);
    const row = s.store.db.prepare("SELECT result FROM buyer_scenarios").get() as {
      result: string;
    };
    expect(Object.keys(JSON.parse(row.result)).sort()).toEqual(["high_cents", "low_cents"]);
  });

  it("operations alone shows promises and what transfers, without balances", async () => {
    const s = await grantedRoom(["operations"]);
    const room = (await s.ana(`/api/acquire/rooms/${s.req}`)).body;
    expect(room.financials).toBeUndefined();
    expect(room.operations.treasury).toBeNull();
    expect(room.operations.promises.length).toBeGreaterThan(0);
    const held = room.operations.manifest.stays.find(
      (i: Json) => i.name === "Customer money held by the contract",
    );
    expect(held.detail).toBe("Amount shown with financials access");
    // Promises may state rules in dollars (the reserve); no balance appears anywhere else.
    expect(JSON.stringify({ ...room.operations, promises: [] })).not.toMatch(/\$\d/);
  });

  it("financials shows the contract's balances", async () => {
    const s = await grantedRoom(["financials"]);
    const room = (await s.ana(`/api/acquire/rooms/${s.req}`)).body;
    expect(room.financials.balances).toMatchObject({ source: expect.stringMatching(/NEAR/) });
  });

  it("a grant made under the earlier wording keeps its balances, and says so", async () => {
    const s = await grantedRoom(["operations"]);
    sql(s, "UPDATE access_requests SET scope_version = 1 WHERE id = ?", s.req);
    const room = (await s.ana(`/api/acquire/rooms/${s.req}`)).body;
    expect(room.operations.treasury).not.toBeNull();
    expect(room.scope_note).toMatch(/earlier wording/);
  });

  it("value-only listing: a range, no calculation, revenue and profit not shared", async () => {
    const s = await grantedRoom(["costs"]);
    await s.mara(`/api/businesses/${s.id}/listing`, "PATCH", { disclose: ["value"] });
    const c = (await s.ana(`/api/acquire/listings/${s.listing}?buyer_id=${s.coop}`)).body;
    expect(c.calculation).toBeNull();
    expect(c.candidate.revenue.status).toBe("not_shared");
    expect(c.candidate.profit.status).toBe("not_shared");
  });

  it("the calculation can't be shared while revenue or profit is withheld", async () => {
    const s = await grantedRoom(["costs"]);
    const r = await s.mara(`/api/businesses/${s.id}/listing`, "PATCH", {
      disclose: ["value", "calculation", "revenue"],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/calculation shows monthly revenue and operating profit/);
    const ok = await s.mara(`/api/businesses/${s.id}/listing`, "PATCH", {
      disclose: ["value", "calculation", "revenue", "profit"],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.listing.disclose_note).toBeNull();
  });

  it("a listing saved under the earlier wording is neither narrowed nor widened, and is labelled", async () => {
    const s = await grantedRoom(["costs"]);
    sql(
      s,
      `UPDATE listings SET disclose = '["value"]', disclose_version = 1 WHERE business_id = ?`,
      s.id,
    );
    const seller = (await s.mara(`/api/businesses/${s.id}/listing`)).body.listing;
    expect(seller.disclose_version).toBe(1);
    expect(seller.disclose).toEqual(["value", "calculation"]);
    expect(seller.disclose_note).toMatch(/earlier wording/);
    // What buyers see is what that wording promised: revenue and profit stay unshared.
    const c = (await s.ana(`/api/acquire/listings/${s.listing}?buyer_id=${s.coop}`)).body;
    expect(c.candidate.revenue.status).toBe("not_shared");
    // Saving something else keeps the old wording; choosing disclosures again applies the new.
    await s.mara(`/api/businesses/${s.id}/listing`, "PATCH", { reason: "Moving away" });
    expect((await s.mara(`/api/businesses/${s.id}/listing`)).body.listing.disclose_version).toBe(1);
  });

  it("no-store on evidence, scenarios, refusals and other API answers", async () => {
    const s = await grantedRoom(["financials"]);
    const answers = [
      await READS.room(s, s.ana),
      await READS.export(s, s.ana),
      await READS.try(s, s.ana),
      await READS.save(s, s.ana),
      await s.mara(`/api/businesses/${s.id}/books`),
      await s.mara(`/api/businesses/${s.id}/value`),
    ];
    await s.mara(`/api/acquire/requests/${s.req}/revoke`, "POST");
    answers.push(await READS.room(s, s.ana));
    expect(answers.at(-1)?.status).toBe(403);
    for (const a of answers) expect(a.headers.get("cache-control")).toBe("no-store");
  });
});

describe("anonymous listings sort without revealing order inside a band", () => {
  it("two asking prices in the same band keep listing order, whichever is higher", async () => {
    const w = world();
    const make = async (name: string, asking: number) => {
      const owner = await w.join(`${name} Owner`);
      const p = (await owner("/api/projects", "POST", { route: "started", name })).body;
      const id = p.business.id as string;
      await owner(`/api/projects/${p.id}/answers`, "PATCH", {
        audience: "Adults",
        outcome: "Prints",
        deliverable: "90 minutes",
        price: "$35",
        when: "Saturdays",
        where: "Online",
        capacity: "6",
        confirmed: true,
      });
      await owner(`/api/businesses/${id}/publish`, "POST");
      await owner(`/api/businesses/${id}/listing`, "PATCH", {
        mode: "anonymous",
        asking_cents: asking,
      });
      return id;
    };
    // Same band ($0–$25,000); the higher price is listed first.
    await make("Higher Studio", 2_000_000);
    await make("Lower Studio", 300_000);
    const viewer = await w.join("Ivy Park");
    const results = (await viewer("/api/acquire/search", "POST", { sort: "asking" })).body.results;
    expect(results.map((r: Json) => r.asking.text)).toEqual([
      expect.stringMatching(/band/),
      expect.stringMatching(/band/),
    ]);
    // Exact sorting would put the lower price first; band sorting leaves listing order.
    const order = results.map((r: Json) => r.listing_id);
    const listed = (
      w.store.db.prepare("SELECT id FROM listings ORDER BY rowid").all() as { id: string }[]
    ).map((r) => r.id);
    expect(order).toEqual(listed);
  });
});

describe("sale terms and evidence", () => {
  it("new terms carry no financial figures by default, only the obligations the buyer takes on", async () => {
    const s = await fundedDeal();
    const v = (await s.ana(`/api/deals/${s.deal.id}`)).body;
    expect(v.terms.format).toBe("everstreet-deal/2");
    expect(v.terms.evidence).toMatchObject({ included: false });
    expect(v.terms.obligations.customer_money).toBeTruthy();
    expect(JSON.stringify(v.terms)).not.toMatch(/revenue_month|profit_month/);
  });

  it("figures go in only when the seller chooses them and the team has financials access", async () => {
    const s = await fundedDeal(); // the team asked for financials; it was never granted
    const preview = (await s.mara(`/api/businesses/${s.id}/deals/snapshot?buyer_id=${s.coop}`))
      .body;
    expect(preview).toMatchObject({ allowed: false, figures: null });
    const refused = await s.mara(`/api/deals/${s.deal.id}/revise`, "POST", {
      price_cents: 310_000,
      snapshot: true,
    });
    expect(refused.status).toBe(409);
    // Grant financials, preview exactly what would go in, then include it.
    const req = s.store.db
      .prepare("SELECT id FROM access_requests WHERE buyer_id = ?")
      .get(s.coop) as {
      id: string;
    };
    await s.mara(`/api/acquire/requests/${req.id}/decide`, "POST", { action: "grant" });
    const shown = (await s.mara(`/api/businesses/${s.id}/deals/snapshot?buyer_id=${s.coop}`)).body;
    expect(shown.allowed).toBe(true);
    expect(shown.retention).toMatch(/does not recall these terms/);
    const v = (
      await s.mara(`/api/deals/${s.deal.id}/revise`, "POST", {
        price_cents: 310_000,
        snapshot: true,
      })
    ).body;
    expect(v.terms.evidence).toMatchObject({
      included: true,
      estimate: shown.figures.estimate,
      revenue_month: shown.figures.revenue_month,
      audience: shown.audience,
    });
    expect(v.changes).toContain(`Financial snapshot added: estimate ${shown.figures.estimate}`);
    // Ending access later doesn't touch the terms already written.
    const before = v.deal.terms_hash;
    await s.mara(`/api/acquire/requests/${req.id}/revoke`, "POST");
    const after = (await s.ana(`/api/deals/${s.deal.id}`)).body;
    expect(after.deal.terms_hash).toBe(before);
    expect(after.terms.evidence.included).toBe(true);
  });

  it("terms written before this change keep their exact bytes and hash", async () => {
    // A format-1 version as stored before job 003p (fictional values).
    const stored = JSON.stringify({
      format: "everstreet-deal/1",
      business: { name: "Juniper Print Studio", account: "juniper.fake" },
      seller: { name: "Mara Solis", account: "mara.fake" },
      buyer: {
        team: "Alder Lane Makers Co-op",
        kind: "cooperative",
        representative: "Ana Ruiz",
        account: "ana.fake",
      },
      network: "NEAR testnet",
      asset: "usdt.fake (test dollars, no value)",
      price_cents: 300000,
      expires_at: "2026-11-09T00:00:00.000Z",
      control: [],
      stays: [],
      separate: [],
      excluded: [],
      handover: "",
      conditions: "",
      evidence: {
        estimate: "$1,000–$2,000",
        basis: "Earnings-based",
        months: ["Oct 2026"],
        revenue_month: "$350",
        profit_month: "$120",
        customer_money: "$70",
        snapshot_at: "2026-11-01T00:00:00.000Z",
      },
    });
    const hash = createHash("sha256").update(stored).digest("hex");
    expect(termsHash(JSON.parse(stored))).toBe(hash);

    // A deal whose current version is such a format-1 row still reads and compares.
    const s = await fundedDeal();
    sql(
      s,
      "UPDATE deal_versions SET terms = ?, terms_hash = ? WHERE deal_id = ?",
      stored,
      hash,
      s.deal.id,
    );
    const v = (await s.ana(`/api/deals/${s.deal.id}`)).body;
    expect(v.deal.terms_hash).toBe(hash);
    expect(JSON.stringify(v.terms)).toBe(stored);
    const revised = (
      await s.mara(`/api/deals/${s.deal.id}/revise`, "POST", { price_cents: 300_000 })
    ).body;
    expect(revised.changes).toContain("Financial snapshot removed from the terms");
    const kept = s.store.db
      .prepare("SELECT terms, terms_hash FROM deal_versions WHERE deal_id = ? AND version = 1")
      .get(s.deal.id) as { terms: string; terms_hash: string };
    expect(kept).toEqual({ terms: stored, terms_hash: hash });
  });
});
