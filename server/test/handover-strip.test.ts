// The proof page's handover strip (server/src/examples.ts handoversOf): each recorded sale of the
// Ledgerline example at the moment control changed, read only from records whose digests verify.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AFTER_SALES,
  DEFAULT_SALE_RECORDS,
  handoversFrom,
  handoversOf,
} from "../src/examples.ts";

const BIZ = "ledgerline-v3-3b.everstreet.testnet";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

describe("the handover strip", () => {
  it("shows all three sales, each close and the former owner's first refused call on chain", () => {
    const h = handoversOf(BIZ);
    expect(h.sales.map((x) => [x.from.generation, x.to.generation])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(h.sales.map((x) => x.to.account?.split(".")[0])).toEqual([
      "buyer-v3s3",
      "noor-v3s3",
      "ines-v3s4",
    ]);
    for (const x of h.sales) {
      expect(x.closed.hash).toMatch(HASH);
      // The read after the close is the new owner's, at a block the record names.
      expect(x.read_after?.owner).toBe(x.to.account);
      expect(Number(x.read_after?.block)).toBeGreaterThan(0);
      // Every former owner's refusal is a transaction on chain, after its own close.
      expect(x.former_owner_refused?.code).toBe("E_NOT_OWNER");
      expect(x.former_owner_refused?.hash).toMatch(HASH);
    }
    // Which contract refused each former owner (Nov 7 review: a companion each time, never the
    // business itself, and twice as the call's answer rather than a failed transaction), so the
    // page can say so.
    expect(
      h.sales.map((x) => [
        x.former_owner_refused?.method,
        x.former_owner_refused?.receiver?.split(".")[0],
        x.former_owner_refused?.how,
      ]),
    ).toEqual([
      ["request", "feed-key-v3s3", "answer"],
      ["grant", "budget-v3s3", "failed"],
      ["approve", "budget-v3s4", "answer"],
    ]);
    // The first sale's seller was refused only in the later record (the companions' run).
    expect(h.sales[0]?.former_owner_refused?.record).toBe("data/evidence/v3-ext-testnet.json");
    // The customer was read at the first close; the later runs didn't read them.
    expect(h.sales.map((x) => x.customer_unused_at_close)).toEqual(["80", null, null]);
    // After all three: nothing lost (78 unused + 22 used = the 100 bought).
    expect(h.after).toMatchObject({
      owner: "ines-v3s4.everstreet.testnet",
      generation: 4,
      customer: { unused: "78", used: "22", bought: "100" },
    });
  });

  it("drops a sale whose record doesn't verify, and the snapshot if it doesn't", () => {
    const dir = mkdtempSync(join(tmpdir(), "strip-"));
    try {
      const s4 = join(dir, "s4.json");
      writeFileSync(
        s4,
        readFileSync(DEFAULT_SALE_RECORDS[2] as string, "utf8").replace("E_NOT_OWNER", "E_OK"),
      );
      const snap = join(dir, "after.json");
      writeFileSync(
        snap,
        readFileSync(DEFAULT_AFTER_SALES, "utf8").replace('"free": "78"', '"free": "99"'),
      );
      const h = handoversOf(
        BIZ,
        [DEFAULT_SALE_RECORDS[0] as string, DEFAULT_SALE_RECORDS[1] as string, s4],
        snap,
      );
      expect(h.sales).toHaveLength(2);
      expect(h.after).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads nothing for another contract", () => {
    expect(handoversOf("someone-else.testnet")).toEqual({ sales: [], after: null });
  });

  // Nov 7 review (finding 3): one record holding two sales, with checkpoints read under the
  // previous owner before the seller's tenure. Each sale must find its own close by the contract's
  // event, never the record's first checkpoint under another owner.
  it("finds each sale's own close in a record with two sales and earlier owners", () => {
    const H = "7".repeat(44);
    const cp = (name: string, owner: string, generation: number, height: string) => ({
      name,
      source: "chain_final",
      at: "2026-11-07T00:00:00.000Z",
      views: { block: { height }, control: { owner, generation } },
    });
    const close = (seller: string, buyer: string, generation: number, hash: string) => ({
      n: 1,
      step: "accept_sale",
      kind: "transaction",
      signer: { role: "founder", account: seller },
      call: { receiver: BIZ, method: "accept_sale", args: {} },
      chain: {
        hash,
        succeeded: true,
        error: null,
        receipts: [
          {
            executor: BIZ,
            status: "SuccessValue",
            logs: [
              `EVENT_JSON:${JSON.stringify({
                standard: "business_core",
                event: "sale_finalized",
                data: [{ buyer, generation }],
              })}`,
            ],
          },
        ],
      },
      app: { resolution: { result: "closed" } },
    });
    const refusedBy = (seller: string, receiver: string, succeeded: boolean) => ({
      n: 2,
      step: "probe",
      kind: "transaction",
      signer: { role: "former", account: seller },
      call: { receiver, method: succeeded ? "request" : "appoint", args: {} },
      chain: {
        hash: H.replace("7", "8"),
        succeeded,
        error: succeeded ? null : "Smart contract panicked: E_NOT_OWNER",
        receipts: [
          { executor: receiver, status: "SuccessValue", logs: [] },
          ...(receiver === BIZ ? [] : [{ executor: BIZ, status: "SuccessValue", logs: [] }]),
        ],
      },
      app: succeeded ? { resolution: { result: "refused", code: "E_NOT_OWNER" } } : null,
    });
    const a = "a.everstreet.testnet";
    const b = "b.everstreet.testnet";
    const c = "c.everstreet.testnet";
    const r = {
      header: { contract: { account: BIZ }, accounts: {} },
      steps: [
        close(a, b, 2, H),
        refusedBy(a, "feed.everstreet.testnet", true),
        close(b, c, 3, H.replace("7", "9")),
        refusedBy(b, BIZ, false),
      ],
      checkpoints: [
        cp("under_previous_owner", "z.everstreet.testnet", 0, "10"),
        cp("start", a, 1, "20"),
        cp("closed_2", b, 2, "30"),
        cp("closed_3", c, 3, "40"),
      ],
    };
    const h = handoversFrom(BIZ, [{ path: "two-sales.json", r }], null);
    expect(h.sales).toHaveLength(2);
    // The same close in two records (a copy of a record) is one row, not two.
    expect(
      handoversFrom(
        BIZ,
        [
          { path: "two-sales.json", r },
          { path: "copy.json", r },
        ],
        null,
      ).sales,
    ).toHaveLength(2);
    expect(h.sales[0]).toMatchObject({
      from: { account: a, generation: 1 },
      to: { account: b, generation: 2 },
      read_after: { owner: b, block: "30" },
      former_owner_refused: {
        receiver: "feed.everstreet.testnet",
        how: "answer",
        asked_business: true,
      },
    });
    expect(h.sales[1]).toMatchObject({
      from: { account: b, generation: 2 },
      to: { account: c, generation: 3 },
      read_after: { owner: c, block: "40" },
      former_owner_refused: { receiver: BIZ, how: "failed", asked_business: false },
    });
    expect(h.after).toBeNull();
  });
});
