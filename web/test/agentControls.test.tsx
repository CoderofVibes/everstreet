// @vitest-environment jsdom
//
// 006b1 (Astra's independent assessment, Nov 5): customer and owner control of agent access stays
// reliable through errors and actor changes. The ACTUAL page components, with only the session
// (a switchable signed-in person) and fetch (scripted, each answer released by the test) stubbed.
// Fictional people; no network.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  person: null as null | { id: string; display_name: string },
  /** 006b2: bumped by every change of who is acting, like SessionModel's epoch. */
  epoch: 0,
  listeners: new Set<() => void>(),
}));
vi.mock("../src/session.tsx", async () => {
  const React = await import("react");
  return {
    useSession: () => {
      const subscribe = (cb: () => void) => {
        session.listeners.add(cb);
        return () => session.listeners.delete(cb);
      };
      const person = React.useSyncExternalStore(subscribe, () => session.person);
      const sessionEpoch = React.useSyncExternalStore(subscribe, () => session.epoch);
      return { person, sessionEpoch, requireSignIn: () => {} };
    },
  };
});
vi.mock("../src/router.tsx", async () => {
  const React = await import("react");
  return {
    Link: ({ to, children }: { to: string; children: unknown }) =>
      React.createElement("a", { href: to }, children as never),
  };
});

import { AgentAccessPage } from "../src/pages/AgentAccess.tsx";
import { AgentUseSwitches } from "../src/pages/AgentUseSwitch.tsx";
import { PortfolioPage } from "../src/pages/Portfolio.tsx";

const AVA = { id: "person-ava", display_name: "Ava (fictional)" };
const BEA = { id: "person-bea", display_name: "Bea (fictional)" };
const setPerson = (p: typeof AVA | null) =>
  act(async () => {
    session.person = p;
    session.epoch++;
    for (const f of session.listeners) f();
  });

/** Scripted fetch: every call waits until the test answers it. */
type Pending = {
  url: string;
  method: string;
  body: unknown;
  reply: (status: number, body: unknown) => Promise<void>;
  fail: () => Promise<void>;
};
function scriptFetch() {
  const calls: Pending[] = [];
  vi.stubGlobal("fetch", (url: string, init?: { method?: string; body?: string }) => {
    return new Promise((resolve, reject) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
        reply: (status, body) =>
          act(async () => {
            resolve(new Response(JSON.stringify(body), { status }));
            await new Promise((r) => setTimeout(r, 0));
          }),
        fail: () =>
          act(async () => {
            reject(new TypeError("Failed to fetch"));
            await new Promise((r) => setTimeout(r, 0));
          }),
      });
    });
  });
  const next = async (match: (c: Pending) => boolean, what: string) => {
    for (let i = 0; i < 100; i++) {
      const c = calls.find((x) => match(x) && !(x as { taken?: boolean }).taken);
      if (c) {
        (c as { taken?: boolean }).taken = true;
        return c;
      }
      await act(async () => new Promise((r) => setTimeout(r, 5)));
    }
    throw new Error(`no request for ${what}; saw ${calls.map((c) => `${c.method} ${c.url}`)}`);
  };
  return { calls, next };
}

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  session.person = null;
  session.epoch = 0;
});
async function mount(el: ReturnType<typeof createElement>) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => root?.render(el));
}
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label)) as
    | HTMLButtonElement
    | undefined;
/** Fills the agent form's required fields (React-controlled inputs). */
async function fillForm() {
  const set = (label: string, value: string) => {
    const l = [...document.querySelectorAll("label")].find((x) => x.textContent === label);
    const input = document.getElementById(l?.htmlFor ?? "") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => {
    set("Offer id", "offer-1");
    set("Agent's name", "Fictional agent");
  });
}
const click = (b: HTMLElement | undefined) =>
  act(async () => {
    b?.click();
  });

const grant = (over: Record<string, unknown>) => ({
  id: "g1",
  label: "Fictional bookkeeping agent",
  offer_id: "offer-1",
  key_slot: 1,
  max_uses: 5,
  used: 5,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  state: "used_up",
  created_at: new Date().toISOString(),
  ...over,
});

describe("006b1 agent access page", () => {
  it("a used-up grant (it can still read results) can be revoked; a failed revoke never looks successful", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list")).reply(200, {
      grants: [grant({})],
    });
    const revoke = button("Revoke");
    expect(revoke, text()).toBeTruthy();
    await click(revoke);
    await (await f.next((c) => c.url.endsWith("/revoke"), "revoke")).reply(500, {
      error: "Server error",
    });
    expect(text()).toMatch(/Not revoked: Server error/);
    expect(text()).not.toMatch(/·\s*revoked/);
    // 006b2: a lost answer is unknown, never "not revoked", and the list is read back.
    await click(button("Revoke"));
    await (await f.next((c) => c.url.endsWith("/revoke"), "revoke 2")).fail();
    expect(text()).toMatch(/couldn't tell whether it was revoked/);
    expect(text()).not.toMatch(/Not revoked/);
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "readback after loss")).reply(200, {
      grants: [grant({})],
    });
    // Success: the list is read back, and only then shows revoked.
    await click(button("Revoke"));
    await (await f.next((c) => c.url.endsWith("/revoke"), "revoke 3")).reply(200, {});
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "readback")).reply(200, {
      grants: [grant({ state: "revoked", revoked_at: new Date().toISOString() })],
    });
    expect(text()).toMatch(/· revoked/);
    expect(button("Revoke")).toBeUndefined();
  });

  it("a failed list says access couldn't be checked (never None) and can be checked again", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list")).fail();
    expect(text()).toMatch(/couldn't be checked/);
    expect(text()).not.toMatch(/None|haven't given/);
    await click(button("Check again"));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "retry")).reply(200, {
      grants: [],
    });
    expect(text()).toMatch(/haven't given any agent access/);
  });

  it("a double click makes one create request", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list")).reply(200, { grants: [] });
    await fillForm();
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    const posts = f.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("switching person without unmounting: the old token, list and late answers never show", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    const avaList = await f.next((c) => c.url.endsWith("/agent-grants"), "ava list");
    await avaList.reply(200, {
      grants: [grant({ id: "ga", label: "Ava's agent", state: "active" })],
    });
    expect(text()).toMatch(/Ava's agent/);
    await fillForm();
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => form.requestSubmit());
    const avaCreate = await f.next((c) => c.method === "POST", "ava create");
    // Ava signs out and Bea signs in on the same page before Ava's answer arrives.
    await setPerson(null);
    await setPerson(BEA);
    expect(text()).not.toMatch(/Ava's agent/);
    await avaCreate.reply(201, { token: "evs_agent_AVA_SECRET_TOKEN_FICTIONAL_0001", grant: {} });
    expect(text()).not.toMatch(/AVA_SECRET/);
    const beaList = await f.next((c) => c.url.endsWith("/agent-grants"), "bea list");
    await beaList.reply(200, {
      grants: [grant({ id: "gb", label: "Bea's agent", state: "active" })],
    });
    expect(text()).toMatch(/Bea's agent/);
    expect(text()).not.toMatch(/Ava's agent|AVA_SECRET/);
  });
});

describe("006b1 portfolio actor fence", () => {
  const portfolio = (name: string) => ({
    basis: "Fictional basis",
    attention: [],
    owned: [
      {
        business: { id: `b-${name}`, name: `${name}'s business` },
        control: { how: "founded", at: new Date().toISOString() },
        products: { projects: 1, released: 1, offers: 1 },
        this_month: null,
        owed: [],
        next_action: null,
        label: "",
        note: "",
        note_version: 0,
      },
    ],
    considering: [],
    former: [],
    labels: [],
  });
  it("switching person drops the old portfolio at once; a late old answer changes nothing", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(PortfolioPage));
    await (await f.next((c) => c.url.endsWith("/api/me/portfolio"), "ava")).reply(
      200,
      portfolio("Ava"),
    );
    expect(text()).toMatch(/Ava's business/);
    // A refresh for Ava is in flight when Bea signs in.
    await setPerson(null);
    await setPerson(BEA);
    expect(text()).not.toMatch(/Ava's business/);
    const bea = await f.next((c) => c.url.endsWith("/api/me/portfolio"), "bea");
    await bea.reply(200, portfolio("Bea"));
    expect(text()).toMatch(/Bea's business/);
    expect(text()).not.toMatch(/Ava's business/);
  });
});

describe("006b1 owner's Agent use switch", () => {
  it("a failed read stays visible with a retry; a keyboard change keeps focus and announces the server's readback", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(
      createElement(AgentUseSwitches, { businessId: "biz-1", names: { "offer-1": "Ledgerline" } }),
    );
    await (await f.next((c) => c.url.endsWith("/agent-access"), "read")).fail();
    expect(text()).toMatch(/couldn't be checked/);
    await click(button("Check again"));
    const row = { offer_id: "offer-1", offer_state: "active", agents: "off", active_grants: 0 };
    await (await f.next((c) => c.url.endsWith("/agent-access"), "retry")).reply(200, {
      offers: [row],
    });
    const allow = button("Allow agent use") as HTMLButtonElement;
    allow.focus();
    await click(allow);
    // While pending the button keeps focus (it isn't disabled under the user).
    expect(document.activeElement).toBe(allow);
    expect(allow.disabled).toBe(false);
    // A second press while pending sends nothing more.
    await click(allow);
    expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    await (await f.next((c) => c.method === "PUT", "put")).reply(200, {
      offer_id: "offer-1",
      agents: "on",
    });
    await (
      await f.next((c) => c.url.endsWith("/agent-access") && c.method === "GET", "readback")
    ).reply(200, { offers: [{ ...row, agents: "on" }] });
    expect(text()).toMatch(/Agent use for Ledgerline is now allowed/);
    expect(document.activeElement?.textContent).toMatch(/Turn agent use off/);
    // And back off: the same button, still focused.
    await click(document.activeElement as HTMLElement);
    await (await f.next((c) => c.method === "PUT", "put off")).reply(200, {
      offer_id: "offer-1",
      agents: "off",
    });
    await (
      await f.next((c) => c.url.endsWith("/agent-access") && c.method === "GET", "readback 2")
    ).reply(200, { offers: [row] });
    expect(text()).toMatch(/is now not allowed/);
    expect(document.activeElement?.textContent).toMatch(/Allow agent use/);
  });
});

describe("006b2 session boundaries", () => {
  it("the same account signing out and in again never sees the earlier session's token, and an old answer never frees a newer create", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list 1")).reply(200, {
      grants: [],
    });
    await fillForm();
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    const first = await f.next((c) => c.method === "POST", "create in session 1");
    // Ava signs out and back in as Ava, on the same page, before the answer arrives.
    await setPerson(null);
    await setPerson(AVA);
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list 2")).reply(200, {
      grants: [],
    });
    // A create in the new session is possible, and is the only one pending.
    await fillForm();
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    const second = await f.next((c) => c.method === "POST", "create in session 2");
    await first.reply(201, { token: "evs_agent_OLD_SESSION_TOKEN_FICTIONAL", grant: {} });
    expect(text()).not.toMatch(/OLD_SESSION/);
    expect(text()).not.toMatch(/Copy this token now/);
    // The old answer didn't free the new create's guard: another submit sends nothing.
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(2);
    await second.reply(201, { token: "evs_agent_NEW_SESSION_TOKEN_FICTIONAL", grant: {} });
    expect(text()).toMatch(/NEW_SESSION_TOKEN/);
  });

  it("a lost create answer is unknown until the list is read back", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    await mount(createElement(AgentAccessPage));
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "list")).reply(200, { grants: [] });
    await fillForm();
    await act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    await (await f.next((c) => c.method === "POST", "create")).fail();
    expect(text()).toMatch(/couldn't tell whether the access was created/);
    await (await f.next((c) => c.url.endsWith("/agent-grants"), "readback")).reply(200, {
      grants: [grant({ state: "active" })],
    });
    expect(text()).toMatch(/Fictional bookkeeping agent/);
  });

  it("the owner switch reads the business it shows: an in-place change re-reads it, and the prior business's late answer changes nothing", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    const names = { "offer-1": "Ledgerline", "offer-2": "Relaydesk" };
    await mount(createElement(AgentUseSwitches, { businessId: "biz-1", names }));
    const old = await f.next((c) => c.url.includes("/biz-1/agent-access"), "biz-1 read");
    await act(async () =>
      root?.render(createElement(AgentUseSwitches, { businessId: "biz-2", names })),
    );
    const now = await f.next((c) => c.url.includes("/biz-2/agent-access"), "biz-2 read");
    await now.reply(200, {
      offers: [{ offer_id: "offer-2", offer_state: "active", agents: "off", active_grants: 0 }],
    });
    await old.reply(200, {
      offers: [{ offer_id: "offer-1", offer_state: "active", agents: "on", active_grants: 3 }],
    });
    expect(text()).toMatch(/Relaydesk/);
    expect(text()).not.toMatch(/Ledgerline/);
    await click(button("Allow agent use"));
    const put = await f.next((c) => c.method === "PUT", "put");
    expect(put.url).toContain("/biz-2/customer-offers/offer-2/agent-access");
  });

  it("a switch change answered after the business changed announces nothing and frees nothing", async () => {
    await setPerson(AVA);
    const f = scriptFetch();
    const names = { "offer-1": "Ledgerline", "offer-2": "Relaydesk" };
    await mount(createElement(AgentUseSwitches, { businessId: "biz-1", names }));
    await (await f.next((c) => c.url.includes("/biz-1/agent-access"), "biz-1")).reply(200, {
      offers: [{ offer_id: "offer-1", offer_state: "active", agents: "off", active_grants: 0 }],
    });
    await click(button("Allow agent use"));
    const put1 = await f.next((c) => c.method === "PUT", "put biz-1");
    await act(async () =>
      root?.render(createElement(AgentUseSwitches, { businessId: "biz-2", names })),
    );
    await (await f.next((c) => c.url.includes("/biz-2/agent-access"), "biz-2")).reply(200, {
      offers: [{ offer_id: "offer-2", offer_state: "active", agents: "off", active_grants: 0 }],
    });
    await click(button("Allow agent use"));
    const put2 = await f.next((c) => c.method === "PUT" && c.url.includes("/biz-2/"), "put biz-2");
    await put1.reply(200, { offer_id: "offer-1", agents: "on" });
    expect(text()).not.toMatch(/Ledgerline is now/);
    // biz-2's change is still pending: another press sends nothing.
    await click(button("Saving"));
    expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(2);
    await put2.reply(200, { offer_id: "offer-2", agents: "on" });
    expect(text()).toMatch(/Relaydesk is now allowed/);
  });
});
