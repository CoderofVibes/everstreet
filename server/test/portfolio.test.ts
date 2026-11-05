// Job 005d: the portfolio through the real routes (local preview identities, fictional people).

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import type { Json } from "./deal-world.ts";

function world() {
  const store = new Store(openDb(":memory:"));
  const api = everstreetApi(store, { localPreview: true, environment: "test" });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await api.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
    };
  const join = async (name: string) => {
    const res = await api.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return Object.assign(as(cookie), { id: ((await res.json()) as Json).person.id as string });
  };
  const transfer = (businessId: string, from: string, to: string) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, tx, at) VALUES (?, ?, ?, ?, 'fixture-close', ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  /** A fixture listing of a business, shortlisted by a buyer team owned by `person`. */
  const shortlist = (businessId: string, person: string, mode: "named" | "anonymous") => {
    const t = new Date().toISOString();
    const listing = `listing-${businessId.slice(0, 8)}`;
    store.db
      .prepare(
        "INSERT INTO listings (id, business_id, mode, openness, listed_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)",
      )
      .run(listing, businessId, mode, t, t);
    const buyer = `buyer-${person.slice(0, 8)}`;
    store.db
      .prepare(
        "INSERT OR IGNORE INTO buyers (id, owner_id, name, kind, intent, created_at, updated_at) VALUES (?, ?, 'Fictional team', 'individual', 'operate', ?, ?)",
      )
      .run(buyer, person, t, t);
    store.db
      .prepare("INSERT INTO shortlist (buyer_id, listing_id, created_at) VALUES (?, ?, ?)")
      .run(buyer, listing, t);
  };
  return { store, join, transfer, shortlist };
}

const project = async (who: Awaited<ReturnType<ReturnType<typeof world>["join"]>>, idea: string) =>
  (await who("/api/product-projects", "POST", { idea, foundation: "ai_api" })).body.project
    .business_id as string;

describe("005d portfolio", () => {
  it("owned, considering (anonymous stays anonymous) and former; history only after passing a business on", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const noah = await w.join("Noah Brandt");
    const a = await project(ava, "Turn fictional supplier invoices into clean rows");
    const b = await project(ava, "Summarise fictional support tickets");
    const c = await project(ava, "Tag fictional receipts by category");
    w.shortlist(b, noah.id, "named");
    w.shortlist(c, noah.id, "anonymous");

    const p0 = (await ava("/api/me/portfolio")).body;
    expect(p0.owned.map((o: Json) => o.business.id).sort()).toEqual([a, b, c].sort());
    expect(p0.owned[0].control).toMatchObject({ how: "founded", receipt: null });
    expect(p0.owned[0].attention).toContain("Nothing released to customers yet");
    const n0 = (await noah("/api/me/portfolio")).body;
    expect(n0.considering).toHaveLength(2);
    const anon = n0.considering.find((x: Json) => x.listing.mode === "anonymous");
    expect(anon.business).toBeNull();
    expect(JSON.stringify(anon)).not.toContain(c);

    // Noah acquires A by a recorded close: owned (received) for him, history only for Ava.
    w.transfer(a, ava.id, noah.id);
    const n1 = (await noah("/api/me/portfolio")).body;
    expect(n1.owned.map((o: Json) => o.business.id)).toEqual([a]);
    expect(n1.owned[0].control).toMatchObject({
      how: "received_by_close",
      from: "Ava Chen",
      receipt: { tx: "fixture-close" },
    });
    const p1 = (await ava("/api/me/portfolio")).body;
    expect(p1.owned.map((o: Json) => o.business.id).sort()).toEqual([b, c].sort());
    expect(p1.former).toEqual([
      expect.objectContaining({
        business: { id: a, name: expect.any(String) },
        passed_on: expect.objectContaining({ to: "Noah Brandt" }),
      }),
    ]);
    // The former entry carries no figures, products or customer data.
    expect(Object.keys(p1.former[0]).sort()).toEqual([
      "business",
      "history_only",
      "label",
      "note",
      "note_version",
      "passed_on",
    ]);
    expect(JSON.stringify(p1)).toContain("no valuation");
  });

  it("private labels and notes: versioned, history kept, only for businesses in the portfolio", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Okoro");
    const a = await project(ava, "Turn fictional supplier invoices into clean rows");
    const s1 = await ava(`/api/me/portfolio/${a}/note`, "PUT", {
      label: "core",
      note: "Keep the release checks strict",
      version: 0,
    });
    expect(s1.body.owned[0]).toMatchObject({
      label: "core",
      note: "Keep the release checks strict",
      note_version: 1,
    });
    expect(
      (await ava(`/api/me/portfolio/${a}/note`, "PUT", { label: "watch", note: "x", version: 0 }))
        .status,
    ).toBe(409);
    await ava(`/api/me/portfolio/${a}/note`, "PUT", {
      label: "watch",
      note: "Second thoughts",
      version: 1,
    });
    expect(
      (
        w.store.db.prepare("SELECT COUNT(*) AS n FROM portfolio_note_history").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
    expect(() => w.store.db.prepare("DELETE FROM portfolio_note_history").run()).toThrow(
      /append-only/,
    );
    // Someone unrelated can't attach a note to it, and never sees Ava's.
    expect(
      (await ben(`/api/me/portfolio/${a}/note`, "PUT", { label: "core", note: "mine", version: 0 }))
        .status,
    ).toBe(404);
    expect(JSON.stringify((await ben("/api/me/portfolio")).body)).not.toContain("Second thoughts");
  });
});
