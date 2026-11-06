// Permissions review, promise 6 and 7: a signed-out visitor must get 401 from every private
// route. `/api/deals` and `/api/helping` compute `service?.method(me(c))`: when the service isn't
// composed (no payments), optional chaining skips `me(c)` and the route answers 200 to anyone.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

describe("pr09: signed-out visitors on list routes", () => {
  it("/api/deals and /api/helping demand a session even when their service is off", async () => {
    const s = await saleWorld();
    const anon = async (path: string) => {
      const res = await s.w.state.app.request(path);
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    expect((await anon("/api/deals")).status).toBe(401);
    expect((await anon("/api/helping")).status).toBe(401);
  });
});
