// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8800/"}
//
// Showcase stage B (docs/design/SHOWCASE_SPEC.md): the actual components under the real Router.
// The sample panel must make NO request at all (fetch is a trap); the example page reads the
// public projection (served here from the real projection of the committed testnet record).

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerlineExample } from "../../server/src/examples.ts";
import { ExampleBusinesses, ExamplePage, SamplePanel } from "../src/pages/Showcase.tsx";
import { Router } from "../src/router.tsx";

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
async function mount(el: ReturnType<typeof createElement>, url = "/") {
  window.history.pushState({}, "", url);
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => root?.render(createElement(Router, null, el)));
}
const text = () => document.body.textContent ?? "";
const trap = () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (u: string) => {
    calls.push(String(u));
    return Promise.reject(new Error("no request may be made"));
  });
  return calls;
};

describe("the sample panel", () => {
  it("runs each sample with no request at all and shows the product's own answer", async () => {
    const calls = trap();
    await mount(createElement(SamplePanel));
    expect(text()).toMatch(/Nothing is sent or recorded/);
    const radio = document.querySelector('input[value="req_totals_disagree"]') as HTMLInputElement;
    await act(async () => radio.click());
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(text()).toMatch(/Extracted/);
    expect(text()).toMatch(/Line items add up to 260\.00, not the stated 300\.00/);
    expect(text()).toMatch(/300\.00/);
    expect(document.activeElement?.textContent).toMatch(/Line items don't add up/);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => /Try another/.test(b.textContent ?? ""))
        ?.click(),
    );
    const notInvoice = document.querySelector(
      'input[value="req_unrelated_text"]',
    ) as HTMLInputElement;
    await act(async () => notInvoice.click());
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(text()).toMatch(/Refused/);
    expect(text()).toMatch(/returned: a refusal is never charged/);
    expect(calls).toEqual([]);
  });

  it("the example cards and the illustrations make no request and say they aren't runs", async () => {
    const calls = trap();
    await mount(createElement(ExampleBusinesses));
    expect(text()).toMatch(/Not tryable yet/);
    expect(document.querySelectorAll(".example-card")).toHaveLength(3);
    await act(async () => root?.unmount());
    root = null;
    await mount(createElement(ExamplePage, { which: "relaydesk" }), "/example/relaydesk");
    expect(text()).toMatch(/Illustration, not a run/);
    expect(calls).toEqual([]);
  });
});

describe("the Ledgerline example page", () => {
  it("Operate and Acquire read the verified projection: 15 tUSD prepaid, 80 owed at the sale, founder to buyer", async () => {
    const projection = JSON.parse(JSON.stringify(ledgerlineExample()));
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(String(u));
      return new Response(JSON.stringify(projection), { status: 200 });
    });
    await mount(
      createElement(ExamplePage, { which: "ledgerline" }),
      "/example/ledgerline?tab=operate",
    );
    for (let i = 0; i < 50 && !/Prepaid/.test(text()); i++)
      await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(text()).toMatch(/15 tUSD/);
    expect(text()).toMatch(/80 uses/);
    expect(text()).toMatch(/NEAR testnet, final/);
    expect(calls).toEqual(["/api/examples/ledgerline"]);
    await act(async () => root?.unmount());
    root = null;
    await mount(
      createElement(ExamplePage, { which: "ledgerline" }),
      "/example/ledgerline?tab=acquire",
    );
    for (let i = 0; i < 50 && !/took control/.test(text()); i++)
      await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(text()).toMatch(/founder \(generation 1\) → buyer \(generation 2\)/);
    expect(text()).toMatch(/left 79/);
  });
});
