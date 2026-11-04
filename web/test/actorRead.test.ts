// Job 001f2: a private read belongs to the account that asked. Astra's browser finding: a slow
// project-list answer for Ava replaced Bea's own cards after a switch. These drive the shared
// controller with answers held back and released in a chosen order: A->B, A->signed out, a late
// failure, quick switches, retry, unmount and lost access. Each test counts its requests (a hard
// bound independent of the code) and holds no timers; every promise is settled by the test.

import { describe, expect, it } from "vitest";
import { ActorRead, stateFor } from "../src/actorRead.ts";
import { catalogView, composerReady } from "../src/homeView.ts";
import type { LoadState } from "../src/latestLoad.ts";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A fake server whose answers the test releases by hand; at most `cap` requests. */
function heldServer(cap = 10) {
  const calls: {
    who: string;
    resolve: (v: string[]) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const get = (who: string) =>
    new Promise<string[]>((resolve, reject) => {
      if (calls.length >= cap) throw new Error(`more than ${cap} requests`);
      calls.push({ who, resolve, reject });
    });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { calls, get, tick };
}

const data = <T>(s: LoadState<T>) => s.data;

describe("001f2 a late answer never reaches another account", () => {
  it("A's slow answer arrives after the switch to B: B sees only B's projects", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    r.setActor("bea");
    // Before any answer: nothing from Ava is shown to Bea.
    expect(r.snapshot("bea")).toEqual({ data: null, error: null, status: "loading" });
    s.calls[1]?.resolve(["Tutor Portal"]);
    await s.tick();
    expect(data(r.snapshot("bea"))).toEqual(["Tutor Portal"]);
    s.calls[0]?.resolve(["Untitled product (Ava)"]);
    await s.tick();
    expect(data(r.snapshot("bea"))).toEqual(["Tutor Portal"]);
    expect(data(r.snapshot("ava"))).toBeNull();
    expect(s.calls.map((c) => c.who)).toEqual(["ava", "bea"]);
  });

  it("the switch hides the old account's projects at once, before the next answer", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    s.calls[0]?.resolve(["Ava's project"]);
    await s.tick();
    expect(data(r.snapshot("ava"))).toEqual(["Ava's project"]);
    // The render right after the switch (before setActor runs) already shows nothing.
    expect(r.snapshot("bea").data).toBeNull();
    r.setActor("bea");
    expect(r.snapshot("bea").data).toBeNull();
  });

  it("signing out drops the projects and a late answer doesn't bring them back", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    r.setActor(null);
    s.calls[0]?.resolve(["Ava's project"]);
    await s.tick();
    expect(r.snapshot(null).data).toBeNull();
    expect(r.snapshot("ava").data).toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it("A's late failure doesn't mark B's list failed", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    r.setActor("bea");
    s.calls[0]?.reject(new Error("Ava's request timed out"));
    await s.tick();
    expect(r.snapshot("bea").status).toBe("loading");
    s.calls[1]?.resolve([]);
    await s.tick();
    expect(r.snapshot("bea")).toEqual({ data: [], error: null, status: "ready" });
  });

  it("quick switches A->B->A: only the newest read for A counts", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    r.setActor("bea");
    r.setActor("ava");
    expect(s.calls.map((c) => c.who)).toEqual(["ava", "bea", "ava"]);
    s.calls[2]?.resolve(["newest"]);
    await s.tick();
    s.calls[0]?.resolve(["oldest"]);
    s.calls[1]?.resolve(["Bea's"]);
    await s.tick();
    expect(data(r.snapshot("ava"))).toEqual(["newest"]);
    expect(r.snapshot("bea").data).toBeNull();
  });

  it("the same account again doesn't read twice", () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    r.setActor("ava");
    expect(s.calls).toHaveLength(1);
  });
});

describe("001f2 failures settle, retry recovers, unmount and lost access", () => {
  it("a failure is a retry, not an empty list; the retry for the same account recovers", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("bea");
    s.calls[0]?.reject(new Error("Couldn't reach the server"));
    await s.tick();
    expect(r.snapshot("bea")).toEqual({
      data: null,
      error: "Couldn't reach the server",
      status: "failed",
    });
    r.retry();
    expect(r.snapshot("bea").status).toBe("loading");
    s.calls[1]?.resolve(["Tutor Portal"]);
    await s.tick();
    expect(r.snapshot("bea")).toEqual({ data: ["Tutor Portal"], error: null, status: "ready" });
    expect(s.calls.map((c) => c.who)).toEqual(["bea", "bea"]);
  });

  it("a retry started for A and answered after the switch to B is dropped", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    s.calls[0]?.reject(new Error("down"));
    await s.tick();
    r.retry();
    r.setActor("bea");
    s.calls[1]?.resolve(["Ava's project"]);
    await s.tick();
    expect(r.snapshot("bea").data).toBeNull();
  });

  it("after unmount nothing changes; mounting again reads afresh", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    let renders = 0;
    r.subscribe(() => renders++);
    r.open();
    r.setActor("ava");
    const before = renders;
    r.close();
    s.calls[0]?.resolve(["late"]);
    await s.tick();
    expect(renders).toBe(before);
    expect(r.snapshot("ava").data).toBeNull();
    r.retry(); // closed: no request
    expect(s.calls).toHaveLength(1);
    r.open();
    r.setActor("ava");
    expect(s.calls).toHaveLength(2);
  });

  it("losing access (401/403/404) drops the data rather than keeping it", async () => {
    const s = heldServer();
    const r = new ActorRead(s.get);
    r.setActor("ava");
    s.calls[0]?.resolve(["Ava's project"]);
    await s.tick();
    r.retry();
    s.calls[1]?.reject(new HttpError(401, "Sign in again"));
    await s.tick();
    expect(r.snapshot("ava")).toEqual({ data: null, error: "Sign in again", status: "refused" });
  });

  it("stateFor: only the account the data was read for", () => {
    const ready: LoadState<number> = { data: 1, error: null, status: "ready" };
    expect(stateFor({ who: "ava", state: ready }, "ava").data).toBe(1);
    expect(stateFor({ who: "ava", state: ready }, "bea").data).toBeNull();
    expect(stateFor({ who: null, state: ready }, null).data).toBeNull();
  });
});

describe("001f2 Home's catalog and the composer's product types", () => {
  const failed = <T>(): LoadState<T> => ({ data: null, error: "Server down", status: "failed" });
  it("a failed catalog is a failure, never 'No software products are published yet'", () => {
    expect(catalogView(failed(), "all")).toEqual({ kind: "failed", error: "Server down" });
    expect(catalogView({ data: null, error: null, status: "loading" }, "all").kind).toBe("loading");
    expect(catalogView({ data: [], error: null, status: "ready" }, "all")).toEqual({
      kind: "empty",
      software: true,
    });
    // A retry that fails after a success keeps what was confirmed.
    const kept = catalogView(
      {
        data: [{ slug: "p", family: "class", digital: null } as never],
        error: "Server down",
        status: "failed",
      },
      "all",
    );
    expect(kept.kind).toBe("list");
  });

  it("the composer starts nothing until the product types are read, and only a shown type", () => {
    const types: LoadState<{ id: string }[]> = {
      data: [{ id: "ai_api" }, { id: "client_portal" }],
      error: null,
      status: "ready",
    };
    expect(composerReady(failed(), "ai_api").canSubmit).toBe(false);
    expect(composerReady(failed(), "ai_api").reason).toMatch(/couldn't be loaded.*idea is kept/);
    expect(composerReady({ data: null, error: null, status: "loading" }, "ai_api").canSubmit).toBe(
      false,
    );
    expect(composerReady(types as never, "client_portal")).toEqual({
      canSubmit: true,
      reason: null,
    });
    expect(composerReady(types as never, "agent_service").canSubmit).toBe(false);
  });
});
