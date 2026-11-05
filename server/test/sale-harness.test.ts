// Job 003wf2: the sale review harness (scripts/lib/saleHarness.ts), driven without a listener:
// its synthetic wallet module's endpoints, the REAL sign-in controller over its verified routes,
// and the REAL SaleFlow controller for both parties over its app. Fictional and synthetic.

import { describe, expect, it } from "vitest";
import { HARNESS_LABEL, saleControl, saleHarness } from "../../scripts/lib/saleHarness.ts";
import { SaleError, type SalePort } from "../../web/src/saleApi.ts";
import { SaleFlow, saleNext } from "../../web/src/saleFlow.ts";
import { SignInController, type WalletBoundary } from "../../web/src/wallet.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER } from "./sale-world.ts";

const ORIGIN = "http://127.0.0.1:8814";

async function harness() {
  const h = await saleHarness({ origin: ORIGIN });
  const control = saleControl(h);
  const ctl = async (path: string, method = "POST") =>
    (await (await control.request(path, { method })).json()) as Json;
  /** One browser: its own cookie jar over the harness site. */
  const browser = () => {
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
      const json = (await res.json().catch(() => null)) as Json;
      return { status: res.status, body: json };
    };
    const ok = async (path: string, method = "GET", body?: unknown) => {
      const r = await call(path, method, body);
      if (r.status >= 400)
        throw new SaleError(
          r.body?.error ?? String(r.status),
          r.status,
          r.body?.code,
          r.body?.detail,
        );
      return r.body as never;
    };
    // What the injected module does in the page, as a WalletBoundary over the same endpoints.
    const wallet: WalletBoundary = {
      label: HARNESS_LABEL,
      synthetic: true,
      signMessage: async (p) =>
        (await ok("/__harness/sign-message", "POST", {
          ...p,
          nonce: Buffer.from(p.nonce).toString("base64"),
        })) as never,
      connect: async () =>
        ((await ok("/__harness/account", "POST", {})) as Json).accountId as string,
      accounts: async () => [
        ((await ok("/__harness/account", "POST", {})) as Json).accountId as string,
      ],
      send: async (c) => {
        const out = (await ok("/__harness/tx", "POST", {
          receiverId: c.receiverId,
          actions: [
            {
              methodName: c.methodName,
              args: JSON.stringify(c.args),
              gas: c.gas,
              deposit: c.deposit,
            },
          ],
        })) as Json;
        return { txHash: out.transaction.hash as string };
      },
      disconnect: async () => {
        await ok("/__harness/disconnect", "POST", {});
      },
      onChange: () => () => {},
    };
    const port: SalePort = {
      setup: (b) => ok(`/api/sales/${b}`),
      prepare: (b, kind, input) => ok(`/api/sales/${b}/prepare`, "POST", { kind, input }),
      create: (b, body) => ok(`/api/sales/${b}/actions`, "POST", body),
      requested: (id, body) => ok(`/api/sales/actions/${id}/requested`, "POST", body),
      check: (id, body) => ok(`/api/sales/actions/${id}/check`, "POST", body),
      abandon: (id) => ok(`/api/sales/actions/${id}/abandon`, "POST"),
      reconcile: (b, i) => ok(`/api/businesses/${b}/v3/intents/${i}/reconcile`, "POST"),
    };
    const signIn = async (account: string) => {
      await ctl(`/account/${account}`);
      const s = new SignInController(
        {
          challenge: async () => ((await ok("/api/session/challenge", "POST")) as Json).challenge,
          verify: (body) => ok("/api/session/verify", "POST", body),
          cancelAttempt: async () => {},
        },
        async () => wallet,
        { network: "testnet", available: true, harness: HARNESS_LABEL },
        null,
      );
      const out = await s.start("/");
      if (out.kind !== "signed_in") throw new Error(`sign-in: ${out.kind}`);
      return out.account;
    };
    return { call, ok, wallet, port, signIn };
  };
  return { h, ctl, browser };
}

describe("003wf2 the sale review harness", () => {
  it("both parties sign in with the synthetic wallet and close a Direct sale through the real controllers", async () => {
    const { h, ctl, browser } = await harness();
    const biz = h.world.biz;
    const ava = browser();
    expect(await ava.signIn(SELLER)).toBe(SELLER);
    const seller = new SaleFlow(ava.port, () => Promise.resolve(ava.wallet), {
      businessId: biz,
      account: SELLER,
    });
    await seller.load();
    expect(saleNext(seller.getState()).action).toBe("terms");
    await seller.review("propose", proposal());
    await seller.confirm();
    expect(seller.getState().notice?.tone).toBe("ok");

    const noah = browser();
    expect(await noah.signIn(BUYER)).toBe(BUYER);
    const buyer = new SaleFlow(noah.port, () => Promise.resolve(noah.wallet), {
      businessId: biz,
      account: BUYER,
    });
    await buyer.load();
    for (const kind of ["register", "fund", "accept"] as const) {
      expect(saleNext(buyer.getState()).action).toBe(kind);
      await buyer.review(kind);
      await buyer.confirm();
      expect(buyer.getState().notice?.tone, kind).toBe("ok");
    }
    // The seller's wallet is the seller's again; the lost answer is recovered by the original ID.
    await ctl(`/account/${SELLER}`);
    await ctl("/lose-next");
    await seller.load();
    await seller.review("accept");
    await seller.confirm();
    const history = (await (
      await saleControl(h).request(`/history?account=${SELLER}`)
    ).json()) as Json;
    const original = history.transactions[0];
    expect(original.method).toBe("accept_sale");
    const row = seller.getState().setup?.actions.find((a) => a.kind === "accept") as Json;
    await seller.checkWithTransaction(row.id, original.id);
    expect(seller.getState().notice?.tone).toBe("ok");
    const state = await ctl("/", "GET");
    expect(state.contract).toMatchObject({ owner: BUYER, generation: 2 });
    expect(state.owner_here).toBe(h.world.noah.id);
  });

  it("refuses what isn't the sale's own request, and the control listener says what it changed", async () => {
    const { h, ctl, browser } = await harness();
    const b = browser();
    await b.signIn(SELLER);
    const bad = await b.call("/__harness/tx", "POST", {
      receiverId: "elsewhere.near",
      actions: [{ methodName: "x", args: "{}", gas: "1", deposit: "0" }],
    });
    expect(bad.status).toBe(400);
    const two = await b.call("/__harness/tx", "POST", {
      receiverId: h.world.BUSINESS,
      actions: [{}, {}],
    });
    expect(two.status).toBe(400);
    const other = await b.call("/__harness/tx", "POST", {
      receiverId: h.world.BUSINESS,
      actions: [{ methodName: "withdraw_profit", args: "{}", gas: "30000000000000", deposit: "1" }],
    });
    expect(other.status).toBe(400);
    expect(await ctl("/older-contract")).toEqual({ sale_terms: false });
    expect((await b.call(`/api/sales/${h.world.biz}`)).body.capability.reason).toBe(
      "contract_upgrade",
    );
    expect((await ctl("/advance/5")).chain_now).toBeTruthy();
    const use = await ctl("/customer-use");
    expect(use, JSON.stringify(use)).toMatchObject({ unit: "charged" });
  });
});
