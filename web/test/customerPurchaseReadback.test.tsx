// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8818/"}
//
// Job 003wf3 (Astra 03:05): on the SAME mounted customer page, after Cara returns her reserved
// unit, the purchase panel's contract reading follows (100 uses ready, dated) instead of keeping
// the older 99; a re-read that fails keeps the earlier reading, clearly labelled as such. The
// actual App over the configured composition in its own child (scripts/lib/configuredSaleHarness);
// Cara's existing fixture key reserves through the harness control (no browser enrollment); the
// return and settlement are her page's own requests. fetch is stubbed only to reach the harness
// site, and to fail ONE purchase reading on purpose. One bounded child.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONFIGURED_CUSTOMER,
  type ConfiguredSaleHarness,
  freePort,
  startConfiguredSaleHarness,
} from "../../scripts/lib/configuredSaleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { App } from "../src/App.tsx";
import { Router } from "../src/router.tsx";
import { SessionProvider } from "../src/session.tsx";

const PAGE = "http://127.0.0.1:8818";
let h: ConfiguredSaleHarness;
let root: Root | null = null;
const jar = new Map<string, string>();
const realFetch = globalThis.fetch;
let failPurchaseReadings = 0;
let purchaseReadings = 0;

async function send(path: string, init: RequestInit = {}) {
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
const call = async (path: string, method = "GET", body?: unknown) => {
  const r = await send(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
};
const ctl = async (path: string, method = "POST") =>
  (await (await realFetch(`${h.control}${path}`, { method })).json()) as Json;

let useId = "";
beforeAll(async () => {
  h = await startConfiguredSaleHarness({
    sitePort: await freePort(),
    controlPort: await freePort(),
    heapMb: 256,
  });
  const r = await ctl("/customer/start");
  expect(r, JSON.stringify(r)).toMatchObject({ status: 200, state: "reserved" });
  useId = r.use as string;
  await ctl(`/account/${CONFIGURED_CUSTOMER}`);
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
  expect([200, 201]).toContain(v.status);
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      PAGE,
    );
    if (url.origin !== PAGE) throw new Error(`refused: no network (${url.origin})`);
    if (url.pathname.endsWith("/purchase-setup")) {
      purchaseReadings++;
      if (failPurchaseReadings > 0) {
        failPurchaseReadings--;
        throw new TypeError("Failed to fetch"); // this browser's request didn't get through
      }
    }
    return send(`${url.pathname}${url.search}`, init);
  }) as typeof fetch);
  new Function(WALLET_SCRIPT)();
}, 120_000);
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
  expect(cond(), `${what}: ${text().slice(-1200)}`).toBe(true);
};
const buy = () => document.querySelector("#buy-title")?.closest("section")?.textContent ?? "";
const click = async (label: string) => {
  const b = () =>
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === label) as
      | HTMLButtonElement
      | undefined;
  await wait(() => Boolean(b() && !b()?.disabled), `button "${label}"`);
  await act(async () => b()?.click());
};

describe("003wf3 the purchase reading follows this page's unit (actual child process)", () => {
  it("a returned unit updates the contract reading on the same mounted page; a failed re-read keeps the earlier one, labelled", async () => {
    window.history.replaceState(null, "", `/uses/${useId}`);
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root?.render(
        createElement(Router, null, createElement(SessionProvider, null, createElement(App))),
      ),
    );
    const mounted = document.body.firstElementChild;
    await wait(() => /99 uses ready for you \(read /.test(buy()), "the first reading (99)");
    // Cara returns her unit; the next purchase reading fails on purpose.
    failPurchaseReadings = 1;
    const before = purchaseReadings;
    await click("Don't run it: return my unit");
    await wait(() => purchaseReadings > before, "a re-read after the unit changed");
    await wait(() => /couldn't be read again just now/.test(buy()), "the failed re-read, labelled");
    expect(buy()).toMatch(/When last read \(.+\), the contract showed 99 uses ready for you\./);
    expect(buy()).not.toMatch(/the contract shows 99 uses ready/);
    // Settling it: the contract shows the unit back, and the reading follows.
    for (let i = 0; i < 10 && !text().includes("Unit returned"); i++) {
      const settle = [...document.querySelectorAll("button")].find(
        (x) => x.textContent?.trim() === "Settle my unit",
      );
      if (settle && !settle.disabled) await act(async () => settle.click());
      await act(async () => new Promise((r) => setTimeout(r, 300)));
    }
    await wait(() => text().includes("Unit returned"), "the unit returned");
    await wait(() => /100 uses ready for you \(read /.test(buy()), "the reading after the return");
    expect(buy()).not.toMatch(/couldn't be read again/);
    expect(document.body.firstElementChild).toBe(mounted);
  }, 90_000);
});
