// Job 005e: economics over the sale harness's synthetic world (its prepaid units were made on
// the fixture contract, before any purchase record here). Fictional data; no network.

import { describe, expect, it } from "vitest";
import { saleControl, saleHarness } from "../../scripts/lib/saleHarness.ts";
import { economics } from "../src/economics.ts";

describe("005e economics", () => {
  it("charged uses priced by their offer; obligations unknown (never negative) without purchase records; no profit", async () => {
    const h = await saleHarness({ origin: "http://127.0.0.1:8814" });
    const control = saleControl(h);
    for (let i = 0; i < 2; i++) {
      const r = (await (
        await control.request(new URL("/customer-use", "http://127.0.0.1:8815"), { method: "POST" })
      ).json()) as { unit: string };
      expect(r.unit).toBe("charged");
    }
    const e = economics(h.world.w.state.store.db, h.world.w.f.business, 2);
    const now = e.months.at(-1);
    expect(now?.by_asset["tusd.near"]).toMatchObject({
      earned: "100000", // 2 x the fixture plan's 50000
      earned_units: 2,
      prepaid_in: "0",
    });
    expect(now?.successful_uses).toBe(2);
    expect(e.obligations[0]).toMatchObject({ outstanding_units: null, outstanding_value: null });
    expect(e.obligations[0]?.note).toMatch(/Unknown, not negative/);
    expect(JSON.stringify(e)).not.toMatch(/profit_|margin_/);
    expect(e.recovery.items).toEqual([]);
  }, 60_000);
});
