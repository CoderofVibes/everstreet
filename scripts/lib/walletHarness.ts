// Job 003w-e (APPLICATION_COMPOSITION §9.8): the scenario behind scripts/wallet-harness.ts, kept apart
// from any listener so a test can drive it without a network.
//
// FICTIONAL and SYNTHETIC: the customer test world (server/test/customer-world.ts: an in-memory
// database, the real app and routes, the contract-JSON chain double, a scripted extractor), but
// with VERIFIED identity: the real AccountSignIn over a synthetic account-key reader, and the
// exact callback URL of this harness. The wallet is injected at the Wallet Selector MODULE boundary:
// `/__harness/wallet.js` defines a WalletModuleFactory (the official module interface) whose
// signMessage and transactions are served by THIS process: an ephemeral account key made at start
// signs NEP-413 here, and install_key / revoke_key are applied to the chain double by the contract's
// rules. The browser runs the production controllers. Nothing is a real wallet, account or network.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Hono } from "hono";
import { base58Encode } from "../../server/src/customerWriter.ts";
import { AccountSignIn } from "../../server/src/identity.ts";
import type { Store } from "../../server/src/store.ts";
import {
  BUSINESS,
  CUSTOMER,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import { labelScript } from "./customerPreview.ts";

export const HARNESS_LABEL = "Synthetic review wallet";

/** The harness page's policy: scripts, styles and connections from this harness only. */
export const HARNESS_CSP =
  "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'";

/** The page-side module: the official WalletModuleFactory shape, backed by this harness process. */
export const WALLET_SCRIPT = `// Review harness only: a SYNTHETIC wallet module (not a wallet). Never part of the app bundle.
(() => {
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The synthetic wallet refused.");
    return j;
  };
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  window.__everstreetHarnessWallet = async () => ({
    id: "everstreet-harness-wallet",
    type: "injected",
    metadata: { name: ${JSON.stringify(HARNESS_LABEL)}, description: "Synthetic: review harness only", iconUrl: "/favicon.svg", deprecated: false, available: true, downloadUrl: "" },
    init: async () => ({
      signIn: async () => [{ accountId: (await post("/__harness/account", {})).accountId }],
      signOut: async () => { await post("/__harness/disconnect", {}); },
      getAccounts: async () => { const a = (await post("/__harness/account", {})).accountId; return a ? [{ accountId: a }] : []; },
      verifyOwner: async () => { throw new Error("not supported"); },
      signMessage: async (p) => post("/__harness/sign-message", { message: p.message, recipient: p.recipient, nonce: b64(p.nonce), callbackUrl: p.callbackUrl ?? null, state: p.state ?? null }),
      signAndSendTransaction: async (p) => post("/__harness/tx", { receiverId: p.receiverId, actions: p.actions.map((a) => ({ methodName: a.functionCall.methodName, args: new TextDecoder().decode(a.functionCall.args), gas: String(a.functionCall.gas), deposit: String(a.functionCall.deposit) })) }),
      signAndSendTransactions: async () => { throw new Error("not supported"); },
      getPublicKey: async () => { throw new Error("not supported"); },
      signNep413Message: async () => { throw new Error("not supported"); },
      signTransaction: async () => { throw new Error("not supported"); },
      signDelegateAction: async () => { throw new Error("not supported"); },
    }),
  });
})();
`;

/**
 * Applies a customer's install_key / revoke_key to the chain double, following lib.rs
 * install_key / revoke_key (Astra's DeviceKeyReview: plan identity and hold limit on install; on
 * revoke, an active hold under that slot stops serving now, while uses already signed stay
 * settleable until its settle deadline). It is a double: the curve-point and weak-key checks are
 * only the 64-hex shape here, so it can't stand in for the contract's key validation.
 */
export function applyKeyCall(
  ent: Json,
  call: { methodName: string; args: Json; deposit: string },
  plan: { plan_id: number; max_hold_units: number; now_ms: bigint },
) {
  if (call.deposit !== "1") throw new Error("E_DEPOSIT: attach exactly 1 yoctoNEAR");
  if (call.args.plan_id !== plan.plan_id) throw new Error("E_ARGS: no such plan");
  const k = ent.keys?.[call.args.slot] as Json | undefined;
  if (!k) throw new Error("E_ARGS: key slot 0-3");
  if (call.methodName === "install_key") {
    if (k.state === "active") throw new Error("E_KEY: that key slot is in use");
    if (!/^[0-9a-f]{64}$/.test(String(call.args.pk))) throw new Error("E_KEY_INVALID");
    const h = call.args.max_hold_units;
    if (!Number.isInteger(h) || h < 1 || h > plan.max_hold_units)
      throw new Error("E_ARGS: hold units outside the plan");
    if (!Number.isInteger(call.args.max_units_per_day) || call.args.max_units_per_day < 1)
      throw new Error("E_ARGS: allow at least 1 unit a day");
    Object.assign(k, {
      state: "active",
      epoch: k.epoch + 1,
      public_key: call.args.pk,
      max_hold_units: call.args.max_hold_units,
      max_units_per_day: call.args.max_units_per_day,
    });
  } else if (call.methodName === "revoke_key") {
    if (k.state !== "active") throw new Error("E_KEY: that key is not active");
    Object.assign(k, { state: "revoked", epoch: k.epoch + 1 });
    if (ent.hold_active && ent.hold_key_slot === call.args.slot) {
      const until = BigInt(ent.serve_until_ms);
      ent.serve_until_ms = String(until < plan.now_ms ? until : plan.now_ms);
    }
  } else throw new Error("The synthetic wallet only sends install_key and revoke_key.");
  ent.key_states = ent.keys.map(
    (x: Json) => ({ empty: 0, active: 1, revoked: 2 })[x.state as string],
  );
  ent.key_epochs = ent.keys.map((x: Json) => x.epoch);
}

export async function walletHarness(opts: { origin: string }) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({ customer: { protection } });
  const offerId = await w.offer();
  // The synthetic account key the harness wallet signs with (FullAccess for the fictional customer).
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const accountKey = `ed25519:${base58Encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32))}`;
  const store = w.state.store as Store;
  // The fictional customer's person already exists; bind the account to it for verified sign-in.
  store.db
    .prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
    )
    .run(CUSTOMER, w.cara.id, new Date().toISOString());
  const signIn = new AccountSignIn(store, {
    recipient: "everstreet.local",
    network: "testnet",
    reader: { isFullAccessKey: async (a, k) => a === CUSTOMER && k === accountKey },
    callbackUrl: `${opts.origin}/signin/return`,
  });
  w.state.app = w.make(store, undefined, {
    localPreview: false,
    environment: "Review harness (synthetic)",
    identity: { mode: "verified", signIn },
    wallet: { network: "testnet", available: true, harness: HARNESS_LABEL },
  });
  const controls = {
    account: CUSTOMER as string | null,
    /** The next wallet action is closed by the person (cancellation). */
    cancelNext: false,
    /** The next transaction lands but its answer is lost. */
    loseNext: false,
    signed: 0,
    sent: [] as Json[],
  };
  const site = new Hono();
  site.get("/__harness/wallet.js", (c) =>
    c.body(WALLET_SCRIPT, 200, { "content-type": "text/javascript" }),
  );
  site.get("/__harness/label.js", (c) =>
    c.body(
      labelScript({
        label: `Review harness: ${HARNESS_LABEL}, synthetic chain`,
        detail:
          "Fictional data and ephemeral keys; not a wallet or testnet evidence. The page may connect only to this harness.",
      }),
      200,
      { "content-type": "text/javascript" },
    ),
  );
  site.post("/__harness/account", (c) => c.json({ accountId: controls.account }));
  site.post("/__harness/disconnect", (c) => {
    controls.account = null;
    return c.json({ ok: true });
  });
  site.post("/__harness/sign-message", async (c) => {
    if (controls.cancelNext) {
      controls.cancelNext = false;
      return c.json({ error: "User closed the window" }, 400);
    }
    const p = (await c.req.json()) as Json;
    if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
    const { serializeNep413 } = await import("@near-wallet-selector/core");
    const bytes = serializeNep413({
      message: String(p.message),
      recipient: String(p.recipient),
      nonce: Buffer.from(String(p.nonce), "base64"),
      callbackUrl: p.callbackUrl ?? undefined,
    });
    controls.signed++;
    return c.json({
      accountId: controls.account,
      publicKey: accountKey,
      signature: sign(null, createHash("sha256").update(bytes).digest(), privateKey).toString(
        "base64",
      ),
      state: p.state ?? undefined,
    });
  });
  site.post("/__harness/tx", async (c) => {
    if (controls.cancelNext) {
      controls.cancelNext = false;
      return c.json({ error: "User closed the window" }, 400);
    }
    const p = (await c.req.json()) as Json;
    if (p.receiverId !== BUSINESS)
      return c.json(
        { error: "The synthetic wallet only calls the fictional business contract." },
        400,
      );
    const ent = w.chain.ent(String(controls.account));
    if (!ent) return c.json({ error: "E_ARGS: no entitlement" }, 400);
    for (const a of p.actions as Json[]) {
      const call = { methodName: a.methodName, args: JSON.parse(a.args), deposit: a.deposit };
      controls.sent.push({ receiverId: p.receiverId, ...call, gas: a.gas });
      try {
        applyKeyCall(ent, call, {
          plan_id: 1,
          max_hold_units: Number(w.chain.plan.max_hold_units),
          now_ms: w.chain.ts,
        });
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    }
    if (controls.loseNext) {
      controls.loseNext = false;
      return c.json({ error: "Synthetic: the wallet's answer was lost." }, 502);
    }
    return c.json({ status: { SuccessValue: "" } });
  });
  site.all("/api/*", (c) => w.state.app.fetch(c.req.raw));
  return { site, controls, offerId, world: w, accountKey };
}
