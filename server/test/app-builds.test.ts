// Job 002e: the `app` build intent over the REAL builds API and worker, with a scripted provider
// (a labelled test double: no model, no spend). What this proves: the expected artifact kind is
// part of the request's identity and is validated; a change carries its base version as data;
// app bundles have their own size bound; the schema migration keeps every existing column.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { validateBundle } from "../src/appBundle.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { QUOTE_BUNDLE, QUOTE_BUNDLE_V2 } from "./app-fixtures.ts";

/** Test double: returns whatever the test queues, and records what it was asked. */
class Scripted implements BuildProvider {
  readonly id = "scripted-test";
  calls: BuildRequest[] = [];
  next: unknown[] = [];
  identity() {
    return { id: this.id, model: "scripted-model", version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Scripted test provider" };
  }
  pricing() {
    return { inputCentsPerMillionTokens: 300, outputCentsPerMillionTokens: 1500 };
  }
  start(req: BuildRequest): AsyncIterable<BuildEvent> {
    this.calls.push(req);
    const artifact = this.next.shift();
    return (async function* () {
      yield { type: "output", artifact } as BuildEvent;
      yield { type: "usage_final", inputTokens: 4000, outputTokens: 1000 } as BuildEvent;
    })();
  }
}

const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};

function world(dbPath = ":memory:") {
  const provider = new Scripted();
  const store = new Store(openDb(dbPath));
  const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 100_000 });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
  });
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const id = ((await res.json()) as { person: { id: string } }).person.id;
    return Object.assign(
      async (path: string, method = "GET", body?: unknown) => {
        const r = await app.request(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
        });
        // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
        return { status: r.status, body: (await r.json()) as Record<string, any> };
      },
      { id },
    );
  };
  const worker = new BuildWorker(builds, provider, { id: "w1" });
  const drain = async () => {
    for (let i = 0; i < 5 && (await worker.runNext()); i++);
  };
  return { store, provider, join, drain };
}
type Actor = Awaited<ReturnType<ReturnType<typeof world>["join"]>>;

async function project(a: Actor) {
  const p = (
    await a("/api/product-projects", "POST", {
      idea: "A quote calculator for a fictional print shop",
      foundation: "saas_workflow",
    })
  ).body;
  await a(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", { limit_cents: 100 });
  return p.project.id as string;
}

const appBuild = (a: Actor, pid: string, key: string, extra: Record<string, unknown> = {}) =>
  a(`/api/product-projects/${pid}/builds`, "POST", {
    idempotency_key: key,
    revision: 1,
    intent: "app",
    budget: BUDGET,
    ...extra,
  });

describe("002e app builds", () => {
  it("an app request asks for web_app_bundle/1 and stores the platform's own digest", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const pid = await project(ava);
    w.provider.next.push(JSON.stringify(QUOTE_BUNDLE));
    const r = await appBuild(ava, pid, "app-key-0001", { instructions: "A quote calculator" });
    expect(r.status).toBe(201);
    await w.drain();
    const call = w.provider.calls[0];
    expect(call).toMatchObject({
      intent: "app",
      outputSchema: "web_app_bundle/1",
      app: { instructions: "A quote calculator", base: null },
    });
    const job = (await ava(`/api/builds/${r.body.job.id}`)).body.job;
    expect(job.state).toBe("succeeded");
    const own = validateBundle(QUOTE_BUNDLE);
    expect(own.ok && job.artifact).toMatchObject({
      kind: "web_app_bundle",
      digest: own.ok ? own.digest : "",
    });
  });

  it("the expected kind is validated both ways: no spec for an app, no bundle for a build", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const pid = await project(ava);
    w.provider.next.push({ kind: "extraction_spec", schema_version: 1 });
    const a = await appBuild(ava, pid, "app-key-0002");
    await w.drain(); // one job at a time: each takes its own scripted answer
    w.provider.next.push(QUOTE_BUNDLE);
    const b = await ava(`/api/product-projects/${pid}/builds`, "POST", {
      idempotency_key: "build-key-0002",
      revision: 1,
      budget: BUDGET,
    });
    await w.drain();
    for (const id of [a.body.job.id, b.body.job.id]) {
      const job = (await ava(`/api/builds/${id}`)).body.job;
      expect(job).toMatchObject({
        state: "failed",
        failure: { code: "invalid_output" },
        artifact: null,
      });
    }
  });

  it("a change carries its base version as data; base and instructions are part of the identity", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const pid = await project(ava);
    w.provider.next.push(QUOTE_BUNDLE);
    const first = await appBuild(ava, pid, "app-key-0003");
    await w.drain();
    w.provider.next.push(QUOTE_BUNDLE_V2);
    const change = await appBuild(ava, pid, "app-key-0004", {
      base_job: first.body.job.id,
      instructions: "Colour copies cost 40 cents",
    });
    expect(change.status).toBe(201);
    await w.drain();
    const own = validateBundle(QUOTE_BUNDLE);
    expect(w.provider.calls[1]?.app).toMatchObject({
      instructions: "Colour copies cost 40 cents",
      base: { job: first.body.job.id, digest: own.ok ? own.digest : "" },
    });
    // The same key with different instructions is a different request: refused, nothing new.
    const again = await appBuild(ava, pid, "app-key-0004", {
      base_job: first.body.job.id,
      instructions: "Colour copies cost 30 cents",
    });
    expect(again.status).toBe(409);
    expect(w.provider.calls).toHaveLength(2);
  });

  it("a base must be a succeeded app version of the same project; builds take no base", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const p1 = await project(ava);
    const p2 = await project(ava);
    w.provider.next.push(QUOTE_BUNDLE);
    const v = await appBuild(ava, p1, "app-key-0005");
    await w.drain();
    expect((await appBuild(ava, p2, "app-key-0006", { base_job: v.body.job.id })).status).toBe(404);
    const build = await ava(`/api/product-projects/${p1}/builds`, "POST", {
      idempotency_key: "build-key-0007",
      revision: 1,
      budget: BUDGET,
      base_job: v.body.job.id,
    });
    expect(build.status).toBe(400);
  });

  it("app bundles have their own size bound; every other artifact stays at 64 KB", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const pid = await project(ava);
    const big = {
      ...QUOTE_BUNDLE,
      files: [
        ...QUOTE_BUNDLE.files,
        { path: "notes.json", text: JSON.stringify({ t: "x".repeat(60_000) }) },
      ],
    };
    w.provider.next.push(big);
    const ok = await appBuild(ava, pid, "app-key-0008");
    await w.drain(); // one job at a time: each takes its own scripted answer
    w.provider.next.push({ kind: "extraction_spec", padding: "x".repeat(70_000) });
    const spec = await ava(`/api/product-projects/${pid}/builds`, "POST", {
      idempotency_key: "build-key-0009",
      revision: 1,
      budget: BUDGET,
    });
    await w.drain();
    expect((await ava(`/api/builds/${ok.body.job.id}`)).body.job.state).toBe("succeeded");
    expect((await ava(`/api/builds/${spec.body.job.id}`)).body.job.failure).toMatchObject({
      code: "invalid_output",
      detail: "The output is larger than 64 KB",
    });
  });
});

describe("002e schema migration", () => {
  it("a build_jobs table from before 'app' is rebuilt once, keeping every column including request_ref", async () => {
    const dir = mkdtempSync(join(tmpdir(), "es-mig-"));
    const open: { close(): void }[] = [];
    try {
      const path = join(dir, "db.sqlite");
      // A real project made through the app on a file database; then one job row by SQL.
      const w = world(path);
      open.push(w.store.db);
      const ava = await w.join("Ava Chen");
      const pid = await project(ava);
      const db = w.store.db;
      const biz = (
        db.prepare("SELECT business_id FROM product_projects WHERE id = ?").get(pid) as {
          business_id: string;
        }
      ).business_id;
      const t = new Date().toISOString();
      db.prepare(
        "INSERT INTO build_jobs (id, project_id, business_id, revision, content_hash, intent, idempotency_key, fingerprint, provider, budget, pricing, requested_by, owner_id, owner_generation, state, reserved_cents, created_at, updated_at, request_ref) VALUES ('j1',?,?,1,'h','propose','k-00000001','f','s','{}','{}',?,?,1,'succeeded',0,?,?,'msg-1')",
      ).run(pid, biz, ava.id, ava.id, t, t);
      // Back to the pre-002e shape: the CHECK without 'app' (as an older database has it).
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name = 'build_jobs'").get() as {
          sql: string;
        }
      ).sql;
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(sql.replace("build_jobs", "build_jobs_old").replace("'propose','app'", "'propose'"));
      db.exec("INSERT INTO build_jobs_old SELECT * FROM build_jobs");
      db.exec("DROP TABLE build_jobs");
      db.exec("ALTER TABLE build_jobs_old RENAME TO build_jobs");
      db.close();
      open.length = 0;
      const again = openDb(path);
      open.push(again);
      expect(
        (
          again.prepare("SELECT sql FROM sqlite_master WHERE name = 'build_jobs'").get() as {
            sql: string;
          }
        ).sql,
      ).toContain("'app'");
      expect(
        again.prepare("SELECT intent, request_ref, state FROM build_jobs WHERE id = 'j1'").get(),
      ).toEqual({
        intent: "propose",
        request_ref: "msg-1",
        state: "succeeded",
      });
    } finally {
      for (const d of open) d.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
