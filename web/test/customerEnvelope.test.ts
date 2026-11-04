// Job 003q: the browser's own envelope check, against the contract-produced signing fixture and
// against envelopes the real API prepares (the server side runs on the labelled fixture chain).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { customerWorld, SyntheticProtection } from "../../server/test/customer-world.ts";
import {
  preimageOfHold,
  preimageOfUse,
  type SigningEnvelope,
  toHex,
  verifyEnvelope,
} from "../src/customerEnvelope.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SIGNING = JSON.parse(
  readFileSync(
    join(here, "..", "..", "server", "test", "fixtures", "v3", "customer-signing.json"),
    "utf8",
  ),
);
const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

describe("003q browser envelope check", () => {
  it("encodes the contract's hold and use messages byte for byte", () => {
    const e = {
      business_account: SIGNING.business,
      plan_id: SIGNING.plan_id,
      customer_account: SIGNING.customer,
      reg_id: SIGNING.reg_id,
      key_slot: SIGNING.key_slot,
      key_epoch: SIGNING.key_epoch,
      hold: SIGNING.hold,
      use: { slot: 0 },
    } as unknown as SigningEnvelope;
    expect(toHex(preimageOfHold(e))).toBe(SIGNING.hold.preimage_hex);
    expect(toHex(preimageOfUse(e, SIGNING.use.fingerprint_hex))).toBe(SIGNING.use.preimage_hex);
  });

  it("accepts the real API's envelope for the typed document, and refuses every alteration", async () => {
    const protection = new SyntheticProtection();
    const w = await customerWorld({ customer: { protection } });
    const offer = await w.offer();
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "env-key-0001",
      input: INPUT,
    });
    const env = p.body.use.envelope as SigningEnvelope;
    const terms = p.body.use.offer.terms;
    const expected = {
      input: INPUT,
      offerId: offer,
      network: terms.network,
      contract: terms.contract,
      unitPrice: terms.unit_price,
      asset: terms.asset,
      retentionDays: terms.retention_days,
      publicKey: SIGNING.public_key_hex as string,
      now: w.clock.now,
    };
    expect(await verifyEnvelope(env, expected)).toEqual({ ok: true });
    const refuse = async (changed: SigningEnvelope, x = expected) =>
      expect((await verifyEnvelope(changed, x)).ok).toBe(false);
    // Another document: refused for exactly that reason (not only by the fingerprint after it).
    expect(await verifyEnvelope(env, { ...expected, input: `${INPUT} ` })).toEqual({
      ok: false,
      problem: "This request isn't for the document in front of you.",
    });
    await refuse(env, { ...expected, publicKey: "ab".repeat(32) }); // not my key
    await refuse(env, { ...expected, now: Number(env.consent.sign_by_ms) }); // too late
    await refuse({ ...env, consent: { ...env.consent, unit_price: "1" } });
    await refuse({ ...env, hold: { ...env.hold, units: 2 } });
    await refuse({
      ...env,
      hold: { ...env.hold, serve_until_ms: String(BigInt(env.hold.serve_until_ms) + 1n) },
    });
    await refuse({ ...env, use: { ...env.use, message_hex: "00".repeat(32) } });
    await refuse({ ...env, commitment: { ...env.commitment, salt_hex: "11".repeat(32) } });
    await refuse({ ...env, envelope_digest: "22".repeat(32) });
    await refuse({ ...env, business_account: "other.near" });
    await refuse({ ...env, reg_id: "-1" }); // malformed
  });
});
