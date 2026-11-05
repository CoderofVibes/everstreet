// Job 003wea: the harness's REAL browser path, without a browser. The page's own code runs: the
// production customerHttp/api/readKeys over `fetch` (stubbed only to reach the harness site with
// one cookie jar), SignInController, DeviceKeys over fake-indexeddb, and CustomerWorkspace with the
// BROWSER's clock (Date.now). Astra's actual browser handoff found the product "Not available"
// (the harness never published its business); the old harness clock also sat days behind the
// browser. Both are reproduced here first. Synthetic wallet module answers, ephemeral keys.

import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HARNESS_LABEL, walletHarness } from "../../scripts/lib/walletHarness.ts";
import { api } from "../../web/src/api.ts";
import { customerHttp } from "../../web/src/customerApi.ts";
import { CustomerWorkspace } from "../../web/src/customerWorkspace.ts";
import { DeviceKeys, openDeviceKeyStore, readKeys } from "../../web/src/deviceKey.ts";
import { SignInController, type WalletBoundary } from "../../web/src/wallet.ts";
import { CUSTOMER } from "./customer-world.ts";

const ORIGIN = "http://127.0.0.1:8814";
const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One browser on the harness: relative fetches go to its site, with one cookie jar. */
async function browserOn() {
  const h = await walletHarness({ origin: ORIGIN });
  const jar = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await h.site.request(new URL(String(input), ORIGIN), { ...init, headers });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    return res;
  });
  const post = async (path: string, body: unknown) => {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(j.error));
    return j;
  };
  // What the injected module does in the page: the same harness endpoints.
  const wallet: WalletBoundary = {
    label: HARNESS_LABEL,
    synthetic: true,
    signMessage: async (p) =>
      (await post("/__harness/sign-message", {
        ...p,
        nonce: Buffer.from(p.nonce).toString("base64"),
      })) as never,
    connect: async () => (await post("/__harness/account", {})).accountId as string,
    accounts: async () => [(await post("/__harness/account", {})).accountId as string],
    send: async (c) => {
      await post("/__harness/tx", {
        receiverId: c.receiverId,
        actions: [
          {
            methodName: c.methodName,
            args: JSON.stringify(c.args),
            gas: c.gas,
            deposit: c.deposit,
          },
        ],
      });
    },
    disconnect: async () => {
      await post("/__harness/disconnect", {});
    },
    onChange: () => () => {},
  };
  const signIn = () =>
    new SignInController(
      {
        challenge: async () => (await api.signInChallenge()).challenge,
        verify: (b) => api.signInVerify(b),
        cancelAttempt: async () => {
          await api.cancelSignIn();
        },
      },
      async () => wallet,
      { network: "testnet", available: true, harness: HARNESS_LABEL },
      null,
    ).start(`/use/${h.offerId}`);
  return { h, wallet, signIn };
}

describe("003wea the harness's customer page, through the page's own code", () => {
  it("the printed product is a PUBLIC offer: the page loads it before anyone signs in", async () => {
    const { h } = await browserOn();
    const { offer } = (await customerHttp.offer(h.offerId)) as {
      offer: { offer_id: string; offer_state: string; business: { slug: string } };
    };
    expect(offer).toMatchObject({ offer_id: h.offerId, offer_state: "active" });
    expect(offer.business.slug).toBe("ledgerline");
  });

  it("sign in, enroll this device, prepare, check and authorize with the device key, on the browser's clock", async () => {
    const { h, wallet, signIn } = await browserOn();
    expect(await signIn()).toMatchObject({ kind: "signed_in", account: CUSTOMER });
    const me = await api.me();
    const keys = new DeviceKeys({
      store: () => openDeviceKeyStore(idb),
      read: readKeys,
      wallet: async () => wallet,
      account: CUSTOMER,
    });
    const idb = new IDBFactory();
    const enrolled = await keys.enroll(h.offerId, 5);
    if (enrolled.kind !== "done" || enrolled.readiness.kind !== "ready")
      throw new Error(`not ready: ${JSON.stringify(enrolled)}`);
    const authorizer = keys.authorizer(h.offerId, enrolled.readiness);
    const w = new CustomerWorkspace(customerHttp, {
      personId: me.person?.id as string,
      offerId: h.offerId,
      authorizer: () => authorizer,
      storage: null,
      // the default clock: this computer's (the browser's) time
    });
    await w.start();
    w.setDraft(INPUT);
    await w.prepare();
    expect(w.getState().use?.state).toBe("prepared");
    expect(w.getState().check).toEqual({ ok: true, problem: null });
    await w.authorize();
    expect(w.getState().notice?.message ?? null).toBeNull();
    expect(w.getState().use?.state).toBe("reserved");
    expect(h.world.chain.opened).toBe(1);
  });
});
