// Job 005a: the review step's request lifecycle, through the controller the page uses, with a
// scripted API answered by the test in any order. Fictional data.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import type { CreateFromRequest, Opportunity } from "../src/opportunitiesApi.ts";
import { ReviewController, type ReviewPort, UNANSWERED } from "../src/opportunityReview.ts";

const NEED: Opportunity = {
  id: "n1",
  text: "An AI tool that reads supplier invoices into my accounting app, under $50",
  constraints: { family: "software", max_price_cents: 5000 },
  allow_replies: true,
  expires_at: "2026-11-17T00:00:00.000Z",
  created_at: "2026-11-03T00:00:00.000Z",
  responses: 0,
  classification: {
    kind: "ai_tool",
    label: "AI tool",
    basis: ["ai"],
    suggested_foundation: "ai_api",
    note: "A guess from the request's words.",
  },
  matches: [],
};

interface Pending {
  kind: "get" | "create";
  args: unknown[];
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
}

class Script implements ReviewPort {
  pending: Pending[] = [];
  private call(kind: Pending["kind"], args: unknown[]) {
    return new Promise<never>((ok, fail) =>
      this.pending.push({ kind, args, ok: ok as (v: unknown) => void, fail }),
    );
  }
  get = (...a: unknown[]) => this.call("get", a);
  createProject = (...a: unknown[]) => this.call("create", a);
  take(kind: Pending["kind"]) {
    const i = this.pending.findIndex((p) => p.kind === kind);
    if (i < 0) throw new Error(`no ${kind} waiting`);
    return this.pending.splice(i, 1)[0] as Pending;
  }
}

const made = (id: string, created = true) => ({ created, view: { project: { id } } });

let n = 0;
async function opened(preset: { business_id?: string | null } = {}) {
  const api = new Script();
  const c = new ReviewController("n1", api, () => `key-${++n}-abcdefgh`, preset);
  const loading = c.load();
  api.take("get").ok(NEED);
  await loading;
  return { api, c };
}

const sentBody = (p: Pending) => p.args[1] as CreateFromRequest;

describe("005a the review step", () => {
  it("starts from the request once; a later load never replaces what was typed", async () => {
    const { api, c } = await opened({ business_id: "b9" });
    expect(c.getState().draft).toEqual({
      idea: NEED.text,
      foundation: "ai_api",
      name: "",
      business_id: "b9",
    });
    c.edit({ idea: "My own take on it", foundation: "agent_service" });
    const again = c.load();
    api.take("get").ok({ ...NEED, text: "Changed upstream" });
    await again;
    expect(c.getState().draft).toMatchObject({
      idea: "My own take on it",
      foundation: "agent_service",
    });
  });

  it("creates once; a second click while sending sends nothing", async () => {
    const { api, c } = await opened();
    c.edit({ idea: "  Read invoices into the ledger  ", name: " Invoice relay " });
    const creating = c.create();
    await c.create();
    expect(api.pending.filter((p) => p.kind === "create")).toHaveLength(1);
    const p = api.take("create");
    expect(p.args[0]).toBe("n1");
    expect(sentBody(p)).toMatchObject({
      idea: "Read invoices into the ledger",
      name: "Invoice relay",
      foundation: "ai_api",
      business_id: null,
    });
    p.ok(made("p1"));
    await creating;
    expect(c.getState().created).toEqual({ project_id: "p1", again: false });
  });

  it("a lost response is retried with the same key and input, and finds the same project", async () => {
    const { api, c } = await opened();
    const first = c.create();
    const p1 = api.take("create");
    p1.fail(new TypeError("Failed to fetch"));
    await first;
    expect(c.getState().attempt).toMatchObject({ state: "unknown", message: UNANSWERED });
    expect(c.getState().created).toBeNull();
    const second = c.create();
    const p2 = api.take("create");
    expect(sentBody(p2).idempotency_key).toBe(sentBody(p1).idempotency_key);
    expect(sentBody(p2)).toEqual(sentBody(p1));
    p2.ok(made("p1", false));
    await second;
    expect(c.getState().created).toEqual({ project_id: "p1", again: true });
  });

  it("a server error is also unknown; editing afterwards starts a new key and says so", async () => {
    const { api, c } = await opened();
    const first = c.create();
    const p1 = api.take("create");
    p1.fail(new ApiError(503, "Service unavailable"));
    await first;
    expect(c.getState().attempt?.state).toBe("unknown");
    c.edit({ name: "Renamed" });
    expect(c.draftDiverged).toBe(true);
    const second = c.create();
    const p2 = api.take("create");
    expect(sentBody(p2).idempotency_key).not.toBe(sentBody(p1).idempotency_key);
    p2.ok(made("p2"));
    await second;
    expect(c.getState().created?.project_id).toBe("p2");
  });

  it("a request that closed or expired before Create is shown as gone; nothing more is sent", async () => {
    for (const msg of [
      "The person who posted this request has closed it. Nothing was created.",
      "This request expired before the project was created. Nothing was created.",
      "This request is no longer available. Nothing was created.",
    ]) {
      const { api, c } = await opened();
      const creating = c.create();
      api.take("create").fail(new ApiError(msg.includes("available") ? 404 : 409, msg));
      await creating;
      expect(c.getState()).toMatchObject({
        status: "gone",
        created: null,
        attempt: { state: "refused", message: msg },
      });
      await c.create();
      expect(api.pending).toEqual([]);
    }
  });

  it("a business that isn't yours is a refusal to correct, not a gone request", async () => {
    const { api, c } = await opened({ business_id: "someone-elses" });
    const creating = c.create();
    api.take("create").fail(new ApiError(404, "No such business"));
    await creating;
    expect(c.getState()).toMatchObject({
      status: "ready",
      attempt: { state: "refused", message: "No such business" },
    });
    c.edit({ business_id: null });
    const again = c.create();
    api.take("create").ok(made("p3"));
    await again;
    expect(c.getState().created?.project_id).toBe("p3");
  });

  it("a request no longer open when the page loads shows as gone, with no draft", async () => {
    const api = new Script();
    const c = new ReviewController("n1", api, () => "key-gone-abcdefgh");
    const loading = c.load();
    api.take("get").fail(new ApiError(404, "This request is no longer open"));
    await loading;
    expect(c.getState()).toMatchObject({ status: "gone", need: null, draft: null });
    await c.create();
    expect(api.pending).toEqual([]);
  });

  it("leaving the page (or another person acting) drops a late answer", async () => {
    const { api, c } = await opened();
    const creating = c.create();
    c.dispose();
    api.take("create").ok(made("p4"));
    await creating;
    expect(c.getState().created).toBeNull();
  });

  it("too short an idea is refused locally, with nothing sent", async () => {
    const { api, c } = await opened();
    c.edit({ idea: " a " });
    await c.create();
    expect(api.pending).toEqual([]);
    expect(c.getState().attempt).toMatchObject({ state: "refused" });
  });
});
