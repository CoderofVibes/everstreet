// Job 003n: executing a reserved customer request through the existing managed runtime, with a
// private protected result (docs/design/CUSTOMER_USE_RUNTIME.md §13). Real app routes; the chain
// is the labelled fixture double seeded from contract JSON, the extractor is the scripted runtime
// double, and protection is the labelled synthetic seam. Every producer is finite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import {
  type CustomerWorld,
  customerWorld,
  heldScript,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";
import { correct, reply } from "./runtime-world.ts";

const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const B32 = "B".repeat(32);
const C32 = "C".repeat(32);

async function reserved(w: CustomerWorld, input = INPUT, key = "exec-key-0001") {
  const offer = await w.offer();
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input,
  });
  expect(p.status).toBe(201);
  const c = await w.cara(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    w.signed(p.body.use.envelope),
  );
  expect(c.body.use.state).toBe("reserved");
  return { id: p.body.use.id as string, offer };
}

const all = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];
const customerInvocations = (w: CustomerWorld) =>
  all(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'");
const ledger = (w: CustomerWorld, id: string) =>
  all(
    w,
    "SELECT kind, cents, microcents FROM runtime_usage WHERE invocation_id = ? ORDER BY id",
    id,
  );
/**
 * Everything the business's records and events hold about customer use, as text. (The owner's
 * own release-check rows keep their outputs by design and are not customer data.)
 */
const businessDump = (w: CustomerWorld) =>
  JSON.stringify([
    all(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'"),
    all(
      w,
      "SELECT u.* FROM runtime_usage u JOIN runtime_invocations i ON i.id = u.invocation_id WHERE i.purpose = 'customer_use'",
    ),
    all(w, "SELECT * FROM customer_executions"),
    all(w, "SELECT * FROM customer_request_events"),
    all(w, "SELECT * FROM customer_requests"),
  ]);

/** A bounded wait for an in-process condition (at most 200 turns of the event loop). */
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(cond()).toBe(true);
}

const protectedWorld = (extra: Parameters<typeof customerWorld>[0] = {}) => {
  const protection = new SyntheticProtection();
  return customerWorld({ ...extra, customer: { protection, ...extra.customer } }).then((w) => ({
    w,
    protection,
  }));
};

describe("003n execution: one provider call, a private validated result, exact accounting", () => {
  it("reserved → one call → protected result; the business keeps cost only; the unit stays reserved", async () => {
    const { w, protection } = await protectedWorld();
    const { id } = await reserved(w);
    const before = w.chain.ent();
    const calls = w.provider.calls.length;
    const counted = (await w.owner(`/api/businesses/${w.f.business}/runtime-budget`)).body
      .counted_cents as number;
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.status).toBe(200);
    expect(r.body.use.execution).toMatchObject({
      state: "completed",
      outcome: "extracted",
      fulfilled: true,
      usage_state: "final",
      result: "available",
      input_source: "protected",
      unit: "reserved_awaiting_settlement",
    });
    expect(w.provider.calls.length - calls).toBe(1);
    const got = await w.cara(`/api/customer/uses/${id}/result`);
    expect(got.status).toBe(200);
    expect(got.body.result.outcome).toBe("extracted");
    expect(JSON.stringify(got.body.result)).toContain("Stackline Hosting Ltd");
    // The business's record: purpose customer_use, no output; the exact ledger.
    const [inv] = customerInvocations(w);
    expect(inv).toMatchObject({
      output: null,
      state: "completed",
      requested_by: w.cara.id,
      reserved_cents: 0,
    });
    const l = ledger(w, inv?.id);
    expect(l.map((x) => x.kind)).toEqual(["reservation", "actual", "release"]);
    expect(l[1]?.microcents).toBe(inv?.charged_microcents);
    expect(l[0]?.cents).toBe(l[2]?.cents);
    expect(inv?.charged_cents).toBe(Math.ceil((inv?.charged_microcents as number) / 1_000_000));
    // The result exists only behind the seam, never in any business table or event.
    expect(businessDump(w)).not.toContain("Stackline");
    expect([...protection.kinds.values()].sort()).toEqual(["input", "result"]);
    // The unit is still only reserved: the request, its allocation and the chain are unchanged.
    expect(r.body.use.state).toBe("reserved");
    expect(all(w, "SELECT allocation FROM customer_requests")[0]?.allocation).not.toBeNull();
    expect(w.chain.ent()).toEqual(before);
    // The owner's budget counts the cost.
    const budget = await w.owner(`/api/businesses/${w.f.business}/runtime-budget`);
    // Exactly this execution's cost was added to the business's runtime ledger.
    expect(budget.body.counted_cents - counted).toBe(inv?.charged_cents);
    expect(budget.body.reserved_cents).toBe(0);
  });

  it("a lost reply and competing workers never run it twice", async () => {
    const { w } = await protectedWorld();
    const { id } = await reserved(w);
    const calls = w.provider.calls.length;
    const [a, b] = await Promise.all([
      w.cara(`/api/customer/uses/${id}/execute`, "POST", {}),
      w.cara(`/api/customer/uses/${id}/execute`, "POST", {}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const again = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(again.body.use.execution.result).toBe("available");
    expect(w.provider.calls.length - calls).toBe(1);
    expect(customerInvocations(w)).toHaveLength(1);
    expect(all(w, "SELECT * FROM customer_executions")).toHaveLength(1);
  });

  it("refuses without a provider or protection, before anything is reserved or sent", async () => {
    const noProtection = await customerWorld();
    const r1 = await reserved(noProtection);
    const before1 = noProtection.provider.calls.length;
    const a = await noProtection.cara(`/api/customer/uses/${r1.id}/execute`, "POST", {
      input: INPUT,
    });
    expect([a.status, a.body.code]).toEqual([503, "protection_unavailable"]);
    expect(noProtection.provider.calls.length).toBe(before1);
    const { w } = await protectedWorld({ noProvider: true });
    const r2 = await reserved(w);
    const before2 = w.provider.calls.length;
    const b = await w.cara(`/api/customer/uses/${r2.id}/execute`, "POST", {});
    expect([b.status, b.body.code]).toEqual([503, "runtime_unavailable"]);
    expect(w.provider.calls.length).toBe(before2);
    for (const x of [noProtection, w]) expect(customerInvocations(x)).toHaveLength(0);
  });

  it("input: a changed document is refused; a missing copy needs resupply; a failed protection is retried once", async () => {
    const { w, protection } = await protectedWorld();
    protection.failProtect = 1; // the first protection fails: no reference is kept
    const offer = await w.offer();
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "exec-key-0001",
      input: INPUT,
    });
    expect(p.body.use.input.retained).toBe(false);
    const id = p.body.use.id as string;
    await w.cara(`/api/customer/uses/${id}/confirm`, "POST", w.signed(p.body.use.envelope));
    const calls = w.provider.calls.length;
    expect((await w.cara(`/api/customer/uses/${id}/execute`, "POST", {})).body.code).toBe(
      "input_needed",
    );
    expect(
      (await w.cara(`/api/customer/uses/${id}/execute`, "POST", { input: `${INPUT} ` })).body.code,
    ).toBe("input_mismatch");
    // The same-key retry protects it now, once; a further retry doesn't protect again.
    const retry = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "exec-key-0001",
      input: INPUT,
    });
    expect(retry.body.use.input.retained).toBe(true);
    const protects = protection.calls;
    await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "exec-key-0001",
      input: INPUT,
    });
    expect(protection.calls).toBe(protects);
    expect(w.provider.calls.length).toBe(calls);
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.body.use.execution).toMatchObject({ input_source: "protected", fulfilled: true });
  });

  it("a changed release, model or retired offer refuses before dispatch", async () => {
    const { w } = await protectedWorld();
    const { id, offer } = await reserved(w);
    const model = w.provider.model;
    w.provider.model = "another-model"; // the runtime identity changed since the release
    expect((await w.cara(`/api/customer/uses/${id}/execute`, "POST", {})).body.code).toBe(
      "release_needs_recheck",
    );
    w.provider.model = model;
    await w.owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/retire`, "POST");
    expect((await w.cara(`/api/customer/uses/${id}/execute`, "POST", {})).body.code).toBe(
      "offer_retired",
    );
    expect(customerInvocations(w)).toHaveLength(0);
  });

  it("only the requesting customer runs or reads it; neither owner route exposes it", async () => {
    const { w } = await protectedWorld();
    const { id } = await reserved(w);
    const lena = w.person("Lena Park");
    expect((await lena(`/api/customer/uses/${id}/execute`, "POST", {})).status).toBe(404);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const inv = customerInvocations(w)[0] as Json;
    for (const [who, path, method] of [
      [lena, `/api/customer/uses/${id}/result`, "GET"],
      [w.owner, `/api/customer/uses/${id}/result`, "GET"],
      [w.owner, `/api/customer/uses/${id}`, "GET"],
      [w.owner, `/api/runtime/invocations/${inv.id}`, "GET"],
      [w.owner, `/api/runtime/invocations/${inv.id}/cancel`, "POST"],
      [lena, `/api/customer/uses/${id}/execution/cancel`, "POST"],
    ] as const)
      expect((await who(path, method)).status, `${path}`).toBe(404);
    const list = await w.owner(`/api/product-projects/${w.f.project}/runtime`);
    expect(list.body.invocations.some((i: Json) => i.purpose === "customer_use")).toBe(false);
  });
});

describe("003n budget, concurrency and failure accounting", () => {
  it("budget and concurrency limits refuse with nothing reserved or sent", async () => {
    const { w } = await protectedWorld();
    const { id } = await reserved(w);
    await w.owner(`/api/businesses/${w.f.business}/runtime-budget`, "PUT", { limit_cents: 3 });
    const calls = w.provider.calls.length;
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([409, "budget_exhausted"]);
    await w.owner(`/api/businesses/${w.f.business}/runtime-budget`, "PUT", { limit_cents: 100 });
    // Two owner trials hold both slots of the business's concurrency.
    const held = heldScript(async () => reply({}, "not_a_document"));
    w.provider.script = held.script;
    const trials = [1, 2].map((n) =>
      w.owner(`/api/product-projects/${w.f.project}/runtime/invocations`, "POST", {
        idempotency_key: `trial-key-000${n}`,
        release: true,
        text: "Fictional note",
      }),
    );
    try {
      await until(() => w.provider.calls.length === calls + 2);
      const c = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect([c.status, c.body.code]).toEqual([409, "concurrency_limit"]);
    } finally {
      held.open();
      await Promise.all(trials);
    }
    expect(customerInvocations(w)).toHaveLength(0);
    // The owner's trials keep their own behaviour: answered to the owner, output kept.
    const list = await w.owner(`/api/product-projects/${w.f.project}/runtime`);
    expect(list.body.invocations.filter((i: Json) => i.purpose === "release")).toHaveLength(2);
    w.provider.script = correct;
    const ok = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(ok.body.use.execution.fulfilled).toBe(true);
  });

  it("partial and unknown usage keep their reservations unresolved and no result", async () => {
    for (const [name, failure, state, usage] of [
      [
        "partial",
        new RuntimeFailure("Usage outside its priced limits", "unpriced_usage", {
          inputTokens: 900,
          outputTokens: 120,
          final: false,
        }),
        "failed",
        "partial",
      ],
      ["unknown", new RuntimeFailure("No answer", "provider_error", null), "unknown", "unknown"],
    ] as const) {
      const { w } = await protectedWorld();
      const { id } = await reserved(w);
      w.provider.script = async () => {
        throw failure;
      };
      const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect(r.body.use.execution, name).toMatchObject({
        state,
        usage_state: usage,
        fulfilled: false,
        result: "none",
      });
      const inv = customerInvocations(w)[0] as Json;
      expect(inv.reserved_cents, name).toBeGreaterThan(0); // held, never released
      expect(
        ledger(w, inv.id).map((x) => x.kind),
        name,
      ).toEqual(["reservation", name === "partial" ? "actual" : "unknown"]);
      expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("no_result");
    }
  });

  it("a cancellation stops it; a late answer is neither kept nor delivered, its usage still counted", async () => {
    const { w, protection } = await protectedWorld();
    const { id } = await reserved(w);
    const held = heldScript(async () => reply({ vendor: "Stackline Hosting Ltd" }));
    w.provider.script = held.script;
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    try {
      await held.entered;
      const c = await w.cara(`/api/customer/uses/${id}/execution/cancel`, "POST");
      expect(c.status).toBe(200);
    } finally {
      held.open();
    }
    const r = await run;
    expect(r.body.use.execution).toMatchObject({
      state: "cancelled",
      result: "none",
      usage_state: "final",
    });
    expect([...protection.kinds.values()]).toEqual(["input"]);
    const inv = customerInvocations(w)[0] as Json;
    expect(ledger(w, inv.id).map((x) => x.kind)).toEqual(["reservation", "actual", "release"]);
  });

  it("a timeout is unknown: no result, its reservation held", async () => {
    const { w } = await protectedWorld({ runtime: { timeoutMs: 30 } });
    const { id } = await reserved(w);
    const held = heldScript(async () => reply({}), true);
    w.provider.script = held.script;
    try {
      const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect(r.body.use.execution).toMatchObject({
        state: "unknown",
        failure: "timeout",
        result: "none",
      });
    } finally {
      held.open();
    }
  });
});

describe("003n fresh evidence before dispatch", () => {
  it("refuses an expiring, expired, revoked, stale, conflicting or already-used hold, sending nothing", async () => {
    const cases: [string, (w: CustomerWorld) => void, number, string][] = [
      ["expiring", (w) => w.chain.tick(500_000n), 409, "not_enough_time"],
      ["expired", (w) => w.chain.tick(700_000n), 409, "not_serving_serve_window_passed"],
      ["revoked", (w) => w.chain.revoke(0), 409, "not_serving_key_revoked"],
      [
        "stale",
        (w) => {
          w.reader.scripted = {
            block: { height: "900", hash: B32, timestamp_ms: String(w.chain.ts - 99_000n) },
            views: {},
          };
        },
        503,
        "evidence_stale",
      ],
      [
        "conflict",
        (w) => {
          const mark = JSON.parse(
            all(w, "SELECT evidence_mark FROM customer_requests")[0]?.evidence_mark,
          );
          w.reader.scripted = {
            block: { height: mark.height, hash: C32, timestamp_ms: mark.timestamp_ms },
            views: {},
          };
        },
        409,
        "evidence_conflict",
      ],
      [
        "slot used",
        (w) => {
          // Synthetic: the hold's one slot recorded as used.
          const e = w.chain.ent() as Json;
          w.chain.tick(1_000n);
          w.reader.scripted = {
            block: w.chain.block(),
            views: {
              get_entitlement: {
                ...e,
                hold_used: 1,
                hold_charged: 1,
                hold_slots: ["ab".repeat(32)],
              },
            },
          };
        },
        409,
        "slot_used",
      ],
    ];
    for (const [name, change, status, code] of cases) {
      const { w } = await protectedWorld();
      const { id } = await reserved(w);
      const calls = w.provider.calls.length;
      change(w);
      w.clock.now = Number(w.chain.ts);
      const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect([r.status, r.body.code], name).toEqual([status, code]);
      expect(w.provider.calls.length, name).toBe(calls);
      expect(customerInvocations(w), name).toHaveLength(0);
      if (name === "conflict") {
        // Sticky: recorded on the request, and refused again.
        const again = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
        expect(again.body.code).toBe("evidence_conflict");
        expect(again.body.use ?? (await w.cara(`/api/customer/uses/${id}`)).body.use).toMatchObject(
          { evidence_conflict: "equal_height_hash_differs" },
        );
      }
    }
  });
});

describe("003n across a sale, a restart and retention", () => {
  it("a sale during admission fences the dispatch; afterwards the customer is still served", async () => {
    const { w } = await protectedWorld();
    const { id } = await reserved(w);
    const buyer = w.person("Noah Fenn");
    w.reader.duringRead = () => w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([409, "control_changed"]);
    expect(customerInvocations(w)).toHaveLength(0);
    const ok = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(ok.body.use.execution.fulfilled).toBe(true);
    expect((await buyer(`/api/customer/uses/${id}/result`)).status).toBe(404);
  });

  it("a sale during execution: the customer still gets the result; neither owner can", async () => {
    const { w } = await protectedWorld();
    const { id } = await reserved(w);
    const held = heldScript(() => correct({ document: INPUT } as never));
    w.provider.script = held.script;
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const buyer = w.person("Noah Fenn");
    try {
      await held.entered;
      w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    } finally {
      held.open();
    }
    const r = await run;
    expect(r.body.use.execution).toMatchObject({ fulfilled: true, result: "available" });
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    expect((await buyer(`/api/customer/uses/${id}/result`)).status).toBe(404);
    expect((await w.owner(`/api/customer/uses/${id}/result`)).status).toBe(404);
  });

  it("retention: after the deadline the result is refused, then deleted through the seam", async () => {
    const { w, protection } = await protectedWorld();
    const { id } = await reserved(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const ref = all(w, "SELECT result_ref FROM customer_executions")[0]?.result_ref as string;
    w.clock.now += 31 * 86_400_000;
    const r = await w.cara(`/api/customer/uses/${id}/result`);
    expect([r.status, r.body.code]).toEqual([409, "result_expired"]);
    expect(await w.service().expireResults(5)).toEqual({ deleted: 1, failed: 0 });
    expect(protection.deleted).toContain(ref);
    expect(protection.kept.has(ref)).toBe(false);
    expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution.result).toBe("expired");
    expect(await w.service().expireResults(5)).toEqual({ deleted: 0, failed: 0 });
  });

  it("a crash after the dispatch intent is unknown after restart and never re-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-exec-"));
    const open: Store[] = [];
    const held = heldScript(async () => reply({}));
    try {
      const { w } = await protectedWorld({ dbPath: join(dir, "app.db") });
      open.push(w.state.store);
      const { id } = await reserved(w);
      w.provider.script = held.script;
      const stuck = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      stuck.catch(() => {});
      await held.entered; // the provider was called; this process never comes back
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store); // a new runtime on the same file, recovered
      const s = await w.cara(`/api/customer/uses/${id}`);
      expect(s.body.use.execution).toMatchObject({
        state: "unknown",
        failure: "outcome_unknown",
        result: "none",
      });
      const calls = w.provider.calls.length;
      const again = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect(again.body.use.execution.state).toBe("unknown");
      expect(w.provider.calls.length).toBe(calls);
      const inv = all(
        w,
        "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'",
      )[0] as Json;
      expect(inv.reserved_cents).toBeGreaterThan(0);
      expect(ledger(w, inv.id).map((x) => x.kind)).toEqual(["reservation", "unknown"]);
      held.open();
      await stuck; // the lost worker's late finish changes nothing
      expect(all(w, "SELECT result_state FROM customer_executions")[0]?.result_state).toBe(
        "pending",
      );
      expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution.result).toBe("none");
    } finally {
      held.open();
      for (const s of open)
        try {
          s.db.close();
        } catch {
          // already closed
        }
      // Bounded retries: Windows may hold a just-closed SQLite file briefly.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("an existing database is upgraded for customer_use, keeping its runtime rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-migrate-"));
    try {
      const path = join(dir, "old.db");
      // Only the runtime table exists here, so its references can't be enforced while seeding.
      const old = new DatabaseSync(path, { enableForeignKeyConstraints: false });
      // The runtime table exactly as it was before 003n (purpose without customer_use).
      old.exec(`CREATE TABLE runtime_invocations (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
  project_id TEXT NOT NULL REFERENCES product_projects(id),
  artifact_job TEXT NOT NULL REFERENCES build_jobs(id), artifact_digest TEXT NOT NULL, release_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('trial','evaluation','release')),
  eval_run TEXT, eval_case TEXT,
  requested_by TEXT NOT NULL REFERENCES people(id), owner_id TEXT NOT NULL, owner_generation INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, input_sha TEXT NOT NULL, input_chars INTEGER NOT NULL,
  provider TEXT NOT NULL, provider_config TEXT NOT NULL, validator TEXT NOT NULL, pricing TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','failed','cancelled','unknown')),
  outcome TEXT CHECK (outcome IN ('extracted','incomplete','refused','invalid')),
  failure_class TEXT, failure_detail TEXT, output TEXT,
  reserved_cents INTEGER NOT NULL DEFAULT 0, charged_cents INTEGER NOT NULL DEFAULT 0,
  charged_microcents INTEGER NOT NULL DEFAULT 0,
  usage_state TEXT NOT NULL DEFAULT 'none' CHECK (usage_state IN ('none','final','partial','unknown')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TEXT, dispatched_at TEXT, created_at TEXT NOT NULL, finished_at TEXT, elapsed_ms INTEGER,
  UNIQUE (project_id, idempotency_key)
) STRICT;`);
      old
        .prepare(
          "INSERT INTO runtime_invocations (id, business_id, project_id, artifact_job, artifact_digest, purpose, requested_by, owner_id, owner_generation, idempotency_key, fingerprint, input_sha, input_chars, provider, provider_config, validator, pricing, state, created_at) VALUES ('inv-old', 'b', 'p', 'j', 'd', 'trial', 'u', 'u', 0, 'k-00000001', 'f', 's', 1, 'x', '{}', 'v', '{}', 'completed', 't')",
        )
        .run();
      old.close();
      const db = openDb(path);
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE name = 'runtime_invocations'").get() as {
          sql: string;
        }
      ).sql;
      expect(sql).toContain("'customer_use'");
      expect(db.prepare("SELECT id, purpose FROM runtime_invocations").all()).toEqual([
        { id: "inv-old", purpose: "trial" },
      ]);
      db.close();
      // Opening again is a no-op.
      openDb(path).close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
