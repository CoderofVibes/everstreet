// Permissions review, queued actions: things the seller prepared before the close that complete
// after it. An invitation sent before the close must not be acceptable after it; a sale action the
// seller prepared before the close (an operator appointment) must not take effect after it.
import { describe, expect, it } from "vitest";
import { BUYER, proposal, SELLER, saleWorld } from "../sale-world.ts";

describe("pr10: queued before the close, completing after", () => {
  it("an invitation from the seller's generation can't be accepted after the sale", async () => {
    const s = await saleWorld();
    const { ava, noah, act, biz, w } = s;
    const inv = await ava(`/api/businesses/${biz}/members`, "POST", {
      person_id: w.dana.id,
      role: "case_worker",
    });
    const memberId = inv.body.members[0].id as string;
    // Also an operator appointment the seller prepared (the wallet never asked yet).
    const appoint = await s.prepare(ava, "appoint", { account: "stranger.near", caps: 1 });
    const prepared =
      appoint.status === 200
        ? await ava(`/api/sales/${biz}/actions`, "POST", {
            kind: "appoint",
            input: appoint.body.input,
            action_digest: appoint.body.action_digest,
            idempotency_key: "queued-appoint-0001",
          })
        : null;
    await act(ava, SELLER, "propose", proposal());
    for (const k of ["register", "fund", "accept"]) await act(noah, BUYER, k);
    const closed = await act(ava, SELLER, "accept");
    expect(closed.check?.body.resolution?.result).toBe("closed");

    // Dana accepts the old invitation after the close: refused, and nothing active.
    const acc = await w.dana(`/api/me/teams/${memberId}/respond`, "POST", { accept: true });
    expect(acc.status).toBe(409);
    expect((await w.dana(`/api/businesses/${biz}/workflow-cases`)).status).toBe(404);
    // The pre-close invitation isn't in Dana's invites any more.
    const mine = (await w.dana("/api/me/teams")).body as { invites: { id: string }[] };
    expect(mine.invites.map((i) => i.id)).not.toContain(memberId);

    // The seller's queued appointment: the wallet signs it now; the contract refuses, and the
    // server records no appointment.
    if (prepared && prepared.status === 201) {
      const a = prepared.body.action as { id: string; call: unknown };
      await ava(`/api/sales/actions/${a.id}/requested`, "POST", {});
      let hash: string | null = null;
      try {
        const out = s.wallet(SELLER, a.call as never) as { transaction: { hash: string } };
        hash = out.transaction.hash;
      } catch {
        hash = null;
      }
      if (hash) {
        await ava(`/api/sales/actions/${a.id}/requested`, "POST", { tx_hash: hash });
        const check = await ava(`/api/sales/actions/${a.id}/check`, "POST", {});
        expect(check.body.resolution?.kind).not.toBe("confirmed");
      }
      const control = s.control() as { operators: { account: string }[] };
      expect(control.operators.map((o) => o.account)).not.toContain("stranger.near");
    }
  });
});
