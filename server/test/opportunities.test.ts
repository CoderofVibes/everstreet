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

// ---------- 005a1: a strict constraint boundary and structured refusals ----------

const FICTIONAL_CONTACT = "fictional@example.invalid";

/** A row as an older version could have stored it (synthetic, fictional). */
function legacyNeed(w: ReturnType<typeof world>, personId: string, constraints: string) {
  const id = `legacy-${Math.random().toString(36).slice(2, 10)}`;
  w.store.db
    .prepare(
      "INSERT INTO needs (id, person_id, text, constraints, allow_replies, status, expires_at, created_at) VALUES (?, ?, ?, ?, 1, 'open', ?, ?)",
    )
    .run(
      id,
      personId,
      "An API that turns timesheets into invoices",
      constraints,
      new Date(Date.now() + 7 * 864e5).toISOString(),
      new Date().toISOString(),
    );
  return id;
}

describe("005a1 new requests accept only well-formed, allowed constraints", () => {
  it("refuses wrong shapes, unknown keys and unsafe amounts with a useful 400, storing nothing", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const bad: [unknown, RegExp][] = [
      [5, /must be an object/],
      ["software", /must be an object/],
      [["software"], /must be an object/],
      [{ family: { nested: "software" } }, /family must be one of/],
      [{ family: "consulting" }, /family must be one of/],
      [{ family: "s".repeat(10_000) }, /family must be one of/],
      [{ contact: FICTIONAL_CONTACT }, /Unknown constraint "contact"/],
      [{ ["k".repeat(10_000)]: 1 }, /Unknown constraint/],
      [{ max_price_cents: -1 }, /whole number of cents/],
      [{ max_price_cents: 12.5 }, /whole number of cents/],
      [{ max_price_cents: 2 ** 53 }, /whole number of cents/],
      [{ max_price_cents: 1e12 }, /whole number of cents/],
      [{ max_price_cents: "5000" }, /whole number of cents/],
      [{ online: "yes" }, /online must be true or false/],
      [{ confirmed_only: 1 }, /confirmed_only must be true or false/],
    ];
    for (const [constraints, why] of bad) {
      const r = await noah("/api/needs", "POST", { text: NEED, constraints, days: 14 });
      expect(r.status, JSON.stringify(constraints).slice(0, 60)).toBe(400);
      expect(r.body).toMatchObject({ code: "invalid_constraints" });
      expect(r.body.error).toMatch(why);
      expect(r.body.error.length).toBeLessThan(200); // a huge key isn't echoed back
    }
    expect(w.count("needs")).toBe(0);
  });

  it("stores a zero limit, a normal limit and the flags exactly; no constraints is fine too", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const zero = await post(noah, "Free help wanted with a website for my reading group", {
      constraints: { max_price_cents: 0 },
    });
    const full = await post(noah, NEED, {
      constraints: {
        family: "software",
        max_price_cents: 5000,
        online: true,
        confirmed_only: true,
      },
    });
    const none = await post(noah, "Anything that sends my newsletter automatically", {
      constraints: {},
    });
    const off = await post(noah, "A dashboard for my client renewals, any format", {
      constraints: { online: false },
    });
    const stored = (id: string) =>
      (
        w.store.db.prepare("SELECT constraints FROM needs WHERE id = ?").get(id) as {
          constraints: string;
        }
      ).constraints;
    expect(JSON.parse(stored(zero))).toEqual({ max_price_cents: 0 });
    expect(JSON.parse(stored(full))).toEqual({
      family: "software",
      max_price_cents: 5000,
      online: true,
      confirmed_only: true,
    });
    expect(JSON.parse(stored(none))).toEqual({});
    expect(JSON.parse(stored(off))).toEqual({});
    const board = (await w.anon("/api/opportunities")).body.opportunities;
    expect(board.find((o: Json) => o.id === zero)).toMatchObject({
      constraints: { max_price_cents: 0 },
      constraints_unreadable: [],
    });
  });
});

describe("005a1 stored rows are projected through the same boundary", () => {
  it("an older malformed row shows only allowed fields, names what can't be read, and never leaks extras", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const payload = "x".repeat(10_000);
    const id = legacyNeed(
      w,
      noah.id,
      JSON.stringify({
        family: "software",
        max_price_cents: -500,
        online: "yes",
        contact: FICTIONAL_CONTACT,
        payload,
      }),
    );
    const board = await w.anon("/api/opportunities");
    expect(board.status).toBe(200);
    const o = board.body.opportunities.find((x: Json) => x.id === id);
    expect(o.constraints).toEqual({ family: "software" });
    expect(o.constraints_unreadable).toEqual(["max_price_cents", "online", "other"]);
    expect(board.text).not.toContain(FICTIONAL_CONTACT);
    expect(board.text).not.toContain(payload.slice(0, 100));
    const review = await mara(`/api/opportunities/${id}`);
    expect(review.body.constraints).toEqual({ family: "software" });
    expect(review.text).not.toContain(FICTIONAL_CONTACT);
    // A project from it keeps only the allowed fields, and says which couldn't be read.
    const made = await create(mara, id, input());
    expect(made.status).toBe(201);
    expect(made.body.view.source.snapshot).toMatchObject({
      constraints: { family: "software" },
      constraints_unreadable: ["max_price_cents", "online", "other"],
    });
    expect(made.body.view.source.snapshot.constraints.max_price_cents).toBeUndefined(); // not met, not zero
    const row = w.store.db
      .prepare("SELECT constraints FROM project_sources WHERE project_id = ?")
      .get(made.body.view.project.id) as { constraints: string };
    expect(row.constraints).toBe('{"family":"software"}');
    expect(JSON.stringify(made.body)).not.toContain(FICTIONAL_CONTACT);
    // The poster's own view of it works too.
    const activity = await noah("/api/activity");
    expect(activity.status).toBe(200);
    expect(activity.text).not.toContain(payload.slice(0, 100));
  });

  it("an unparseable row, or a non-object, doesn't crash the board, the review or the poster's view", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const broken = legacyNeed(w, noah.id, "{not json");
    const list = legacyNeed(w, noah.id, '["software"]');
    const board = await w.anon("/api/opportunities");
    expect(board.status).toBe(200);
    for (const id of [broken, list])
      expect(board.body.opportunities.find((x: Json) => x.id === id)).toMatchObject({
        constraints: {},
        constraints_unreadable: ["other"],
      });
    expect((await mara(`/api/opportunities/${broken}`)).status).toBe(200);
    expect((await noah("/api/activity")).status).toBe(200);
    expect((await create(mara, broken, input())).status).toBe(201);
  });

  it("a project snapshot captured by 005a with extra fields is cleaned when shown", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const needId = await post(noah, NEED);
    const v = (await create(mara, needId, input())).body.view;
    // Simulate a row written before this boundary: the raw constraints copied verbatim.
    w.store.db.prepare("UPDATE project_sources SET constraints = ? WHERE project_id = ?").run(
      JSON.stringify({
        max_price_cents: 5000,
        contact: FICTIONAL_CONTACT,
        payload: "y".repeat(5000),
      }),
      v.project.id,
    );
    const shown = await mara(`/api/product-projects/${v.project.id}`);
    expect(shown.body.source.snapshot.constraints).toEqual({ max_price_cents: 5000 });
    expect(shown.body.source.snapshot.constraints_unreadable).toEqual(["other"]);
    expect(shown.text).not.toContain(FICTIONAL_CONTACT);
  });
});

describe("005a1 refusals carry a stable code", () => {
  it("closed, expired, removed and a reused key each say why by code; a committed retry still works after closure", async () => {
    const w = world();
    const noah = await w.join("Noah Fenn");
    const mara = await w.join("Mara Solis");
    const a = await post(noah, NEED);
    const b = await post(noah, "A SaaS dashboard for tracking client renewals");
    const gone = await post(noah, "An API that converts timesheets to invoices");
    const first = await create(mara, a, input());
    expect(first.status).toBe(201);
    await noah(`/api/needs/${a}/close`, "POST");
    // The server already made this one: the same key and input still return it.
    const retry = await create(mara, a, input());
    expect([retry.status, retry.body.created]).toEqual([200, false]);
    expect(retry.body.view.project.id).toBe(first.body.view.project.id);
    expect((await create(mara, a, input({ idempotency_key: "need-project-0010" }))).body.code).toBe(
      "request_closed",
    );
    w.store.db
      .prepare("UPDATE needs SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), b);
    expect((await create(mara, b, input({ idempotency_key: "need-project-0011" }))).body.code).toBe(
      "request_expired",
    );
    w.store.db.prepare("DELETE FROM needs WHERE id = ?").run(gone);
    expect(
      (await create(mara, gone, input({ idempotency_key: "need-project-0012" }))).body.code,
    ).toBe("request_removed");
    expect((await create(mara, a, input({ idea: "Different idea now" }))).body.code).toBe(
      "key_reused",
    );
    expect((await mara(`/api/opportunities/${a}`)).body.code).toBe("request_unavailable");
    expect(w.count("product_projects")).toBe(1);
    expect(w.count("need_responses")).toBe(0);
  });
});
