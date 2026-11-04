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
import { CustomerProgress, CustomerResult } from "../src/pages/CustomerProduct.tsx";

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

/** Test-only authorizer: the contract tests' synthetic key. Never in the app bundle. */
const testAuthorizer = (): CustomerAuthorizer => {
  const sign = keyFromSeed(1);
  return {
    label: "Test only: synthetic key",
    synthetic: true,
    publicKey: async () => SEED1_PK,
    sign: async (m) => ({
      hold_signature: sign(m.hold_message_hex),
      use_signature: sign(m.use_message_hex),
    }),
  };
};

let keys = 0;
const makeKey = () => `view-key-${String(++keys).padStart(6, "0")}`;

async function setup(override: Partial<CustomerPort> = {}) {
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
      authorizer: testAuthorizer,
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

  it("a lost execute answer: checking again finds the same run, completed once", async () => {
    let lose = true;
    const box: { real?: CustomerPort } = {};
    const { w, open, runs } = await setup({
      execute: async (id, b) => {
        const r = await box.real?.execute(id, b);
        if (lose) {
          lose = false;
          throw new TypeError("network");
        }
        return r;
      },
    });
    box.real = portOver(w.cara, () => {
      w.clock.now = Number(w.chain.ts);
    });
    const ws = open();
    await reserved(ws);
    await ws.run();
    expect(statuses(ws.getState()).result).not.toBe("completed");
    for (let i = 0; i < 3 && ws.getState().use?.execution?.state !== "completed"; i++)
      await ws.refresh();
    expect(statuses(ws.getState())).toMatchObject({ run: "completed", result: "current" });
    expect(runs()).toBe(1);
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
