// The proof page's handover strip (server/src/examples.ts handoversOf): each recorded sale of the
// Ledgerline example at the moment control changed, read only from records whose digests verify.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SALES, DEFAULT_SALE_RECORDS, handoversOf } from "../src/examples.ts";

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
      expect(Number(x.closed.block)).toBeGreaterThan(0);
      // Every former owner's refusal is a transaction on chain, after its own close.
      expect(x.former_owner_refused?.code).toBe("E_NOT_OWNER");
      expect(x.former_owner_refused?.hash).toMatch(HASH);
    }
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
});
