// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003wf2: the seller proposes through the ACTUAL page: Router + SessionProvider + App under
// jsdom, the real SaleRoom and SaleFlow, the real selectorWallet (pinned Wallet Selector) with the
// sale harness's injected synthetic module (its real script), over the harness's real routes and
// one synthetic customer+sale state. Only fetch is stubbed (to reach the harness site with one
// cookie jar; anything else is refused, as the harness CSP). Fictional data; no network.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saleHarness } from "../../scripts/lib/saleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import { BUYER, SELLER } from "../../server/test/sale-world.ts";
import { App } from "../src/App.tsx";
import { Router } from "../src/router.tsx";
import { SessionProvider } from "../src/session.tsx";

const ORIGIN = "http://127.0.0.1:8814";
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
const text = () => document.body.textContent ?? "";
const wait = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 300 && !cond(); i++)
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(cond(), `${what}: ${text().slice(-900)}`).toBe(true);
};
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label)) as
    | HTMLButtonElement
    | undefined;
const click = async (label: string) => {
  await wait(() => Boolean(button(label) && !button(label)?.disabled), `button "${label}"`);
  await act(async () => button(label)?.click());
};
const fieldInput = (label: string) =>
  [...document.querySelectorAll("label.field")]
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

async function signedIn(account: string) {
  const h = await saleHarness({ origin: ORIGIN });
  const jar = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      ORIGIN,
    );
    if (url.origin !== ORIGIN) throw new Error(`refused: no network (${url.origin})`);
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await h.site.request(url, { ...init, headers });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    return res;
  });
  new Function(WALLET_SCRIPT)();
  h.controls.account = account;
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
  await fetch("/api/session/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: signed.accountId,
      public_key: signed.publicKey,
      signature: signed.signature,
      nonce: ch.nonce,
    }),
  });
  window.history.replaceState(null, "", `/sales/${h.world.biz}`);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      createElement(Router, null, createElement(SessionProvider, null, createElement(App))),
    ),
  );
  return h;
}

describe("003wf2 the sale room page", () => {
  it("the seller prepares terms in a labelled form, reviews the exact request and proposes through the wallet", async () => {
    const h = await signedIn(SELLER);
    await wait(() => text().includes("No sale is in progress"), "the sale page");
    expect(text()).toContain("you are the seller");
    // Before any proposal, the continuity panel doesn't describe a draft as the terms.
    expect(text()).toContain("No sale is proposed at this reading");
    expect(text()).not.toContain("These terms name no operator");
    await click("Prepare terms");
    await wait(() => Boolean(fieldInput("Buyer's NEAR account")), "the terms form");
    // Every text control sits inside its own labelled field; the checkbox has its explanation.
    const form = document.querySelector("form") as HTMLFormElement;
    for (const c of form.querySelectorAll("input:not([type=checkbox]), textarea"))
      expect(
        c.closest("label.field")?.querySelector("span")?.textContent,
        (c as HTMLElement).outerHTML,
      ).toBeTruthy();
    expect(form.querySelector(".grid-2")).toBeTruthy();
    expect(form.querySelector("label.check input[type=checkbox]")).toBeTruthy();
    expect(form.querySelector("label.check")?.textContent).toContain(
      "Customers' new uses continue",
    );
    await typeInto(fieldInput("Buyer's NEAR account") as HTMLInputElement, BUYER);
    await typeInto(fieldInput("Price in TUSD") as HTMLInputElement, "250");
    expect(form.textContent).toContain("= 250000000 base units of tusd.near");
    await click("Review the exact request");
    await wait(() => text().includes("Review: Propose these terms"), "the review");
    expect(document.activeElement?.classList.contains("sale-review")).toBe(true);
    expect(text()).toContain("propose_sale_guarded");
    expect(text()).toContain("checked in your browser");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("Deal 1, version 1"), "the proposal on the contract");
    expect(h.world.sale.controlView().live_deal).toMatchObject({
      seq: "1",
      buyer: BUYER,
      price: "250000000",
    });
    expect(h.controls.sent.map((c) => c.methodName)).toEqual(["propose_sale_guarded"]);
    expect(text()).toContain("Operators named in these terms");
  });
});
