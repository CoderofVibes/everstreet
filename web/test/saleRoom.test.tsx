// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003wf2: the Direct sale through the ACTUAL page: Router + SessionProvider + App under jsdom,
// the real SaleRoom and SaleFlow, the real selectorWallet (pinned Wallet Selector) with the sale
// harness's injected synthetic module (its real script), over the harness's real routes and one
// synthetic customer+sale state. Only fetch is stubbed (to reach the harness site with one cookie
// jar; anything else is refused, as the harness CSP). The other party acts through the same
// routes with its own cookie jar (`apiAs`). Fictional data; no network.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saleHarness } from "../../scripts/lib/saleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "../../server/test/sale-world.ts";
import { App } from "../src/App.tsx";
import { Continuity } from "../src/pages/SaleRoom.tsx";
import { Router } from "../src/router.tsx";
import type { SaleSetup } from "../src/saleApi.ts";
import { SessionProvider } from "../src/session.tsx";

const ORIGIN = "http://127.0.0.1:8814";
type Harness = Awaited<ReturnType<typeof saleHarness>>;
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

/** NEP-413 sign-in through the harness's routes with a given fetch (its own cookie jar). */
async function signInWith(h: Harness, account: string, go: typeof fetch) {
  const page = h.controls.account;
  h.controls.account = account;
  const ch = (await (await go("/api/session/challenge", { method: "POST" })).json()).challenge;
  const signed = await (
    await go("/__harness/sign-message", {
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
  await go("/api/session/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: signed.accountId,
      public_key: signed.publicKey,
      signature: signed.signature,
      nonce: ch.nonce,
    }),
  });
  h.controls.account = page;
}

/** A fetch over the harness site with its own cookie jar (loopback-only, as the harness CSP). */
function jarFetch(h: Harness): typeof fetch {
  const jar = new Map<string, string>();
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
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
  }) as typeof fetch;
}

/** The OTHER party, through the same routes and its own synthetic wallet sends. */
async function apiAs(h: Harness, account: string) {
  const go = jarFetch(h);
  await signInWith(h, account, go);
  const call = async (path: string, method = "GET", body?: unknown) => {
    const res = await go(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as Json;
  };
  const act_ = async (kind: string, input: Json = {}) => {
    const biz = h.world.biz;
    const p = await call(`/api/sales/${biz}/prepare`, "POST", { kind, input });
    const c = await call(`/api/sales/${biz}/actions`, "POST", {
      kind,
      input: p.input,
      action_digest: p.action_digest,
      idempotency_key: `other-${kind}-${Math.random().toString(36).slice(2, 10)}`,
    });
    const a = c.action as Json;
    expect((await call(`/api/sales/actions/${a.id}/requested`, "POST", {})).ask).toBe("granted");
    const page = h.controls.account;
    h.controls.account = account;
    const out = await call("/__harness/tx", "POST", {
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
    h.controls.account = page;
    await call(`/api/sales/actions/${a.id}/requested`, "POST", { tx_hash: out.transaction.hash });
    return (await call(`/api/sales/actions/${a.id}/check`, "POST", {})) as Json;
  };
  return { call, act: act_ };
}

/** The page, rendered afresh (a reload: nothing carried over in memory, same session cookie). */
async function mount() {
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

/** The harness, the other party's setup, then this person's page (signed in). */
async function signedIn(account: string, before?: (h: Harness) => Promise<void>) {
  const h = await saleHarness({ origin: ORIGIN });
  if (before) await before(h);
  vi.stubGlobal("fetch", jarFetch(h));
  new Function(WALLET_SCRIPT)();
  h.controls.account = account;
  await signInWith(h, account, fetch);
  window.history.replaceState(null, "", `/sales/${h.world.biz}`);
  await mount();
  return h;
}

/** The newest transaction the synthetic wallet recorded with this method (its own ID). */
const txOf = (h: Harness, method: string) =>
  [...(h.world.w.chain.txs as Map<string, Json>).values()]
    .filter((o) => o.transaction.actions[0].FunctionCall.method_name === method)
    .at(-1)?.transaction.hash as string;

const historyRow = (label: string) =>
  [...document.querySelectorAll(".sale-history li")].find((li) =>
    li.textContent?.startsWith(label),
  ) as HTMLElement | undefined;

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

  it("the review summarizes the terms readably; Not now keeps the draft and returns focus; nothing is sent", async () => {
    const h = await signedIn(SELLER);
    await click("Prepare terms");
    await wait(() => Boolean(fieldInput("Buyer's NEAR account")), "the terms form");
    await typeInto(fieldInput("Buyer's NEAR account") as HTMLInputElement, BUYER);
    await typeInto(fieldInput("Price in TUSD") as HTMLInputElement, "250");
    await typeInto(
      fieldInput("Available balance the business must keep") as HTMLInputElement,
      "0.1",
    );
    await typeInto(
      fieldInput("Not included") as HTMLTextAreaElement,
      "ledgerline.example domain and DNS account",
    );
    await click("Review the exact request");
    await wait(() => text().includes("Review: Propose these terms"), "the review");
    // One readable summary before the wallet button: buyer, price, expiry with its zone and the
    // exact UTC instant, the floor, the operators named, the deposit.
    const summary = document.querySelector(".sale-summary") as HTMLElement;
    expect(summary.textContent).toContain(BUYER);
    expect(summary.textContent).toContain("250 TUSD");
    expect(summary.textContent).toMatch(/Offer open until.*UTC\)/);
    expect(summary.textContent).toContain("Available balance kept (floor)0.1 TUSD");
    expect(summary.textContent).toContain("meter.near (metering)");
    expect(
      summary.compareDocumentPosition(button("Ask my wallet for exactly this") as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(text()).not.toContain("open until the time shown");
    // Not now: the draft is still there, focus is back on the review button, nothing was sent.
    await click("Not now");
    await wait(() => Boolean(fieldInput("Buyer's NEAR account")), "the form again");
    expect((fieldInput("Buyer's NEAR account") as HTMLInputElement).value).toBe(BUYER);
    expect((fieldInput("Price in TUSD") as HTMLInputElement).value).toBe("250");
    expect((fieldInput("Not included") as HTMLTextAreaElement).value).toBe(
      "ledgerline.example domain and DNS account",
    );
    await wait(
      () => (document.activeElement as HTMLElement | null)?.dataset.focus === "terms-propose",
      "focus on the review button",
    );
    expect(h.controls.sent).toEqual([]);
    // Changing a value and reviewing again shows the changed terms; still nothing is sent.
    await typeInto(fieldInput("Price in TUSD") as HTMLInputElement, "260");
    await click("Review the exact request");
    await wait(() => text().includes("260 TUSD"), "the changed review");
    expect(h.controls.sent).toEqual([]);
  });

  it("a lost funding answer: the history row recovers by the original ID only, read-only, through reload and wrong IDs", async () => {
    const h = await signedIn(BUYER, async (x) => {
      await (await apiAs(x, SELLER)).act("propose", proposal());
    });
    await wait(() => text().includes("you are the buyer"), "the buyer's page");
    await click("Register with the token");
    await click("Ask my wallet for exactly this");
    await wait(() => text().includes("Registered with the token"), "registered");
    h.controls.loseNext = true;
    await click("Fund escrow");
    await click("Ask my wallet for exactly this");
    await wait(
      () => Boolean(historyRow("Fund escrow")?.querySelector("form")),
      "the recovery form",
    );
    const sentBefore = h.controls.sent.length;
    // The unrelated next action isn't blocked by a request that can no longer take effect.
    expect(button("Accept version 1")).toBeTruthy();
    expect(historyRow("Fund escrow")?.textContent).toContain("Can no longer take effect");
    // Wrong IDs show nothing about it; it stays as it was.
    const row = () => historyRow("Fund escrow") as HTMLElement;
    await typeInto(
      fieldInput("Its transaction ID", row()) as HTMLInputElement,
      txOf(h, "storage_deposit"),
    );
    await click("Check with this ID", row());
    await wait(() => text().includes("isn't this request"), "a wrong ID");
    await typeInto(fieldInput("Its transaction ID", row()) as HTMLInputElement, "not-an-id");
    await click("Check with this ID", row());
    await wait(() => text().includes("isn't a NEAR transaction ID"), "a malformed ID");
    // A reload: the row and its recovery are still there.
    await mount();
    await wait(
      () => Boolean(historyRow("Fund escrow")?.querySelector("form")),
      "recovery after reload",
    );
    await typeInto(
      fieldInput("Its transaction ID", row()) as HTMLInputElement,
      txOf(h, "ft_transfer_call"),
    );
    await click("Check with this ID", row());
    await wait(() => text().includes("Escrow is funded"), "the original transaction");
    expect(historyRow("Fund escrow")?.textContent).toContain("Confirmed by its own transaction");
    expect(historyRow("Fund escrow")?.querySelector("form")).toBeNull();
    // Recovery never sent anything.
    expect(h.controls.sent.length).toBe(sentBefore);
  });

  it("a lost closing acceptance: applying the close first, then the original ID reports the stored, applied result", async () => {
    const h = await signedIn(SELLER, async (x) => {
      await (await apiAs(x, SELLER)).act("propose", proposal());
      const buyer = await apiAs(x, BUYER);
      await buyer.act("register");
      await buyer.act("fund");
      await buyer.act("accept");
    });
    await wait(
      () => Boolean(button("Accept version 1 and close the sale")),
      "the closing acceptance",
    );
    h.controls.loseNext = true;
    await click("Accept version 1 and close the sale");
    await click("Ask my wallet for exactly this");
    await wait(
      () => Boolean(historyRow("Accept this version")?.querySelector("form")),
      "the recovery form",
    );
    // The close happened on the contract; applying it here is the next action (not blocked).
    expect(h.world.sale.controlView().owner).toBe(BUYER);
    await click("Apply the close here");
    await wait(() => text().includes("the business now belongs to the buyer here"), "applied here");
    const sentBefore = h.controls.sent.length;
    const row = () => historyRow("Accept this version") as HTMLElement;
    await typeInto(
      fieldInput("Its transaction ID", row()) as HTMLInputElement,
      txOf(h, "accept_sale"),
    );
    await click("Check with this ID", row());
    // Confirmed by its own transaction, and the local follow-up reports what is stored: already applied.
    await wait(
      () => text().includes("This sale was already applied here."),
      "the authoritative result",
    );
    expect(text()).not.toContain("isn't finished yet");
    expect(h.controls.sent.length).toBe(sentBefore);
  });
});

describe("003wf2 the authority panel follows the CURRENT reading (Astra 23:42)", () => {
  const aside = (s: SaleSetup) =>
    new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(Continuity, { s })),
      "text/html",
    ).body.textContent ?? "";
  it("no sale, a live deal, a closed deal, an ended deal, and a later live deal after a close", async () => {
    const s = await saleWorld();
    const none = (await s.setup(s.ava)).body as SaleSetup;
    expect(aside(none)).toContain("No sale is proposed at this reading");
    await s.act(s.ava, SELLER, "propose", proposal());
    const live = (await s.setup(s.ava)).body as SaleSetup;
    expect(aside(live)).toContain("Authority the buyer receives");
    expect(aside(live)).toContain("From deal 1, version 1");
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "accept");
    await s.act(s.ava, SELLER, "accept");
    // After the close: the closed terms, then what holds NOW; never pre-proposal guidance.
    const closed = (await s.setup(s.ava)).body as SaleSetup;
    const c = aside(closed);
    expect(c).toContain("Authority after deal 1 closed");
    expect(c).toContain(`${SELLER} sold the business to ${BUYER}`);
    expect(c).toContain("Those terms are finished; what holds now is read below.");
    expect(c).toContain(`${BUYER} owns the business's contract (generation 2)`);
    expect(c).toContain("Operators now: meter.near (metering)");
    expect(c).not.toContain("No sale is proposed");
    expect(c).not.toContain("Authority the buyer receives");
    // The same reading with the platform's operator gone: the pause is stated as current fact.
    const noOp = structuredClone(closed);
    noOp.control.operators = [];
    expect(aside(noOp)).toContain("No operator is appointed now.");
    expect(aside(noOp)).toContain("customers' new uses pause until the owner appoints it");
    // An ended (not closed) deal changed no authority.
    const cancelled = structuredClone(closed);
    cancelled.outcomes = cancelled.outcomes.map((o) => ({ ...o, status: "cancelled" as const }));
    expect(aside(cancelled)).toContain("Authority now");
    expect(aside(cancelled)).toContain("was cancelled: no authority changed with it");
    // A later live deal is the current one; the earlier close is history, not its authority.
    const later = structuredClone(closed);
    later.control.live_deal = {
      ...(live.control.live_deal as NonNullable<SaleSetup["control"]["live_deal"]>),
      seq: "2",
    };
    expect(aside(later)).toContain("Authority the buyer receives");
    expect(aside(later)).toContain("From deal 2, version 1");
    expect(aside(later)).not.toContain("Authority after deal 1 closed");
  });
});
