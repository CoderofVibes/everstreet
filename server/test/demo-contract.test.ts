// Tony (Nov 7): in the demo, the owner of a business with no contract connects a synthetic one,
// owned by their own account, so the "Start building" route reaches customers. Only the demo has
// this option; only the owner may use it; a business with a contract keeps it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoWorld } from "../../scripts/lib/demo/world.ts";

describe("demo: connect a synthetic contract to a new business", () => {
  it("the owner connects one; the business then reads as bound; nobody else can, and only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everstreet-demo-contract-"));
    try {
      const w = await demoWorld({ dbPath: join(dir, "demo.db") });
      const rosa = w.person("Rosa Lind", "rosa.near");
      const env = await rosa("/api/env");
      expect(env.body.demo_contracts).toBe(true);
      const made = await rosa("/api/product-projects", "POST", {
        idea: "A booking page for a mobile dog grooming van",
        foundation: "saas_workflow",
      });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      const biz = (made.body.project as { business_id: string }).business_id;
      // Unbound before.
      const before = await rosa(`/api/businesses/${biz}/v3`);
      expect(before.body.state).toBe("unbound");
      // Someone else can't connect it (the same answer as a missing business).
      const other = await w.delphine(`/api/businesses/${biz}/demo-contract`, "POST", {});
      expect(other.status).toBe(404);
      // The owner connects it.
      const r = await rosa(`/api/businesses/${biz}/demo-contract`, "POST", {});
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.synthetic).toBe(true);
      expect(String(r.body.binding.account)).toMatch(/\.demo\.near$/);
      // Bound after, on every app the demo serves (they share the configured list).
      const after = await rosa(`/api/businesses/${biz}/v3`);
      expect(after.body.state).not.toBe("unbound");
      // The contract is owned by Rosa's own account.
      const control = w.chains.chains.get(String(r.body.binding.account))?.sale?.controlView() as {
        owner: string;
      };
      expect(control.owner).toBe("rosa.near");
      // Only once.
      const again = await rosa(`/api/businesses/${biz}/demo-contract`, "POST", {});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("bound");
      // A business that already has one (Delphine's Ledgerline) is refused too.
      const ledger = await w.delphine(
        `/api/businesses/${w.business.ledgerline.id}/demo-contract`,
        "POST",
        {},
      );
      expect(ledger.status).toBe(409);
    } finally {
      // The demo's database stays open in this process (Windows refuses to remove it then).
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }, 120_000);
});
