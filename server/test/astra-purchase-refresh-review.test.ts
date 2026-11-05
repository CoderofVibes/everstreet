// Actual setup routes and browser controller; delay only delivery of an already-read answer.
import { expect, it } from "vitest";
import { PurchaseFlow, type PurchasePort, type PurchaseSetup } from "../../web/src/purchase.ts";
import { customerWorld, FRESH } from "./customer-world.ts";

it.each(["newer entitlement", "edited quantity"])(
  "a delayed purchase setup answer cannot replace %s",
  async (caseName) => {
    const w = await customerWorld();
    try {
      const offer = await w.offer();
      const path = `/api/customer/offers/${offer}/purchase-setup`;
      const shell = await w.dana(path);
      w.chain.walletCall(FRESH, shell.body.shell.call);
      const before = await w.dana(`${path}?units=100`);
      expect(before.status).toBe(200);
      let deliver: ((s: PurchaseSetup) => void) | undefined;
      let first = true;
      const noWrite = async (): Promise<never> => {
        throw new Error("This read-only review must not send anything");
      };
      const port: PurchasePort = {
        setup: async (_offer, units) => {
          if (first) {
            first = false;
            return new Promise<PurchaseSetup>((resolve) => {
              deliver = resolve;
            });
          }
          const answer = await w.dana(`${path}?units=${units}`);
          expect(answer.status).toBe(200);
          return answer.body as PurchaseSetup;
        },
        create: noWrite,
        requested: noWrite,
        check: noWrite,
        abandon: noWrite,
      };
      const flow = new PurchaseFlow(port, () => null, { offerId: offer, account: FRESH });
      const pending = flow.load();
      if (caseName === "newer entitlement") {
        w.chain.walletCall(FRESH, before.body.preview.call);
        await flow.load();
        expect(flow.getState().setup?.entitlement?.free).toBe("100");
      } else {
        flow.setUnits(100);
        expect(flow.getState().units).toBe(100);
      }
      if (!deliver) throw new Error("No delayed setup read");
      deliver(before.body as PurchaseSetup);
      await pending;
      if (caseName === "newer entitlement") {
        expect(flow.getState().setup?.entitlement?.free).toBe("100");
      } else {
        expect(flow.getState().units).toBe(100);
      }
      flow.retire();
    } finally {
      w.rw.store.db.close();
    }
  },
);
