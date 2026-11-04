// Job 003u1: the seller page's loader. Astra's browser finding: the page stayed on "Sign in
// first" after a person was chosen, because an earlier failure was never cleared and the load
// wasn't tied to who was acting. Here: success clears the error, a newer load wins, access loss
// drops the data, a failed check keeps confirmed data and can be retried, and a closed loader
// ignores everything.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import { ApiError as Api5Error } from "../src/api5.ts";
import { initialLoad, type LoadState, latestLoader } from "../src/latestLoad.ts";

function harness() {
  const calls: { resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
  let state: LoadState<string> = initialLoad();
  const loader = latestLoader<string>(
    () =>
      new Promise<string>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
    (p) => {
      state = { ...state, ...p };
    },
  );
  return { loader, calls, state: () => state };
}

describe("003u1 seller page loads", () => {
  it("an error (signed out) is cleared by the next successful load (signed in)", async () => {
    const h = harness();
    const a = h.loader.load();
    h.calls[0]?.reject(new ApiError(401, "Sign in first"));
    await a;
    expect(h.state()).toMatchObject({ status: "refused", error: "Sign in first", data: null });
    const b = h.loader.load();
    h.calls[1]?.resolve("listing");
    await b;
    expect(h.state()).toEqual({ data: "listing", error: null, status: "ready" });
  });

  it("a late answer for an older load is dropped", async () => {
    const h = harness();
    const a = h.loader.load();
    const b = h.loader.load();
    h.calls[1]?.resolve("new");
    await b;
    h.calls[0]?.resolve("old");
    await a;
    expect(h.state().data).toBe("new");
  });

  it("losing access drops the data; a failed check keeps it and can be retried", async () => {
    const h = harness();
    const a = h.loader.load();
    h.calls[0]?.resolve("listing");
    await a;
    const b = h.loader.load();
    h.calls[1]?.reject(new ApiError(503, "Busy"));
    await b;
    expect(h.state()).toMatchObject({ data: "listing", status: "failed", error: "Busy" });
    const c = h.loader.load();
    h.calls[2]?.reject(new ApiError(404, "No such business"));
    await c;
    expect(h.state()).toMatchObject({ data: null, status: "refused" });
  });

  it("001d1: a read started before a save or publish reply can't overwrite that newer reply", async () => {
    const h = harness();
    const stale = h.loader.load(); // a view read in flight
    h.loader.invalidate(); // the save's reply is applied now (by its own path)
    h.calls[0]?.resolve("older view");
    await stale;
    expect(h.state().data).toBeNull();
  });

  it("the acquisitions API's own error class is recognised too (the seller page uses it)", async () => {
    const h = harness();
    const a = h.loader.load();
    h.calls[0]?.reject(new Api5Error("Sign in first", 401));
    await a;
    expect(h.state().status).toBe("refused");
  });

  it("a closed loader (another person or business) changes nothing", async () => {
    const h = harness();
    const a = h.loader.load();
    h.loader.close();
    h.calls[0]?.resolve("former owner's listing");
    await a;
    expect(h.state().data).toBeNull();
    const b = h.loader.load();
    h.loader.open(); // re-mounted: earlier loads are stale
    h.calls[1]?.resolve("stale");
    await b;
    expect(h.state().data).toBeNull();
  });
});
