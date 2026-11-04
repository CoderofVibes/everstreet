// Job 001c: the desk's loads. Only the newest load lands; a late answer for an older load, or
// for a closed (unmounted) desk, changes nothing; losing access clears both reads.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import { type DeskLoadState, deskLoader } from "../src/deskLoad.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const desks: ReturnType<typeof deferred<string>>[] = [];
  const digitals: ReturnType<typeof deferred<string>>[] = [];
  let state: DeskLoadState<string, string> = {
    desk: null,
    digital: null,
    error: null,
    digitalError: null,
  };
  const loader = deskLoader<string, string>(
    {
      desk: () => {
        const d = deferred<string>();
        desks.push(d);
        return d.promise;
      },
      digital: () => {
        const d = deferred<string>();
        digitals.push(d);
        return d.promise;
      },
    },
    (patch) => {
      state = { ...state, ...patch };
    },
  );
  return { loader, desks, digitals, state: () => state };
}

describe("001c desk loads", () => {
  it("a late answer for an older load is dropped", async () => {
    const h = harness();
    const first = h.loader.load();
    const second = h.loader.load();
    h.desks[1]?.resolve("desk-new");
    h.digitals[1]?.resolve("digital-new");
    await second;
    h.desks[0]?.resolve("desk-old");
    h.digitals[0]?.resolve("digital-old");
    await first;
    expect(h.state()).toMatchObject({ desk: "desk-new", digital: "digital-new" });
  });

  it("losing access clears both reads, even after they were shown", async () => {
    const h = harness();
    const a = h.loader.load();
    h.desks[0]?.resolve("desk");
    h.digitals[0]?.resolve("digital");
    await a;
    const b = h.loader.load();
    h.digitals[1]?.reject(new ApiError(404, "No such business"));
    h.desks[1]?.reject(new ApiError(404, "No such business"));
    await b;
    expect(h.state()).toMatchObject({ desk: null, digital: null, error: "No such business" });
  });

  it("an unavailable projection keeps the desk and reports it; nothing lands once closed", async () => {
    const h = harness();
    const a = h.loader.load();
    h.desks[0]?.resolve("desk");
    h.digitals[0]?.reject(new ApiError(503, "Busy"));
    await a;
    expect(h.state()).toMatchObject({ desk: "desk", digital: null, digitalError: "Busy" });
    const b = h.loader.load();
    h.loader.close();
    h.desks[1]?.resolve("someone else's desk");
    h.digitals[1]?.resolve("someone else's digital");
    await b;
    expect(h.state().desk).toBe("desk");
    expect(h.state().digital).toBeNull();
    // Re-opened (an effect re-run): an answer to a load started before is still dropped.
    const c = h.loader.load();
    h.loader.open();
    h.desks[2]?.resolve("stale");
    h.digitals[2]?.resolve("stale");
    await c;
    expect(h.state().desk).toBe("desk");
  });
});
