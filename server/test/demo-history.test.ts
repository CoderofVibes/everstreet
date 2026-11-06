// Step 7 (docs/design/DEMO_ACCOUNT.md §2): 30 simulated days through the real routes, on the
// simulated clock. Records carry the simulated days they happened on; units are charged only for
// delivered results; the month's events happen (an update, a teammate, a rehearsal, a funded
// sale). Fictional; no network. Runs in its own test file: the simulated clock is this process's.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulatedClock } from "../../scripts/lib/demo/clock.ts";
import { simulateHistory } from "../../scripts/lib/demo/history.ts";
import { demoWorld } from "../../scripts/lib/demo/world.ts";

describe("step 7: 30 simulated days", () => {
  it("runs the month through the real flows; records carry their simulated days", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everstreet-demo-history-"));
    const start = simulatedClock.realNow() - 31 * 86_400_000;
    simulatedClock.install();
    simulatedClock.begin(start);
    try {
      const w = await demoWorld({ dbPath: join(dir, "demo.db") });
      const log = await simulateHistory(w, { start });
      const by = (b: string) => log.uses.filter((u) => u.business === b);
      expect(by("ledgerline").length).toBeGreaterThan(40);
      expect(by("relaydesk").length).toBeGreaterThan(15);
      expect(by("signalwatch").length).toBeGreaterThan(8);
      // Delivered results are charged; refused ones are returned, never charged.
      for (const u of log.uses)
        if (u.unit === "charged")
          expect(["extracted", "accepted", "analyzed"], JSON.stringify(u)).toContain(u.outcome);
      expect(log.uses.some((u) => u.outcome === "refused" || u.outcome === "not_a_document")).toBe(
        true,
      );
      expect(log.events.map((e) => e.what).join(" | ")).toMatch(
        /v2 checked and released.*Priya.*rehearsal.*funded/,
      );
      // The records span the simulated month.
      const span = w.db
        .prepare("SELECT MIN(created_at) AS a, MAX(created_at) AS b FROM customer_requests")
        .get() as { a: string; b: string };
      expect(Date.parse(span.b) - Date.parse(span.a)).toBeGreaterThan(25 * 86_400_000);
      // The dashboard reads it back: daily series, totals by token only, credits as observed.
      const d = (await w.delphine("/api/me/dashboard?days=30")).body;
      expect(d.businesses.map((b: { name: string }) => b.name)).toEqual([
        "Ledgerline",
        "Relaydesk",
        "Signalwatch",
      ]);
      for (const b of d.businesses) {
        expect(b.daily).toHaveLength(30);
        expect(b.network_fees).toBeNull();
        const charged = log.uses.filter(
          (u) => u.business === b.name.toLowerCase() && u.unit === "charged",
        ).length;
        expect(b.totals.delivered, b.name).toBe(charged);
        expect(b.credits?.units, b.name).toBeGreaterThan(0);
      }
      expect(Object.keys(d.totals.revenue)).toEqual(["tusd.near"]);
      const sw = d.businesses.find((b: { name: string }) => b.name === "Signalwatch");
      expect(sw.ownership.sale_in_progress).toBe(true);
      expect(sw.attention.map((a: { kind: string }) => a.kind)).toContain("sale");
      const rd = d.businesses.find((b: { name: string }) => b.name === "Relaydesk");
      expect(rd.rehearsal?.state).toBe("passed");
      // What a founder reads beyond the totals: customers, quality, desk, runway, the sale.
      expect(rd.cases.resolved_in_period).toBeGreaterThan(20);
      expect(rd.cases.median_hours_to_resolve).toBeGreaterThan(0);
      expect(rd.team_members).toBe(1);
      expect(rd.customers.active).toBeGreaterThan(1);
      const ll = d.businesses.find((b: { name: string }) => b.name === "Ledgerline");
      expect(ll.success_rate).toBeLessThan(1);
      expect(ll.not_charged_reasons.map((r: { outcome: string }) => r.outcome)).toContain(
        "refused",
      );
      expect(ll.releases.map((r: { number: number }) => r.number)).toEqual([1, 2]);
      expect(ll.credits_runway_days).toBeGreaterThan(0);
      expect(sw.sale).toMatchObject({
        state: "proposed",
        seller_accepted: false,
        buyer_accepted: false,
      });
      expect(sw.sale.escrow).toBe(sw.sale.price);
      // Costs: compute by purpose and outcome (unbilled = spent on requests never charged),
      // tokens, the runtime budget, and the operating costs the founder entered (USD cents).
      const llUse = BigInt(ll.compute.by_purpose.customer_use.microcents);
      expect(llUse).toBe(BigInt(ll.totals.compute_microcents));
      expect(ll.compute.by_purpose.evaluation.calls).toBeGreaterThan(0);
      const unbilled = ["refused", "incomplete"].reduce(
        (n, k) => n + BigInt(ll.compute.customer_use_by_outcome[k]?.microcents ?? "0"),
        0n,
      );
      expect(BigInt(ll.compute.unbilled_microcents)).toBe(unbilled);
      expect(unbilled).toBeGreaterThan(0n);
      expect(ll.compute.tokens.input).toBeGreaterThan(0);
      expect(ll.compute.budget.limit_cents).toBe(100);
      expect(rd.compute.unbilled_microcents).toBe("0");
      expect(rd.compute.models).toEqual(["workflow-engine"]);
      expect(rd.operating_costs.categories.map((c: { category: string }) => c.category)).toContain(
        "Paid help",
      );
      expect(
        sw.operating_costs.categories.find((c: { category: string }) => c.category === "Marketing")
          ?.total_cents,
      ).toBe(2500);
      // One business in detail: its clients (named when known), only for its owner.
      const one = (await w.delphine(`/api/me/dashboard/businesses/${ll.id}`)).body;
      expect(one.businesses).toHaveLength(1);
      const clients = one.businesses[0].clients as { requests: number; name: string | null }[];
      expect(clients.reduce((n, c) => n + c.requests, 0)).toBeGreaterThan(40);
      expect(clients.some((c) => c.name === "Cara Okafor")).toBe(true);
      expect((await w.noah(`/api/me/dashboard/businesses/${ll.id}`)).status).toBe(404);
      w.db.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }, 600_000);
});
