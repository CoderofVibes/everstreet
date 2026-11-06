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
      w.db.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }, 600_000);
});
