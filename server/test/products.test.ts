// The product studio's promises: a founder's project and every saved revision survive reopening,
// history only grows (a restore is a new revision), a stale save never overwrites newer work,
// nobody but the business's current owner can read or change a project, malformed input is
// refused, and no build is ever claimed while no build provider is connected.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import type { BuildProvider } from "../src/build.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

function world(buildProvider?: BuildProvider) {
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, { localPreview: true, environment: "test", buildProvider });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown, raw?: string) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const me = (await res.json()) as { person: { id: string } };
    return Object.assign(as(cookie), { id: me.person.id });
  };
  return { store, join, anon: as("") };
}

type Actor = Awaited<ReturnType<ReturnType<typeof world>["join"]>>;

const IDEA = "An API that turns supplier invoices into clean data for small bookkeeping firms";

async function start(founder: Actor, extra: Record<string, unknown> = {}) {
  const res = await founder("/api/product-projects", "POST", {
    idea: IDEA,
    foundation: "ai_api",
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

// biome-ignore lint/suspicious/noExplicitAny: a studio view as the API returned it
function edited(view: Record<string, any>) {
  return {
    brief: {
      ...view.head.brief,
      name: "Ledgerline",
      audience: "Bookkeepers at firms with under ten staff (fictional)",
      promise: "Every invoice becomes a checked row in under a minute",
      features: ["Upload a PDF invoice", "Get vendor, total and due date back"],
      price: { model: "per_use", amount_cents: 25, note: "Prepaid packs of 100" },
    },
    prototype: view.head.prototype,
  };
}

describe("product studio", () => {
  it("creates a project on a new private business, with a starting revision and honest checks", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const view = await start(ava);

    expect(view.head.number).toBe(1);
    expect(view.head.brief).toMatchObject({ name: "Untitled product", problem: IDEA });
    expect(view.head.brief.features).toHaveLength(3);
    expect(view.starter).toEqual(["features"]);
    expect(view.head.prototype.screens.map((s: { kind: string }) => s.kind)).toEqual([
      "form",
      "model",
      "list",
    ]);
    expect(view.revisions).toHaveLength(1);
    expect(view.head.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // Linked to a business the founder owns, which shows up beside their other businesses.
    const desk = (await ava(`/api/businesses/${view.project.business_id}`)).body;
    expect(desk.business).toMatchObject({ family: "software", stage: "shape", published_at: null });
    expect((await ava("/api/projects")).body.projects).toHaveLength(1);
    expect((await ava("/api/product-projects")).body.projects[0]).toMatchObject({
      id: view.project.id,
      revision: 1,
      foundation: "ai_api",
    });

    // Checks separate what was checked from what cannot be yet.
    const todo = view.checks.deterministic.filter((c: { state: string }) => c.state === "todo");
    expect(todo.map((c: { id: string }) => c.id)).toEqual(["name", "audience", "promise", "price"]);
    expect(view.checks.model_evaluations.state).toBe("unavailable");
    expect(view.checks.journey_tests.state).toBe("unavailable");
    expect(view.continuity.promises[2].detail).toMatch(/no customers/);
    expect(
      view.continuity.dependencies.find((d: { label: string }) =>
        d.label.startsWith("Customer payments"),
      ).state,
    ).toBe("missing");
  });

  it("saves edits as new revisions, reopens them, and keeps every earlier revision intact", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    const id = v1.project.id;

    const saved = await ava(`/api/product-projects/${id}/revisions`, "POST", {
      base_revision: 1,
      note: "Named it and set a price",
      ...edited(v1),
    });
    expect(saved.status).toBe(201);
    expect(saved.body.created).toBe(true);
    expect(saved.body.head).toMatchObject({ number: 2, note: "Named it and set a price" });
    expect(saved.body.starter).toEqual([]);

    // Reopening restores exactly what was saved.
    const reopened = (await ava(`/api/product-projects/${id}`)).body;
    expect(reopened.head.brief).toEqual(saved.body.head.brief);
    expect(reopened.head.brief.price).toEqual({
      model: "per_use",
      amount_cents: 25,
      note: "Prepaid packs of 100",
    });
    expect(reopened.checks.passed).toBe(7);
    // The business made for the project takes the product's name.
    expect(reopened.business.name).toBe("Ledgerline");

    // Revision 1 is untouched.
    const r1 = (await ava(`/api/product-projects/${id}/revisions/1`)).body;
    expect(r1.brief.name).toBe("Untitled product");
    expect(r1.content_hash).toBe(v1.head.content_hash);

    // Saving the same content again is not a new revision.
    const again = await ava(`/api/product-projects/${id}/revisions`, "POST", {
      base_revision: 2,
      ...edited(v1),
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.revisions).toHaveLength(2);
  });

  it("refuses a save based on an older revision instead of overwriting newer work", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    const id = v1.project.id;
    await ava(`/api/product-projects/${id}/revisions`, "POST", { base_revision: 1, ...edited(v1) });

    const stale = await ava(`/api/product-projects/${id}/revisions`, "POST", {
      base_revision: 1,
      brief: { ...v1.head.brief, name: "Older tab" },
      prototype: v1.head.prototype,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/Revision 2 was saved after/);
    const now = (await ava(`/api/product-projects/${id}`)).body;
    expect(now.head.number).toBe(2);
    expect(now.head.brief.name).toBe("Ledgerline");
  });

  it("restores an old revision as a new one, so history only grows", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    const id = v1.project.id;
    await ava(`/api/product-projects/${id}/revisions`, "POST", { base_revision: 1, ...edited(v1) });

    const restored = await ava(`/api/product-projects/${id}/restore`, "POST", {
      revision: 1,
      base_revision: 2,
    });
    expect(restored.status).toBe(201);
    expect(restored.body.head).toMatchObject({
      number: 3,
      restored_from: 1,
      note: "Restored revision 1",
      content_hash: v1.head.content_hash,
    });
    expect(restored.body.revisions.map((r: { number: number }) => r.number)).toEqual([3, 2, 1]);
    expect((await ava(`/api/product-projects/${id}/revisions/2`)).body.brief.name).toBe(
      "Ledgerline",
    );
    expect(
      (await ava(`/api/product-projects/${id}/restore`, "POST", { revision: 9, base_revision: 3 }))
        .status,
    ).toBe(404);
  });

  it("keeps revisions immutable in the database itself", async () => {
    const { join, store } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    expect(() =>
      store.db
        .prepare("UPDATE product_revisions SET brief = '{}' WHERE project_id = ?")
        .run(v1.project.id),
    ).toThrow(/immutable/);
    expect(() =>
      store.db.prepare("DELETE FROM product_revisions WHERE project_id = ?").run(v1.project.id),
    ).toThrow(/immutable/);
  });

  it("lets nobody but the business's owner read, change, restore or attach to a project", async () => {
    const { join, anon } = world();
    const ava = await join("Ava Chen");
    const ben = await join("Ben Okafor");
    const v1 = await start(ava);
    const id = v1.project.id;

    expect((await ben(`/api/product-projects/${id}`)).status).toBe(404);
    expect((await ben(`/api/product-projects/${id}/revisions/1`)).status).toBe(404);
    expect(
      (
        await ben(`/api/product-projects/${id}/revisions`, "POST", {
          base_revision: 1,
          ...edited(v1),
        })
      ).status,
    ).toBe(404);
    expect(
      (await ben(`/api/product-projects/${id}/restore`, "POST", { revision: 1, base_revision: 1 }))
        .status,
    ).toBe(404);
    expect((await ben("/api/product-projects")).body.projects).toHaveLength(0);
    // Ben can't hang a project on Ava's business either.
    expect(
      (
        await ben("/api/product-projects", "POST", {
          idea: IDEA,
          foundation: "ai_api",
          business_id: v1.project.business_id,
        })
      ).status,
    ).toBe(404);
    expect((await anon(`/api/product-projects/${id}`)).status).toBe(401);
    expect(
      (await anon("/api/product-projects", "POST", { idea: IDEA, foundation: "ai_api" })).status,
    ).toBe(401);
    // Nothing Ben tried changed Ava's project.
    expect((await ava(`/api/product-projects/${id}`)).body.revisions).toHaveLength(1);
  });

  it("follows the business when it changes hands", async () => {
    const { join, store } = world();
    const ava = await join("Ava Chen");
    const ben = await join("Ben Okafor");
    const v1 = await start(ava);
    // What a closed deal does to ownership (server/src/deals.ts), applied directly here.
    store.db
      .prepare("UPDATE businesses SET owner_id = ? WHERE id = ?")
      .run(ben.id, v1.project.business_id);
    expect((await ava(`/api/product-projects/${v1.project.id}`)).status).toBe(404);
    const benView = await ben(`/api/product-projects/${v1.project.id}`);
    expect(benView.status).toBe(200);
    expect(benView.body.revisions).toHaveLength(1);
  });

  it("attaches a project to a business the founder already owns", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const first = await start(ava);
    const second = await start(ava, {
      foundation: "client_portal",
      business_id: first.project.business_id,
    });
    expect(second.project.business_id).toBe(first.project.business_id);
    expect((await ava("/api/projects")).body.projects).toHaveLength(1);
    expect((await ava("/api/product-projects")).body.projects).toHaveLength(2);
  });

  it("refuses malformed input with a plain reason", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const create = (body: unknown) => ava("/api/product-projects", "POST", body);
    expect((await create({ foundation: "ai_api" })).status).toBe(400);
    expect((await create({ idea: IDEA, foundation: "crypto_casino" })).status).toBe(400);
    expect((await create({ idea: 42, foundation: "ai_api" })).status).toBe(400);
    expect((await create({ idea: "x".repeat(2001), foundation: "ai_api" })).status).toBe(400);
    expect((await ava("/api/product-projects", "POST", undefined, "{not json")).status).toBe(400);

    const v1 = await start(ava);
    const save = (patch: Record<string, unknown>) =>
      ava(`/api/product-projects/${v1.project.id}/revisions`, "POST", {
        base_revision: 1,
        brief: v1.head.brief,
        prototype: v1.head.prototype,
        ...patch,
      });
    const screens = v1.head.prototype.screens;
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["no base", { base_revision: undefined }, /base_revision/],
      ["no brief", { brief: null }, /brief is missing/],
      ["array brief", { brief: [] }, /brief is missing/],
      [
        "bad price",
        { brief: { ...v1.head.brief, price: { model: "per_use", amount_cents: -5 } } },
        /price/,
      ],
      ["bad model", { brief: { ...v1.head.brief, price: { model: "barter" } } }, /pricing model/],
      [
        "too many features",
        { brief: { ...v1.head.brief, features: Array(9).fill("x") } },
        /at most 8/,
      ],
      ["no screens", { prototype: { schema: 1, screens: [] } }, /at least one screen/],
      ["wrong schema", { prototype: { schema: 2, screens } }, /version/],
      [
        "unknown screen kind",
        { prototype: { schema: 1, screens: [{ id: "x", kind: "script", title: "x" }] } },
        /unknown kind/,
      ],
      [
        "dangling source",
        {
          prototype: {
            schema: 1,
            screens: [screens[0], { id: "log", kind: "list", title: "Log", source: "nowhere" }],
          },
        },
        /must read from a form/,
      ],
      [
        "bad key",
        {
          prototype: {
            schema: 1,
            screens: [
              { ...screens[0], fields: [{ key: "<img src=x>", label: "Doc", type: "text" }] },
            ],
          },
        },
        /lowercase key/,
      ],
      [
        "duplicate field",
        {
          prototype: {
            schema: 1,
            screens: [
              {
                ...screens[0],
                fields: [
                  { key: "doc", label: "Doc", type: "text" },
                  { key: "doc", label: "Doc 2", type: "text" },
                ],
              },
            ],
          },
        },
        /share the key/,
      ],
      [
        "choice without options",
        {
          prototype: {
            schema: 1,
            screens: [{ ...screens[0], fields: [{ key: "k", label: "K", type: "choice" }] }],
          },
        },
        /needs options/,
      ],
    ];
    for (const [name, patch, message] of cases) {
      const res = await save(patch);
      expect(res.status, name).toBe(400);
      expect(res.body.error, name).toMatch(message);
    }
    expect((await ava(`/api/product-projects/${v1.project.id}/revisions/abc`)).status).toBe(404);
    expect((await ava(`/api/product-projects/${v1.project.id}`)).body.revisions).toHaveLength(1);
  });

  it("stores markup as plain text and drops fields nobody asked for", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    const res = await ava(`/api/product-projects/${v1.project.id}/revisions`, "POST", {
      base_revision: 1,
      brief: { ...v1.head.brief, name: "<b>Bold</b>", owner_override: "me", html: "<script>" },
      prototype: {
        ...v1.head.prototype,
        endpoint: "https://example.invalid",
        screens: v1.head.prototype.screens.map((s: object) => ({ ...s, onClick: "alert(1)" })),
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.head.brief.name).toBe("<b>Bold</b>");
    expect(res.body.head.brief).not.toHaveProperty("owner_override");
    expect(res.body.head.prototype).not.toHaveProperty("endpoint");
    expect(res.body.head.prototype.screens[0]).not.toHaveProperty("onClick");
  });

  it("says plainly that builds are not connected, and reports a provider's own availability", async () => {
    const { join } = world();
    const ava = await join("Ava Chen");
    const v1 = await start(ava);
    expect(v1.build).toMatchObject({ available: false, provider: null });
    expect(v1.build.reason).toMatch(/not connected/);
    expect((await ava("/api/product-foundations")).body.foundations).toHaveLength(4);

    const double: BuildProvider = {
      id: "test-double",
      availability: () => ({ available: false, provider: "test-double", reason: "Budget not set" }),
      pricing: () => null,
      identity: () => ({ id: "test-double", model: "none", version: "1" }),
      start: () => {
        throw new Error("never started in M1");
      },
    };
    const w = world(double);
    const view = await start(await w.join("Ava Chen"));
    expect(view.build).toEqual({
      available: false,
      provider: "test-double",
      reason: "Budget not set",
    });
  });
});

describe("product studio storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "everstreet-products-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("adds its tables to an existing database without touching earlier records", () => {
    const path = join(dir, "legacy.db");
    const legacy = openDb(path);
    legacy.exec(
      "DROP TABLE product_revisions; DROP TABLE product_projects; INSERT INTO people (id, display_name, created_at) VALUES ('p1', 'Mara Solis', '2026-10-01T00:00:00Z')",
    );
    expect(
      legacy.prepare("SELECT name FROM sqlite_master WHERE name = 'product_projects'").get(),
    ).toBeUndefined();
    legacy.close();

    const reopened = openDb(path);
    expect(reopened.prepare("SELECT display_name FROM people WHERE id = 'p1'").get()).toMatchObject(
      { display_name: "Mara Solis" },
    );
    expect(
      reopened
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'product_revisions%'")
        .get(),
    ).toMatchObject({ n: 3 });
    reopened.close();
  });
});
