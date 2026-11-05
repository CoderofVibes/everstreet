// Actual controller, injected wallet/API boundaries. No keys, signatures or network.
import { expect, it } from "vitest";
import type { Person } from "../../web/src/api.ts";
import { SignInController, type SignInPort, type WalletBoundary } from "../../web/src/wallet.ts";

it("a delayed old verification body does not sign out the newer account", async () => {
  let bodyA: (answer: { person: Person }) => void = () => {};
  let reachedA: () => void = () => {};
  const startedA = new Promise<void>((resolve) => {
    reachedA = resolve;
  });
  const delayedBody = new Promise<{ person: Person }>((resolve) => {
    bodyA = resolve;
  });
  const person = (id: string): Person => ({
    id,
    display_name: id,
    bio: "",
    headline: "",
  });
  let currentCookie: string | null = null;
  let proofs = 0;
  const wallet: WalletBoundary = {
    label: "Synthetic controller test",
    synthetic: true,
    async connect() {
      throw new Error("This test never connects an account");
    },
    async accounts() {
      return [];
    },
    async send() {
      throw new Error("This test never sends a transaction");
    },
    async disconnect() {
      throw new Error("This test never disconnects a wallet");
    },
    onChange() {
      return () => {};
    },
    async signMessage() {
      return {
        accountId: ++proofs === 1 ? "a.testnet" : "b.testnet",
        publicKey: "test",
        signature: "test",
      };
    },
  };
  const port: SignInPort & { endSession(): Promise<void> } = {
    async challenge() {
      return {
        message: "synthetic proof",
        nonce: Buffer.alloc(32).toString("base64"),
        recipient: "everstreet.local",
        callback_url: "http://localhost/signin/return",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    async verify(answer) {
      // A response's Set-Cookie is applied before its asynchronous body parsing completes.
      currentCookie = answer.account_id;
      if (answer.account_id === "a.testnet") {
        reachedA();
        return delayedBody;
      }
      return { person: person("b") };
    },
    async endSession() {
      currentCookie = null;
    },
    async cancelAttempt() {
      // This modeled endpoint preserves the current cookie; route tests cover invalidation.
    },
  };
  const controller = new SignInController(
    port,
    async () => wallet,
    { network: "testnet", available: true, harness: "synthetic test" },
    null,
  );
  const first = controller.start("/build");
  await startedA;
  const second = await controller.start("/operate");
  expect(second.kind).toBe("signed_in");
  expect(currentCookie).toBe("b.testnet");
  bodyA({ person: person("a") });
  expect((await first).kind).toBe("stale");
  expect(currentCookie).toBe("b.testnet");
});
