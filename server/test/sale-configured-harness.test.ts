// Job 003wf2 brief item 8: the configured-composition sale review harness
// (scripts/lib/configuredSaleHarness.ts) as a finite PROCESS test: the normal entry in its own child
// over the configured composition, reached only through the harness's site listener with a cookie
// jar, as a browser would (the same routes, the synthetic wallet module's own calls). Ephemeral
// ports, a disposable directory, one bounded child; everything is stopped and removed here.

import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIGURED_BUYER,
  CONFIGURED_SELLER,
  type ConfiguredSaleHarness,
  freePort,
  HARNESS_CSP,
  HARNESS_LABEL,
  startConfiguredSaleHarness,
} from "../../scripts/lib/configuredSaleHarness.ts";
import type { Json } from "./customer-world.ts";
import { OP } from "./lifecycleWorld.ts";

let running: ConfiguredSaleHarness | null = null;
afterEach(async () => {
  await running?.stop();
  running = null;
});

/** A browser on the harness site: its own cookie jar, only that origin. */
function browserOn(origin: string, account: string) {
  const jar = new Map<string, string>();
  const call = async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  return Object.assign(call, { account });
}
type Browser = ReturnType<typeof browserOn>;

/** Sign in as the wallet would: the composition's challenge, the module's signMessage, verify. */
async function signIn(h: ConfiguredSaleHarness, call: Browser, account: string) {
  await fetch(`${h.control}/account/${account}`, { method: "POST" });
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as Json;
  const signed = (
    await call("/__harness/sign-message", "POST", {
      message: ch.message,
      recipient: ch.recipient,
      nonce: ch.nonce,
      callbackUrl: ch.callback_url,
      state: null,
    })
  ).body;
  const v = await call("/api/session/verify", "POST", {
    account_id: signed.accountId,
    public_key: signed.publicKey,
    signature: signed.signature,
    nonce: ch.nonce,
  });
  expect([200, 201], JSON.stringify(v.body)).toContain(v.status);
}

/** One wallet action as the page's controller does it: preview, store, ask, wallet, hash, check. */
async function act(
  h: ConfiguredSaleHarness,
  call: Browser & { account: string },
  kind: string,
  input: Json = {},
  o: { lose?: boolean } = {},
) {
  const p = await call(`/api/sales/${h.business}/prepare`, "POST", { kind, input });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const c = await call(`/api/sales/${h.business}/actions`, "POST", {
    kind,
    input: p.body.input,
    action_digest: p.body.action_digest,
    idempotency_key: `configured-${kind}-${Math.random().toString(36).slice(2, 10)}`,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const a = c.body.action as Json;
  expect((await call(`/api/sales/actions/${a.id}/requested`, "POST", {})).body.ask).toBe("granted");
  // The synthetic wallet is one per harness: it acts as this person's account (as switching
  // accounts in a wallet would); a transaction signed by another account never resolves this one.
  await fetch(`${h.control}/account/${call.account}`, { method: "POST" });
  if (o.lose) await fetch(`${h.control}/lose-next`, { method: "POST" });
  const sent = await call("/__harness/tx", "POST", {
    receiverId: a.call.receiverId,
    actions: [
      {
        methodName: a.call.methodName,
        args: JSON.stringify(a.call.args),
        gas: a.call.gas,
        deposit: a.call.deposit,
      },
    ],
  });
  if (o.lose) {
    expect(sent.status).toBe(502);
    return {
      id: a.id as string,
      check: await call(`/api/sales/actions/${a.id}/check`, "POST", {}),
    };
  }
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  await call(`/api/sales/actions/${a.id}/requested`, "POST", {
    tx_hash: sent.body.transaction.hash,
  });
  return {
    id: a.id as string,
    hash: sent.body.transaction.hash as string,
    check: await call(`/api/sales/actions/${a.id}/check`, "POST", {}),
  };
}

const history = async (h: ConfiguredSaleHarness, account: string) =>
  (await (await fetch(`${h.control}/history?account=${account}`)).json()).transactions as Json[];

describe("003wf2 the configured-composition sale review harness (actual child process)", () => {
  it("serves the composition's own page and API with only the wallet module added; seller and buyer close a sale; lost funding is recovered by its original ID; customers keep using; the stop leaves nothing", async () => {
    const [sitePort, controlPort] = [await freePort(), await freePort()];
    const h = await startConfiguredSaleHarness({ sitePort, controlPort, heapMb: 256 });
    running = h;
    const dir = h.dir;
    expect(existsSync(dir)).toBe(true);

    // Provenance: the composition's own page (web_dist), its configured environment and inventory.
    const page = await fetch(`${h.origin}/sales/${h.business}`);
    expect(page.headers.get("content-security-policy")).toBe(HARNESS_CSP);
    const html = await page.text();
    expect(html).toContain('<script src="/__harness/wallet.js"></script>');
    expect(html).toMatch(/<script type="module"[^>]*src="\/assets\//);
    const seller = browserOn(h.origin, CONFIGURED_SELLER);
    const env = (await seller("/api/env")).body;
    expect(env).toMatchObject({
      environment: "Configured (testnet)",
      localPreview: false,
      identity: "verified",
      wallet: { network: "testnet", available: true, harness: HARNESS_LABEL },
    });
    const caps = (await seller("/api/system/capabilities")).body;
    expect(caps.mode).toBe("configured");
    const cap = (k: string) => caps.capabilities.find((c: Json) => c.key === k);
    expect(cap("maintenance")).toMatchObject({ state: "on" });
    expect(cap("checks")).toMatchObject({ state: "unavailable" }); // the isolated worker is off
    expect(cap("model")).toMatchObject({ provenance: "synthetic model HTTP (lifecycle test)" });
    expect(JSON.stringify(caps)).toContain("synthetic RPC (lifecycle test)");
    // No control route exists on the site.
    expect((await seller("/lose-next", "POST")).status).not.toBe(200);

    // The seller proposes through the composition's sale routes and the synthetic wallet.
    await signIn(h, seller, CONFIGURED_SELLER);
    const s0 = (await seller(`/api/sales/${h.business}`)).body;
    expect([s0.roles.seller, s0.platform_operator]).toEqual([true, OP]);
    const proposed = await act(h, seller, "propose", {
      buyer_account: CONFIGURED_BUYER,
      price: "250000000",
      expires_in_days: 7,
      available_floor: "0",
      grants: [{ account: OP, caps: 1 }],
      exclusions: ["The ledgerline.example domain and its DNS account"],
      note: "Fictional terms for a synthetic review.",
    });
    expect(proposed.check.body.resolution).toMatchObject({ kind: "confirmed", result: "proposed" });
    expect(proposed.check.body.effects).toMatchObject({ recorded: { deal_seq: "1", version: 1 } });

    // The buyer registers, then funds with a lost answer: no longer possible, recovered by ID only.
    const buyer = browserOn(h.origin, CONFIGURED_BUYER);
    await signIn(h, buyer, CONFIGURED_BUYER);
    expect((await buyer(`/api/sales/${h.business}`)).body.roles.buyer).toBe(true);
    const reg = await act(h, buyer, "register");
    expect(reg.check.body.resolution.kind).toBe("confirmed");
    const sentBefore = h.controls.sent.length;
    const fund = await act(h, buyer, "fund", {}, { lose: true });
    expect(fund.check.body.resolution.kind).toBe("no_longer_possible");
    const original = (await history(h, CONFIGURED_BUYER)).find(
      (t) => t.method === "ft_transfer_call",
    )?.id as string;
    expect(original).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    const wrong = await buyer(`/api/sales/actions/${fund.id}/check`, "POST", {
      tx_hash: reg.hash,
    });
    expect(wrong.body.transaction).toMatchObject({ hash: reg.hash, matched: false });
    const right = await buyer(`/api/sales/actions/${fund.id}/check`, "POST", {
      tx_hash: original,
    });
    expect(right.body.resolution).toMatchObject({ kind: "confirmed" });
    expect(h.controls.sent.length).toBe(sentBefore + 1); // recovery sent nothing
    expect((await act(h, buyer, "accept")).check.body.resolution.kind).toBe("confirmed");

    // The seller closes; the composition's reconciliation applies it; roles follow the contract.
    const close = await act(h, seller, "accept");
    expect(close.check.body.resolution, JSON.stringify(close.check.body)).toMatchObject({
      kind: "confirmed",
      result: "closed",
    });
    expect(close.check.body.effects).toMatchObject({
      reconcile: { state: "applied" },
      finished: true,
    });
    expect(h.sale.controlView()).toMatchObject({ owner: CONFIGURED_BUYER, generation: 2 });
    const after = (await seller(`/api/sales/${h.business}`)).body;
    expect([after.local_owner, after.roles.former_seller]).toEqual([false, true]);
    expect(after.party.sale_proceeds_claim).toBe("250000000");
    expect((await buyer(`/api/sales/${h.business}`)).body.local_owner).toBe(true);

    // Cara's next use runs under the buyer's grants: the real writer opens the hold over the RPC.
    const use = (await (
      await fetch(`${h.control}/customer-use`, { method: "POST" })
    ).json()) as Json;
    expect(use, JSON.stringify(use)).toMatchObject({
      status: 201,
      reserved: "reserved",
      fulfilled: true,
    });
    expect(h.b.rpc.applied.map((x) => x.method)).toContain("open_hold");

    // The bounded stop: the child drains and exits 0, the listeners close, the directory is gone.
    const r = await h.stop();
    running = null;
    expect(r).toEqual({ childExit: 0, forcedKill: false });
    expect(existsSync(dir)).toBe(false);
    await expect(fetch(`${h.origin}/api/env`)).rejects.toThrow();
    await expect(fetch(`${h.app}/api/env`)).rejects.toThrow();
  }, 180_000);

  it("a cumulative recovery and aftercare scenario stays inside its explicit budget: lost proposal, funding and close, wrong IDs, repeated reads, apply, registration, restored then paid", async () => {
    const h = await startConfiguredSaleHarness({
      sitePort: await freePort(),
      controlPort: await freePort(),
      heapMb: 256,
    });
    running = h;
    const seller = browserOn(h.origin, CONFIGURED_SELLER);
    const buyer = browserOn(h.origin, CONFIGURED_BUYER);
    await signIn(h, seller, CONFIGURED_SELLER);
    await signIn(h, buyer, CONFIGURED_BUYER);
    /** What a page reload reads (the session, the environment, the sale), a few times over. */
    const reloads = async (call: Browser, n = 5) => {
      for (let i = 0; i < n; i++) {
        expect((await call("/api/me")).status).toBe(200);
        expect((await call(`/api/sales/${h.business}`)).status).toBe(200);
      }
    };
    const recover = async (call: Browser, id: string, method: string, wrong: string) => {
      const w = await call(`/api/sales/actions/${id}/check`, "POST", { tx_hash: wrong });
      expect(w.body.transaction).toMatchObject({ matched: false });
      await reloads(call);
      const tx = (await history(h, call.account)).filter((x) => x.method === method).at(-1)
        ?.id as string;
      const r = await call(`/api/sales/actions/${id}/check`, "POST", { tx_hash: tx });
      expect(r.body.resolution, JSON.stringify(r.body)).toMatchObject({ kind: "confirmed" });
      return r;
    };
    const FAKE = "4".repeat(43);

    // Lost proposal: the control moved, so it can no longer take effect; recovered by its ID only.
    const p = await act(
      h,
      seller,
      "propose",
      {
        buyer_account: CONFIGURED_BUYER,
        price: "250000000",
        expires_in_days: 7,
        available_floor: "0",
        grants: [{ account: OP, caps: 1 }],
        exclusions: [],
        note: "",
      },
      { lose: true },
    );
    expect(p.check.body.resolution.kind).toBe("no_longer_possible");
    expect((await recover(seller, p.id, "propose_sale_guarded", FAKE)).body.effects).toMatchObject({
      recorded: { deal_seq: "1", version: 1 },
    });
    // Buyer: registration, lost funding (wrong ID: the registration), acceptance.
    const reg = await act(h, buyer, "register");
    const f = await act(h, buyer, "fund", {}, { lose: true });
    expect(f.check.body.resolution.kind).toBe("no_longer_possible");
    await recover(buyer, f.id, "ft_transfer_call", reg.hash as string);
    expect((await act(h, buyer, "accept")).check.body.resolution.kind).toBe("confirmed");
    // Lost close: the page offers Apply; applying first, then the original ID reports "already".
    const close = await act(h, seller, "accept", {}, { lose: true });
    expect(close.check.body.resolution.kind).toBe("no_longer_possible");
    const s1 = (await seller(`/api/sales/${h.business}`)).body;
    const intent = (s1.intents as Json[]).find((i) => i.status === "recorded");
    expect(intent).toBeTruthy();
    const applied = await seller(
      `/api/businesses/${h.business}/v3/intents/${intent?.id}/reconcile`,
      "POST",
    );
    expect(applied.body, JSON.stringify(applied.body)).toMatchObject({ state: "applied" });
    const rc = await recover(seller, close.id, "accept_sale", FAKE);
    expect(rc.body.effects).toMatchObject({ reconcile: { state: "already" }, finished: true });
    await reloads(buyer);
    // The former seller registers to collect; the first payout fails (restored), then it's paid.
    expect((await act(h, seller, "register")).check.body.resolution.kind).toBe("confirmed");
    await fetch(`${h.control}/fail-next-payout`, { method: "POST" });
    const first = await act(h, seller, "claim", { category: 2 });
    expect(first.check.body.resolution).toMatchObject({ kind: "confirmed", result: "restored" });
    expect((await seller(`/api/sales/${h.business}`)).body.party.sale_proceeds_claim).toBe(
      "250000000",
    );
    const paid = await act(h, seller, "claim", { category: 2 });
    expect(paid.check.body.resolution).toMatchObject({ kind: "confirmed", result: "paid" });
    const end = (await seller(`/api/sales/${h.business}`)).body;
    expect(end.party.sale_proceeds_claim).toBe("0");
    await reloads(seller);

    // The whole session stayed inside its explicit budget; the counters say what it used.
    const u = (await (await fetch(`${h.control}/usage`)).json()) as Json;
    expect(u.counters.exhausted).toBeNull();
    expect(u.counters.transport_failed).toBe(0);
    expect(u.counters.rpc_total).toBeGreaterThan(100);
    expect(u.counters.rpc_total).toBeLessThan(u.budget.rpc_requests);
    expect(u.counters.chain_calls).toBeLessThan(u.budget.chain_calls);
    expect(u.counters.sale_calls).toBeLessThan(u.budget.sale_calls);
    console.log(`configured scenario usage: ${JSON.stringify(u)}`);
  }, 240_000);

  it("a budget reached is REPORTED (the composition sees a failed read, the reason is named), never a success", async () => {
    const h = await startConfiguredSaleHarness({
      sitePort: await freePort(),
      controlPort: await freePort(),
      heapMb: 256,
      budget: { rpcRequests: 40 },
    });
    running = h;
    const seller = browserOn(h.origin, CONFIGURED_SELLER);
    await signIn(h, seller, CONFIGURED_SELLER);
    let last = 200;
    for (let i = 0; i < 30 && last === 200; i++)
      last = (await seller(`/api/sales/${h.business}`)).status;
    expect(last).not.toBe(200);
    const u = (await (await fetch(`${h.control}/usage`)).json()) as Json;
    expect(u.counters.exhausted.reason).toBe("harness RPC budget reached (40 requests)");
  }, 120_000);

  it("a start that fails after the child and listeners are up leaves no child, listener or directory", async () => {
    const [sitePort, controlPort] = [await freePort(), await freePort()];
    const e = (await startConfiguredSaleHarness({
      sitePort,
      controlPort,
      heapMb: 256,
      injectStartupFailure: true,
    }).catch((x) => x)) as Error & {
      harness?: { dir: string; pid: number | null; removed: boolean };
    };
    expect(e.message).toBe("injected startup failure (cleanup test)");
    expect(e.harness?.removed).toBe(true);
    expect(existsSync(e.harness?.dir as string)).toBe(false);
    expect(e.harness?.pid).toBeTypeOf("number");
    expect(() => process.kill(e.harness?.pid as number, 0)).toThrow(); // the child is gone
    await expect(fetch(`http://127.0.0.1:${sitePort}/`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${controlPort}/`)).rejects.toThrow();
  }, 120_000);
});
