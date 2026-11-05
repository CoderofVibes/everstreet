// Job 004b through the real routes: connect a configured read-only source to an import
// workspace, read it at a pinned commit, recheck and compare, disconnect and reconnect, and the
// fences (scope, owner change during a read, a buyer refused the seller's connection, nothing
// private in public reads). FICTIONAL fixture transport only; no network, account or token.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import {
  type FetchLike,
  FICTIONAL_REPOS,
  fixtureTransport,
  GithubSource,
  type SourceConnectionConfig,
} from "../src/sourceConnect.ts";
import { Store } from "../src/store.ts";
import type { Json } from "./deal-world.ts";

const REPO = "ledgerline-fictional/invoice-reader";
const CONN: SourceConnectionConfig = {
  id: "fictional-fixture",
  label: "Fictional GitHub fixture",
  kind: "repository_scoped",
  repositories: [REPO],
  fixture: true,
};

function world(wrap?: (f: FetchLike) => FetchLike) {
  const repos = JSON.parse(JSON.stringify(FICTIONAL_REPOS)) as typeof FICTIONAL_REPOS;
  const t = fixtureTransport(repos);
  const store = new Store(openDb(":memory:"));
  const api = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    importSources: {
      reader: new GithubSource(
        "https://fixture.github.invalid",
        wrap ? wrap(t.fetchImpl) : t.fetchImpl,
      ),
      connections: [CONN],
      credential: () => "fictional-credential",
    },
  });
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
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  return { store, repos, requests: t.requests, join, transfer };
}

let n = 0;
const key = () => `src-${++n}`;

async function workspace(w: ReturnType<typeof world>) {
  const m = await w.join("Mara Solis");
  const r = await m("/api/imports", "POST", {
    idempotency_key: key(),
    new_business_name: "Ledgerline Labs",
    name: "Invoice reader",
    description: "Reads fictional invoices",
    product_kind: "api",
  });
  expect(r.status, r.text).toBe(201);
  return { m, id: r.body.workspace.id as string, business: r.body.workspace.business.id as string };
}

describe("004b connecting a source to an import workspace", () => {
  it("connect, read at a pinned commit, recheck with a comparison, disconnect; history stays", async () => {
    const w = world();
    const { m, id } = await workspace(w);
    const s0 = await m(`/api/imports/${id}/source`);
    expect(s0.body).toMatchObject({ available: true, active: null });
    expect(s0.body.connections[0]).toMatchObject({
      id: "fictional-fixture",
      fixture: true,
      configured: true,
    });

    const c = await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    expect(c.status, c.text).toBe(200);
    expect(c.body.active).toMatchObject({ repository: REPO, usable_by_you: true });

    const first = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "v1.2.0",
    });
    expect(first.status, first.text).toBe(201);
    const v1 = first.body.view;
    expect(v1.source.latest.provenance).toMatchObject({
      repository: { full_name: REPO },
      ref: "v1.2.0",
      commit: { sha: "c3".repeat(20) },
      manifest: { state: "read" },
      connection: { fixture: true },
    });
    // The manifest's text is never kept, nor any URL from a payload.
    expect(JSON.stringify(v1)).not.toContain("example.invalid");
    expect(
      w.store.db
        .prepare("SELECT source FROM import_inspections")
        .all()
        .map((r) => String((r as Json).source)),
    ).not.toContainEqual(expect.stringContaining('"content"'));
    const own = (v1.report.live.items as Json[]).find(
      (i) => i.category === "source_ownership",
    ) as Json;
    expect(own.status).toBe("detected"); // observed, never verified
    expect(own.evidence[0]).toMatchObject({ kind: "observed" });
    expect(own.evidence[0].text).toMatch(/isn't proof of who owns it/);
    expect(v1.report.live.headline).toMatch(/^Not ready to transfer/);

    // Recheck at main: a new immutable inspection; the comparison names what changed.
    const second = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    const v2 = second.body.view;
    expect(v2.source.history.map((h: Json) => h.number)).toEqual([2, 1]);
    expect(v2.source.comparison).toMatchObject({
      commit_changed: true,
      from: { commit: "c3".repeat(20), ref: "v1.2.0" },
      to: { commit: "a1".repeat(20), ref: "main" },
    });
    expect(v2.source.comparison.dependencies.added.map((d: Json) => d.key)).toEqual(
      expect.arrayContaining(["dependencies:pg", "devDependencies:vitest"]),
    );
    const hosting = (v2.report.live.items as Json[]).find((i) => i.category === "hosting") as Json;
    expect(
      hosting.evidence.some(
        (e: Json) => e.kind === "claimed" && /not proof it runs now/.test(e.text),
      ),
    ).toBe(true);
    expect(hosting.status).not.toBe("verified");

    // Disconnect: no more reads; earlier reports keep their provenance. Reconnect works.
    await m(`/api/imports/${id}/source/disconnect`, "POST");
    const after = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    expect(after.status).toBe(409);
    expect((await m(`/api/imports/${id}/inspections/1`)).status).toBe(200);
    const re = await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    expect(re.body.history).toHaveLength(2);
  });

  it("refuses a repository outside the connection's scope before reading anything", async () => {
    const w = world();
    const { m, id } = await workspace(w);
    const r = await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: "other-org/private",
    });
    expect(r.status).toBe(409);
    expect(w.requests).toEqual([]);
  });

  it("an owner change during the read stores and shows nothing", async () => {
    let w!: ReturnType<typeof world>;
    let during: (() => void) | null = null;
    w = world((f) => async (url, init) => {
      const r = await f(url, init);
      if (url.includes("/contents/") && during) {
        during();
        during = null;
      }
      return r;
    });
    const { m, id, business } = await workspace(w);
    const buyer = await w.join("Noah Brandt");
    await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    during = () => w.transfer(business, m.id, buyer.id);
    const r = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    expect(r.status).not.toBe(201);
    expect(
      (w.store.db.prepare("SELECT COUNT(*) AS n FROM import_inspections").get() as { n: number }).n,
    ).toBe(0);
    expect(r.text).not.toContain("a1a1a1");
  });

  it("after a sale the buyer sees the history but can't read with the seller's connection", async () => {
    const w = world();
    const { m, id, business } = await workspace(w);
    await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    const buyer = await w.join("Noah Brandt");
    w.transfer(business, m.id, buyer.id);
    expect((await m(`/api/imports/${id}/source`)).status).toBe(404); // the seller: gone
    const st = await buyer(`/api/imports/${id}/source`);
    expect(st.body.active).toMatchObject({ usable_by_you: false });
    const before = w.requests.length;
    const r = await buyer(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    expect([r.status, r.body.code]).toEqual([409, "connection_not_yours"]);
    expect(w.requests.length).toBe(before); // nothing was read with the seller's connection
    // The business's earlier report moved with it.
    expect((await buyer(`/api/imports/${id}`)).body.source.history).toHaveLength(1);
    // The buyer connects their own and reads.
    await buyer(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    expect(
      (
        await buyer(`/api/imports/${id}/source/inspections`, "POST", {
          idempotency_key: key(),
          ref: "main",
        })
      ).status,
    ).toBe(201);
  });

  it("a rate limit or missing manifest is reported truthfully; a rate limit records nothing", async () => {
    let limited = true;
    const w = world(
      (f) => async (url, init) =>
        limited && url.includes("/commits/")
          ? new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })
          : f(url, init),
    );
    const { m, id } = await workspace(w);
    await m(`/api/imports/${id}/source/connect`, "POST", {
      connection: "fictional-fixture",
      repository: REPO,
    });
    const r = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "main",
    });
    expect(r.body.outcome).toMatchObject({ ok: false, failure: "rate_limited", retryable: true });
    expect(r.body.view.source.history).toHaveLength(0);
    limited = false;
    (w.repos[0] as (typeof w.repos)[0]).refs.bare = "e5".repeat(20);
    const bare = await m(`/api/imports/${id}/source/inspections`, "POST", {
      idempotency_key: key(),
      ref: "bare",
    });
    expect(bare.status).toBe(201);
    expect(bare.body.view.source.latest.provenance.manifest.state).toBe("missing");
    expect(bare.body.view.source.history[0].dependency_count).toBeNull(); // unknown, not zero
    expect(bare.body.view.report.live.basis).toMatch(/package.json not read/);
  });

  it("without a configured connection, connecting is unavailable and says so", async () => {
    const store = new Store(openDb(":memory:"));
    const api = everstreetApi(store, { localPreview: true, environment: "test" });
    const res = await api.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mara" }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const create = await api.request("/api/imports", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        idempotency_key: "k-1",
        new_business_name: "X Labs",
        name: "X",
        product_kind: "api",
      }),
    });
    const id = ((await create.json()) as Json).workspace.id;
    const st = (await (
      await api.request(`/api/imports/${id}/source`, { headers: { cookie } })
    ).json()) as Json;
    expect(st).toMatchObject({ available: false, connections: [] });
    expect(st.unavailable_reason).toMatch(/No source connection is configured/);
  });
});
