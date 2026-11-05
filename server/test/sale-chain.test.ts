// Job 003wf2: the sale double replays the contract's own scripted Direct sale history
// (fixtures/v3/direct-sale.json, produced by contracts/business-v3 tests.rs
// direct_sale_matches_server_fixture). The same encoded calls must give byte-identical views,
// the same refusal codes, return values and logs, and every digest the contract computed must be
// recomputed exactly by the server's port of digest_of.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dealDigest } from "../src/saleTerms.ts";
import { SaleChain, startFromFixture } from "./sale-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON, read field by field
type Json = Record<string, any>;
const here = dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "direct-sale.json"), "utf8"),
) as Json;

const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

function world() {
  const balances = new Map<string, bigint>();
  const registered = new Set<string>();
  for (const a of [
    "founder.near",
    "buyer.near",
    "stranger.near",
    "meter2.near",
    DOC.business as string,
  ]) {
    balances.set(a, 10n ** 30n);
    registered.add(a);
  }
  return new SaleChain(startFromFixture(DOC), { balances, registered });
}

function viewsOf(c: SaleChain, expected: Json) {
  return {
    get_control: c.view("get_control", {}),
    get_treasury: c.view("get_treasury", {}),
    get_outcomes: c.view("get_outcomes", {}),
    get_pending: c.view("get_pending", {}),
    get_party: Object.fromEntries(
      Object.keys(expected.get_party).map((a) => [a, c.view("get_party", { account: a })]),
    ),
    get_sale_terms: Object.fromEntries(
      Object.keys(expected.get_sale_terms).map((a) => [a, c.view("get_sale_terms", { buyer: a })]),
    ),
  };
}

describe("003wf2 sale double against the contract's scripted history", () => {
  it("starts from exactly the contract's views", () => {
    const c = world();
    expect(viewsOf(c, DOC.start)).toEqual(DOC.start);
  });

  it("replays every step: same codes, values, logs and byte-identical views", () => {
    const c = world();
    const steps = DOC.steps as Json[];
    expect(steps.length).toBeGreaterThanOrEqual(45);
    for (const s of steps) {
      c.now = BigInt(s.now_ms);
      if (s.payout) c.failPayouts = s.payout.transfer_ok ? 0 : 1;
      const out = c.walletCall(s.signer, {
        receiverId: s.receiver,
        methodName: s.method,
        args: s.args,
        deposit: s.deposit,
        gas: "30000000000000",
      });
      const receipts = out.receipts_outcome as Json[];
      const first = receipts[0]?.outcome as Json;
      const where = `step "${s.case}"`;
      if (s.refused) {
        expect("Failure" in out.status, where).toBe(true);
        expect(JSON.stringify(first.status), where).toContain(s.refused);
      } else if (s.method === "ft_transfer_call") {
        const receiver = receipts.find((r) => r.outcome.executor_id === DOC.business)?.outcome;
        expect(JSON.parse(decode(receiver.status.SuccessValue)), where).toBe(s.unused);
        expect(receiver.logs, where).toEqual(s.logs);
        const resolution = receipts.find(
          (r) => r.outcome.executor_id === DOC.asset && r.id.endsWith("resolution"),
        )?.outcome;
        expect(JSON.parse(decode(resolution.status.SuccessValue)), where).toBe(
          String(BigInt(s.args.amount) - BigInt(s.unused)),
        );
      } else if (s.payout) {
        expect(first.logs, where).toEqual(s.logs);
        const cb = receipts.find((r) => r.id.endsWith("callback"))?.outcome;
        expect(cb.logs, where).toEqual(s.payout.logs);
        expect(JSON.parse(decode(cb.status.SuccessValue)), where).toBe(s.payout.value);
        expect(JSON.parse(decode(out.status.SuccessValue)), where).toBe(s.payout.value);
      } else {
        expect(first.logs, where).toEqual(s.logs);
        const v = decode(first.status.SuccessValue);
        if (s.value === null) expect(v, where).toBe("");
        else expect(JSON.parse(v), where).toEqual(s.value);
      }
      expect(viewsOf(c, s.views), where).toEqual(s.views);
    }
  });

  it("recomputes every digest the contract produced, from the views alone", () => {
    const c = world();
    let checked = 0;
    for (const s of DOC.steps as Json[]) {
      const control = JSON.parse(s.views.get_control) as Json;
      const d = control.live_deal;
      if (!d) continue;
      const terms = JSON.parse(Object.values(s.views.get_sale_terms)[0] as string) as Json;
      expect(
        dealDigest({
          business: DOC.business,
          seq: d.seq,
          version: d.version,
          seller: d.seller,
          buyer: d.buyer,
          asset: DOC.asset,
          price: d.price,
          expires_at_ms: d.expires_at_ms,
          close_window_ms: d.close_window_ms,
          available_floor: d.available_floor,
          grants: d.grants,
          terms_hash: d.terms_hash,
          expected_generation: d.expected_generation,
          manifest: control.service_manifest,
          manifest_seq: control.manifest_seq,
          plan_count: terms.plan_count,
          min_reserve: terms.min_reserve,
          close_mode: control.close_mode,
          closer: control.closer,
        }),
        `step "${s.case}"`,
      ).toBe(d.digest);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // The accepted fixtures' digests too (another business shape: a different floor and grants).
    for (const name of ["direct-accepting", "gated-closing"]) {
      const f = JSON.parse(
        readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8"),
      ) as Json;
      const control = JSON.parse(f.get_control) as Json;
      const d = control.live_deal;
      expect(
        dealDigest({
          business: DOC.business,
          seq: d.seq,
          version: d.version,
          seller: d.seller,
          buyer: d.buyer,
          asset: DOC.asset,
          price: d.price,
          expires_at_ms: d.expires_at_ms,
          close_window_ms: d.close_window_ms,
          available_floor: d.available_floor,
          grants: d.grants,
          terms_hash: d.terms_hash,
          expected_generation: d.expected_generation,
          manifest: control.service_manifest,
          manifest_seq: control.manifest_seq,
          plan_count: 2,
          min_reserve: "250000",
          close_mode: control.close_mode,
          closer: control.closer,
        }),
        name,
      ).toBe(d.digest);
    }
    expect(c.calls).toBe(0);
  });

  it("refuses calls it doesn't model and a deposit on the non-payable expire", () => {
    const c = world();
    expect(() =>
      c.walletCall("buyer.near", {
        receiverId: "elsewhere.near",
        methodName: "ft_transfer_call",
        args: {},
        deposit: "1",
        gas: "1",
      }),
    ).toThrow(/not a sale-path call/);
    const out = c.walletCall("buyer.near", {
      receiverId: DOC.business,
      methodName: "withdraw_profit",
      args: {},
      deposit: "1",
      gas: "1",
    });
    expect(JSON.stringify(out.status)).toContain("MethodNotFound");
    const paid = c.walletCall("buyer.near", {
      receiverId: DOC.business,
      methodName: "expire_sale_guarded",
      args: { deal_seq: "1", expected_control_seq: "3" },
      deposit: "1",
      gas: "1",
    });
    expect(JSON.stringify(paid.status)).toContain("doesn't accept deposit");
  });
});
