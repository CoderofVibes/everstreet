// Astra's independent 003wf3 review regressions. Fictional, in-memory records only.
// The first test derives an away-and-back current-control case from the Rust Gated fixture.
// The second holds the coordinator's read at a deterministic barrier; it does not test RPC.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { armHandover, latestHandover, resolveFromEvidence } from "../src/handover.ts";
import { type CloserKey, HandoverCoordinator } from "../src/handoverCoordinator.ts";
import type { ControlV3, OutcomeV3, V3Snapshot } from "../src/v3read.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/v3/gated-sale.json", import.meta.url), "utf8"),
) as {
  business: string;
  steps: { now_ms: string; views: { get_control: string; get_outcomes: string } }[];
};

describe("Astra managed-handover review regressions", () => {
  it("keeps an aborted handover gated when the same account returns at an unreconciled generation", () => {
    const db = openDb(":memory:");
    try {
      const closingStep = fixture.steps[20];
      const abortedStep = fixture.steps[22];
      if (!closingStep || !abortedStep) throw new Error("Missing Gated fixture steps");
      const closing = JSON.parse(closingStep.views.get_control) as ControlV3;
      const aborted = JSON.parse(abortedStep.views.get_control) as ControlV3;
      const outcomes = JSON.parse(abortedStep.views.get_outcomes) as OutcomeV3[];
      if (!closing.live_deal) throw new Error("Expected the fixture's closing deal");
      const parties: [string, string][] = [
        ["seller", closing.owner],
        ["buyer", closing.live_deal.buyer],
      ];
      for (const [id, account] of parties) {
        db.prepare("INSERT INTO people (id, display_name, created_at) VALUES (?, ?, ?)").run(
          id,
          id,
          "2026-11-05",
        );
        db.prepare(
          "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, tx, created_at) VALUES ('person', ?, ?, ?, ?)",
        ).run(id, account, "synthetic", "2026-11-05");
      }
      db.exec(
        "INSERT INTO businesses (id, slug, owner_id, name, family, stage, created_at, updated_at) VALUES ('b', 'synthetic', 'seller', 'Synthetic', 'software', 'grow', '2026-11-05', '2026-11-05')",
      );
      armHandover(db, {
        businessId: "b",
        network: "testnet",
        account: fixture.business,
        block: { height: "20", hash: "block20" },
        control: closing,
        source: "astra_review",
        now: 1,
      });
      // A historical abort is still true after later sales. The account agrees again, but its
      // new generation has never been applied locally. Account equality is insufficient.
      const current = {
        ...aborted,
        generation: aborted.generation + 2,
        control_seq: String(BigInt(aborted.control_seq) + 10n),
      };
      const gate = resolveFromEvidence(db, {
        businessId: "b",
        network: "testnet",
        account: fixture.business,
        evidence: {
          block: { height: "30", hash: "block30" },
          control: current,
          outcomes,
        },
        source: "astra_review",
        now: 2,
      });
      expect(db.prepare("SELECT COUNT(*) AS n FROM ownership").get()?.n).toBe(0);
      expect(gate).not.toBeNull();
      expect(latestHandover(db, "b")?.state).toBe("attention");
    } finally {
      db.close();
    }
  });

  it("does not record delayed observations after timed-out passes and coordinator stop", async () => {
    const db = openDb(":memory:");
    let release = () => {};
    let entered = () => {};
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const obs = {
      bindingFor: () => ({ businessId: "b", network: "testnet", account: "synthetic.testnet" }),
      record: () => {
        db.exec(
          "INSERT INTO events (type, subject, payload, at) VALUES ('synthetic_late_read', 'b', '{}', '2026-11-05')",
        );
        return { outcome: "stale", period: null };
      },
    } as unknown as ConstructorParameters<typeof HandoverCoordinator>[1];
    // The read is held before any customer/intent/writer operation is reachable. Those doubles
    // deliberately have no behavior; this test exercises start/pass/step/claim/stop themselves.
    const coordinator = new HandoverCoordinator(
      db,
      obs,
      {} as ConstructorParameters<typeof HandoverCoordinator>[2],
      null,
      {} as ConstructorParameters<typeof HandoverCoordinator>[4],
      new Map([["b", {} as CloserKey]]),
      {
        holder: "astra-timeout-review",
        intervalMs: 5,
        batch: 1,
        passBudgetMs: 20,
        opDeadlineMs: 15,
        dispatchMarginMs: 100,
        maxOrders: 1,
        leaseMs: 1000,
      },
    );
    coordinator.read = async () => {
      entered();
      await barrier;
      return {
        snapshot: {} as V3Snapshot,
        block: { height: "1", hash: "synthetic", timestamp_ms: "1" },
        terms: null,
      };
    };
    try {
      coordinator.start();
      await started;
      await new Promise((r) => setTimeout(r, 40));
      await coordinator.stop();
      expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()?.n).toBe(0);
      release();
      await new Promise((r) => setTimeout(r, 25));
      expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()?.n).toBe(0);
    } finally {
      release();
      await coordinator.stop();
      db.close();
    }
  });
});
