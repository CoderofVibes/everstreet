// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003wf4 (OWNER_PLAN_SETUP.md §9, S-8, B-2 in jsdom): the ACTUAL "Set up customer access"
// component (CustomerAccess + its controller + SaleFlow) under Router + SessionProvider, the real
// selectorWallet with the sale harness's synthetic module, over the harness's real routes and one
// synthetic chain state. Only fetch is stubbed (to the harness site, one cookie jar). Fictional
// data; no network. Not a real browser: Astra's browser review is a separate gate.

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saleHarness } from "../../scripts/lib/saleHarness.ts";
import { WALLET_SCRIPT } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { SELLER } from "../../server/test/sale-world.ts";
import { CustomerAccess } from "../src/pages/CustomerAccess.tsx";
import { Router } from "../src/router.tsx";
import { SessionProvider } from "../src/session.tsx";

const ORIGIN = "http://127.0.0.1:8814";
type Harness = Awaited<ReturnType<typeof saleHarness>>;
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
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
const field = (label: string) =>
  [...document.querySelectorAll("label.field")]
    .find((l) => l.querySelector("span")?.textContent?.startsWith(label))
    ?.querySelector("input") as HTMLInputElement | undefined;
const typeInto = async (el: HTMLInputElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const step = (n: number) => document.querySelectorAll(".access-steps > li")[n] as HTMLElement;

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

async function signIn(h: Harness, account: string) {
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
}

/** The component, rendered afresh (a reload: nothing carried in memory but session storage). */
async function mount(h: Harness, onOffer?: (id: number) => void) {
  if (root) await act(async () => root?.unmount());
  document.body.innerHTML = "";
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      createElement(
        Router,
        null,
        createElement(
          SessionProvider,
          null,
          createElement(CustomerAccess, {
            businessId: h.world.biz,
            projectId: h.world.w.f.project,
            onOffer,
          }),
        ),
      ),
    ),
  );
}

/** The harness with its customer offer retired: the plan and offer steps are open. */
async function founder() {
  const h = await saleHarness({ origin: ORIGIN });
  vi.stubGlobal("fetch", jarFetch(h));
  new Function(WALLET_SCRIPT)();
  await signIn(h, SELLER);
  const r = await fetch(
    `/api/businesses/${h.world.biz}/customer-offers/${h.world.offerId}/retire`,
    { method: "POST" },
  );
  expect(r.status).toBe(200);
  return h;
}

describe("003wf4 Set up customer access (actual component, synthetic wallet)", {
  timeout: 20_000,
}, () => {
  it("guides the plan: labelled fields, review, Not now keeps the draft and focus, a reload keeps it, the wallet creates it", async () => {
    const h = await founder();
    const offered: number[] = [];
    await mount(h, (id) => offered.push(id));
    await wait(() => text().includes("1. Pricing plan"), "the steps");
    expect(step(0).textContent).toContain("Needs your input");
    expect(step(1).textContent).toContain("Done"); // the platform already meters (the world)
    expect(step(2).textContent).toContain("Waiting for an earlier step");
    // Every input sits in its own labelled field with help text.
    for (const i of step(0).querySelectorAll("input"))
      expect(i.closest("label.field")?.querySelector("span")?.textContent).toBeTruthy();
    expect(field("Hold length")?.value).toBe("10");
    expect(field("Settlement window")?.value).toBe("6");
    // Astra 05:45: price first; limits in their own section; timing explained, its controls under
    // Advanced; storage in readable NEAR with the exact amount under details; exact minimums.
    const plan = step(0);
    const first = plan.querySelector("label.field span")?.textContent;
    expect(first).toBe("Price per use (TUSD)");
    expect(plan.querySelector("fieldset.plan-limits legend")?.textContent).toBe("Limits");
    expect(
      [...plan.querySelectorAll("fieldset.plan-limits label.field span")].map((x) => x.textContent),
    ).toEqual(["Units per purchase", "Units a customer may hold"]);
    const advanced = [...plan.querySelectorAll("details")].find((x) =>
      x.querySelector("summary")?.textContent?.startsWith("Advanced"),
    ) as HTMLDetailsElement;
    expect([...advanced.querySelectorAll("label.field span")].map((x) => x.textContent)).toEqual([
      "Uses per hold",
      "Hold length (minutes)",
      "Settlement window (minutes)",
    ]);
    expect(advanced.open).toBe(false);
    expect(plan.textContent).toContain("each use holds one unit for 10 min");
    expect(plan.textContent).toContain("At least 7 min 30 s on this server");
    expect(plan.textContent).toContain("Creating it attaches 0.0009 NEAR for contract storage");
    expect(plan.textContent).toContain("900000000000000000000 yoctoNEAR for 90 bytes");
    // Without a price, review is unavailable and says why.
    expect(button("Review this plan")?.disabled).toBe(true);
    expect(step(0).textContent).toContain("Enter a price per use above 0.");
    await typeInto(field("Price per use") as HTMLInputElement, "0.15");
    // The exact example purchase and the full plan summary, from the typed price (a preview).
    expect(step(0).textContent).toContain("For example, a customer buying 20 uses pays 3 TUSD.");
    expect(step(0).textContent).toContain("0.15 TUSD per use (150000 base units)");
    await click("Review this plan");
    await wait(() => text().includes("Review the plan"), "the review");
    expect(text()).toContain("Creates plan 2 on the contract: 0.15 TUSD per use");
    expect(text()).toContain("permanent");
    await click("Not now");
    await wait(() => !text().includes("Review the plan"), "the review set aside");
    expect(field("Price per use")?.value).toBe("0.15");
    await wait(
      () => (document.activeElement as HTMLElement | null)?.dataset.focus === "plan-review",
      "focus back on the review button",
    );
    expect(h.controls.sent).toHaveLength(0);
    // A reload keeps the draft (this business and account only).
    await mount(h, (id) => offered.push(id));
    await wait(() => field("Price per use")?.value === "0.15", "the draft after a reload");
    // A closed wallet sends nothing and keeps the draft.
    await click("Review this plan");
    await wait(() => text().includes("Review the plan"), "the review again");
    h.controls.cancelNext = true;
    await click("Approve in my wallet");
    await wait(() => text().includes("You closed the wallet"), "the cancelled wallet");
    expect(h.world.sale.planCount).toBe(1);
    await wait(
      () => step(0).textContent?.includes("Your earlier request") === true,
      "the open request",
    );
    // The asked-but-unsent request is shown apart; the draft is still there to keep.
    expect(h.controls.sent).toHaveLength(0);
  });

  it("an unusable plan is refused with the server's reason; the confirmed plan is the evidence and hands over to the offer", async () => {
    const h = await founder();
    const offered: number[] = [];
    await mount(h, (id) => offered.push(id));
    await wait(() => Boolean(field("Price per use")), "the form");
    await typeInto(field("Price per use") as HTMLInputElement, "0.15");
    await typeInto(field("Hold length") as HTMLInputElement, "5");
    await click("Review this plan");
    await wait(() => text().includes("at least 450 s"), "the unusable-plan explanation");
    expect(text()).not.toContain("Review the plan");
    await typeInto(field("Hold length") as HTMLInputElement, "10");
    await click("Review this plan");
    await wait(() => text().includes("Review the plan"), "the review");
    await click("Approve in my wallet");
    await wait(() => step(0).textContent?.includes("Done") === true, "the plan confirmed");
    expect(step(0).textContent).toContain("Plan 2: 0.15 TUSD per use, holds of 10 min");
    expect(h.controls.sent.map((c: Json) => c.methodName)).toEqual(["create_plan_guarded"]);
    expect(h.world.sale.plans.get(2)).toMatchObject({
      unit_price: "150000",
      hold_ttl_ms: "600000",
    });
    // The draft is used up: a fresh one, without the old price.
    await click("Review the offer for plan 2");
    expect(offered).toEqual([2]);
  });

  it("the plan review leads with readable NEAR; the exact deposit is under technical details", async () => {
    const h = await founder();
    await mount(h);
    await wait(() => Boolean(field("Price per use")), "the form");
    await typeInto(field("Price per use") as HTMLInputElement, "0.15");
    await click("Review this plan");
    await wait(() => text().includes("Review the plan"), "the review");
    const review = document.querySelector("section.review") as HTMLElement;
    const effects = [...review.querySelectorAll("ul li")].map((l) => l.textContent ?? "");
    const storage = effects.find((e) => e.startsWith("Attaches")) as string;
    expect(storage).toContain("Attaches 0.0009 NEAR for 90 bytes of contract storage");
    expect(storage).not.toContain("yoctoNEAR");
    const tech = review.querySelector("details") as HTMLDetailsElement;
    expect(tech.open).toBe(false);
    expect(tech.textContent).toContain(
      "Exact deposit: 900000000000000000000 yoctoNEAR for 90 bytes at 10000000000000000000 yoctoNEAR per byte",
    );
  });

  it("with a support slot, every sentence of the permission step states the current choice", async () => {
    const h = await founder();
    const { saleControl } = await import("../../scripts/lib/saleHarness.ts");
    await saleControl(h).request(new URL("/access/operator/support", "http://127.0.0.1:8815"), {
      method: "POST",
    });
    await mount(h);
    await wait(
      () => step(1)?.textContent?.includes("Keep its support permission") === true,
      "the choice",
    );
    const perm = () => step(1).textContent ?? "";
    expect(perm()).toContain("Adds metering and keeps support.");
    expect(perm()).not.toContain("support is removed");
    // Unchecked: the step's own sentence says removal; nothing still says "keeps support".
    const box = step(1).querySelector("input[type=checkbox]") as HTMLInputElement;
    await act(async () => box.click());
    await wait(
      () => perm().includes("Replaces support with metering: support is removed."),
      "removal",
    );
    expect(perm()).not.toContain("keeps support");
    // Under review, the heading and the review say the same reviewed change.
    await click("Review this permission");
    await wait(() => text().includes("Review the permission"), "the permission review");
    expect(perm()).toContain("Replaces support with metering: support is removed.");
    expect(perm()).not.toContain("keeps support");
  });

  it("a lost wallet answer is recovered by its own transaction ID; never sent twice", async () => {
    const h = await founder();
    await mount(h);
    await wait(() => Boolean(field("Price per use")), "the form");
    await typeInto(field("Price per use") as HTMLInputElement, "0.2");
    await click("Review this plan");
    await wait(() => text().includes("Review the plan"), "the review");
    h.controls.loseNext = true;
    await click("Approve in my wallet");
    await wait(
      () => step(0).textContent?.includes("Your earlier request") === true,
      "the unresolved request",
    );
    expect(h.world.sale.planCount).toBe(2); // it landed; only its answer was lost
    const hash = [...(h.world.w.chain.txs as Map<string, Json>).values()].at(-1)?.transaction
      .hash as string;
    await typeInto(field("Its transaction ID") as HTMLInputElement, hash);
    await click("Check with this ID");
    await wait(() => step(0).textContent?.includes("Done") === true, "recovered and confirmed");
    expect(h.controls.sent).toHaveLength(1);
    expect(h.world.sale.planCount).toBe(2);
  });
});
