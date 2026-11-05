// Actual browser PurchaseFlow + actual routes; the response boundary and wallet are synthetic.
import { expect, it } from "vitest";
import { PurchaseFlow, type PurchasePort } from "../../web/src/purchase.ts";
import type { WalletBoundary, WalletFunctionCall } from "../../web/src/wallet.ts";
import { customerWorld, FRESH } from "./customer-world.ts";

it.each(["unchanged", "recipient", "deposit", "customer"])(
  "the create answer cannot replace the reviewed purchase: %s",
  async (change) => {
    const w = await customerWorld();
    try {
      const offer = await w.offer();
      const root = `/api/customer/offers/${offer}`;
      const initial = await w.dana(`${root}/purchase-setup`);
      expect(initial.status).toBe(200);
      w.chain.walletCall(FRESH, initial.body.shell.call);
      const go = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
        const response = await w.dana(path, method, body);
        if (response.status >= 400) throw new Error(`Unexpected route refusal ${response.status}`);
        return response.body as T;
      };
      const port: PurchasePort = {
        setup: (_offer, units) => go(`${root}/purchase-setup?units=${units ?? 100}`),
        create: async (_offer, body) => {
          const answer = await go<Awaited<ReturnType<PurchasePort["create"]>>>(
            `${root}/purchases`,
            "POST",
            body,
          );
          if (change === "recipient") answer.purchase.call.receiverId = "other-token.testnet";
          if (change === "deposit") answer.purchase.call.deposit = "1000000000000000000000000";
          if (change === "customer") answer.purchase.customer = "another-customer.testnet";
          return answer;
        },
        requested: (id, body) => go(`/api/customer/purchases/${id}/requested`, "POST", body),
        check: (id, body) => go(`/api/customer/purchases/${id}/check`, "POST", body),
        abandon: (id) => go(`/api/customer/purchases/${id}/abandon`, "POST"),
      };
      const sent: WalletFunctionCall[] = [];
      const wallet: WalletBoundary = {
        label: "Synthetic consent test",
        synthetic: true,
        accounts: async () => [FRESH],
        connect: async () => FRESH,
        disconnect: async () => {},
        onChange: () => () => {},
        signMessage: async () => {
          throw new Error("No signing in this test");
        },
        send: async (call) => {
          sent.push(structuredClone(call));
        },
      };
      const flow = new PurchaseFlow(port, async () => wallet, {
        offerId: offer,
        account: FRESH,
        makeKey: () => "astra-consent-review",
      });
      flow.setUnits(100);
      await flow.review("purchase");
      const review = flow.getState().review;
      if (review?.kind !== "purchase") throw new Error("No purchase review");
      const approvedCall = structuredClone(review.preview.call);
      await flow.confirmPurchase();
      expect(sent).toEqual(change === "unchanged" ? [approvedCall] : []);
      flow.retire();
    } finally {
      w.rw.store.db.close();
    }
  },
);
