// Step 7 (docs/design/DEMO_ACCOUNT.md): the demo world. Delphine Marsh's three businesses are
// founded through the real routes on three synthetic contracts behind one set of transports
// (DemoChains), and each serves a fictional customer: one unit charged per delivered result, on
// that business's own contract only. Fictional; no network.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNTS, CUSTOMERS, demoWorld } from "../../scripts/lib/demo/world.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("step 7 demo world", () => {
  it("founds three businesses for one founder; each serves its customers on its own contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everstreet-demo-test-"));
    dirs.push(dir);
    const w = await demoWorld({ dbPath: join(dir, "demo.db") });
    const [cara, ines] = w.customers;
    if (!cara || !ines) throw new Error("customers");
    const invoice = await w.use(
      cara,
      w.offers.ledgerline,
      "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD",
    );
    expect(invoice, JSON.stringify(invoice)).toMatchObject({
      outcome: "extracted",
      unit: "charged",
    });
    const request = await w.use(
      ines,
      w.offers.relaydesk,
      w.submission({ subject: "Export fails", details: "FICTIONAL. It spins.", urgency: "high" }),
    );
    expect(request, JSON.stringify(request)).toMatchObject({
      outcome: "accepted",
      unit: "charged",
    });
    const flags = await w.use(
      cara,
      w.offers.signalwatch,
      w.submission({
        notes:
          "FICTIONAL. Northbeam API v4.2\n- Removed the Ledger Export API endpoint /v1/export.",
        relies: "We call the Ledger Export API every night.",
      }),
    );
    expect(flags, JSON.stringify(flags)).toMatchObject({ outcome: "analyzed", unit: "charged" });
    // Each contract charged only its own unit.
    for (const k of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
      const c = w.chains.chains.get(ACCOUNTS[k]);
      const total = CUSTOMERS.reduce((n, cu) => n + Number(c?.ent(cu.account)?.consumed ?? 0), 0);
      expect(total, k).toBe(1);
    }
    // The founder's portfolio shows the three businesses.
    const p = (await w.delphine("/api/me/portfolio")).body;
    expect(JSON.stringify(p)).toContain("Signalwatch");
    w.db.close();
  }, 60_000);
});
