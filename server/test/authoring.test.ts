// Job 002b: guided authoring. The flow idea → proposal → "Use this version" → immutable
// revision → requested change → second proposal, plus stale bases, duplicate applies, other
// actors, transfer fencing, restart, cancel and budget boundaries. The provider is an explicit
// scripted test double passed into the constructor; nothing here calls a real model.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

type Script = (req: BuildRequest, signal: AbortSignal) => AsyncIterable<BuildEvent>;

/** Drafts a proposal from the snapshot and the latest founder message. Test double only. */
function proposer(): Script {
  return async function* (req) {
    const said = req.conversation.at(-1)?.text ?? "";
    const prototype = req.content.prototype;
    const screens = prototype.screens.map((s) =>
      s.kind === "model" && /invoice date/i.test(said)
        ? {
            ...s,
            outputs: [
              ...s.outputs,
              { key: "invoice_date", label: "Invoice date", type: "text", options: [] },
            ],
          }
        : s,
    );
    yield { type: "progress", message: "Reading the brief" };
    yield {
      type: "output",
      artifact: {
        reply: /invoice date/i.test(said)
          ? "Added the invoice date to the result."
          : "Here is a first version for small accounting teams.",
        summary: /invoice date/i.test(said)
          ? "The result now includes the invoice date."
          : "Named the product, described the customer and promise, and kept three screens.",
        brief: {
          name: "Ledgerline",
          audience: "Small accounting teams (fictional)",
          problem: req.content.brief.problem,
          promise: "Clean rows from every invoice",
          features: ["Paste an invoice", "Get vendor, total and due date"],
          price: { model: "per_use", amount_cents: 25, note: "" },
        },
        screens,
        assumptions: ["Invoices arrive as pasted text, not scans"],
        questions: ["Which accounting tool do they export to?"],
      },
    };
    yield { type: "usage_final", inputTokens: 3000, outputTokens: 800 };
  };
}

class Scripted implements BuildProvider {
  readonly id = "scripted-test";
  calls: BuildRequest[] = [];
  constructor(public script: Script = proposer()) {}
  identity() {
    return { id: this.id, model: "scripted-model", version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Scripted test provider" };
  }
  pricing() {
    return { inputCentsPerMillionTokens: 300, outputCentsPerMillionTokens: 1500 };
  }
  start(req: BuildRequest, signal: AbortSignal) {
    this.calls.push(req);
    return this.script(req, signal);
  }
}

async function world(
  provider: BuildProvider | null = new Scripted(),
  operatorCeilingCents: number | null = 1_000,
) {
  const store = new Store(openDb(":memory:"));
  const clock = { t: Date.parse("2026-11-02T12:00:00.000Z") };
  const builds = new Builds(store.db, store, provider, {
    now: () => clock.t,
    operatorCeilingCents,
  });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
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
  const ava = await join("Ava Chen");
  const created = (
    await ava("/api/product-projects", "POST", {
      idea: "Turn invoices into clean data for small accounting teams.",
      foundation: "ai_api",
    })
  ).body;
  const id = created.project.id as string;
  const business = created.project.business_id as string;
  const budget = (cents: number) =>
    ava(`/api/businesses/${business}/build-budget`, "PUT", { limit_cents: cents });
  const say = (text: string, key: string, who = ava) =>
    who(`/api/product-projects/${id}/conversation`, "POST", { text, idempotency_key: key });
  const log = (who = ava) => who(`/api/product-projects/${id}/conversation`);
  // Production time scale (job 002a2): no test here is about the build deadline.
  const worker = (wid = "w1") => new BuildWorker(builds, provider as BuildProvider, { id: wid });
  const count = (sql: string, ...args: string[]) =>
    (store.db.prepare(sql).get(...args) as { n: number }).n;
  return { store, clock, builds, ava, join, id, business, budget, say, log, worker, count };
}

describe("guided authoring", () => {
  it("goes from an idea to an applied proposal, then a requested change to a second proposal", async () => {
    const w = await world();
    await w.budget(100);
    const first = await w.say(
      "Turn invoices into clean data for small accounting teams.",
      "msg-key-0001",
    );
    expect(first.status).toBe(201);
    expect(first.body.message).toMatchObject({
      role: "founder",
      job: { intent: "propose", state: "queued" },
    });
    await w.worker().runNext();

    let log = (await w.log()).body;
    expect(log.log.label).toBe("Product work log");
    expect(log.messages.map((m: { role: string }) => m.role)).toEqual(["founder", "assistant"]);
    expect(log.messages[1].text).toMatch(/first version/);
    const p1 = log.proposals[0];
    expect(p1).toMatchObject({ status: "open", base_revision: 1, current_owner: true });

    const detail = (await w.ava(`/api/product-projects/${w.id}/proposals/${p1.id}`)).body;
    expect(detail).toMatchObject({ base_is_head: true, assumptions: [expect.any(String)] });
    expect(detail.questions.length).toBeLessThanOrEqual(3);
    expect(detail.brief.name).toBe("Ledgerline");

    const applied = await w.ava(`/api/product-projects/${w.id}/proposals/${p1.id}/apply`, "POST");
    expect(applied.status).toBe(201);
    expect(applied.body.head).toMatchObject({ number: 2 });
    expect(applied.body.head.brief.name).toBe("Ledgerline");
    expect(applied.body.applied).toMatchObject({ revision: 2, created: true });
    // Revision 1 is untouched.
    expect((await w.ava(`/api/product-projects/${w.id}/revisions/1`)).body.brief.name).toBe(
      "Untitled product",
    );

    // A requested change is a new proposal against revision 2.
    const second = await w.say("Also return the invoice date", "msg-key-0002");
    expect(second.body.message.job.revision).toBe(2);
    await w.worker().runNext();
    log = (await w.log()).body;
    const p2 = log.proposals[0];
    expect(p2).toMatchObject({ status: "open", base_revision: 2 });
    expect(log.proposals[1]).toMatchObject({ id: p1.id, status: "applied", applied_revision: 2 });
    const d2 = (await w.ava(`/api/product-projects/${w.id}/proposals/${p2.id}`)).body;
    const outputs = d2.prototype.screens.find((s: { kind: string }) => s.kind === "model").outputs;
    expect(outputs.map((o: { key: string }) => o.key)).toContain("invoice_date");
    // The provider saw the work log, oldest first, ending with the new request.
    const sent = (w.builds.provider as Scripted).calls[1] as BuildRequest;
    expect(sent.intent).toBe("propose");
    expect(sent.conversation.at(-1)).toEqual({
      role: "founder",
      text: "Also return the invoice date",
    });
    expect(sent.content.brief.name).toBe("Ledgerline");
    const third = await w.ava(`/api/product-projects/${w.id}/proposals/${p2.id}/apply`, "POST");
    expect(third.body.head.number).toBe(3);
  });

  it("refuses to apply over edits made while the assistant was working, and keeps both", async () => {
    const w = await world();
    await w.budget(100);
    await w.say("Make it for bookkeepers", "msg-key-0001");
    // The founder saves their own edit before the proposal arrives.
    const view = (await w.ava(`/api/product-projects/${w.id}`)).body;
    await w.ava(`/api/product-projects/${w.id}/revisions`, "POST", {
      base_revision: 1,
      brief: { ...view.head.brief, name: "My own name" },
      prototype: view.head.prototype,
    });
    await w.worker().runNext();
    const p = (await w.log()).body.proposals[0];
    const detail = (await w.ava(`/api/product-projects/${w.id}/proposals/${p.id}`)).body;
    expect(detail).toMatchObject({ base_revision: 1, base_is_head: false, head: { number: 2 } });
    const refused = await w.ava(`/api/product-projects/${w.id}/proposals/${p.id}/apply`, "POST");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Revision 2 was saved after this proposal/);
    const now = (await w.ava(`/api/product-projects/${w.id}`)).body;
    expect(now.head).toMatchObject({ number: 2 });
    expect(now.head.brief.name).toBe("My own name");
  });

  it("applies a proposal once, however many times it is asked, including at the same moment", async () => {
    const w = await world();
    await w.budget(100);
    await w.say("Shape it", "msg-key-0001");
    await w.worker().runNext();
    const p = (await w.log()).body.proposals[0];
    const url = `/api/product-projects/${w.id}/proposals/${p.id}/apply`;
    const [a, b] = await Promise.all([w.ava(url, "POST"), w.ava(url, "POST")]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const again = await w.ava(url, "POST");
    expect(again.status).toBe(200);
    expect(again.body.applied).toMatchObject({ revision: 2, already: true });
    expect(w.count("SELECT COUNT(*) AS n FROM product_revisions WHERE project_id = ?", w.id)).toBe(
      2,
    );
  });

  it("treats a repeated message as the same request, and a reused key with other words as a conflict", async () => {
    const w = await world();
    await w.budget(100);
    const [a, b] = await Promise.all([
      w.say("Shape it", "msg-key-0001"),
      w.say("Shape it", "msg-key-0001"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.message.id).toBe(b.body.message.id);
    expect((await w.say("Something else", "msg-key-0001")).status).toBe(409);
    expect(w.count("SELECT COUNT(*) AS n FROM build_jobs WHERE intent = 'propose'")).toBe(1);
    expect(w.count("SELECT COUNT(*) AS n FROM product_messages")).toBe(1);
  });

  it("lets nobody but the business's current owner read or act on the work log", async () => {
    const w = await world();
    await w.budget(100);
    await w.say("Shape it", "msg-key-0001");
    await w.worker().runNext();
    const p = (await w.log()).body.proposals[0];
    const ben = await w.join("Ben Okafor");
    expect((await w.log(ben)).status).toBe(404);
    expect((await w.say("Mine now", "msg-key-0002", ben)).status).toBe(404);
    expect((await ben(`/api/product-projects/${w.id}/proposals/${p.id}`)).status).toBe(404);
    expect(
      (await ben(`/api/product-projects/${w.id}/proposals/${p.id}/apply`, "POST")).status,
    ).toBe(404);
    expect(w.count("SELECT COUNT(*) AS n FROM product_revisions WHERE project_id = ?", w.id)).toBe(
      1,
    );
  });

  it("fences a pending request at a sale and refuses the former owner's proposal to the buyer", async () => {
    const w = await world();
    await w.budget(100);
    await w.say("Shape it", "msg-key-0001");
    await w.worker().runNext();
    const p = (await w.log()).body.proposals[0];
    await w.say("Another idea", "msg-key-0002"); // queued, not yet run
    const ben = await w.join("Ben Okafor");
    w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(ben.id, w.business);
    w.store.db
      .prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)")
      .run(w.business, w.ava.id, ben.id, new Date().toISOString());
    // The former owner is out; the buyer sees the work log, which belongs to the business.
    expect((await w.log()).status).toBe(404);
    const seen = (await w.log(ben)).body;
    expect(seen.messages.length).toBe(3);
    expect(seen.messages[2].job).toMatchObject({
      state: "cancelled",
      failure: { code: "ownership_changed" },
    });
    expect(seen.proposals[0]).toMatchObject({ id: p.id, current_owner: false });
    const refused = await ben(`/api/product-projects/${w.id}/proposals/${p.id}/apply`, "POST");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/before the business changed hands/);
  });

  it("survives a restart before dispatch and runs the proposal once", async () => {
    const provider = new Scripted();
    const w = await world(provider);
    await w.budget(100);
    await w.say("Shape it", "msg-key-0001");
    expect(w.worker("old").claim()).not.toBeNull(); // the process stops here
    const fresh = w.worker("new");
    expect(fresh.recover({ orphanAll: true })).toEqual({ requeued: 1, held: 0 });
    await fresh.runNext();
    expect(provider.calls).toHaveLength(1);
    expect((await w.log()).body.proposals).toHaveLength(1);
  });

  it("cancels a running request; no proposal appears and the reservation follows usage", async () => {
    const reached = { open: () => {} };
    const gate = new Promise<void>((r) => {
      reached.open = r;
    });
    const provider = new Scripted(async function* (_req, signal) {
      reached.open();
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
      yield { type: "output", artifact: {} };
    });
    const w = await world(provider);
    await w.budget(100);
    const sent = await w.say("Shape it", "msg-key-0001");
    const running = w.worker().runNext();
    await gate;
    const job = (await w.ava(`/api/builds/${sent.body.message.job.id}/cancel`, "POST")).body.job;
    expect(job.cancel_requested).toBe(true);
    await running;
    const log = (await w.log()).body;
    expect(log.messages).toHaveLength(1);
    expect(log.messages[0].job).toMatchObject({ state: "cancelled", usage_state: "unknown" });
    expect(log.proposals).toHaveLength(0);
    expect(log.pending).toBeNull();
  });

  it("refuses malformed proposals and asks no more than three questions", async () => {
    const outputs: unknown[] = [
      "Sure! Here is a better brief: ...",
      { reply: "x", summary: "y", brief: {}, screens: [], assumptions: [], questions: [] },
      {
        reply: "x",
        summary: "y",
        brief: { name: "N" },
        screens: [
          {
            id: "f",
            kind: "form",
            title: "F",
            fields: [{ key: "a", label: "A", type: "text", options: [] }],
            submit_label: "Go",
          },
        ],
        assumptions: [],
        questions: ["1?", "2?", "3?", "4?"],
      },
      {
        reply: "x",
        summary: "y",
        brief: { name: "N" },
        screens: [{ id: "f", kind: "script", title: "rm -rf /" }],
        assumptions: [],
        questions: [],
      },
    ];
    for (const artifact of outputs) {
      const w = await world(
        new Scripted(async function* () {
          yield { type: "output", artifact };
          yield { type: "usage_final", inputTokens: 10, outputTokens: 10 };
        }),
      );
      await w.budget(100);
      const sent = await w.say("Shape it", "msg-key-0001");
      await w.worker().runNext();
      const job = (await w.ava(`/api/builds/${sent.body.message.job.id}`)).body.job;
      expect(job.state, JSON.stringify(artifact).slice(0, 40)).toBe("failed");
      expect(job.failure.code).toBe("invalid_output");
      expect(w.count("SELECT COUNT(*) AS n FROM product_proposals")).toBe(0);
      // Usage was final, so the reservation was released and the cost recorded exactly.
      expect(job).toMatchObject({ usage_state: "final", reserved_cents: 0 });
    }
  });
});

describe("a long work log", () => {
  it("shows the newest exchange, pages back through all of it, and never hides a new one", async () => {
    // Astra's follow-up: after 101 exchanges (202 messages) the newest was stored but
    // invisible, because the log returned the oldest page. 30 exchanges exceed the tail here.
    const w = await world();
    await w.budget(1000);
    for (let i = 1; i <= 30; i++) {
      await w.say(`Message ${i}`, `msg-key-${String(i).padStart(4, "0")}`);
      await w.worker().runNext();
    }
    const tail = (await w.log()).body;
    expect(tail.last_seq).toBe(60);
    expect(tail.messages).toHaveLength(50);
    expect(tail.messages.at(-1).seq).toBe(60);
    expect(tail.messages.at(-2).text).toBe("Message 30");
    expect(tail.has_older).toBe(true);

    const older = (
      await w.ava(`/api/product-projects/${w.id}/conversation?before=${tail.oldest_returned}`)
    ).body;
    expect(older.messages.map((m: { seq: number }) => m.seq)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect(older.has_older).toBe(false);

    // A new exchange after history is loaded appears in the next poll of the tail.
    await w.say("Message 31", "msg-key-0031");
    await w.worker().runNext();
    const next = (await w.log()).body;
    expect(next.messages.at(-2).text).toBe("Message 31");
    expect(next.messages.at(-1).role).toBe("assistant");
    expect(next.last_seq).toBe(62);
  });
});

describe("studio view scoping", () => {
  it("gives drafts an owner epoch that changes when the business changes hands", async () => {
    const w = await world();
    const before = (await w.ava(`/api/product-projects/${w.id}`)).body.business.owner_epoch;
    expect(before).toBe(`${w.ava.id}:0`);
    const ben = await w.join("Ben Okafor");
    w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(ben.id, w.business);
    w.store.db
      .prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)")
      .run(w.business, w.ava.id, ben.id, new Date().toISOString());
    const after = (await ben(`/api/product-projects/${w.id}`)).body.business.owner_epoch;
    expect(after).toBe(`${ben.id}:1`);
  });

  it("shows the studio the same availability as the assistant, including the ceiling", async () => {
    const w = await world(new Scripted(), null);
    const view = (await w.ava(`/api/product-projects/${w.id}`)).body;
    expect(view.build).toMatchObject({ available: false });
    expect(view.build.reason).toMatch(/overall AI spending ceiling/);
  });
});

describe("guided authoring budgets and availability", () => {
  it("keeps nothing and sends nothing when no provider is connected", async () => {
    const w = await world(null);
    await w.budget(100);
    const res = await w.say("Shape it", "msg-key-0001");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not connected/);
    const log = (await w.log()).body;
    expect(log.availability.available).toBe(false);
    expect(log.messages).toHaveLength(0);
    expect(log.per_request).toBeNull();
  });

  it("does not dispatch without an operator ceiling, whatever the founder's budget", async () => {
    const w = await world(new Scripted(), null);
    await w.budget(100);
    const res = await w.say("Shape it", "msg-key-0001");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overall AI spending ceiling/);
    expect(w.count("SELECT COUNT(*) AS n FROM product_messages")).toBe(0);
  });

  it("needs a business budget, keeps it within the operator ceiling, and refuses past either", async () => {
    // Each proposal reserves 24,000 × 300 + 6,000 × 1,500 millionths of a cent = 17 cents.
    const w = await world(new Scripted(), 30);
    const none = await w.say("Shape it", "msg-key-0001");
    expect(none.status).toBe(409);
    expect(none.body.error).toMatch(/Set an AI budget/);
    expect(w.count("SELECT COUNT(*) AS n FROM product_messages")).toBe(0);

    expect((await w.budget(31)).status).toBe(400); // above the operator's ceiling
    expect((await w.budget(30)).body).toMatchObject({ limit_cents: 30, max_settable_cents: 30 });
    expect((await w.log()).body.per_request).toMatchObject({ reserve_cents: 17 });
    expect((await w.say("Shape it", "msg-key-0001")).status).toBe(201);
    const second = await w.say("And more", "msg-key-0002");
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/Not enough AI budget/);

    // Another business cannot use the rest of the operator's ceiling either.
    const ben = await w.join("Ben Okafor");
    const other = (
      await ben("/api/product-projects", "POST", { idea: "Another idea", foundation: "ai_api" })
    ).body;
    await ben(`/api/businesses/${other.project.business_id}/build-budget`, "PUT", {
      limit_cents: 30,
    });
    const blocked = await ben(`/api/product-projects/${other.project.id}/conversation`, "POST", {
      text: "Shape it",
      idempotency_key: "msg-key-0003",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/overall AI spending limit/);
  });

  it("reports exact use and rounded budget consumption separately", async () => {
    const w = await world();
    await w.budget(100);
    await w.say("Shape it", "msg-key-0001");
    await w.worker().runNext();
    const b = (await w.ava(`/api/businesses/${w.business}/build-budget`)).body;
    // 3,000 × 300 + 800 × 1,500 = 2,100,000 millionths of a cent: 2.1 cents used, 3 counted.
    expect(b).toMatchObject({ used_microcents: 2_100_000, counted_cents: 3, reserved_cents: 0 });
  });
});
