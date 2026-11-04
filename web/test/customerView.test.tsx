// Job 001j: the customer workspace's steps, driven by the actual CustomerWorkspace over the REAL
// customer-use API (server side: the labelled fixture chain, scripted extractor and synthetic
// protection of server/test; the preview scenario for the sale). What these prove: each step says
// what the request's own state shows; a running request is never invoked again by checking; a
// failed, unknown or incomplete answer never reads as success; a lost answer recovers the same
// request; access loss clears private data; the customer's view is unchanged across a sale.
// SYNTHETIC throughout: no wallet, model, chain or network. Finite: bounded loops, no timers.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customerPreview, PREVIEW_PUBLIC_KEY } from "../../scripts/lib/customerPreview.ts";
import { RuntimeFailure } from "../../server/src/runtime.ts";
import {
  customerWorld,
  heldScript,
  type Json,
  keyFromSeed,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import { correct } from "../../server/test/runtime-world.ts";
import { ApiError } from "../src/api.ts";
import type { CustomerPort } from "../src/customerApi.ts";
import type { CustomerAuthorizer } from "../src/customerAuthorizer.ts";
import { activeCustomerStep, completeResult, customerSteps } from "../src/customerView.ts";
import { CustomerWorkspace, nextStep, type WorkspaceState } from "../src/customerWorkspace.ts";
import {
  CustomerProgress,
  CustomerResult,
  ResultArea,
  StepActions,
  StepHeading,
} from "../src/pages/CustomerProduct.tsx";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const AMBIGUOUS = "Fictional invoice HD-310 from Harbor Desk, dated 03/04/2026, total 90.00 EUR";
const SEED1_PK = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";

type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>;

function portOver(go0: Call, before: () => void = () => {}, override: Partial<CustomerPort> = {}) {
  const go = async (path: string, method = "GET", body?: unknown) => {
    before();
    const r = await go0(path, method, body);
    if (r.status >= 400)
      throw new ApiError(r.status, r.body.error ?? "failed", r.body.code, r.body.detail);
    return r.body;
  };
  const port: CustomerPort = {
    offer: (id) => go(`/api/public/customer-offers/${id}`),
    use: (id) => go(`/api/customer/uses/${id}`),
    uses: () => go("/api/customer/uses?limit=20"),
    byKey: (key) => go(`/api/customer/requests/by-key/${key}`),
    prepare: (o, b) => go(`/api/customer/offers/${o}/prepare`, "POST", b),
    confirm: (id, b) => go(`/api/customer/uses/${id}/confirm`, "POST", b),
    cancel: (id) => go(`/api/customer/uses/${id}/cancel`, "POST"),
    reconcile: (id) => go(`/api/customer/uses/${id}/reconcile`, "POST"),
    execute: (id, b) => go(`/api/customer/uses/${id}/execute`, "POST", b),
    result: (id) => go(`/api/customer/uses/${id}/result`),
    units: (id) => go(`/api/customer/uses/${id}/units/reconcile`, "POST"),
    release: (id) => go(`/api/customer/uses/${id}/release`, "POST"),
  };
  return { ...port, ...override };
}

/** Signatures made by the test authorizer (001j1: a lost answer never signs again). */
let signatures = 0;
/** Test-only authorizer: the contract tests' synthetic key. Never in the app bundle. */
const testAuthorizer = (): CustomerAuthorizer => {
  const sign = keyFromSeed(1);
  return {
    label: "Test only: synthetic key",
    synthetic: true,
    publicKey: async () => SEED1_PK,
    sign: async (m) => {
      signatures++;
      return {
        hold_signature: sign(m.hold_message_hex),
        use_signature: sign(m.use_message_hex),
      };
    },
  };
};

let keys = 0;
const makeKey = () => `view-key-${String(++keys).padStart(6, "0")}`;

async function setup(
  override: Partial<CustomerPort> = {},
  authorizer: () => CustomerAuthorizer = testAuthorizer,
) {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  // Synthetic: publish the founder's business so its offer is public.
  w.state.store.db
    .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
    .run(new Date().toISOString(), w.f.business);
  const port = portOver(
    w.cara,
    () => {
      w.clock.now = Number(w.chain.ts);
    },
    override,
  );
  const open = (useId?: string) =>
    new CustomerWorkspace(port, {
      personId: w.cara.id,
      offerId: useId ? undefined : offer,
      useId,
      authorizer,
      now: () => w.clock.now,
      makeKey,
    });
  // Provider calls made by customers' runs (the release check before this made its own).
  const base = w.provider.calls.length;
  const runs = () => w.provider.calls.length - base;
  return { w, offer, open, runs };
}

async function reserved(ws: CustomerWorkspace, text = INVOICE) {
  await ws.start();
  ws.setDraft(text);
  await ws.prepare();
  await ws.authorize();
  expect(ws.getState().use?.state).toBe("reserved");
}

const statuses = (s: WorkspaceState) =>
  Object.fromEntries(customerSteps(s).map((st) => [st.key, st.status]));

describe("001j steps follow the real request", () => {
  it("document → review → run → result: each step completes only when the request shows it", async () => {
    const { open, runs } = await setup();
    const ws = open();
    await ws.start();
    expect(statuses(ws.getState())).toEqual({
      document: "current",
      authorize: "waiting",
      run: "waiting",
      result: "waiting",
    });
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(statuses(ws.getState())).toMatchObject({ document: "completed", authorize: "current" });
    expect(activeCustomerStep(ws.getState())).toBe("authorize");
    await ws.authorize();
    expect(statuses(ws.getState())).toMatchObject({ authorize: "completed", run: "current" });
    await ws.run();
    expect(statuses(ws.getState())).toMatchObject({ run: "completed", result: "current" });
    await ws.showResult();
    expect(completeResult(ws.getState())).toBe(true);
    expect(statuses(ws.getState()).result).toBe("completed");
    expect(activeCustomerStep(ws.getState())).toBe("result");
    const strip = renderToStaticMarkup(
      <CustomerProgress steps={customerSteps(ws.getState())} active="result" />,
    );
    expect(strip.match(/aria-current="step"/g)).toHaveLength(1);
    expect(strip).toMatch(
      /aria-current="step"><span class="use-step-status">Completed<\/span><strong class="use-step-title">Your result/,
    );
    expect(runs()).toBe(1);
  });

  it("a running request: checking from a reloaded page shows Running and never runs it again", async () => {
    const { w, open, runs } = await setup();
    const ws = open();
    await reserved(ws);
    const held = heldScript(() => correct({ document: INVOICE } as never));
    w.provider.script = held.script;
    const running = ws.run();
    try {
      await held.entered;
      const reload = open(ws.getState().use?.id);
      await reload.start();
      expect(reload.getState().use?.execution?.state).toBe("running");
      expect(statuses(reload.getState())).toMatchObject({ run: "current", result: "waiting" });
      expect(nextStep(reload.getState()).action).toBe("refresh");
      for (let i = 0; i < 3; i++) await reload.refresh();
      expect(runs()).toBe(1);
    } finally {
      held.open();
      await running;
    }
    expect(statuses(ws.getState())).toMatchObject({ run: "completed", result: "current" });
    expect(runs()).toBe(1);
  });

  it("unit words follow the unit evidence: a requested return isn't a returned unit, a reservation is history", async () => {
    // Astra's CustomerStepReview: "reserved" persists after charge or return, and release_pending
    // isn't returned. The real path: reserve, ask for the unit back, settle.
    const { open, runs } = await setup();
    const ws = open();
    await reserved(ws);
    const authorized = () => customerSteps(ws.getState())[1]?.detail ?? "";
    const run = () => customerSteps(ws.getState())[2];
    await ws.release();
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const unit = ws.getState().use?.units.unit as string;
      seen.add(unit);
      expect(authorized()).not.toMatch(/holds/);
      expect(authorized()).toMatch(/^Authorized: the contract confirmed one unit reserved/);
      if (unit === "release_pending") {
        expect(run()).toMatchObject({ status: "stopped" });
        expect(run()?.detail).toMatch(/Waiting for the contract to confirm the return/);
        expect(run()?.detail).not.toMatch(/returned/);
      }
      if (unit === "returned") {
        expect(run()?.detail).toBe("Not run: the contract confirmed your unit returned.");
        break;
      }
      await ws.checkUnit();
    }
    expect([...seen]).toEqual(["release_pending", "returned"]);
    expect(runs()).toBe(0);
  });

  it("an ambiguous answer is shown as needing checking, never as a complete extraction", async () => {
    const { open } = await setup();
    const ws = open();
    await reserved(ws, AMBIGUOUS);
    await ws.run();
    await ws.showResult();
    const s = ws.getState();
    expect(s.result?.result.outcome).not.toBe("extracted");
    expect(completeResult(s)).toBe(false);
    expect(statuses(s).result).toBe("attention");
    const r = s.result;
    if (!r) throw new Error("no result");
    const html = renderToStaticMarkup(<CustomerResult r={r} />);
    expect(html).toContain("Not a complete extraction.");
    expect(html).toContain("use-answer is-partial");
    expect(html).not.toContain("Every required field found");
  });

  it("an unknown provider outcome stops the run: no result, never re-run, never charged", async () => {
    const { w, open, runs } = await setup();
    const ws = open();
    await reserved(ws);
    w.provider.script = async () => {
      throw new RuntimeFailure("No answer", "provider_error", null);
    };
    await ws.run();
    const s = ws.getState();
    expect(s.use?.execution?.state).toBe("unknown");
    expect(statuses(s)).toMatchObject({ run: "stopped", result: "stopped" });
    expect(nextStep(s).action).not.toBe("run");
    await ws.refresh();
    expect(runs()).toBe(1);
    expect(w.chain.charged).toBe(0);
  });

  it("access lost: the request and its result leave the page; the steps start over", async () => {
    let gone = false;
    const box: { real?: CustomerPort } = {};
    const { w, open } = await setup({
      use: async (id) => {
        if (gone) throw new ApiError(404, "No such request");
        return box.real?.use(id);
      },
    });
    box.real = portOver(w.cara, () => {
      w.clock.now = Number(w.chain.ts);
    });
    const ws = open();
    await reserved(ws);
    await ws.run();
    await ws.showResult();
    expect(statuses(ws.getState()).result).toBe("completed");
    gone = true;
    await ws.refresh();
    const s = ws.getState();
    expect([s.use, s.result]).toEqual([null, null]);
    expect(statuses(s)).toMatchObject({ document: "current", result: "waiting" });
  });
});

describe("001j the customer's view across a sale (synthetic preview scenario)", () => {
  it("same product, business, history and complete result before and after the sale", async () => {
    const p = await customerPreview({ withOffer: true });
    const as = await p.site.fetch(
      new Request(`http://preview/api/session/as/${p.people.cara}`, { method: "POST" }),
    );
    const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    let requests = 0;
    const cara: Call = async (path, method = "GET", body) => {
      if (++requests > 60) throw new Error("request cap");
      const res = await p.site.fetch(
        new Request(`http://preview${path}`, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
    };
    const signer: CustomerAuthorizer = {
      label: "Preview only: synthetic test key",
      synthetic: true,
      publicKey: async () => PREVIEW_PUBLIC_KEY,
      sign: async (m) => (await cara("/__preview/sign", "POST", m)).body as never,
    };
    const open = (useId?: string) =>
      new CustomerWorkspace(portOver(cara), {
        personId: p.people.cara,
        offerId: useId ? undefined : (p.offerId as string),
        useId,
        authorizer: () => signer,
        makeKey,
      });
    const ws = open();
    await reserved(ws);
    await ws.run();
    await ws.showResult();
    for (let i = 0; i < 3 && ws.getState().use?.units.unit !== "charged"; i++) await ws.checkUnit();
    const id = ws.getState().use?.id as string;
    const view = (s: WorkspaceState) => ({
      product: s.use?.offer.product.name,
      business: s.use?.offer.business.name,
      unit: s.use?.units.unit,
      steps: statuses(s),
      fields: s.result?.result.fields.map((f) => [f.key, f.value]),
      recent: s.recent.map((r) => [r.id, r.product.name]),
    });
    const before = view(ws.getState());
    expect(before).toMatchObject({ unit: "charged", steps: { result: "completed" } });

    p.controls.sale(); // synthetic: the business goes to Noah; not a live transaction
    const after = open(id);
    await after.start();
    await after.showResult();
    expect(view(after.getState())).toEqual(before);
    expect(p.controls.summary().entitlement).toMatchObject({ free: "99", consumed: "1" });
  });
});

// Job 001j1, Astra's browser finding on 89c6923: after the server ran a use but its answer was
// lost, the page still offered "Run it on my document" and "Don't run it: return my unit". The
// same request's direct link showed the finished result. These lose one answer of the real API
// (the server acts, or never sees it, or refuses) and check what the page's own controls
// (StepActions, the component the page renders) offer at each step.

type Method = "execute" | "confirm" | "release";
/** One answer of `method` is lost: after the server acted, before it saw it, or a refusal. */
async function losing(method: Method, mode: "acted" | "unsent" | "refused") {
  let lose = true;
  const box: { real?: CustomerPort; failReads: number } = { failReads: 0 };
  const call = (id: string, b: unknown) => {
    if (!box.real) throw new Error("port not ready");
    return (box.real[method] as (id: string, b: unknown) => Promise<unknown>)(id, b);
  };
  const x = await setup({
    [method]: async (id: string, b: unknown) => {
      if (!lose) return call(id, b);
      lose = false;
      if (mode === "refused") throw new ApiError(409, "Not possible now", "not_now");
      if (mode === "acted") await call(id, b);
      throw new TypeError("network");
    },
    use: async (id: string) => {
      if (box.failReads > 0) {
        box.failReads--;
        throw new ApiError(503, "Service unavailable");
      }
      return box.real?.use(id);
    },
  } as Partial<CustomerPort>);
  box.real = portOver(x.w.cara, () => {
    x.w.clock.now = Number(x.w.chain.ts);
  });
  return { ...x, box };
}

const controls = (s: WorkspaceState) =>
  renderToStaticMarkup(<StepActions s={s} onAction={() => {}} />);

describe("001j1 a lost answer is recovered visibly, on the same request", () => {
  it("lost execute: only Check what happened; a failed read keeps it; a fresh read shows the finished run once", async () => {
    const { open, runs, box } = await losing("execute", "acted");
    const ws = open();
    await reserved(ws);
    const id = ws.getState().use?.id;
    await ws.run();

    // Immediately: the page offers a check of this request, nothing based on the stale state.
    let s = ws.getState();
    expect(s.inDoubt).toEqual({ action: "run", useId: id });
    expect(nextStep(s)).toMatchObject({ action: "check_request", label: "Check what happened" });
    let html = controls(s);
    expect(html).toContain("Check what happened");
    expect(html).toMatch(/It may have run\. Check this request: it is never run again/);
    expect(html).not.toContain("Run it on my document");
    expect(html).not.toContain("return my unit");
    expect(statuses(s)).toMatchObject({ run: "attention", result: "waiting" });
    expect(runs()).toBe(1);
    // Astra's recovery review: the heading and result area don't keep the stale instruction.
    const use = s.use;
    const card = renderToStaticMarkup(
      <>
        <StepHeading s={s} />
        <ResultArea use={use} result={null} fields={[]} inDoubt />
      </>,
    );
    expect(card).toContain("Check this request");
    expect(card).toContain("Not known until this request is checked");
    expect(card).not.toMatch(/Run it when you.re ready/);
    expect(card).not.toContain(use?.headline.detail ?? "(none)");

    // The check's read fails: still in doubt, still the same action, nothing run.
    box.failReads = 1;
    await ws.checkRequest();
    s = ws.getState();
    expect(s.inDoubt?.useId).toBe(id);
    expect(nextStep(s).action).toBe("check_request");
    expect(s.notice?.tone).toBe("warn");
    html = controls(s);
    expect(html).toContain("Check what happened");
    expect(html).not.toContain("Run it on my document");

    // A fresh read of the same request: the run finished; the doubt is settled.
    await ws.checkRequest();
    s = ws.getState();
    expect(s.inDoubt).toBeNull();
    expect(s.use?.id).toBe(id);
    expect(s.use?.execution?.state).toBe("completed");
    expect(s.notice).toMatchObject({ code: "request_checked", tone: "ok" });
    expect(nextStep(s).action).toBe("show_result");
    expect(controls(s)).toContain("Show my result");
    expect(statuses(s)).toMatchObject({ run: "completed", result: "current" });
    expect(runs()).toBe(1);
  });

  it("the run never reached the server: the check says so, then running it is the same request", async () => {
    const { open, runs } = await losing("execute", "unsent");
    const ws = open();
    await reserved(ws);
    const id = ws.getState().use?.id;
    await ws.run();
    expect(nextStep(ws.getState()).action).toBe("check_request");
    await ws.checkRequest();
    // Astra's recovery review: the read says what is recorded now, nothing more.
    expect(ws.getState().notice).toMatchObject({
      code: "run_not_recorded",
      message: expect.stringMatching(/^Checked: no run is recorded for this request yet/),
    });
    expect(nextStep(ws.getState()).action).toBe("run");
    expect(runs()).toBe(0);
    await ws.run();
    expect(ws.getState().use).toMatchObject({ id, execution: { state: "completed" } });
    expect(runs()).toBe(1);
  });

  it("a lost execute whose run ended unknown: the check keeps it unknown, never 'ended'", async () => {
    const { w, open, runs } = await losing("execute", "acted");
    const ws = open();
    await reserved(ws);
    w.provider.script = async () => {
      throw new RuntimeFailure("No answer", "provider_error", null);
    };
    await ws.run();
    expect(nextStep(ws.getState()).action).toBe("check_request");
    await ws.checkRequest();
    const s = ws.getState();
    expect(s.use?.execution?.state).toBe("unknown");
    expect(s.notice).toMatchObject({ tone: "warn", code: "run_unknown" });
    expect(s.notice?.message).toMatch(/can't be told whether this run finished/);
    expect(s.notice?.message).not.toMatch(/ended|failed/);
    expect(nextStep(s).action).not.toBe("run");
    expect(runs()).toBe(1);
  });

  it("the signer fails on this device: nothing sent, no doubt, the same request can be authorized", async () => {
    let fail = true;
    let confirms = 0;
    const box: { real?: CustomerPort } = {};
    const failing = (): CustomerAuthorizer => {
      const real = testAuthorizer();
      return {
        ...real,
        sign: async (m) => {
          if (fail) {
            fail = false;
            throw new Error("The signer was closed");
          }
          return real.sign(m);
        },
      };
    };
    const { w, open } = await setup(
      {
        confirm: async (id, b) => {
          confirms++;
          return box.real?.confirm(id, b);
        },
      },
      failing,
    );
    box.real = portOver(w.cara, () => {
      w.clock.now = Number(w.chain.ts);
    });
    const ws = open();
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    const id = ws.getState().use?.id;
    await ws.authorize();
    let s = ws.getState();
    expect(confirms).toBe(0);
    expect(s.inDoubt).toBeNull();
    expect(s.notice).toMatchObject({ code: "not_sent" });
    expect(s.notice?.message).toMatch(/nothing was sent and nothing is held/);
    expect(nextStep(s).action).toBe("authorize");
    const html = controls(s);
    expect(html).toContain("Authorize this one use");
    expect(html).not.toContain("Check what happened");
    await ws.authorize();
    s = ws.getState();
    expect(confirms).toBe(1);
    expect(s.use).toMatchObject({ id, state: "reserved" });
  });

  it("an explicit refusal is a definite answer: no doubt, the refusal is shown", async () => {
    const { open, runs } = await losing("execute", "refused");
    const ws = open();
    await reserved(ws);
    await ws.run();
    const s = ws.getState();
    expect(s.inDoubt).toBeNull();
    expect(s.notice).toMatchObject({ tone: "error", message: "Not possible now" });
    expect(nextStep(s).action).not.toBe("check_request");
    expect(runs()).toBe(0);
  });

  it("lost authorization: no second signature or cancel offered; the check finds it received", async () => {
    const { open } = await losing("confirm", "acted");
    const ws = open();
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    const id = ws.getState().use?.id;
    const before = signatures;
    await ws.authorize();
    expect(signatures - before).toBe(1);
    const html = controls(ws.getState());
    expect(html).toContain("Check what happened");
    expect(html).not.toContain("Authorize this one use");
    expect(html).not.toContain("Cancel this request");
    expect(statuses(ws.getState())).toMatchObject({ authorize: "attention", run: "waiting" });
    await ws.checkRequest();
    const s = ws.getState();
    expect(s.use?.id).toBe(id);
    expect(s.use?.state).not.toBe("prepared");
    expect(s.notice?.code).toBe("request_checked");
    expect(signatures - before).toBe(1);
  });

  it("lost return: the stale Run and return aren't offered; the check shows the return requested", async () => {
    const { open, runs } = await losing("release", "acted");
    const ws = open();
    await reserved(ws);
    await ws.release();
    const html = controls(ws.getState());
    expect(html).toContain("Check what happened");
    expect(html).not.toContain("Run it on my document");
    expect(html).not.toContain("return my unit");
    await ws.checkRequest();
    expect(["release_pending", "returned"]).toContain(ws.getState().use?.units.unit);
    expect(nextStep(ws.getState()).action).not.toBe("run");
    expect(runs()).toBe(0);
  });

  it("a reload or direct link reads the request fresh: no stale doubt; leaving the request clears it", async () => {
    const { open, runs } = await losing("execute", "acted");
    const ws = open();
    await reserved(ws);
    const id = ws.getState().use?.id as string;
    await ws.run();
    expect(ws.getState().inDoubt).not.toBeNull();
    const link = open(id);
    await link.start();
    expect(link.getState()).toMatchObject({ inDoubt: null, use: { id } });
    expect(nextStep(link.getState()).action).toBe("show_result");
    ws.startAnother();
    expect(ws.getState()).toMatchObject({ inDoubt: null, use: null });
    expect(runs()).toBe(1);
  });
});
