// Job 003wea: SessionProvider's identity orderings (web/src/sessionModel.ts, which the provider runs),
// with deterministic barriers: an old /me answer must not restore an ended or replaced identity, a
// delayed logout answer must not clear a newer identity, and a pending sign-in prompt is settled
// by a sign-out. Fictional people; no network.

import { describe, expect, it } from "vitest";
import type { Person } from "../src/api.ts";
import { type SessionApi, SessionModel } from "../src/sessionModel.ts";

const person = (id: string) => ({ id, display_name: id }) as Person;
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const ENV = { environment: "test", localPreview: false, identity: "verified" as const };

/** An API whose every answer is released explicitly, in the order the test chooses. */
function heldApi() {
  const me: ReturnType<typeof deferred<{ person: Person | null; account: string | null }>>[] = [];
  const out: ReturnType<typeof deferred<unknown>>[] = [];
  const api: SessionApi = {
    me: () => {
      const d = deferred<{ person: Person | null; account: string | null }>();
      me.push(d);
      return d.promise;
    },
    env: async () => ENV,
    signOut: () => {
      const d = deferred<unknown>();
      out.push(d);
      return d.promise;
    },
  };
  return { api, me, out };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("003wea SessionProvider orderings", () => {
  it("an old /me answer after sign-out does not restore the ended identity", async () => {
    const { api, me, out } = heldApi();
    const m = new SessionModel(api);
    const old = m.refresh();
    const ending = m.signOut();
    out[0]?.resolve({});
    await ending;
    me[0]?.resolve({ person: person("cara"), account: "cara.testnet" }); // answered before logout
    await old;
    expect(m.getState()).toMatchObject({ person: null, account: null });
  });

  it("a delayed logout answer does not clear a newer sign-in", async () => {
    const { api, me, out } = heldApi();
    const m = new SessionModel(api);
    const ending = m.signOut();
    const newer = m.settle({
      kind: "signed_in",
      person: person("dana"),
      account: "dana.testnet",
      destination: "/",
    });
    await flush();
    me[0]?.resolve({ person: person("dana"), account: "dana.testnet" });
    await newer;
    out[0]?.resolve({});
    await ending;
    expect(m.getState()).toMatchObject({ person: { id: "dana" }, account: "dana.testnet" });
  });

  it("an older refresh answering after a newer sign-in's refresh does not switch back", async () => {
    const { api, me } = heldApi();
    const m = new SessionModel(api);
    const old = m.refresh();
    const newer = m.settle({
      kind: "signed_in",
      person: person("dana"),
      account: "dana.testnet",
      destination: "/",
    });
    await flush();
    me[1]?.resolve({ person: person("dana"), account: "dana.testnet" });
    await newer;
    me[0]?.resolve({ person: person("cara"), account: "cara.testnet" });
    await old;
    expect(m.getState()).toMatchObject({ person: { id: "dana" }, account: "dana.testnet" });
  });

  it("signing out settles a pending sign-in prompt with no one, and closes it", async () => {
    const { api, out } = heldApi();
    const m = new SessionModel(api);
    const asked = m.requireSignIn("Sign in to use this product.");
    expect(m.getState().signInReason).not.toBeNull();
    const ending = m.signOut();
    out[0]?.resolve({});
    await ending;
    expect(await asked).toBeNull();
    expect(m.getState().signInReason).toBeNull();
  });

  it("the ordinary path still works: refresh, sign in, sign out", async () => {
    const { api, me, out } = heldApi();
    let fenced = 0;
    const m = new SessionModel(api, () => fenced++);
    const r = m.refresh();
    me[0]?.resolve({ person: person("cara"), account: "cara.testnet" });
    await r;
    expect(m.getState()).toMatchObject({ ready: true, person: { id: "cara" } });
    const ending = m.signOut();
    expect(m.getState().person).toBeNull(); // cleared at once, not after the answer
    out[0]?.resolve({});
    await ending;
    expect(fenced).toBeGreaterThanOrEqual(2);
  });
});
