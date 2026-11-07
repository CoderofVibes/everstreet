// The Closing Ledger's server side: the in-progress inventory for a live deal's current
// participants (counts only), and the Gated readiness checklist: deterministic, bound to one
// deal version, digest and generation, unexpired, and signed so a change after issue shows.

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReadinessSigner, readinessApplies, readinessSignatureOk } from "../src/readiness.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

const deal = { seq: "1", version: 2, digest: "a".repeat(64) };
const input = (o: Partial<Parameters<ReadinessSigner["issue"]>[0]> = {}) => ({
  deal,
  generation: 3,
  control_seq: "9",
  runtime: { eligible: true, reasons: [] },
  seller_open_requests: 0,
  inventory: { reservations_pending: 0, unresolved: 0, settlements_pending: 0 },
  now_ms: 1_000_000,
  ...o,
});

describe("Gated readiness checklist", () => {
  it("is signed, bound to the deal and generation, and expires", () => {
    const keys = generateKeyPairSync("ed25519");
    const signer = new ReadinessSigner(keys);
    const r = signer.issue(input());
    expect(r.items.map((i) => [i.key, i.ok, i.value])).toEqual([
      ["runtime", true, "Healthy"],
      ["seller_admin", true, "Frozen"],
      ["queued_work", true, "Safe to replay"],
    ]);
    expect(r.signer).toMatch(/^ed25519:/);
    expect(readinessSignatureOk(r, keys.publicKey)).toBe(true);
    // Deterministic for the same inputs and time.
    expect(signer.issue(input()).signature).toBe(r.signature);
    // A changed item, expiry or deal no longer verifies.
    const forged = { ...r, items: r.items.map((i) => ({ ...i, value: "Healthy" })) };
    expect(readinessSignatureOk(forged, keys.publicKey)).toBe(false);
    expect(readinessSignatureOk({ ...r, valid_until_ms: "9".repeat(15) }, keys.publicKey)).toBe(
      false,
    );
    expect(
      readinessSignatureOk(
        { ...r, deal: { ...deal, version: 3 } },
        createPublicKey(keys.publicKey.export({ format: "pem", type: "spki" })),
      ),
    ).toBe(false);
    // Another key didn't issue it.
    expect(readinessSignatureOk(r, generateKeyPairSync("ed25519").publicKey)).toBe(false);
    // Applies only to the same deal version, digest and generation, before it expires.
    expect(readinessApplies(r, deal, 3, 1_000_001)).toBe(true);
    expect(readinessApplies(r, { ...deal, version: 3 }, 3, 1_000_001)).toBe(false);
    expect(readinessApplies(r, { ...deal, digest: "b".repeat(64) }, 3, 1_000_001)).toBe(false);
    expect(readinessApplies(r, deal, 4, 1_000_001)).toBe(false);
    expect(readinessApplies(r, deal, 3, 1_000_000 + 15 * 60_000)).toBe(false);
  });

  it("states what isn't ready instead of claiming it is", () => {
    const r = new ReadinessSigner().issue(
      input({
        runtime: { eligible: false, reasons: ["metering not appointed"] },
        seller_open_requests: 1,
        inventory: { reservations_pending: 1, unresolved: 1, settlements_pending: 0 },
      }),
    );
    expect(r.items.map((i) => [i.ok, i.value])).toEqual([
      [false, "metering not appointed"],
      [false, "1 open seller request"],
      [false, "2 not yet decided"],
    ]);
  });
});

describe("Closing Ledger inventory", () => {
  it("current participants of a live deal see what is in flight; a Direct deal has no checklist", async () => {
    const s = await saleWorld();
    expect((await s.setup(s.ava)).body.inventory).toBeNull(); // no live deal
    await s.act(s.ava, SELLER, "propose", proposal());
    const a = await s.setup(s.ava);
    expect(a.body.inventory).toMatchObject({
      reservations_pending: 0,
      settlements_unsettled: 0,
      unresolved: 0,
      pending_payouts: 0,
      open_wallet_requests: 0,
    });
    expect(a.body.readiness).toBeNull();
    // A request the buyer prepared but hasn't sent is an open wallet request on this sale.
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund", {}, { send: false });
    expect((await s.setup(s.ava)).body.inventory.open_wallet_requests).toBe(1);
    // Strangers see nothing.
    expect((await s.setup(s.stranger)).status).toBe(404);
  });
});
