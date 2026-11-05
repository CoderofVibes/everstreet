// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003web: a FRESH customer buys uses through the ACTUAL page: Router + SessionProvider + App
// under jsdom with React's real lifecycle, the real PurchasePanel and PurchaseFlow, the real
// selectorWallet (pinned Wallet Selector) with the harness's injected synthetic module (its real
// script), over the harness's real routes and contract-anchored double. Only fetch is stubbed (to
// reach the harness site with one cookie jar). Fictional data; no network.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WALLET_SCRIPT, walletHarness } from "../../scripts/lib/walletHarness.ts";
import { BUSINESS, FRESH } from "../../server/test/customer-world.ts";
import { App } from "../src/App.tsx";
import { Router } from "../src/router.tsx";
import { SessionProvider, useSession } from "../src/session.tsx";

const ORIGIN = "http://127.0.0.1:8814";
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  session = useSession();
  return null;
}
const wait = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !cond(); i++)
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(cond(), `${what}: ${(document.body.textContent ?? "").slice(-900)}`).toBe(true);
};
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined;
const click = async (label: string) => {
  await wait(() => Boolean(button(label) && !button(label)?.disabled), `button "${label}"`);
  await act(async () => button(label)?.click());
};

/** The harness site, signed in as the fresh customer, with the actual page on the offer. */
async function signedIn() {
  const h = await walletHarness({ origin: ORIGIN, customer: "fresh" });
  const jar = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      ORIGIN,
    );
    if (url.origin !== ORIGIN) throw new Error(`refused: no network (${url.origin})`); // as the harness CSP
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
  // The harness's own injected module script, as the page loads it.
  new Function(WALLET_SCRIPT)();
  // Signed in as the fresh customer (over the real routes, as the dialog's controller does).
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
  expect(signed.accountId).toBe(FRESH);
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
  window.history.replaceState(null, "", `/use/${h.offerId}`);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      createElement(
        Router,
        null,
        createElement(SessionProvider, null, createElement(Probe), createElement(App)),
      ),
    ),
  );
  await wait(() => text().includes("Buy uses"), "the panel");
  return h;
}
const setUnits = async (n: number) => {
  const qty = document.querySelector('input[type="number"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(qty, String(n));
    qty.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("003web the Buy uses panel, for a fresh customer, on the actual page", () => {
  it("registration, then 100 uses: exact reviews in token terms, the wallet asked, confirmed by the contract", async () => {
    const h = await signedIn();
    await wait(() => text().includes("You have no uses for this product yet"), "a fresh customer");
    expect(text()).toContain("Each use costs 0.05 TUSD (50000 base units)"); // token terms first
    await wait(() => text().includes("One unit: 0.05 TUSD"), "the page's own price line in tokens");
    await click("Review: create your registration");
    await wait(() => text().includes("0.0082 NEAR"), "the exact deposit");
    expect(text()).toContain("820 bytes");
    await click("Ask my wallet to approve exactly this");
    await wait(
      () => text().includes("registration with this business is confirmed"),
      "shell confirmed",
    );
    await setUnits(100);
    await wait(() => text().includes("Total: 5 TUSD"), "the total in tokens");
    await click("Review this purchase");
    await wait(() => text().includes("Review: buy uses"), "the purchase review");
    expect(text()).toContain("100 uses for 5 TUSD (5000000 base units)");
    await click("Ask my wallet to approve exactly this");
    await wait(() => text().includes("Purchase confirmed by the contract"), "confirmed");
    expect(h.world.chain.ent(FRESH)).toMatchObject({ free: "100", purchase_seq: 1 });
    expect(h.controls.sent.map((c) => c.methodName)).toEqual(["sponsor_shell", "ft_transfer_call"]);
    void session;
  });

  it("a lost answer, then the registration replaced: the old purchase is listed as unknown and no longer blocks", async () => {
    const h = await signedIn();
    await click("Review: create your registration");
    await click("Ask my wallet to approve exactly this");
    await wait(() => text().includes("registration with this business is confirmed"), "shell");
    await setUnits(2);
    await click("Review this purchase");
    h.controls.loseNext = true;
    await click("Ask my wallet to approve exactly this");
    await wait(() => text().includes("A purchase is waiting for its outcome"), "open, unknown");
    // Later, elsewhere: the registration is removed and a new one made (a new registration id).
    h.world.chain.ents.delete(FRESH);
    h.world.chain.walletCall(FRESH, {
      receiverId: BUSINESS,
      methodName: "sponsor_shell",
      args: { customer: FRESH, plan_id: 1 },
      deposit: "8200000000000000000000",
      gas: "30000000000000",
    });
    await click("Check its outcome");
    await wait(() => text().includes("Earlier purchases with an unknown outcome"), "listed");
    expect(text()).toContain("whether it was accepted before isn't known");
    expect(text()).not.toContain("A purchase is waiting for its outcome");
    expect(button("Review this purchase")).toBeDefined(); // a purchase for the new registration
  });
});
