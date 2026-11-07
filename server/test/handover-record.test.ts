// Job 003x: the buyer's control sheet, the portable record, and the offline verifier, through the
// real routes (in-process app, scripted runtime, fictional people; no network).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonical,
  digestsFor,
  RECORD_MAX_BYTES,
  SECTIONS,
  verifyRecord,
} from "../src/handoverVerify.ts";
import { correct, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

async function released() {
  const w = runtimeWorld(new ScriptedRuntime(correct));
  const f = await w.founder();
  await w.release(f);
  return { w, f };
}

describe("003x control sheet and portable record", () => {
  it("only the current owner reads either; after a change of hands the buyer gets the receipt as history and the seller nothing", async () => {
    const { w, f } = await released();
    const sheet = await f.ava(`/api/businesses/${f.business}/control-sheet`);
    expect(sheet.status).toBe(200);
    const groups = sheet.body.statements.map((g: { group: string }) => g.group);
    // Judge rehearsal (Nov 7): the server's count of control changes is not called a generation.
    expect(sheet.body.statements[0].items[0].text).toMatch(/change of control recorded here/);
    expect(sheet.body.statements[0].items[0].text).not.toMatch(/owner generation/);
    expect(groups).toEqual([
      "What you control",
      "What customers keep",
      "Still to transfer outside NEAR",
    ]);
    const external = sheet.body.statements[2].items;
    expect(external.every((i: { kind: string }) => i.kind === "pending_external")).toBe(true);
    expect(JSON.stringify(external)).not.toMatch(/"kind":"current"/);

    const noah = await w.join("Noah Brandt");
    expect((await noah(`/api/businesses/${f.business}/control-sheet`)).status).not.toBe(200);
    expect((await noah(`/api/businesses/${f.business}/handover-record`)).status).not.toBe(200);
    w.transfer(f.business, f.ava.id, noah.id);
    expect((await f.ava(`/api/businesses/${f.business}/control-sheet`)).status).toBe(404);
    expect((await f.ava(`/api/businesses/${f.business}/handover-record`)).status).toBe(404);
    const after = (await noah(`/api/businesses/${f.business}/control-sheet`)).body;
    const control = after.statements[0].items;
    expect(control[0]).toMatchObject({ kind: "current" });
    expect(control.find((i: { kind: string }) => i.kind === "historical").text).toMatch(
      /moved from Ava Chen to Noah Brandt/,
    );
    const record = (await noah(`/api/businesses/${f.business}/handover-record`)).body;
    expect(record.body.receipt).toMatchObject({ kind: "historical" });
    expect(record.body.releases[0]).toMatchObject({ state: "active", passed: 10, total: 10 });
    const text = JSON.stringify(record);
    for (const forbidden of [
      "signed_tx",
      "private_key",
      "ciphertext",
      "input_ref",
      "result_ref",
      "work_log",
    ])
      expect(text).not.toContain(forbidden);
    const v = verifyRecord(text);
    expect(v).toMatchObject({ ok: true, mismatched: [], missing: [], inconsistent: [] });
    expect(v.cannot_establish.join(" ")).toMatch(/isn't signed/);
    expect(v.needs_fresh_observation.length).toBeGreaterThan(0);
    // The server's verify route is the same pure check.
    const viaRoute = await noah("/api/handover-records/verify", "POST", record);
    expect(viaRoute.body.ok).toBe(true);
  });

  it("the verifier refuses changed bytes, missing sections, inconsistent identities, other versions and oversized input", async () => {
    const { f } = await released();
    const record = (await f.ava(`/api/businesses/${f.business}/handover-record`)).body;
    // Changed bytes: one release's digest altered, digests left as they were.
    const tampered = structuredClone(record);
    tampered.body.releases[0].artifact_digest = "0".repeat(64);
    const t = verifyRecord(JSON.stringify(tampered));
    expect(t.ok).toBe(false);
    expect(t.mismatched.join(" ")).toMatch(/"releases" doesn't match/);
    // A missing mandatory section.
    const cut = structuredClone(record);
    delete cut.body.omissions;
    expect(verifyRecord(JSON.stringify(cut)).missing).toEqual([
      'Mandatory section "omissions" is missing.',
    ]);
    // Inconsistent identities, even with digests recomputed to match (digests prove bytes, not sense).
    const odd = structuredClone(record);
    odd.body.offers = [{ id: "offer-x", release_id: "no-such-release", state: "active" }];
    odd.body.control.business_id = "another-business";
    odd.digests = digestsFor(odd.body);
    const o = verifyRecord(JSON.stringify(odd));
    expect(o.mismatched).toEqual([]);
    expect(o.inconsistent).toEqual([
      "The control section names another business.",
      "Offer offer-x names a release that isn't in this record.",
    ]);
    expect(o.ok).toBe(false);
    expect(verifyRecord(JSON.stringify({ ...record, version: 2 })).format.supported).toBe(false);
    expect(verifyRecord("not json").format.detail).toBe("Not valid JSON.");
    expect(verifyRecord(" ".repeat(RECORD_MAX_BYTES + 1)).format.detail).toMatch(/Larger than/);
    expect(SECTIONS.every((s) => typeof canonical(record.body[s]) === "string")).toBe(true);
  });

  it("the offline script verifies a file on its own (exit 0) and refuses a tampered one (exit 1)", async () => {
    const { f } = await released();
    const record = (await f.ava(`/api/businesses/${f.business}/handover-record`)).body;
    const dir = mkdtempSync(join(tmpdir(), "record-"));
    try {
      const good = join(dir, "good.json");
      writeFileSync(good, JSON.stringify(record));
      const run = (file: string) =>
        spawnSync(
          process.execPath,
          ["--import", "tsx", "scripts/verify-handover-record.ts", file],
          { encoding: "utf8", timeout: 30_000 },
        );
      expect(run(good).status).toBe(0);
      const bad = join(dir, "bad.json");
      writeFileSync(
        bad,
        JSON.stringify({ ...record, body: { ...record.body, receipt: { kind: "forged" } } }),
      );
      const r = run(bad);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/doesn't match its digest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
