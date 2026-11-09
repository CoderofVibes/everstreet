// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8816/"}
//
// Job 003wf3: the ACTUAL sale page (Router + SessionProvider + App, SaleRoom) over the CONFIGURED
// COMPOSITION with the managed handover (scripts/lib/configuredSaleHarness.ts, `gated`): the normal
// entry in its own child process, its coordinator passing every second, the closer's ephemeral
// close_sale-only key. A Gated sale from proposal to the buyer operating the business, with the
// closer's send held so the page shows the close in flight. fetch is stubbed only to send the
// page's same-origin requests to the harness's site listener (one cookie jar per person). A
// process-phase test: one bounded child, stopped and removed here.

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

const PAGE = "http://127.0.0.1:8816";
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
    gated: true,
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

const control = async (path: string, method = "POST") =>
  (await (await realFetch(`${h.control}${path}`, { method })).json()) as Json;
const text = () => document.body.textContent ?? "";
const wait = async (cond: () => boolean, what: string, tries = 1000) => {
  for (let i = 0; i < tries && !cond(); i++)
    await act(async () => new Promise((r) => setTimeout(r, 15)));
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
    ?.querySelector("input, textarea") as HTMLInputElement | undefined;
const typeInto = async (el: HTMLInputElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const panel = () => document.querySelector(".sale-handover")?.textContent ?? "";

/** This person, signed in through the composition's verified routes, on the sale page. */
async function as(account: string) {
  who = account;
  await control(`/account/${account}`);
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

describe("003wf3 a Gated sale on the sale page over the configured composition (actual child process)", () => {
  it("seller proposes; buyer registers, funds and accepts", async () => {
    expect((await control("/", "GET")).close_mode).toBe("gated");
    await as(CONFIGURED_SELLER);
    await wait(() => text().includes("you are the seller"), "the seller's page");
    await click("Prepare terms");
    await wait(() => Boolean(fieldInput("Buyer's NEAR account")), "the terms form");
    await typeInto(fieldInput("Buyer's NEAR account") as HTMLInputElement, CONFIGURED_BUYER);
    await typeInto(fieldInput("Price in TUSD") as HTMLInputElement, "250");
    // Astra 02:17: the checked meter keeps metering authority; service is checked separately.
    expect(text()).toContain("It keeps its metering authority after the close.");
    expect(text()).not.toContain("Customers' new uses continue right after the close.");
    await click("Review the exact request");
    await click("Approve in my wallet");
    await wait(() => text().includes("Deal 1, version 1"), "the proposal on the contract");
    // The live terms and progress follow the business's close mode, never the Direct wording.
    expect(text()).toContain("By its named closer (closer-synthetic.testnet)");
    expect(text()).toContain("before a deadline 60 minutes after the second acceptance");
    expect(text()).not.toContain("On the second matching acceptance");
    expect(text()).toContain("Both accept (starts the closing)");
    expect(text()).toContain("The named closer closes it");
    expect(text()).not.toContain("Both accept (closes)");
    await as(CONFIGURED_BUYER);
    await wait(() => text().includes("you are the buyer"), "the buyer's page");
    for (const [label, done] of [
      ["Register with the token", "Registered with the token"],
      ["Fund escrow", "Escrow is funded"],
      ["Accept version 1", "Waiting for the seller"],
    ]) {
      await click(label as string);
      if (label === "Fund escrow") {
        // The exact review: escrow can come back only until both accept; then close or abort.
        await wait(() => text().includes("until both of you have accepted"), "the fund review");
        expect(text()).toContain("after the closing deadline, either party ends the closing");
        expect(text()).not.toContain("until the sale closes");
      }
      await click("Approve in my wallet");
      await wait(() => text().includes(done as string), done as string);
    }
  }, 90_000);

  it("the seller's acceptance starts the closing; with the closer's send held the page shows it in flight, never as done; then it is handed over", async () => {
    await as(CONFIGURED_SELLER);
    await control("/hold-close");
    await click("Accept version 1 and start the closing");
    await click("Approve in my wallet");
    await wait(() => text().includes("Everstreet is checking the handover"), "the closing");
    expect(button("End the closing")).toBeUndefined(); // only after the deadline
    // Astra 02:23: the SAME mounted page follows the handover, never a remount or reload.
    const mounted = document.body.firstElementChild;
    // The coordinator arms, checks readiness and prepares order 1; its send is held. The explicit
    // read-only check shows it (nothing is sent: the wallet log doesn't grow).
    const sent = h.controls.sent.length;
    for (let i = 0; i < 60 && !panel().includes("Close orders (1)"); i++) {
      if (button("Check the handover") && !button("Check the handover")?.disabled)
        await act(async () => button("Check the handover")?.click());
      await act(async () => new Promise((r) => setTimeout(r, 500)));
    }
    expect(panel(), "order 1 through Check the handover").toContain("Close orders (1)");
    expect(panel()).toContain("Last checked");
    expect(panel()).not.toContain("succeeded");
    expect(panel()).not.toContain("Handed over");
    expect(panel()).toMatch(/Close deadline.*UTC/);
    // The close lands outside this page; the page's own bounded follow shows it, no click.
    await control("/release-close");
    await wait(
      () => panel().includes("Handover: Handed over to the buyer"),
      "the follow shows the external close",
      4_000,
    );
    expect(document.body.firstElementChild).toBe(mounted);
    expect(h.controls.sent.length).toBe(sent);
    expect(button("Check the handover")).toBeUndefined(); // nothing left to follow
    expect(panel()).toContain("its transaction succeeded");
    expect(text()).toContain("you are the former seller");
    expect(text()).toContain("The named closer closes it");
    expect(text()).not.toContain("Both accept (closes)");
  }, 120_000);

  it("aftercare: the new owner's first action is operating the business; resale is secondary; service eligibility is stated apart", async () => {
    await as(CONFIGURED_BUYER);
    await wait(() => text().includes("you are the new owner"), "the new owner's page");
    expect(panel()).toContain("Customer service:");
    expect(panel()).toMatch(/A customer's next use is what proves it\.|Customer service: paused/);
    expect(button("Propose a resale")).toBeTruthy();
    await click("Open your business");
    await wait(() => window.location.pathname === `/desk/${h.business}`, "the business desk");
  }, 60_000);
});
