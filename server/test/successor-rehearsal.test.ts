// Job 006c (docs/design/SUCCESSOR_REHEARSAL.md): the successor rehearsal. A live business (the
// Relaydesk and quote-app sale worlds, synthetic) is snapshotted; the rehearsal journey runs in its
// own temporary directory, seeded with the snapshot's exact product, and its sealed record is
// checked: the rebuilt digest matches, the founder-only dependency fails and is corrected with the
// check repeated, the former owner is refused, the successor releases a checked version, the
// customer keeps their case or pass, external dependencies stay pending, and the directory is gone.
// Fictional data; no network.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSuccessorRehearsal } from "../../scripts/lib/successor/run.ts";
import {
  type SuccessorRunner,
  sealSuccessorRecord,
  snapshotDigest,
  takeSnapshot,
  verifySuccessorRecord,
} from "../src/successorRehearsal.ts";
import type { Json } from "./customer-world.ts";
import { saleWorld } from "./sale-world.ts";

async function rehearse(product: "relaydesk" | "quote-app") {
  const live = await saleWorld({ product });
  const { snapshot, seed } = takeSnapshot(live.w.state.store.db, live.biz);
  expect(snapshot.product?.supported, snapshot.product?.reason ?? "").toBe(true);
  if (!seed) throw new Error("no seed");
  const digest = snapshotDigest(snapshot, seed);
  const raw = await runSuccessorRehearsal({ snapshot, seed, digest });
  const v = verifySuccessorRecord(raw);
  expect(v.problems).toEqual([]);
  return { live, record: v.record as Json, raw, digest };
}

describe("006c successor rehearsal journey", () => {
  it("Relaydesk: every step as expected, the founder-only dependency failed then corrected, directory removed", async () => {
    const { record, digest } = await rehearse("relaydesk");
    expect(record.header.snapshot_digest).toBe(digest);
    expect(
      (record.steps as Json[]).map((s) => [s.key, s.outcome]),
      JSON.stringify(record.steps, null, 1),
    ).toEqual([
      ["rebuild", "passed"],
      ["existing_customer", "passed"],
      ["change_of_control", "passed"],
      ["founder_dependency", "passed"],
      ["corrected", "passed"],
      ["former_owner", "passed"],
      ["successor_release", "passed"],
      ["customer_continuity", "passed"],
    ]);
    expect(record.outcome.result).toBe("passed");
    const deps = Object.fromEntries((record.dependencies as Json[]).map((d) => [d.key, d.status]));
    expect(deps).toMatchObject({
      business_contract: "rehearsed",
      metering_operator: "failed_then_corrected",
      external: "pending_external",
    });
    expect(record.disposal.removed).toBe(true);
    expect(existsSync(record.disposal.directory)).toBe(false);
  }, 60_000);

  it("a web app (pass): the pre-sale pass still opens after the successor releases", async () => {
    const { record } = await rehearse("quote-app");
    expect(
      (record.steps as Json[]).every((s) => s.outcome === "passed"),
      JSON.stringify(record.steps, null, 1),
    ).toBe(true);
  }, 60_000);

  it("a record that was changed, or carries key material, doesn't check out", async () => {
    const { raw } = await rehearse("relaydesk");
    const edited = JSON.parse(raw) as Json;
    edited.outcome.result = "passed";
    edited.steps[3].outcome = "passed";
    edited.steps[0].observed = "edited";
    expect(verifySuccessorRecord(JSON.stringify(edited)).problems).toContain(
      "steps digest differs",
    );
    expect(verifySuccessorRecord(raw.replace("synthetic rehearsal", "es_session=abc")).ok).toBe(
      false,
    );
  }, 60_000);
});

/** The runner as the server calls it, in-process (the child process is tested separately). */
const makeRunner =
  (run: (input: Parameters<SuccessorRunner>[0]) => Promise<string>): SuccessorRunner =>
  (input) =>
    run(input);

describe("006c rehearsals through the routes", () => {
  async function routes(
    runner: (input: Parameters<SuccessorRunner>[0]) => Promise<string> = runSuccessorRehearsal,
    deadlineMs?: number,
  ) {
    const s = await saleWorld({ product: "relaydesk" });
    s.w.state.app = s.w.make(s.w.state.store, undefined, {
      successorRunner: makeRunner(runner),
      successorDeadlineMs: deadlineMs,
    });
    const until = async () => {
      for (let i = 0; i < 400; i++) {
        const l = (await s.ava(`/api/businesses/${s.biz}/rehearsals`)).body;
        if (l.rehearsals[0] && l.rehearsals[0].state !== "running") return l;
        await new Promise((ok) => setTimeout(ok, 25));
      }
      throw new Error("still running");
    };
    return { s, until };
  }

  it("the owner starts one, follows it, downloads the record; the handover record carries it as recorded", async () => {
    const { s, until } = await routes();
    const before = (await s.ava(`/api/businesses/${s.biz}/rehearsals`)).body;
    expect(before).toMatchObject({
      available: true,
      product: { kind: "workflow_spec", supported: true },
    });
    expect((await s.noah(`/api/businesses/${s.biz}/rehearsals`)).status).toBe(404);
    expect((await s.noah(`/api/businesses/${s.biz}/rehearsals`, "POST", {})).status).toBe(404);
    const started = await s.ava(`/api/businesses/${s.biz}/rehearsals`, "POST", {});
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(started.body.rehearsal.state).toBe("running");
    expect((await s.ava(`/api/businesses/${s.biz}/rehearsals`, "POST", {})).body.code).toBe("busy");
    const done = await until();
    const r = done.rehearsals[0] as Json;
    expect(r.state, r.detail).toBe("passed");
    expect(r.steps).toHaveLength(8);
    const rec = await s.ava(`/api/businesses/${s.biz}/rehearsals/${r.id}/record`);
    expect(verifySuccessorRecord(JSON.stringify(rec.body)).ok).toBe(true);
    const hr = (await s.ava(`/api/businesses/${s.biz}/handover-record`)).body;
    expect(hr.body.control.successor_rehearsal).toMatchObject({
      id: r.id,
      state: "passed",
      kind: "as_recorded",
    });
    const sheet = (await s.ava(`/api/businesses/${s.biz}/control-sheet`)).body;
    expect(sheet.statements.map((g: Json) => g.group)).toContain("Successor rehearsal");
    // A finished rehearsal is immutable.
    expect(() =>
      s.w.state.store.db.prepare("UPDATE successor_rehearsals SET state = 'failed'").run(),
    ).toThrow(/immutable/);
  }, 60_000);

  it("unsupported products, a failing runner, the deadline and a restart: nothing is kept but the outcome", async () => {
    const ledger = await saleWorld();
    ledger.w.state.app = ledger.w.make(ledger.w.state.store, undefined, {
      successorRunner: makeRunner(runSuccessorRehearsal),
    });
    const ns = await ledger.ava(`/api/businesses/${ledger.biz}/rehearsals`, "POST", {});
    expect([ns.status, ns.body.code]).toEqual([409, "not_supported"]);
    expect(ns.body.error).toMatch(/spend the model budget/);

    const failing = await routes(async () => {
      throw new Error("synthetic failure");
    });
    await failing.s.ava(`/api/businesses/${failing.s.biz}/rehearsals`, "POST", {});
    const f = (await failing.until()).rehearsals[0] as Json;
    expect([f.state, f.detail]).toEqual([
      "interrupted",
      "The rehearsal stopped before it finished: synthetic failure",
    ]);

    const slow = await routes(() => new Promise<string>(() => {}), 50);
    await slow.s.ava(`/api/businesses/${slow.s.biz}/rehearsals`, "POST", {});
    expect(((await slow.until()).rehearsals[0] as Json).detail).toMatch(/time limit/);

    // A restart while one runs: it is interrupted, never resumed.
    const hung = await routes(() => new Promise<string>(() => {}));
    await hung.s.ava(`/api/businesses/${hung.s.biz}/rehearsals`, "POST", {});
    hung.s.w.state.app = hung.s.w.make(hung.s.w.state.store, undefined, {
      successorRunner: makeRunner(runSuccessorRehearsal),
    });
    const after = (await hung.s.ava(`/api/businesses/${hung.s.biz}/rehearsals`)).body.rehearsals[0];
    expect([after.state, after.detail]).toEqual([
      "interrupted",
      "The server stopped while it ran; nothing from it was kept.",
    ]);
  }, 60_000);

  it("a changed business makes the result stale; a directory left behind isn't accepted", async () => {
    const changed = await routes(async (input) => {
      const raw = await runSuccessorRehearsal(input);
      // The owner withdraws the offer while the rehearsal runs.
      changed.s.w.state.store.db
        .prepare("UPDATE customer_offers SET state = 'retired', retired_at = ?")
        .run(new Date().toISOString());
      return raw;
    });
    await changed.s.ava(`/api/businesses/${changed.s.biz}/rehearsals`, "POST", {});
    expect(((await changed.until()).rehearsals[0] as Json).state).toBe("stale");

    const kept = mkdtempSync(join(tmpdir(), "everstreet-kept-"));
    const left = await routes(async (input) => {
      const rec = JSON.parse(await runSuccessorRehearsal(input)) as Json;
      const { digests: _d, format: _f, version: _v, ...body } = rec;
      return JSON.stringify(
        sealSuccessorRecord({ ...body, disposal: { directory: kept, removed: true } } as never),
      );
    });
    await left.s.ava(`/api/businesses/${left.s.biz}/rehearsals`, "POST", {});
    expect(((await left.until()).rehearsals[0] as Json).detail).toMatch(/directory wasn't removed/);
    rmSync(kept, { recursive: true, force: true });
  }, 90_000);
});
