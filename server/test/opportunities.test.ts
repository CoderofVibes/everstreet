// Job 005a: published requests as opportunities, and a request becoming a private product
// project. Fictional people and businesses; everything through the real API.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { interpret } from "../src/community.ts";
import { openDb } from "../src/db.ts";
import { classifyNeed } from "../src/opportunities.ts";
import { Store } from "../src/store.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

function world() {
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, { localPreview: true, environment: "test" });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const { person } = (await res.json()) as Json;
    const call = as((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "");
    return Object.assign(call, { id: person.id as string });
  };
  const count = (t: string) =>
    (store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const transfer = (businessId: string, from: string, to: string) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  return { store, join, anon: as(""), count, transfer };
}

type Caller = Awaited<ReturnType<ReturnType<typeof world>["join"]>>;

/** A published digital business (fictional): turns invoices into data for accounting tools. */
async function ledgerline(mara: Caller) {
  const p = (await mara("/api/projects", "POST", { route: "started", name: "Ledgerline Labs" }))
    .body;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Small accounting teams",
    outcome: "Invoices turned into clean data for your accounting tool",
    deliverable: "An API that reads invoice PDFs and returns JSON",
    price: "$40",
    when: "Any time",
    where: "Online",
    capacity: "100",
    confirmed: true,
  });
  await mara(`/api/businesses/${p.business.id}`, "PATCH", { family: "software" });
  await mara(`/api/businesses/${p.business.id}/publish`, "POST");
  return p.business.id as string;
}

async function post(
  who: Caller,
  text: string,
  extra: { allow_replies?: boolean; constraints?: Json } = {},
) {
  const r = await who("/api/needs", "POST", {
    text,
    constraints: extra.constraints ?? { family: "software", max_price_cents: 5000, online: true },
    allow_replies: extra.allow_replies ?? true,
    days: 14,
  });
  expect(r.status).toBe(201);
  // Posts in one millisecond tie on created_at, so find this one by its text.
  return r.body.needs.find((n: Json) => n.text === text).id as string;
}

const NEED =
  "An AI tool that reads supplier invoices and sends the totals to my accounting app, under $50 a month";

const create = (who: Caller, needId: string, body: Json) =>
  who(`/api/opportunities/${needId}/projects`, "POST", body);

const input = (over: Json = {}) => ({
  idempotency_key: "need-project-0001",
  idea: "Read supplier invoice PDFs and push totals into the accounting app",
  foundation: "ai_api",
  name: "Invoice relay",
  ...over,
});

describe("005a the opportunities board", () => {
  it("shows open requests with constraints, expiry, reply availability and a visible guess, never who posted", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const needId = await post(noah, NEED);
    const quiet = await post(noah, "A website that lists my workshop dates online", {
      allow_replies: false,
      constraints: {},
    });
    const r = await w.anon("/api/opportunities");
    expect(r.status).toBe(200);
    const o = r.body.opportunities.find((x: Json) => x.id === needId);
    expect(o).toMatchObject({
      text: NEED,
      constraints: { family: "software", max_price_cents: 5000, online: true },
      allow_replies: true,
      responses: 0,
      classification: { kind: "ai_tool", basis: ["ai"], suggested_foundation: "ai_api" },
      matches: [],
    });
    expect(o.classification.note).toMatch(/not an AI judgement/);
    expect(o.expires_at).toBeTruthy();
    expect(r.body.opportunities.find((x: Json) => x.id === quiet)).toMatchObject({
      allow_replies: false,
      classification: { kind: "website" },
    });
    expect(r.body.note).toMatch(/isn't a commitment, a customer or verified demand/);
    expect(r.text).not.toContain(noah.id);
    expect(r.text).not.toContain("Noah");
  });

  it("explains a match only by words shared with the viewer's own businesses", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    await ledgerline(mara);
    const needId = await post(noah, NEED);
    const forMara = (await mara("/api/opportunities")).body.opportunities.find(
      (x: Json) => x.id === needId,
    );
    expect(forMara.matches).toEqual([
      expect.objectContaining({ name: "Ledgerline Labs", published: true }),
    ]);
    expect(forMara.matches[0].words).toEqual(expect.arrayContaining(["invoice", "accounting"]));
    // Another founder sees no match through Mara's business.
    const forAna = (await ana("/api/opportunities")).body.opportunities.find(
      (x: Json) => x.id === needId,
    );
    expect(forAna.matches).toEqual([]);
  });
});

describe("005a a request becomes a private product project", () => {
  it("creates once, opens in the studio with provenance, contacts nobody and adds no reply", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    const anaBiz = await ledgerline(ana);
    const needId = await post(noah, NEED);
    // Another founder replied before; that reply is never copied.
    await ana(`/api/needs/${needId}/respond`, "POST", {
      business_id: anaBiz,
      message: "PRIVATE-REPLY-TEXT we can do this for $45",
    });
    const before = { businesses: w.count("businesses"), responses: w.count("need_responses") };
    const r = await create(mara, needId, input());
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    const v = r.body.view;
    expect(v.project).toMatchObject({ idea: input().idea, foundation: "ai_api" });
    expect(v.head.brief.problem).toBe(input().idea);
    // The stated limit isn't turned into a product price.
    expect(v.head.brief.price).toMatchObject({ model: "undecided", amount_cents: null });
    expect(v.head.note).toMatch(/inspired by a publicly shared request/);
    expect(v.source).toMatchObject({
      kind: "public_request",
      label: "Inspiration from a publicly shared request",
      state: "open",
      need_id: needId,
      can_reply: true,
      snapshot: {
        text: NEED,
        constraints: { max_price_cents: 5000 },
        replies_allowed: true,
      },
    });
    expect(v.source.notes.join(" ")).toMatch(/didn't contact the person/);
    expect(v.source.notes.join(" ")).toMatch(/not a product price/);
    expect(v.business.published_at).toBeNull(); // a new private business
    expect(w.count("businesses")).toBe(before.businesses + 1);
    expect(w.count("need_responses")).toBe(before.responses);
    expect((await w.anon("/api/opportunities")).body.opportunities[0].responses).toBe(1);
    // Nothing private crosses over: no requester identity, no other founder's reply.
    const text = JSON.stringify(v);
    expect(text).not.toContain(noah.id);
    expect(text).not.toContain("Noah");
    expect(text).not.toContain("PRIVATE-REPLY-TEXT");
    // Reopened later: same provenance, the normal studio view.
    const again = await mara(`/api/product-projects/${v.project.id}`);
    expect(again.status).toBe(200);
    expect(again.body.source.snapshot.text).toBe(NEED);
    expect((await mara("/api/product-projects")).body.projects).toHaveLength(1);
    // The requester's own view of their need shows no new reply.
    const mine = (await noah("/api/activity")).body;
    expect(JSON.stringify(mine)).not.toContain("Invoice relay");
  });

  it("a lost response retried with the same key returns the same project; a different key makes another", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const needId = await post(noah, NEED);
    const first = await create(mara, needId, input());
    const retry = await create(mara, needId, input());
    expect([retry.status, retry.body.created]).toEqual([200, false]);
    expect(retry.body.view.project.id).toBe(first.body.view.project.id);
    expect(w.count("product_projects")).toBe(1);
    const mismatch = await create(mara, needId, input({ idea: "Something else entirely" }));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/already used for a different project/);
    expect(w.count("product_projects")).toBe(1);
    const second = await create(mara, needId, input({ idempotency_key: "need-project-0002" }));
    expect(second.status).toBe(201);
    expect(second.body.view.project.id).not.toBe(first.body.view.project.id);
    expect(w.count("product_projects")).toBe(2);
  });

  it("refuses invalid and oversize input, creating nothing", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const needId = await post(noah, NEED);
    const cases: [Json, RegExp][] = [
      [input({ idempotency_key: "short" }), /idempotency_key/],
      [input({ idempotency_key: "has spaces in it" }), /idempotency_key/],
      [input({ idea: "x".repeat(2001) }), /too long/],
      [input({ idea: "ab" }), /sentence/],
      [input({ idea: 42 }), /must be text/],
      [input({ foundation: "mobile_game" }), /Choose what kind/],
      [input({ name: "n".repeat(81) }), /too long/],
    ];
    for (const [body, why] of cases) {
      const r = await create(mara, needId, body);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(why);
    }
    expect(w.count("product_projects")).toBe(0);
    expect((await w.anon(`/api/opportunities/${needId}/projects`, "POST", input())).status).toBe(
      401,
    );
  });

  it("a request that closed, expired or was removed before Create is reported truthfully", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const closed = await post(noah, NEED);
    const expired = await post(noah, "A SaaS dashboard for tracking client renewals");
    const removed = await post(noah, "An API that converts timesheets to invoices");
    await noah(`/api/needs/${closed}/close`, "POST");
    w.store.db
      .prepare("UPDATE needs SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), expired);
    w.store.db.prepare("DELETE FROM needs WHERE id = ?").run(removed);
    const c = await create(mara, closed, input());
    expect([c.status, c.body.error]).toEqual([409, expect.stringMatching(/has closed it/)]);
    const e = await create(mara, expired, input({ idempotency_key: "need-project-0003" }));
    expect([e.status, e.body.error]).toEqual([409, expect.stringMatching(/expired/)]);
    const g = await create(mara, removed, input({ idempotency_key: "need-project-0004" }));
    expect([g.status, g.body.error]).toEqual([404, expect.stringMatching(/no longer available/)]);
    expect((await mara("/api/opportunities/missing-id")).status).toBe(404);
    expect((await mara(`/api/opportunities/${closed}`)).status).toBe(404);
    expect(w.count("product_projects")).toBe(0);
    expect(w.count("businesses")).toBe(0);
  });

  it("a destination business must be the caller's; their own works and gets the project", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    const anaBiz = await ledgerline(ana);
    const maraBiz = await ledgerline(mara);
    const needId = await post(noah, NEED);
    const r = await create(mara, needId, input({ business_id: anaBiz }));
    expect(r.status).toBe(404);
    expect(w.count("product_projects")).toBe(0);
    const ok = await create(mara, needId, input({ business_id: maraBiz }));
    expect(ok.status).toBe(201);
    expect(ok.body.view.business.id).toBe(maraBiz);
  });

  it("a no-replies request still allows private ideation, with contacting disabled", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const maraBiz = await ledgerline(mara);
    const needId = await post(noah, NEED, { allow_replies: false });
    const r = await create(mara, needId, input());
    expect(r.status).toBe(201);
    expect(r.body.view.source).toMatchObject({
      state: "open",
      can_reply: false,
      snapshot: { replies_allowed: false },
    });
    const reply = await mara(`/api/needs/${needId}/respond`, "POST", {
      business_id: maraBiz,
      message: "Hello",
    });
    expect(reply.status).toBe(409);
  });

  it("the snapshot stays after the request closes; a removed request shows as unavailable, without its id", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const needId = await post(noah, NEED);
    const id = (await create(mara, needId, input())).body.view.project.id;
    await noah(`/api/needs/${needId}/close`, "POST");
    let s = (await mara(`/api/product-projects/${id}`)).body.source;
    expect(s).toMatchObject({ state: "closed", need_id: null, can_reply: false });
    expect(s.snapshot.text).toBe(NEED);
    w.store.db.prepare("DELETE FROM needs WHERE id = ?").run(needId);
    s = (await mara(`/api/product-projects/${id}`)).body.source;
    expect(s).toMatchObject({ state: "unavailable", need_id: null, can_reply: false });
  });
});

describe("005a projects follow business control", () => {
  it("after a sale the buyer has the project and its source; the former owner's replay is refused", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    const needId = await post(noah, NEED);
    const v = (await create(mara, needId, input())).body.view;
    w.transfer(v.business.id, mara.id, ana.id);
    const replay = await create(mara, needId, input());
    expect(replay.status).toBe(404);
    expect((await mara(`/api/product-projects/${v.project.id}`)).status).toBe(404);
    const theirs = await ana(`/api/product-projects/${v.project.id}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.source.snapshot.text).toBe(NEED);
    expect(w.count("product_projects")).toBe(1);
    // Request keys belong to the person who used them: the buyer's own key is independent.
    const own = await create(ana, needId, input());
    expect(own.status).toBe(201);
    expect(own.body.view.project.id).not.toBe(v.project.id);
  });

  it("another person can't read a founder's project, and the board shows nothing about it", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    const needId = await post(noah, NEED);
    const v = (await create(mara, needId, input())).body.view;
    expect((await ana(`/api/product-projects/${v.project.id}`)).status).toBe(404);
    expect((await noah(`/api/product-projects/${v.project.id}`)).status).toBe(404);
    const board = (await w.anon("/api/opportunities")).text;
    expect(board).not.toContain(v.project.id);
    expect(board).not.toContain(v.business.id);
    expect(board).not.toContain("Invoice relay");
  });
});

describe("005a digital search vocabulary, with legacy behaviour kept", () => {
  it("reads digital requests as software, and still reads a class as a class", () => {
    expect(interpret("an AI agent that triages support email under $50").constraints).toEqual({
      family: "software",
      max_price_cents: 5000,
    });
    for (const q of [
      "a SaaS dashboard for client renewals",
      "a website for my bakery",
      "an api for invoice data",
      "a NEAR wallet login for my members",
      "AI that summarizes meeting notes",
    ])
      expect(interpret(q).constraints.family).toBe("software");
    expect(interpret("A beginner printmaking class under $40, online")).toEqual({
      words: ["beginner", "printmaking", "class"],
      constraints: { family: "class", max_price_cents: 4000, online: true },
    });
    expect(interpret("someone to fix my bike").constraints.family).toBe("service");
  });

  it("classifies requests by the kind of digital product, showing the words used", () => {
    expect(classifyNeed("A NEAR app to sell digital passes")).toMatchObject({
      kind: "near_app",
      basis: ["near", "app"].filter((w) => w === "near"),
    });
    expect(classifyNeed("An agent that triages support email").kind).toBe("agent");
    expect(classifyNeed("Webhook integration between two tools").kind).toBe("api");
    expect(classifyNeed("Someone to fix my bike").kind).toBe("other");
  });

  it("the search finds a published digital business from digital words", async () => {
    const w = world();
    const mara = await w.join("Mara Solis");
    await ledgerline(mara);
    const r = (await w.anon("/api/public/search?q=invoice%20api%20for%20accounting&interpret=1"))
      .body;
    expect(r.constraints.family).toBe("software");
    expect(r.matches.map((b: Json) => b.name)).toEqual(["Ledgerline Labs"]);
  });
});
