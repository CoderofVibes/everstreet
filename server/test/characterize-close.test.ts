// Job 003a: characterization of the close and revocation boundaries. Tests named "gap:" pin
// down behaviour the digital acquisition journey must not rely on. The two app-reconciliation
// gaps 003a found (a lost acceptance response; duplicate settlement from concurrent reads) are
// fixed by job 003b and are now regression tests of the intended behaviour; the wider 003b
// suite is in reconcile-close.test.ts. The chain is the in-memory FakeChain (a test double,
// not testnet evidence), and timing is forced with gates, not real network delays.
// See docs/astra/reports/2026-11-02_003a_characterize-credit-and-close.md.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { type OperatorIdentity, signCommand } from "../../services/openseat/src/command.ts";
import { JUNIPER_CLASS, seedJuniper } from "../../services/openseat/src/fixture.ts";
import { generateKey } from "../../services/openseat/src/keys.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { count, fundedDeal, gate } from "./deal-world.ts";

describe("closing a sale in the app (003a gaps, fixed by 003b)", () => {
  it("a lost acceptance response is confirmed from the contract, not reported as a failure", async () => {
    const s = await fundedDeal();
    s.chain.loseNextAcceptResponse = true;
    const lost = await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });
    // The contract closed the sale; Everstreet reads that back and follows.
    expect(lost.status).toBe(200);
    expect(lost.body.deal.status).toBe("closed");
    expect((await s.chain.control(s.account)).generation).toBe(2);
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(1);
    // A retry checks first and sends nothing again.
    const retry = await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });
    expect(retry.status).toBe(200);
    expect(retry.body.deal.status).toBe("closed");
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(1);
  });

  it("two concurrent reads after a close settle it once", async () => {
    const s = await fundedDeal();
    // The chain closes, but nothing in the app has followed yet (both reads unanswered).
    s.chain.loseNextAcceptResponse = true;
    s.chain.failReads = 100;
    const unconfirmed = await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", {
      digest: s.deal.digest,
    });
    expect(unconfirmed.body.confirmation.state).toBe("unknown");
    s.chain.failReads = 0;
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(0);
    // Hold the control read so both requests are past their reads before either writes.
    const g = gate();
    s.chain.controlGate = g.opened;
    const before = s.chain.controlReads;
    const both = Promise.all([s.ana(`/api/deals/${s.deal.id}`), s.mara(`/api/deals/${s.deal.id}`)]);
    for (let i = 0; i < 50 && s.chain.controlReads < before + 2; i++)
      await new Promise((r) => setTimeout(r, 1));
    expect(s.chain.controlReads).toBe(before + 2);
    g.open();
    s.chain.controlGate = null;
    const [a, b] = await both;
    expect(a.body.deal.status).toBe("closed");
    expect(b.body.deal.status).toBe("closed");
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(1);
    expect(
      count(
        s,
        "SELECT COUNT(*) AS n FROM events WHERE type = 'business.sold' AND subject = ?",
        s.id,
      ),
    ).toBe(1);
  });
});

describe("characterize: OpenSeat operator authority across a close", () => {
  const BUSINESS = "openseat.business.test";

  function identity(accountId: string, authority: TestDoubleAuthority): OperatorIdentity {
    const key = generateKey();
    authority.addKey(accountId, key.publicKey);
    return { accountId, secretKey: key.secretKey };
  }

  /** The authority double, with its answer computed at call time and delivered on a gate. */
  class GatedAuthority extends TestDoubleAuthority {
    hold: Promise<void> | null = null;
    asked = gate();
    override async operatorCheck(accountId: string, capability: string) {
      const answer = await super.operatorCheck(accountId, capability); // read now
      this.asked.open();
      if (this.hold) await this.hold; // ...used later
      return answer;
    }
  }

  it("gap: a command checked before the close runs after it, under the former owner", async () => {
    const authority = new GatedAuthority(BUSINESS, "founder.test");
    const service = new OpenSeat({ dbPath: ":memory:", authority });
    seedJuniper(service);
    const founder = identity("founder.test", authority);
    const g = gate();
    authority.hold = g.opened;
    const pending = service.execute(
      signCommand(founder, {
        business: BUSINESS,
        action: "set_capacity",
        args: { class_id: JUNIPER_CLASS.id, capacity: 9 },
        op_id: "cap-before-close",
        generation: 1,
      }),
    );
    await authority.asked.opened; // the check has read "owner, generation 1"
    authority.sell("northline.test"); // the close lands: new owner, generation 2
    g.open();
    const outcome = await pending;
    expect(outcome.accepted).toBe(true);
    expect(outcome.authority).toMatchObject({ owner: "founder.test", generation: 1 });
    expect(service.getClass(JUNIPER_CLASS.id).capacity).toBe(9);
    // A command checked after the close is refused.
    authority.hold = null;
    const after = await service.execute(
      signCommand(founder, {
        business: BUSINESS,
        action: "set_capacity",
        args: { class_id: JUNIPER_CLASS.id, capacity: 3 },
        op_id: "cap-after-close",
        generation: 1,
      }),
    );
    expect(after.accepted).toBe(false);
    expect(service.getClass(JUNIPER_CLASS.id).capacity).toBe(9);
  });
});
