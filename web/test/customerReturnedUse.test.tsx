// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8817/"}
//
// Job 003wf3 (Astra 02:43): the ACTUAL customer page (Router + SessionProvider + App, /uses/:id)
// over the configured Gated composition in its own child (scripts/lib/configuredSaleHarness.ts),
// for a use whose unit a real managed closing returned: Cara reserves (her existing fixture key, via
// the harness control; no browser enrollment), the sale's participants accept through the
// composition's routes and the synthetic wallet, the coordinator drains and returns her unit. The
// page then must not invite a run or promise a result anywhere. Read-only for Cara in the page;
// fetch is stubbed only to reach the harness site (one cookie jar per person). One bounded child.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONFIGURED_BUYER,
  CONFIGURED_CUSTOMER,
  CONFIGURED_SELLER,
  type ConfiguredSaleHarness,
  freePort,
  startConfiguredSaleHarness,
} from "../../scripts/lib/configuredSaleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { OP } from "../../server/test/lifecycleWorld.ts";
import { App } from "../src/App.tsx";
import { WONT_RUN_RESULT } from "../src/customerView.ts";
import { Router } from "../src/router.tsx";
import { SessionProvider } from "../src/session.tsx";

const PAGE = "http://127.0.0.1:8817";
let h: ConfiguredSaleHarness;
let root: Root | null = null;
const jars = new Map<string, Map<string, string>>();
let who = CONFIGURED_CUSTOMER as string;
const realFetch = globalThis.fetch;

/** One person's requests to the harness site, with their own cookie jar. */
async function send(account: string, path: string, init: RequestInit = {}) {
  const jar = jars.get(account) ?? new Map<string, string>();
  jars.set(account, jar);
  const headers = new Headers(init.headers);
  if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  const res = await realFetch(`${h.origin}${path}`, { ...init, headers });
  for (const set of res.headers.getSetCookie()) {
    const [pair, ...attrs] = set.split(";");
    const [name, ...rest] = (pair as string).split("=");
    if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
      jar.delete(name as string);
    else jar.set(name as string, rest.join("="));
  }
  return res;
}
const call = async (account: string, path: string, method = "GET", body?: unknown) => {
  const r = await send(account, path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
};
const ctl = async (path: string, method = "POST") =>
  (await (await realFetch(`${h.control}${path}`, { method })).json()) as Json;

async function signIn(account: string) {
  await ctl(`/account/${account}`);
  const ch = (await call(account, "/api/session/challenge", "POST")).body.challenge as Json;
  const signed = (
    await call(account, "/__harness/sign-message", "POST", {
      message: ch.message,
      recipient: ch.recipient,
      nonce: ch.nonce,
      callbackUrl: ch.callback_url,
      state: null,
    })
  ).body;
  const v = await call(account, "/api/session/verify", "POST", {
    account_id: signed.accountId,
    public_key: signed.publicKey,
    signature: signed.signature,
    nonce: ch.nonce,
  });
  expect([200, 201]).toContain(v.status);
}
/** One wallet action through the composition's routes and the synthetic wallet. */
async function act_(account: string, kind: string, input: Json = {}) {
  const biz = h.business;
  const p = await call(account, `/api/sales/${biz}/prepare`, "POST", { kind, input });
  expect(p.status, `${kind}: ${JSON.stringify(p.body)}`).toBe(200);
  const c = await call(account, `/api/sales/${biz}/actions`, "POST", {
    kind,
    input: p.body.input,
    action_digest: p.body.action_digest,
    idempotency_key: `returned-${kind}-${Math.random().toString(36).slice(2, 10)}`,
  });
  const a = c.body.action as Json;
  await call(account, `/api/sales/actions/${a.id}/requested`, "POST", {});
  await ctl(`/account/${account}`);
  const sent = await call(account, "/__harness/tx", "POST", {
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
  await call(account, `/api/sales/actions/${a.id}/requested`, "POST", {
    tx_hash: sent.body.transaction.hash,
  });
  return (await call(account, `/api/sales/actions/${a.id}/check`, "POST", {})).body as Json;
}

let useId = "";
beforeAll(async () => {
  h = await startConfiguredSaleHarness({
    sitePort: await freePort(),
    controlPort: await freePort(),
    heapMb: 256,
    gated: true,
  });
  // Cara reserves one use (her existing fixture key, through the control; no enrollment).
  const r = await ctl("/customer/start");
  expect(r, JSON.stringify(r)).toMatchObject({ status: 200, state: "reserved" });
  useId = r.use as string;
  // The sale reaches its managed closing through the participants' own requests.
  await signIn(CONFIGURED_SELLER);
  await signIn(CONFIGURED_BUYER);
  const terms = {
    buyer_account: CONFIGURED_BUYER,
    price: "250000000",
    expires_in_days: 7,
    available_floor: "0",
    grants: [{ account: OP, caps: 1 }],
    exclusions: [],
    note: "",
  };
  expect((await act_(CONFIGURED_SELLER, "propose", terms)).resolution.kind).toBe("confirmed");
  for (const k of ["register", "fund", "accept"])
    expect((await act_(CONFIGURED_BUYER, k)).resolution.kind, k).toBe("confirmed");
  expect((await act_(CONFIGURED_SELLER, "accept")).resolution.result).toBe("closing");
  // The coordinator drains: Cara's unit is returned (bounded wait).
  for (let i = 0; i < 200; i++) {
    const u = await ctl(`/customer/use/${useId}`, "GET");
    if (JSON.stringify(u.use).includes('"returned"')) break;
    await new Promise((d) => setTimeout(d, 300));
  }
  // The page's own requests go to the harness site, as Cara.
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      PAGE,
    );
    if (url.origin !== PAGE) throw new Error(`refused: no network (${url.origin})`);
    return send(who, `${url.pathname}${url.search}`, init);
  }) as typeof fetch);
  new Function(WALLET_SCRIPT)();
}, 180_000);
afterAll(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
  const r = await h?.stop();
  expect(r).toEqual({ childExit: 0, forcedKill: false });
}, 60_000);

const text = () => document.body.textContent ?? "";
const wait = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 1000 && !cond(); i++)
    await act(async () => new Promise((r) => setTimeout(r, 15)));
  expect(cond(), `${what}: ${text().slice(-900)}`).toBe(true);
};

describe("003wf3 the customer page for a use the managed closing returned (actual child process)", () => {
  it("every panel and step says it didn't run and has no result; nothing invites a run", async () => {
    who = CONFIGURED_CUSTOMER;
    await signIn(CONFIGURED_CUSTOMER);
    window.history.replaceState(null, "", `/uses/${useId}`);
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root?.render(
        createElement(Router, null, createElement(SessionProvider, null, createElement(App))),
      ),
    );
    await wait(() => text().includes("Your result"), "the use's steps");
    const result = document.querySelector(".use-placeholder")?.textContent ?? "";
    expect(result).toBe(WONT_RUN_RESULT.returned);
    const steps = document.querySelector(".use-steps")?.textContent ?? "";
    expect(steps).toContain("Not run: the contract confirmed your unit returned.");
    expect(steps).toContain(WONT_RUN_RESULT.returned);
    expect(text()).not.toContain("Run it when you're ready");
    expect(text()).not.toContain("Appears here after the run");
    const run = [...document.querySelectorAll("button")].find((b) =>
      /Run it on my document/.test(b.textContent ?? ""),
    );
    expect(run).toBeUndefined();
  }, 60_000);
});
