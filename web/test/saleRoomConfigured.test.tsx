// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003wf2 brief item 8: the ACTUAL sale page (Router + SessionProvider + App, SaleRoom, SaleFlow,
// the real selectorWallet with the harness's synthetic module) against the CONFIGURED COMPOSITION:
// the normal entry in its own child process (scripts/lib/configuredSaleHarness.ts), reached through
// the harness's site listener on an ephemeral port. fetch is stubbed only to send the page's
// same-origin requests to that listener with one cookie jar per person (anything else is
// refused, as the harness CSP). A process-phase test: one bounded child, stopped and removed here.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONFIGURED_BUYER,
  CONFIGURED_SELLER,
  type ConfiguredSaleHarness,
  freePort,
  startConfiguredSaleHarness,
} from "../../scripts/lib/configuredSaleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { App } from "../src/App.tsx";
import { Router } from "../src/router.tsx";
import { SessionProvider } from "../src/session.tsx";

const PAGE = "http://127.0.0.1:8814";
let h: ConfiguredSaleHarness;
let root: Root | null = null;
const jars = new Map<string, Map<string, string>>();
let who = CONFIGURED_SELLER as string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  h = await startConfiguredSaleHarness({
    sitePort: await freePort(),
    controlPort: await freePort(),
    heapMb: 256,
  });
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      PAGE,
    );
    if (url.origin !== PAGE) throw new Error(`refused: no network (${url.origin})`);
    const jar = jars.get(who) ?? new Map<string, string>();
    jars.set(who, jar);
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await realFetch(`${h.origin}${url.pathname}${url.search}`, { ...init, headers });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    return res;
  }) as typeof fetch);
  new Function(WALLET_SCRIPT)();
}, 120_000);
afterAll(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
  const r = await h?.stop();
  expect(r).toEqual({ childExit: 0, forcedKill: false });
}, 60_000);

/** The harness's control listener (a separate origin; reached directly, never by the page). */
const fetchControl = async (path: string) =>
  (await (await realFetch(`${h.control}${path}`, { method: "POST" })).json()) as Json;
const controlGet = async (path: string) =>
  (await (await realFetch(`${h.control}${path}`)).json()) as Json;

const text = () => document.body.textContent ?? "";
const wait = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 1000 && !cond(); i++)
    await act(async () => new Promise((r) => setTimeout(r, 15)));
  expect(cond(), `${what}: ${text().slice(-900)}`).toBe(true);
};
const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label)) as
    | HTMLButtonElement
    | undefined;
const click = async (label: string, within: ParentNode = document) => {
  await wait(
    () => Boolean(button(label, within) && !button(label, within)?.disabled),
    `button "${label}"`,
  );
  await act(async () => button(label, within)?.click());
};
const fieldInput = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll("label.field")]
    .find((l) => l.querySelector("span")?.textContent?.startsWith(label))
    ?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | undefined;
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const historyRow = (label: string) =>
  [...document.querySelectorAll(".sale-history li")].find((li) =>
    li.textContent?.startsWith(label),
  ) as HTMLElement | undefined;

/** This person, signed in through the composition's verified routes with the wallet module. */
async function as(account: string) {
  who = account;
  await fetchControl(`/account/${account}`);
  if (!jars.get(account)?.size) {
    const ch = (await (await fetch("/api/session/challenge", { method: "POST" })).json()).challenge;
    const signed = await (
      await fetch("/__harness/sign-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: ch.message,
          recipient: ch.recipient,
          nonce: ch.nonce,
          callbackUrl: ch.callback_url,
          state: null,
        }),
      })
    ).json();
    const v = await fetch("/api/session/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        account_id: signed.accountId,
        public_key: signed.publicKey,
        signature: signed.signature,
        nonce: ch.nonce,
      }),
    });
    expect([200, 201]).toContain(v.status);
  }
  window.history.replaceState(null, "", `/sales/${h.business}`);
  if (root) await act(async () => root?.unmount());
  document.body.innerHTML = "";
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      createElement(Router, null, createElement(SessionProvider, null, createElement(App))),
    ),
  );
}

describe("003wf2 the sale page over the configured composition (actual child process)", () => {
  it("seller: readable review, Not now keeps the draft and focus, then a proposal through the wallet", async () => {
    await as(CONFIGURED_SELLER);
    await wait(() => text().includes("you are the seller"), "the seller's page");
    // The composition's environment banner (the harness label script is HTML-level; the process
    // test checks its injection into the composition's own page).
    expect(text()).toContain("Configured (testnet)");
    await click("Prepare terms");
    await wait(() => Boolean(fieldInput("Buyer's NEAR account")), "the terms form");
    await typeInto(fieldInput("Buyer's NEAR account") as HTMLInputElement, CONFIGURED_BUYER);
    await typeInto(fieldInput("Price in TUSD") as HTMLInputElement, "250");
    await click("Review the exact request");
    await wait(() => Boolean(document.querySelector(".sale-summary")), "the review");
    const summary = document.querySelector(".sale-summary")?.textContent ?? "";
    expect(summary).toContain(CONFIGURED_BUYER);
    expect(summary).toMatch(/Offer open until.*\d{4}, \d{1,2}:\d{2}\s?[AP]M [A-Z]/);
    expect(summary).toContain("meter.testnet (metering)"); // the configured platform operator
    await click("Not now");
    await wait(
      () => (document.activeElement as HTMLElement | null)?.dataset.focus === "terms-propose",
      "focus back on the review button",
    );
    expect((fieldInput("Buyer's NEAR account") as HTMLInputElement).value).toBe(CONFIGURED_BUYER);
    expect(h.controls.sent).toEqual([]);
    await click("Review the exact request");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("Deal 1, version 1"), "the proposal on the contract");
    expect(h.controls.sent.map((c) => c.methodName)).toEqual(["propose_sale_guarded"]);
  }, 60_000);

  it("buyer: a lost funding answer is recovered in History by its original ID only, across a reload; then acceptance", async () => {
    await as(CONFIGURED_BUYER);
    await wait(() => text().includes("you are the buyer"), "the buyer's page");
    await click("Register with the token");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("Registered with the token"), "registered");
    await fetchControl("/lose-next");
    await click("Fund escrow");
    await click("Ask my wallet for exactly this");
    await wait(
      () => Boolean(historyRow("Fund escrow")?.querySelector("form")),
      "the recovery form",
    );
    const sent = h.controls.sent.length;
    expect(button("Accept version 1")).toBeTruthy(); // not blocked by the inapplicable request
    const txs = (await controlGet(`/history?account=${CONFIGURED_BUYER}`)).transactions as Json[];
    const id = (m: string) => txs.find((t) => t.method === m)?.id as string;
    const row = () => historyRow("Fund escrow") as HTMLElement;
    await typeInto(
      fieldInput("Its transaction ID", row()) as HTMLInputElement,
      id("storage_deposit"),
    );
    await click("Check with this ID", row());
    await wait(() => text().includes("isn't this request"), "a wrong ID");
    await as(CONFIGURED_BUYER); // a reload
    await wait(() => Boolean(historyRow("Fund escrow")?.querySelector("form")), "after reload");
    await typeInto(
      fieldInput("Its transaction ID", row()) as HTMLInputElement,
      id("ft_transfer_call"),
    );
    await click("Check with this ID", row());
    await wait(() => text().includes("Escrow is funded"), "the original transaction");
    expect(h.controls.sent.length).toBe(sent);
    await click("Accept version 1");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("Waiting for the seller"), "waiting for the seller");
  }, 90_000);

  it("seller: the close is applied by the composition; the sidebar shows the closed terms apart from current authority", async () => {
    await as(CONFIGURED_SELLER);
    await click("Accept version 1 and close the sale");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("closed on the contract"), "the close");
    const aside = document.querySelector(".sale-continuity") as HTMLElement;
    await wait(() => (aside.textContent ?? "").includes("Authority after deal 1 closed"), "aside");
    expect(aside.textContent).toContain(
      `${CONFIGURED_SELLER} sold the business to ${CONFIGURED_BUYER}`,
    );
    expect(aside.textContent).toContain(`${CONFIGURED_BUYER} owns`);
    expect(aside.textContent).toContain("Operators now: meter.testnet (metering)");
    expect(aside.textContent).not.toContain("No sale is proposed");
    expect(aside.textContent).toContain("Sale proceeds owed (not paid yet)");
    expect(h.sale.controlView()).toMatchObject({ owner: CONFIGURED_BUYER, generation: 2 });
    expect(text()).toContain("you are the former seller");
    // Astra 00:21: the buyer revisits after the close. He is the closed deal's buyer and the new
    // owner, not "the seller"; his permission to propose a resale is unchanged.
    await as(CONFIGURED_BUYER);
    await wait(
      () => text().includes("you are the new owner (buyer in deal 1)"),
      "the new owner's header",
    );
    expect(text()).not.toContain("you are the seller");
    // Aftercare: operating comes first; resale stays a secondary action.
    expect(button("Open your business")).toBeTruthy();
    expect(button("Propose a resale")).toBeTruthy();
  }, 60_000);
});
