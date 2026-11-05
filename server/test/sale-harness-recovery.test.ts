// Job 003wf4 continuation 1 (Astra 06:21): the actual-browser original-plan-ID recovery failure,
// reproduced through the REAL sale harness routes (scripts/lib/saleHarness.ts: the app's routes,
// its NEP-413 sign-in, the synthetic wallet's /__harness/tx and the control routes) with the
// harness's own wall-clock sync and a reload-equivalent session (the same cookie jar, fresh reads).
// Fictional data; the chain is the TypeScript TEST DOUBLE; no network.

import { describe, expect, it } from "vitest";
import { saleControl, saleHarness } from "../../scripts/lib/saleHarness.ts";
import type { Json } from "./customer-world.ts";
import { SELLER } from "./sale-world.ts";

const ORIGIN = "http://127.0.0.1:8814";
const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};

async function session(budget?: Parameters<typeof saleHarness>[0]["budget"]) {
  const h = await saleHarness({ origin: ORIGIN, budget });
  const control = saleControl(h);
  const jar = new Map<string, string>();
  const go = async (path: string, method = "GET", body?: unknown) => {
    const headers = new Headers(body === undefined ? {} : { "content-type": "application/json" });
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await h.site.request(new URL(path, ORIGIN), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (rest.join("=")) jar.set(name as string, rest.join("="));
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  const ctl = (path: string) =>
    control.request(new URL(path, "http://127.0.0.1:8815"), { method: "POST" });
  // NEP-413 sign-in as the founder through the harness's synthetic wallet.
  h.controls.account = SELLER;
  const ch = (await go("/api/session/challenge", "POST")).body.challenge;
  const signed = (
    await go("/__harness/sign-message", "POST", {
      message: ch.message,
      recipient: ch.recipient,
      nonce: ch.nonce,
      callbackUrl: ch.callback_url,
      state: null,
    })
  ).body;
  const v = await go("/api/session/verify", "POST", {
    account_id: signed.accountId,
    public_key: signed.publicKey,
    signature: signed.signature,
    nonce: ch.nonce,
  });
  expect(v.status).toBeLessThan(300);
  /** The page's wallet: exactly the stored call through the harness's synthetic wallet route. */
  const wallet = async (call: Json) =>
    (
      await go("/__harness/tx", "POST", {
        receiverId: call.receiverId,
        actions: [
          {
            methodName: call.methodName,
            args: JSON.stringify(call.args),
            gas: call.gas,
            deposit: call.deposit,
          },
        ],
      })
    ).body;
  const biz = h.world.biz;
  const project = h.world.w.f.project;
  /** What the page reads on a load: the access picture and the sale setup. */
  const reload = async () => {
    const a = await go(`/api/businesses/${biz}/customer-access?project=${project}`);
    const s = await go(`/api/sales/${biz}`);
    return { a, s };
  };
  const store = async (kind: string, input: Json, key: string) => {
    const p = await go(`/api/sales/${biz}/prepare`, "POST", { kind, input });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const c = await go(`/api/sales/${biz}/actions`, "POST", {
      kind,
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: key,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.action.id as string;
    expect(
      (await go(`/api/sales/actions/${id}/requested`, "POST", { ask_id: `${key}-ask` })).body.ask,
    ).toBe("granted");
    return { id, call: c.body.action.call as Json };
  };
  return { h, go, ctl, wallet, reload, store, biz };
}

describe("003wf4 (Astra 06:21) original plan ID recovery through the actual harness routes", () => {
  it("after a closed wallet, a reviewed grant, a lost plan answer and a long session, the original ID confirms", async () => {
    const t = await session();
    await t.ctl("/access/retire-offer");
    await t.ctl("/access/operator/support");
    // 1. A plan request whose wallet window was closed: asked, nothing sent.
    const first = await t.store("create_plan", { plan: PLAN }, "browser-plan-0001");
    // 2. The reviewed grant (metering, support kept): control moves.
    const grant = await t.store("appoint", { keep_support: true }, "browser-grant-001");
    const g = await t.wallet(grant.call);
    await t.go(`/api/sales/actions/${grant.id}/requested`, "POST", { tx_hash: g.transaction.hash });
    expect((await t.go(`/api/sales/actions/${grant.id}/check`, "POST", {})).body.action.state).toBe(
      "confirmed",
    );
    expect((await t.go(`/api/sales/actions/${first.id}/check`, "POST", {})).body.action.state).toBe(
      "no_longer_possible",
    );
    // 3. A new plan, its answer lost (the transaction landed; no hash recorded).
    const second = await t.store("create_plan", { plan: PLAN }, "browser-plan-0002");
    const lost = await t.wallet(second.call);
    expect(lost.status?.Failure).toBeUndefined();
    // 4. A long session in a real browser: many reloads (each reads the contract), wall clock moving.
    for (let i = 0; i < 40; i++) {
      t.h.sync();
      const r = await t.reload();
      expect(
        [r.a.status, r.s.status],
        `reload ${i}: ${JSON.stringify(r.a.body).slice(0, 200)}`,
      ).toEqual([200, 200]);
    }
    // 5. The wrong ID (the appointment's), then the original plan ID.
    const wrong = await t.go(`/api/sales/actions/${second.id}/check`, "POST", {
      tx_hash: g.transaction.hash,
    });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(200);
    expect(wrong.body.transaction).toEqual({ hash: g.transaction.hash, matched: false });
    const own = await t.go(`/api/sales/actions/${second.id}/check`, "POST", {
      tx_hash: lost.transaction.hash,
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.action.state).toBe("confirmed");
    expect(own.body.effects).toMatchObject({ plan: { plan_id: 2 } });
    const after = (await t.reload()).a.body;
    expect(after.plans.map((p: Json) => p.plan_id)).toEqual([2]);
    // Within the harness's finite budget, and nothing exhausted.
    const b = t.h.budget();
    expect(b.exhausted.reason).toBeNull();
    for (const [used, ceiling] of Object.values(b.used))
      expect(used as number).toBeLessThan(ceiling as number);
  }, 60_000);

  it("a spent synthetic budget is named as the test double's, and reads still fail closed", async () => {
    // A deliberately small chain budget: the fixture's original 400 calls (what the 06:21 session had).
    const t = await session({ chain_calls: 400 });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => errors.push(a.join(" "));
    try {
      let failedAt = -1;
      for (let i = 0; i < 40 && failedAt < 0; i++) {
        const r = await t.reload();
        if (r.a.status !== 200 || r.s.status !== 200) {
          failedAt = i;
          // The product's own answer is unchanged: a failed read, never a guess.
          const failed = r.a.status !== 200 ? r.a : r.s;
          expect([failed.status, failed.body.code]).toEqual([503, "read_failed"]);
        }
      }
      expect(failedAt).toBeGreaterThan(0);
      const b = t.h.budget();
      expect(b.exhausted.reason).toBe("fixture chain ceiling reached (400 calls)");
      expect(b.used.chain_calls[0]).toBeGreaterThan(400);
      // Counter evidence through the control route, and one plain console diagnostic.
      const report = (await (
        await saleControl(t.h).request(new URL("/budget", "http://127.0.0.1:8815"))
      ).json()) as Json;
      expect(report.exhausted.reason).toBe("fixture chain ceiling reached (400 calls)");
      expect(errors.filter((e) => e.startsWith("SYNTHETIC BUDGET EXHAUSTED"))).toHaveLength(1);
      expect(errors[0]).toContain("not a NEAR or product failure");
    } finally {
      console.error = original;
    }
  }, 60_000);

  it("the printed link opens the product studio route the app navigates to", async () => {
    const { customerAccessPath } = await import("../../scripts/lib/saleHarness.ts");
    const t = await session();
    expect(customerAccessPath(t.h)).toBe(`/build/${t.h.world.w.f.project}`);
    // The product studio's own read for that id (web/src/productsApi.ts) answers the founder.
    expect((await t.go(`/api/product-projects/${t.h.world.w.f.project}`)).status).toBe(200);
  }, 60_000);
});
