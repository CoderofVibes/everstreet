// Showcase stage A (docs/design/SHOWCASE_SPEC.md): the homepage samples can't drift from the
// product, and the public example is an allowlisted, provenance-tagged projection of a VERIFIED
// committed testnet record (never a database read; nothing served from a record that fails).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { samplesJson } from "../../scripts/lib/showcaseSamples.ts";
import { DEFAULT_LEDGERLINE_RECORD, ledgerlineExample } from "../src/examples.ts";
import { customerWorld, type Json } from "./customer-world.ts";

describe("showcase samples", () => {
  it("the committed samples equal a fresh run through the product's own cases, stand-in and validation", async () => {
    const committed = readFileSync("web/src/showcase/samples.json", "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(await samplesJson());
    const j = JSON.parse(committed) as Json;
    const by = (id: string) => (j.samples as Json[]).find((s) => s.id === id) as Json;
    expect(by("req_clean").extraction.outcome).toBe("extracted");
    expect(by("req_totals_disagree").extraction.issues).toEqual([
      "Line items add up to 260.00, not the stated 300.00",
    ]);
    expect(
      (by("req_totals_disagree").extraction.fields as Json[]).find((f) => f.key === "total")?.value,
    ).toBe("300.00");
    expect([
      by("req_unrelated_text").extraction.outcome,
      by("req_unrelated_text").charged_on_a_real_run,
    ]).toEqual(["refused", false]);
  });
});

/** Every key path in a value (arrays collapse to [] so element shapes are compared). */
function keyPaths(v: unknown, prefix = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keyPaths(x, `${prefix}[]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) => [
      `${prefix}.${k}`,
      ...keyPaths(x, `${prefix}.${k}`),
    ]);
  return [];
}
const ALLOWED = new Set(
  `.example .label .record .record.format .record.digest .record.commit .record.verified_offline
  .record.reproduce .network .contract .contract.account .contract.code_hash .model .model.source
  .model.note .token .token.account .token.symbol .token.decimals .token.source .figures .checkpoints .transactions .refusals .releases`
    .split(/\s+/)
    .filter(Boolean),
);
const allowedPath = (p: string) =>
  ALLOWED.has(p) ||
  /^\.figures\.[a-z_]+(\.(value|unit|source|derived_from|role|generation))?$/.test(p) ||
  /^\.checkpoints\[\]\.(name|at|block|free|consumed|owner|owner_role|generation|source)$/.test(p) ||
  /^\.transactions\[\]\.(step|role|method|receiver|hash|explorer|succeeded|source)$/.test(p) ||
  /^\.refusals\[\]\.(step|status|source)$/.test(p) ||
  /^\.releases\[\]\.(step|by|source)$/.test(p);

describe("the public example (verified testnet record -> allowlisted projection)", () => {
  it("derives the headline figures from the record and tags every figure with its own source", () => {
    const x = ledgerlineExample();
    expect(x.figures.prepaid.value).toBe((100n * 150000n).toString());
    expect(x.figures.earned_by_end.value).toBe((22n * 150000n).toString());
    expect([
      x.figures.owed_at_close.value,
      x.figures.after_next_use.value,
      x.figures.after_update.value,
    ]).toEqual(["80", "79", "78"]);
    expect(x.figures.control_before).toMatchObject({ role: "founder", generation: 1 });
    expect(x.figures.control_after).toMatchObject({ role: "buyer", generation: 2 });
    for (const c of x.checkpoints) expect(c.source).toBe("near_testnet_final");
    for (const t of x.transactions) {
      expect(t.source).toBe("near_testnet_tx");
      expect(t.explorer).toMatch(
        /^https:\/\/testnet\.nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]{43,44}$/,
      );
    }
    expect(x.model.source).toBe("stand_in_model");
    expect(x.refusals.map((r) => r.status)).toEqual([404, 404]);
  });

  it("is an allowlist: no field outside the named ones, no document text, results, keys or app bodies", () => {
    const x = ledgerlineExample();
    const stray = keyPaths(x).filter((p) => !allowedPath(p));
    expect(stray).toEqual([]);
    const text = JSON.stringify(x);
    expect(text).not.toMatch(
      /SH-1042|Stackline|invoice|ed25519:|evs_agent_|cookie|terms_digest|envelope/i,
    );
  });

  it("serves nothing from a record that doesn't verify (a one-character change), or that is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "example-"));
    try {
      const raw = readFileSync(DEFAULT_LEDGERLINE_RECORD, "utf8");
      const bad = join(dir, "tampered.json");
      writeFileSync(bad, raw.replace('"free": "80"', '"free": "81"'));
      expect(() => ledgerlineExample(bad)).toThrow(/didn't verify/);
      expect(() => ledgerlineExample(join(dir, "missing.json"))).toThrow(/isn't on this server/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the public route answers without sign-in and equals the projection; it reads no database", async () => {
    const w = await customerWorld();
    const res = await w.state.app.request("/api/examples/ledgerline");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(ledgerlineExample())));
  });
});
