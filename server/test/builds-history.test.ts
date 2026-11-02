// Job 002b: event history pages past the first 100 rows (Astra's 180-progress-event fixture),
// and a build_jobs table from before 002b is rebuilt for the new intent with its rows kept.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import type { BuildEvent, BuildProvider } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

const SPEC = {
  kind: "extraction_spec",
  schema_version: 1,
  name: "Invoice reader",
  input: { kind: "document_text", max_chars: 20000 },
  fields: [
    { key: "vendor", label: "Vendor", type: "text", required: true },
    { key: "total", label: "Total", type: "number", required: true },
    { key: "due_date", label: "Due date", type: "date", required: false },
  ],
  instructions: "Read the invoice and return the fields.",
  examples: [
    {
      input: "Fictional ACME invoice 120.50 due 2026-12-01",
      output: { vendor: "ACME", total: 120.5, due_date: "2026-12-01" },
    },
  ],
};

describe("completed build history", () => {
  it("pages through all 180 progress events to the final receipt and completion", async () => {
    const provider: BuildProvider = {
      id: "scripted-test",
      identity: () => ({ id: "scripted-test", model: "m", version: "1" }),
      availability: () => ({ available: true, provider: "scripted-test", reason: "test" }),
      pricing: () => ({ inputCentsPerMillionTokens: 300, outputCentsPerMillionTokens: 1500 }),
      async *start(): AsyncGenerator<BuildEvent> {
        for (let i = 1; i <= 180; i++) yield { type: "progress", message: `progress ${i}` };
        yield { type: "output", artifact: SPEC };
        yield { type: "usage_final", inputTokens: 4500, outputTokens: 1000 };
      },
    };
    const store = new Store(openDb(":memory:"));
    const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 1000 });
    const app = everstreetApi(store, {
      localPreview: true,
      environment: "test",
      buildProvider: provider,
      builds,
    });
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ava Chen" }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = async (
      path: string,
      method = "GET",
      body?: unknown,
      // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
    ): Promise<Record<string, any>> =>
      (
        await app.request(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      ).json();
    const p = await call("/api/product-projects", "POST", {
      idea: "Invoices to rows",
      foundation: "ai_api",
    });
    await call(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", {
      limit_cents: 100,
    });
    const { job } = await call(`/api/product-projects/${p.project.id}/builds`, "POST", {
      idempotency_key: "build-key-0001",
      revision: 1,
      budget: {
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_seconds: 60,
        max_cost_cents: 10,
      },
    });
    await new BuildWorker(builds, provider, { id: "w1" }).runNext();

    const seen: { seq: number; type: string; data: Record<string, unknown> }[] = [];
    let after = 0;
    let pages = 0;
    for (;;) {
      const page = await call(`/api/builds/${job.id}/events?after=${after}&limit=100`);
      seen.push(...page.events);
      pages++;
      if (!page.has_more) break;
      after = page.next_after;
    }
    expect(pages).toBe(2);
    expect(seen.filter((e) => e.type === "progress")).toHaveLength(180);
    expect(seen.at(-1)?.type).toBe("succeeded");
    expect(seen.map((e) => e.seq)).toEqual(seen.map((_, i) => i + 1));
    // The receipt event carries the exact cost alongside the rounded one.
    const receipt = seen.find((e) => e.type === "usage_final");
    expect(receipt?.data).toMatchObject({ microcents: 4500 * 300 + 1000 * 1500, cents: 3 });
  });
});

describe("build_jobs storage from before 002b", () => {
  const dir = mkdtempSync(join(tmpdir(), "everstreet-build-jobs-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is rebuilt to allow proposals, keeping every row and its references", () => {
    const path = join(dir, "legacy.db");
    const db = openDb(path);
    // Recreate the 002a table exactly as it was (intent 'build' only, no later columns).
    db.exec(`PRAGMA foreign_keys = OFF;
      DROP TABLE build_jobs;
      CREATE TABLE build_jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id),
        business_id TEXT NOT NULL REFERENCES businesses(id), revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL, intent TEXT NOT NULL CHECK (intent IN ('build')),
        idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, provider TEXT NOT NULL,
        budget TEXT NOT NULL, pricing TEXT NOT NULL, retry_of TEXT REFERENCES build_jobs(id),
        requested_by TEXT NOT NULL REFERENCES people(id), owner_id TEXT NOT NULL REFERENCES people(id),
        owner_generation INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued','running','validating','succeeded','failed','cancelled','needs_reconciliation')),
        attempt INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, started_at TEXT,
        dispatched_at TEXT, cancel_requested_at TEXT, failure_code TEXT, failure_detail TEXT,
        reserved_cents INTEGER NOT NULL CHECK (reserved_cents >= 0),
        charged_cents INTEGER NOT NULL DEFAULT 0 CHECK (charged_cents >= 0),
        usage_state TEXT NOT NULL DEFAULT 'none' CHECK (usage_state IN ('none','reported','unknown')),
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0, artifact_digest TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
        UNIQUE (project_id, idempotency_key)
      ) STRICT;
      INSERT INTO build_jobs (id, project_id, business_id, revision, content_hash, intent, idempotency_key, fingerprint, provider, budget, pricing, requested_by, owner_id, owner_generation, state, reserved_cents, created_at, updated_at)
        VALUES ('old-job', 'p', 'b', 1, 'h', 'build', 'key-00001', 'f', 'x', '{}', '{}', 'u', 'u', 0, 'failed', 0, 't', 't');
      INSERT INTO build_events (job_id, seq, attempt, type, data, at) VALUES ('old-job', 1, 0, 'queued', '{}', 't');`);
    db.close();

    const reopened = openDb(path);
    const sql = (
      reopened.prepare("SELECT sql FROM sqlite_master WHERE name = 'build_jobs'").get() as {
        sql: string;
      }
    ).sql;
    expect(sql).toContain("'propose'");
    expect(
      reopened.prepare("SELECT id, state, usage_final, request_ref FROM build_jobs").all(),
    ).toEqual([{ id: "old-job", state: "failed", usage_final: 0, request_ref: null }]);
    expect(
      reopened.prepare("SELECT COUNT(*) AS n FROM build_events WHERE job_id = 'old-job'").get(),
    ).toEqual({ n: 1 });
    // Opening again is a no-op.
    reopened.close();
    const third = openDb(path);
    expect(third.prepare("SELECT COUNT(*) AS n FROM build_jobs").get()).toEqual({ n: 1 });
    third.close();
  });
});
