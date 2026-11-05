// Job 003wf3 (MANAGED_HANDOVER.md §16.10 D5, and the four S-21 routes the configured composition
// can't reach): app versions, isolated-check starts and reports, preview issuance and use, Studio
// conversations and proposal apply, across a managed handover. The configured synthetic
// composition builds extraction products only, so this is the app-product service world of
// app-checks.test.ts / authoring.test.ts: the REAL routes, Builds, BuildWorker, AppChecks and
// AppCheckWorker over one in-memory store, with a scripted build provider and a TEST DOUBLE check
// engine (never isolation evidence; the real engine stays off in configured compositions).
//
// Stated limits of this world: there is no chain. The gate is armed by the production
// armHandover from the contract-produced Gated fixture's Closing control; the change of owner is
// this world's direct ownership fixture, and the handover row is then marked released by it. The
// real close and reconciliation are proven in handover*.test.ts, not here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import {
  AppChecks,
  type CheckEngine,
  type CheckJob,
  type EngineIdentity,
} from "../src/appChecks.ts";
import { AppCheckWorker } from "../src/appCheckWorker.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { armHandover, openHandover } from "../src/handover.ts";
import { Store } from "../src/store.ts";
import type { ControlV3 } from "../src/v3read.ts";
import { QUOTE_BUNDLE } from "./app-fixtures.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;
const PREVIEW = "http://localhost:4999";
const PLATFORM = "http://127.0.0.1:4999";
const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/v3/gated-sale.json", import.meta.url), "utf8"),
) as { business: string; steps: { value: unknown; views: { get_control: string } }[] };
const closingControl = JSON.parse(
  (fixture.steps.find((s) => s.value === "closing") as { views: { get_control: string } }).views
    .get_control,
) as ControlV3;

/** Answers an app build with the fixture bundle, a proposal with an unchanged draft. */
class Scripted implements BuildProvider {
  readonly id = "scripted-test";
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
    const artifact =
      req.intent === "app"
        ? QUOTE_BUNDLE
        : {
            reply: "Here is a first version.",
            summary: "Kept the brief and screens.",
            brief: { ...req.content.brief, name: "Lumen Parse" },
            screens: req.content.prototype.screens,
            assumptions: ["Fictional"],
            questions: [],
          };
    return (async function* () {
      yield { type: "output", artifact } as BuildEvent;
      yield { type: "usage_final", inputTokens: 100, outputTokens: 100 } as BuildEvent;
    })();
  }
}

/** TEST DOUBLE engine: a scripted passing report, held at the report until released. */
class HeldEngine implements CheckEngine {
  identity: EngineIdentity = { engine: "test-double", recipe: "web_app_checks/1" };
  release: () => void = () => {};
  entered: Promise<void>;
  private arrive: () => void = () => {};
  private hold: Promise<void>;
  constructor() {
    this.entered = new Promise((r) => {
      this.arrive = r;
    });
    this.hold = new Promise((r) => {
      this.release = r;
    });
  }
  async preflight() {
    return { ok: true as const, identity: this.identity };
  }
  async run(job: CheckJob) {
    this.arrive();
    await this.hold;
    const b = JSON.parse(job.bundle) as typeof QUOTE_BUNDLE;
    return {
      report: {
        check_id: job.check_id,
        attempt: job.attempt,
        digest: job.digest,
        recipe: job.recipe,
        engine: this.identity,
        syntax: b.files
          .filter((f) => f.path.endsWith(".js"))
          .map((f) => ({ path: f.path, ok: true, detail: "" })),
        cases: b.checks.map((c) => ({ id: c.id, passed: true, detail: "" })),
        usage: { untrusted_memory_peak_bytes: 1000 },
      },
      host: { vmm_memory_peak_bytes: 2000 },
    };
  }
  async cleanup() {}
}

function world() {
  const provider = new Scripted();
  const store = new Store(openDb(":memory:"));
  const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 100_000 });
  const checks = new AppChecks(store.db, store, {});
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
    appChecks: checks,
    previewOrigin: PREVIEW,
    platformOrigin: PLATFORM,
  });
  const raw = (path: string, init: RequestInit = {}) => app.request(path, init);
  const join = async (name: string) => {
    const res = await raw("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const id = ((await res.json()) as { person: { id: string } }).person.id;
    return Object.assign(
      async (path: string, method = "GET", body?: unknown) => {
        const r = await raw(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
        });
        return { status: r.status, body: (await r.json().catch(() => null)) as Json };
      },
      { id },
    );
  };
  const buildWorker = new BuildWorker(builds, provider, { id: "b1" });
  return { store, checks, raw, join, buildWorker };
}

describe("003wf3 D5: app products across a managed handover (app-product service world)", () => {
  it("while gated: app-version current, check starts, preview issuance, conversations and proposal apply are refused; after the change of owner a check held at its report is fenced, the preview token ends and the seller's proposal can't be applied", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Ortiz");
    const p = (
      await ava("/api/product-projects", "POST", {
        idea: "A plan estimator for a fictional API service",
        foundation: "saas_workflow",
      })
    ).body;
    const pid = p.project.id as string;
    const biz = p.project.business_id as string;
    await ava(`/api/businesses/${biz}/build-budget`, "PUT", { limit_cents: 100 });
    // An app version, a Studio proposal, a preview token and a check, all before the closing.
    const app = await ava(`/api/product-projects/${pid}/builds`, "POST", {
      idempotency_key: "d5-app-0001",
      revision: 1,
      intent: "app",
      budget: BUDGET,
    });
    await w.buildWorker.runNext();
    const job = app.body.job.id as string;
    const said = await ava(`/api/product-projects/${pid}/conversation`, "POST", {
      text: "Make it for small API teams",
      idempotency_key: "d5-msg-0001",
    });
    expect(said.status).toBe(201);
    await w.buildWorker.runNext();
    const proposal = (await ava(`/api/product-projects/${pid}/conversation`)).body.proposals[0];
    expect(proposal).toMatchObject({ status: "open", current_owner: true });
    const issued = (
      await ava(`/api/product-projects/${pid}/app-versions/${job}/preview`, "POST", {
        unchecked: true,
      })
    ).body;
    const base = String(issued.url)
      .replace(PREVIEW, "")
      .replace(/index\.html$/, "");
    expect((await w.raw(`${base}index.html`)).status).toBe(200);
    const engine = new HeldEngine();
    const started = await ava(`/api/product-projects/${pid}/app-versions/${job}/checks`, "POST", {
      idempotency_key: "d5-check-0001",
    });
    expect([201, 202]).toContain(started.status);
    const checkId = started.body.check.id as string;
    const checker = new AppCheckWorker(w.checks, engine, { id: "c1", pollMs: 5 });
    const running = checker.runNext();
    await engine.entered; // the check is at the engine, its report not yet in

    // The gate: the production arm function, from the contract's own Closing control.
    for (const [account, person] of [
      [closingControl.live_deal?.seller, ava.id],
      [closingControl.live_deal?.buyer, ben.id],
    ] as const)
      w.store.db
        .prepare(
          "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, tx, created_at) VALUES ('person', ?, ?, 'fixture', '2026-11-05') ON CONFLICT DO NOTHING",
        )
        .run(person, String(account));
    armHandover(w.store.db, {
      businessId: biz,
      network: "testnet",
      account: fixture.business,
      block: { height: "20", hash: "fixture-block-20" },
      control: closingControl,
      source: "d5_test",
      now: Date.now(),
    });
    expect(openHandover(w.store.db, biz)?.state).toBe("gated");
    const gated = async (path: string, body: Json = {}) => {
      const r = await ava(path, "POST", body);
      return [r.status, r.body?.code];
    };
    const refused = [409, "handover_in_progress"];
    expect(await gated(`/api/product-projects/${pid}/app-versions/${job}/current`)).toEqual(
      refused,
    );
    expect(
      await gated(`/api/product-projects/${pid}/app-versions/${job}/checks`, {
        idempotency_key: "d5-check-0002",
      }),
    ).toEqual(refused);
    expect(
      await gated(`/api/product-projects/${pid}/app-versions/${job}/preview`, { unchecked: true }),
    ).toEqual(refused);
    expect(
      await gated(`/api/product-projects/${pid}/conversation`, {
        text: "One more change",
        idempotency_key: "d5-msg-0002",
      }),
    ).toEqual(refused);
    expect(await gated(`/api/product-projects/${pid}/proposals/${proposal.id}/apply`)).toEqual(
      refused,
    );
    // The token issued before the closing still serves the seller's own preview while gated.
    expect((await w.raw(`${base}index.html`)).status).toBe(200);

    // The change of owner (this world's fixture), then the handover row released by it.
    const db = w.store.db;
    db.prepare(
      "UPDATE business_handovers SET state = 'released_to_buyer' WHERE business_id = ?",
    ).run(biz);
    db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(ben.id, biz);
    db.prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)").run(
      biz,
      ava.id,
      ben.id,
      new Date().toISOString(),
    );
    // The check held at its report: its result can't publish for the new owner.
    engine.release();
    await running;
    const check = w.store.db
      .prepare("SELECT state, failure_code FROM app_checks WHERE id = ?")
      .get(checkId) as Json;
    expect(check.state).not.toBe("passed");
    expect(check.failure_code).toBe("ownership_changed");
    // The preview token issued under the seller ends; the seller's proposal can't be applied.
    expect((await w.raw(`${base}index.html`)).status).toBe(404);
    const byBen = await ben(`/api/product-projects/${pid}/proposals/${proposal.id}/apply`, "POST");
    expect(byBen.status).toBeGreaterThanOrEqual(400);
    const byAva = await ava(`/api/product-projects/${pid}/proposals/${proposal.id}/apply`, "POST");
    expect(byAva.status).toBeGreaterThanOrEqual(400);
    const after = (await ben(`/api/product-projects/${pid}/conversation`)).body.proposals[0];
    expect(after?.current_owner ?? false).toBe(false);
  }, 60_000);
});
