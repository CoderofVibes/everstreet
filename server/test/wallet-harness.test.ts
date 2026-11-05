// Job 003w-e: the review harness (scripts/lib/walletHarness.ts), driven without a listener: its
// synthetic wallet module's endpoints, the REAL sign-in controller over the harness's verified
// routes, and the REAL device-key controller enrolling through the harness's synthetic transactions.

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  HARNESS_CSP,
  HARNESS_LABEL,
  WALLET_SCRIPT,
  walletHarness,
} from "../../scripts/lib/walletHarness.ts";
import { DeviceKeys, type KeysReadback, openDeviceKeyStore } from "../../web/src/deviceKey.ts";
import { SignInController, type WalletBoundary } from "../../web/src/wallet.ts";
import { CUSTOMER } from "./customer-world.ts";

const ORIGIN = "http://127.0.0.1:8814";

async function harness() {
  const h = await walletHarness({ origin: ORIGIN });
  let cookie = "";
  const call = async (path: string, method = "GET", body?: unknown) => {
    const res = await h.site.request(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(";");
      const [name] = (pair as string).split("=");
      const kept = cookie.split("; ").filter((x) => x && !x.startsWith(`${name}=`));
      if (!/max-age=0/i.test(set)) kept.push(pair as string);
      cookie = kept.join("; ");
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json?.error ?? res.status));
    return json;
  };
  // What the injected module does in the page, as a WalletBoundary over the same endpoints.
  const wallet: WalletBoundary = {
    label: HARNESS_LABEL,
    synthetic: true,
    signMessage: async (p) =>
      (await call("/__harness/sign-message", "POST", {
        ...p,
        nonce: Buffer.from(p.nonce).toString("base64"),
      })) as never,
    connect: async () => (await call("/__harness/account", "POST", {})).accountId as string,
    accounts: async () => [(await call("/__harness/account", "POST", {})).accountId as string],
    send: async (c) => {
      await call("/__harness/tx", "POST", {
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
      await call("/__harness/disconnect", "POST", {});
    },
    onChange: () => () => {},
  };
  return { h, call, wallet };
}

describe("003w-e the wallet review harness", () => {
  it("serves an official-shape synthetic wallet module and says it is synthetic", async () => {
    const { call } = await harness();
    expect(WALLET_SCRIPT).toContain("window.__everstreetHarnessWallet");
    expect(WALLET_SCRIPT).toContain("Never part of the app bundle");
    const env = (await call("/api/env")) as { identity: string; wallet: { harness: string } };
    expect(env.identity).toBe("verified");
    expect(env.wallet).toEqual({ network: "testnet", available: true, harness: HARNESS_LABEL });
  });

  it("signs in through the real controller, then enrolls this device through the real device-key controller", async () => {
    const { h, call, wallet } = await harness();
    const items = new Map<string, string>();
    const storage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    } as unknown as Storage;
    const c = new SignInController(
      {
        challenge: async () => (await call("/api/session/challenge", "POST")).challenge as never,
        verify: async (b) => (await call("/api/session/verify", "POST", b)) as never,
        cancelAttempt: async () => {
          await call("/api/session/challenge", "DELETE");
        },
      },
      async () => wallet,
      { network: "testnet", available: true, harness: HARNESS_LABEL },
      storage,
    );
    expect(await c.start(`/use/${h.offerId}`)).toMatchObject({
      kind: "signed_in",
      account: CUSTOMER,
    });
    expect(((await call("/api/me")) as { account: string }).account).toBe(CUSTOMER);

    const idb = new IDBFactory(); // this browser's storage, for the whole test
    const keys = new DeviceKeys({
      store: () => openDeviceKeyStore(idb),
      read: async (o) => (await call(`/api/customer/offers/${o}/keys`)) as unknown as KeysReadback,
      wallet: async () => wallet,
      account: CUSTOMER,
    });
    h.controls.loseNext = true; // the wallet's answer is lost: the readback still decides
    expect(await keys.enroll(h.offerId, 5)).toMatchObject({
      kind: "done",
      readiness: { kind: "ready", slot: 1 },
    });
    expect(h.controls.sent).toEqual([
      expect.objectContaining({
        receiverId: "studio.biz.near",
        methodName: "install_key",
        deposit: "1",
      }),
    ]);
  });

  it("a closed wallet window cancels sign-in with nothing changed", async () => {
    const { h, call, wallet } = await harness();
    h.controls.cancelNext = true;
    const c = new SignInController(
      {
        challenge: async () => (await call("/api/session/challenge", "POST")).challenge as never,
        verify: async (b) => (await call("/api/session/verify", "POST", b)) as never,
        cancelAttempt: async () => {},
      },
      async () => ({
        ...wallet,
        signMessage: async (p) => {
          try {
            return await wallet.signMessage(p);
          } catch (e) {
            throw new Error((e as Error).message);
          }
        },
      }),
      { network: "testnet", available: true, harness: HARNESS_LABEL },
      null,
    );
    expect((await c.start("/")).kind).toBe("cancelled");
    expect(((await call("/api/me")) as { person: unknown }).person).toBeNull();
  });

  it("late wallet answers are a bounded, one-shot control; the page may connect only to the harness", async () => {
    const { h, call } = await harness();
    h.controls.delayNextMs = 120;
    const t0 = Date.now();
    await call("/__harness/tx", "POST", { receiverId: "studio.biz.near", actions: [] });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(h.controls.delayNextMs).toBe(0);
    expect(HARNESS_CSP).toContain("connect-src 'self'");
    expect(HARNESS_CSP).toContain("default-src 'self'");
  });
});
