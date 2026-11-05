// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8814/"}
//
// Job 003wea (Astra's WalletBrowserRepeat: first sign-in left the product on "Loading…" until a
// reload). This renders the ACTUAL Router + SessionProvider + App under jsdom, with React's real
// effect lifecycle, against the review harness's real routes (fetch is stubbed only to reach the
// harness site with one cookie jar; IndexedDB is fake-indexeddb). The sequence is the browser's:
// signed out on the printed product, sign in, then the same-account session refreshes that
// follow a sign-in. Fictional data; synthetic wallet answers; no network.

import "fake-indexeddb/auto";
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walletHarness } from "../../scripts/lib/walletHarness.ts";
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

async function harnessBrowser() {
  const h = await walletHarness({ origin: ORIGIN });
  const jar = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "object" && "url" in input ? input.url : String(input),
      ORIGIN,
    );
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
  /** Signs in over the real routes, exactly as the wallet dialog's controller would. */
  const signInOverRoutes = async () => {
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
    expect(v.status).toBe(201);
  };
  return { h, signInOverRoutes };
}

/** Exposes the session (as the sign-in dialog and its settle() use it) to the test. */
let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  const s = useSession();
  useEffect(() => {
    session = s;
  });
  return null;
}

const settle = async (ms = 30) => {
  for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, ms / 10)));
};
const text = () => document.body.textContent ?? "";

describe("003wea the customer page across the first sign-in (actual React lifecycle)", () => {
  for (const strict of [false, true])
    it(`after sign-in and same-account refreshes the product loads, and a typed draft survives${strict ? " (StrictMode, as main.tsx renders)" : ""}`, async () => {
      const { h, signInOverRoutes } = await harnessBrowser();
      window.history.replaceState(null, "", `/use/${h.offerId}`);
      const el = document.createElement("div");
      document.body.append(el);
      root = createRoot(el);
      const tree = createElement(
        Router,
        null,
        createElement(SessionProvider, null, createElement(Probe), createElement(App)),
      );
      await act(async () => root?.render(strict ? createElement(StrictMode, null, tree) : tree));
      await settle();
      expect(text()).toContain("Sign in to use this product");
      // The wallet sign-in completes: the session refreshes (settle), then the dialog's
      // finishSignIn and later refreshes hand over NEW person objects for the SAME account.
      await signInOverRoutes();
      await act(async () => session?.refresh());
      await settle();
      await act(async () => session?.refresh());
      await settle();
      expect(text()).not.toContain("Loading…");
      expect(text()).toContain("Invoice reader");
      // A typed draft and the device panel survive another equivalent refresh.
      const box = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(box).not.toBeNull();
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        set?.call(box, "Fictional invoice SH-1042");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => session?.refresh());
      await settle();
      expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
        "Fictional invoice SH-1042",
      );
      expect(text()).toContain("Use this product on this device");
      // A real identity change (sign-out) withdraws the workspace and its private draft.
      await act(async () => session?.signOut());
      await settle();
      expect(text()).toContain("Sign in to use this product");
      expect(document.querySelector("textarea")).toBeNull();
    });
});
