// Actual SessionModel plus the existing WalletSignInDialog completion sequence.
// Deferred fictional /me answers, no DOM, credentials, cryptography or network.
import { expect, it } from "vitest";
import type { Person } from "../../web/src/api.ts";
import { SessionModel } from "../../web/src/sessionModel.ts";

const person = (id: string): Person => ({ id, display_name: id, headline: "", bio: "" });
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

it.each(["logout", "newer account"])(
  "an old dialog completion cannot restore its identity after %s",
  async (change) => {
    const oldRead = deferred<{ person: Person; account: string }>();
    let reads = 0;
    const a = person("fictional-a");
    const b = person("fictional-b");
    const model = new SessionModel({
      me: async () => (++reads === 1 ? oldRead.promise : { person: b, account: "b.testnet" }),
      env: async () => ({ environment: "synthetic", localPreview: false, identity: "verified" }),
      signOut: async () => {},
    });
    const oldCompletion = model.settle({
      kind: "signed_in",
      person: a,
      account: "a.testnet",
      destination: "/",
    });
    if (change === "logout") await model.signOut();
    else
      await model.settle({ kind: "signed_in", person: b, account: "b.testnet", destination: "/" });
    oldRead.resolve({ person: a, account: "a.testnet" });
    const answer = await oldCompletion;
    // This is the production dialog's await walletSignIn -> finishSignIn contract.
    if (answer.kind === "signed_in") model.finishSignIn(answer.person);
    expect(model.getState().person?.id ?? null).toBe(change === "logout" ? null : b.id);
    expect(model.getState().account).toBe(change === "logout" ? null : "b.testnet");
  },
);
