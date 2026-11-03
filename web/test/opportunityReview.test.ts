// Jobs 005a and 005a1: the review step's request lifecycle, through the controller the page uses,
// with a scripted API answered by the test in any order. Fictional data.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import type { CreateFromRequest, Opportunity } from "../src/opportunitiesApi.ts";
import { ReviewController, type ReviewPort, UNANSWERED } from "../src/opportunityReview.ts";
import type { FoundationInfo } from "../src/productsApi.ts";

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

const FOUNDATIONS = ["ai_api", "saas_workflow", "agent_service", "client_portal"].map((id) => ({
  id,
  label: id,
  summary: "",
  example: "",
  needs: [],
  features: [],
})) as FoundationInfo[];

type Kind = "get" | "create" | "foundations" | "businesses";
interface Pending {
  kind: Kind;
  args: unknown[];
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
}

class Script implements ReviewPort {
  pending: Pending[] = [];
  private call(kind: Kind, args: unknown[]) {
    return new Promise<never>((ok, fail) =>
      this.pending.push({ kind, args, ok: ok as (v: unknown) => void, fail }),
    );
  }
  get = (...a: unknown[]) => this.call("get", a);
  createProject = (...a: unknown[]) => this.call("create", a);
  foundations = () => this.call("foundations", []);
  businesses = () => this.call("businesses", []);
  take(kind: Kind) {
    const i = this.pending.findIndex((p) => p.kind === kind);
    if (i < 0) throw new Error(`no ${kind} waiting (have ${this.pending.map((p) => p.kind)})`);
    return this.pending.splice(i, 1)[0] as Pending;
  }
  count(kind: Kind) {
    return this.pending.filter((p) => p.kind === kind).length;
  }
}

const made = (id: string, created = true) => ({ created, view: { project: { id } } });
const offline = () => new TypeError("Failed to fetch");
const closed = () =>
  new ApiError(
    409,
    "The person who posted this request has closed it. Nothing was created.",
    "request_closed",
  );

let n = 0;
async function opened(preset: { business_id?: string | null } = {}) {
  const api = new Script();
  const c = new ReviewController("n1", api, () => `key-${++n}-abcdefgh`, preset);
  const loading = c.load();
  const choices = c.loadChoices();
  api.take("get").ok(NEED);
  api.take("foundations").ok({ foundations: FOUNDATIONS });
  api.take("businesses").ok([{ id: "b9", name: "Ledgerline Labs" }]);
  await Promise.all([loading, choices]);
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

  it("creates once and opens the project; a second click while sending sends nothing", async () => {
    const { api, c } = await opened();
    c.edit({ idea: "  Read invoices into the ledger  ", name: " Invoice relay " });
    const creating = c.create();
    await c.create();
    expect(api.count("create")).toBe(1);
    const p = api.take("create");
    expect(sentBody(p)).toMatchObject({
      idea: "Read invoices into the ledger",
      name: "Invoice relay",
      foundation: "ai_api",
      business_id: null,
    });
    p.ok(made("p1"));
    await creating;
    expect(c.getState().created).toMatchObject({ project_id: "p1", again: false });
    expect(c.openNow).toBe("p1");
  });

  it("a business that isn't yours is a refusal to correct, not a gone request", async () => {
    const { api, c } = await opened({ business_id: "someone-elses" });
    const creating = c.create();
    api.take("create").fail(new ApiError(404, "No such business"));
    await creating;
    expect(c.getState()).toMatchObject({
      status: "ready",
      original: null,
      refusal: { code: null, message: "No such business" },
    });
    c.edit({ business_id: null });
    const again = c.create();
    api.take("create").ok(made("p3"));
    await again;
    expect(c.openNow).toBe("p3");
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
    expect(c.blocked).toMatch(/sentence/);
    await c.create();
    expect(api.pending).toEqual([]);
  });
});

describe("005a1 the original request stays recoverable", () => {
  it("a committed-but-lost reply, then typing: the check resends the original, keeps the edits and doesn't navigate", async () => {
    const { api, c } = await opened();
    const first = c.create();
    const p1 = api.take("create");
    c.edit({ name: "Typed while waiting" }); // typed-ahead
    p1.fail(offline());
    await first;
    expect(c.getState().original).toMatchObject({ phase: "unknown" });
    expect(UNANSWERED).toMatch(/Check the original request/);
    c.edit({ idea: "A newer idea, typed after the failure" });
    // Typing never removes the original; Create can't start a second one meanwhile.
    expect(c.getState().original?.phase).toBe("unknown");
    expect(c.blocked).toMatch(/original request/);
    await c.create();
    expect(api.count("create")).toBe(0);
    const checking = c.checkOriginal();
    expect(c.getState().original?.phase).toBe("checking");
    const p2 = api.take("create");
    expect(sentBody(p2)).toEqual(sentBody(p1)); // same key, exactly the original input
    p2.ok(made("p1", false));
    await checking;
    expect(c.getState().created).toEqual({
      project_id: "p1",
      again: true,
      sent: { idea: NEED.text, foundation: "ai_api", name: "", business_id: null },
      newer_edits: true,
    });
    expect(c.openNow).toBeNull(); // not opened over the newer edits
    expect(c.getState().draft).toMatchObject({
      idea: "A newer idea, typed after the failure",
      name: "Typed while waiting",
    });
  });

  it("with no edits since, the recovered project opens directly", async () => {
    const { api, c } = await opened();
    const first = c.create();
    api.take("create").fail(new ApiError(503, "Service unavailable"));
    await first;
    const checking = c.checkOriginal();
    api.take("create").ok(made("p1", false));
    await checking;
    expect(c.openNow).toBe("p1");
  });

  it("a check that again gets no answer stays recoverable; it never mints a new key", async () => {
    const { api, c } = await opened();
    const first = c.create();
    const p1 = api.take("create");
    p1.fail(offline());
    await first;
    for (let i = 0; i < 2; i++) {
      const check = c.checkOriginal();
      const p = api.take("create");
      expect(sentBody(p).idempotency_key).toBe(sentBody(p1).idempotency_key);
      p.fail(offline());
      await check;
      expect(c.getState().original?.phase).toBe("unknown");
    }
  });

  it("a late success while typing doesn't navigate away; a separate project needs an explicit action", async () => {
    const { api, c } = await opened();
    const creating = c.create();
    const p1 = api.take("create");
    c.edit({ idea: "Edits typed while it was sending" });
    p1.ok(made("p1"));
    await creating;
    expect(c.getState().created).toMatchObject({ project_id: "p1", newer_edits: true });
    expect(c.openNow).toBeNull();
    expect(c.getState().draft?.idea).toBe("Edits typed while it was sending");
    await c.create(); // plain Create does nothing more
    expect(api.count("create")).toBe(0);
    const another = c.createAnother();
    const p2 = api.take("create");
    expect(sentBody(p2).idempotency_key).not.toBe(sentBody(p1).idempotency_key);
    expect(sentBody(p2).idea).toBe("Edits typed while it was sending");
    p2.ok(made("p2"));
    await another;
    expect(c.openNow).toBe("p2");
  });

  it("the request closing before recovery: a project already made is still found; one never made is a clear refusal", async () => {
    // Made before the closure: the server returns it for the original key.
    const a = await opened();
    const first = a.c.create();
    a.api.take("create").fail(offline());
    await first;
    const found = a.c.checkOriginal();
    a.api.take("create").ok(made("p1", false));
    await found;
    expect(a.c.openNow).toBe("p1");
    // Never made: the check is refused, and that is not an unknown.
    const b = await opened();
    const second = b.c.create();
    b.api.take("create").fail(offline());
    await second;
    const check = b.c.checkOriginal();
    b.api.take("create").fail(closed());
    await check;
    expect(b.c.getState()).toMatchObject({
      status: "gone",
      original: null,
      created: null,
      refusal: { code: "request_closed" },
    });
    expect(b.c.getState().message).toMatch(/has closed it/);
  });

  it("refusals are recognized by code, not wording", async () => {
    const { api, c } = await opened();
    const creating = c.create();
    // The same wording with no code is just a refusal; the code decides "gone".
    api.take("create").fail(new ApiError(409, "Something that says closed it and expired"));
    await creating;
    expect(c.getState().status).toBe("ready");
    const again = c.create();
    api.take("create").fail(new ApiError(409, "Gone", "request_expired"));
    await again;
    expect(c.getState()).toMatchObject({ status: "gone", message: "This request has expired." });
  });
});

describe("005a1 reads are fenced", () => {
  it("an older read finishing last never replaces a newer one, and nothing reopens a request known gone", async () => {
    const { api, c } = await opened();
    const older = c.load();
    const newer = c.load();
    const [o, nw] = [api.take("get"), api.take("get")];
    nw.fail(new ApiError(404, "This request is no longer open", "request_unavailable"));
    await newer;
    expect(c.getState().status).toBe("gone");
    o.ok(NEED); // started earlier, says open
    await older;
    expect(c.getState().status).toBe("gone");
    const later = c.load(); // even a newer read can't reopen it
    api.take("get").ok(NEED);
    await later;
    expect(c.getState().status).toBe("gone");
  });

  it("a request no longer open when the page loads shows as gone, with no draft", async () => {
    const api = new Script();
    const c = new ReviewController("n1", api, () => "key-gone-abcdefgh");
    const loading = c.load();
    api
      .take("get")
      .fail(new ApiError(404, "This request is no longer open", "request_unavailable"));
    await loading;
    expect(c.getState()).toMatchObject({ status: "gone", need: null, draft: null });
    await c.create();
    expect(api.pending).toEqual([]);
  });
});

describe("005a1 choice lists fail visibly", () => {
  it("foundations failing blocks Create with a reason and can be retried; no invisible default is sent", async () => {
    const api = new Script();
    const c = new ReviewController("n1", api, () => "key-choice-abcdefgh");
    const loading = c.load();
    const choices = c.loadChoices();
    api.take("get").ok(NEED);
    api.take("foundations").fail(new ApiError(503, "Service unavailable"));
    api.take("businesses").fail(offline());
    await Promise.all([loading, choices]);
    expect(c.getState().foundations).toMatchObject({ state: "error" });
    expect(c.getState().businesses).toMatchObject({ state: "error" });
    expect(c.blocked).toMatch(/haven't loaded/);
    await c.create();
    expect(api.count("create")).toBe(0);
    const retry = c.loadFoundations();
    expect(c.getState().foundations).toEqual({ state: "loading" });
    api.take("foundations").ok({ foundations: FOUNDATIONS });
    await retry;
    expect(c.blocked).toBeNull();
  });

  it("an older choice-list answer finishing last is ignored", async () => {
    const api = new Script();
    const c = new ReviewController("n1", api, () => "key-order-abcdefgh");
    const first = c.loadBusinesses();
    const second = c.loadBusinesses();
    const [a, b] = [api.take("businesses"), api.take("businesses")];
    b.ok([{ id: "b2", name: "Newer list" }]);
    await second;
    a.ok([{ id: "b1", name: "Older list" }]);
    await first;
    expect(c.getState().businesses).toEqual({
      state: "ready",
      items: [{ id: "b2", name: "Newer list" }],
    });
  });
});
