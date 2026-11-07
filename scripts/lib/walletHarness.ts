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
  FRESH,
  type Json,
  SyntheticProtection,
  TOKEN,
} from "../../server/test/customer-world.ts";
import { labelScript } from "./customerPreview.ts";

export const HARNESS_LABEL = "Synthetic review wallet";

/** The harness page's policy: scripts, styles and connections from this harness only. */
export const HARNESS_CSP =
  "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'";

/** Prefixed to WALLET_SCRIPT by a harness that offers the account picker (the demo). */
export const PICKER_FLAG = "window.__everstreetHarnessPicker = true;\n";

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
  // The demo's account picker: a harness that turns it on (PICKER_FLAG) and lists its accounts
  // (GET /__harness/accounts) asks which one signs, as a wallet with several accounts would.
  // Other harnesses send no extra request.
  const accounts = async () => {
    if (!window.__everstreetHarnessPicker) return null;
    try {
      const r = await fetch("/__harness/accounts");
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return null;
      const j = await r.json();
      return Array.isArray(j.accounts) && j.accounts.length > 1 ? j : null;
    } catch { return null; }
  };
  const choose = (list) => new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.setAttribute("aria-labelledby", "harness-pick-t");
    d.style.cssText = "border:0;border-radius:12px;padding:20px;max-width:380px;width:calc(100% - 32px);font:15px system-ui,sans-serif;color:#1a1a1a;box-shadow:0 12px 40px rgba(0,0,0,.3)";
    const h = document.createElement("h2");
    h.id = "harness-pick-t";
    h.textContent = "Synthetic wallet: sign in as";
    h.style.cssText = "font-size:17px;margin:0 0 12px";
    d.append(h);
    const buttons = [];
    const done = (v) => { window.removeEventListener("keydown", keys, true); d.close(); d.remove(); resolve(v); };
    for (const a of list.accounts) {
      const b = document.createElement("button");
      b.type = "button";
      b.style.cssText = "display:block;width:100%;text-align:left;margin:0 0 8px;padding:10px 12px;border:1px solid #c9c9c9;border-radius:8px;background:#fff;cursor:pointer;font:inherit;color:inherit";
      const n = document.createElement("strong");
      n.textContent = a.name;
      const m = document.createElement("div");
      m.textContent = a.account + (a.role ? " · " + a.role : "");
      m.style.cssText = "font-size:13px;color:#555";
      b.append(n, m);
      b.addEventListener("click", () => done(a.account));
      buttons.push(b);
      d.append(b);
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Close the wallet";
    cancel.style.cssText = "margin-top:4px;padding:8px 12px;border:0;background:none;color:#555;cursor:pointer;font:inherit;text-decoration:underline";
    cancel.addEventListener("click", () => done(null));
    buttons.push(cancel);
    d.append(cancel);
    // The page's own dialog listens for Tab and Escape on the document: this wallet handles its
    // keys first, so they act here only.
    const keys = (e) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); done(null); }
      else if (e.key === "Tab") {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        const next = (i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    };
    window.addEventListener("keydown", keys, true);
    document.body.append(d);
    d.showModal();
    (buttons[list.accounts.findIndex((a) => a.account === list.current)] || buttons[0]).focus();
  });
  const pick = async () => {
    const list = await accounts();
    if (!list) return;
    const chosen = await choose(list);
    if (!chosen) throw new Error("You closed the synthetic wallet; nothing was signed.");
    await post("/__harness/use-account", { account: chosen });
  };
  window.__everstreetHarnessWallet = async () => ({
    id: "everstreet-harness-wallet",
    type: "injected",
    metadata: { name: ${JSON.stringify(HARNESS_LABEL)}, description: "Synthetic: review harness only", iconUrl: "/favicon.svg", deprecated: false, available: true, downloadUrl: "" },
    init: async () => ({
      signIn: async () => [{ accountId: (await post("/__harness/account", {})).accountId }],
      signOut: async () => { await post("/__harness/disconnect", {}); },
      getAccounts: async () => { const a = (await post("/__harness/account", {})).accountId; return a ? [{ accountId: a }] : []; },
      verifyOwner: async () => { throw new Error("not supported"); },
      signMessage: async (p) => { if (window.__everstreetHarnessPicker && !(await post("/__harness/account", {})).accountId) await pick(); return post("/__harness/sign-message", { message: p.message, recipient: p.recipient, nonce: b64(p.nonce), callbackUrl: p.callbackUrl ?? null, state: p.state ?? null }); },
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
 * Applies a customer's install_key / revoke_key / revoke_key_guarded (job 003wec) to the chain
 * double, following lib.rs (Astra's DeviceKeyReview: plan identity and hold limit on install; on
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
  } else if (call.methodName === "revoke_key" || call.methodName === "revoke_key_guarded") {
    if (call.methodName === "revoke_key_guarded") {
      // Job 003wec: lib.rs revoke_key_guarded, in its order; every check before any change
      // (server/test/guarded-revoke-world.test.ts replays the contract's own fixture).
      if (typeof call.args.pk !== "string" || !/^[0-9a-fA-F]{64}$/.test(call.args.pk))
        throw new Error("E_ARGS: public key is 64 hex characters");
      if (String(call.args.reg_id) !== String(ent.reg_id))
        throw new Error("E_STALE_REVIEW: the registration changed since this was reviewed");
      if (k.state !== "active") throw new Error("E_KEY: that key is not active");
      if (k.epoch !== call.args.epoch || k.public_key !== String(call.args.pk).toLowerCase())
        throw new Error("E_STALE_REVIEW: the key in this slot changed since this was reviewed");
    } else if (k.state !== "active") throw new Error("E_KEY: that key is not active");
    if (k.epoch >= 0xffff_ffff) throw new Error("E_OVERFLOW: key epoch");
    Object.assign(k, { state: "revoked", epoch: k.epoch + 1 });
    if (ent.hold_active && ent.hold_key_slot === call.args.slot) {
      const until = BigInt(ent.serve_until_ms);
      // biome-ignore lint/complexity/useMathMinMax: BigInt values (Math.min takes numbers only)
      ent.serve_until_ms = String(until < plan.now_ms ? until : plan.now_ms);
    }
  } else
    throw new Error(
      "The synthetic wallet only sends install_key, revoke_key and revoke_key_guarded.",
    );
  ent.key_states = ent.keys.map(
    (x: Json) => ({ empty: 0, active: 1, revoked: 2 })[x.state as string],
  );
  ent.key_epochs = ent.keys.map((x: Json) => x.epoch);
}

/**
 * `customer`: "seeded" (Cara: 100 units and a fixture key, as before) or "fresh" (job 003web: Dana,
 * with no entitlement and no key, holding only her own fictional test tokens).
 */
export async function walletHarness(opts: { origin: string; customer?: "seeded" | "fresh" }) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({ customer: { protection } });
  // Job 003wea (Astra's actual browser handoff: the product was "Not available"): the public
  // offer route rightly needs a PUBLISHED business, so the fictional one is published here, as
  // the customer preview does. Public access rules are untouched.
  // The chain double and the server follow THIS computer's clock (the browser's), moving only
  // forward, so freshness, deadlines and the browser's own envelope check agree.
  const time = { offset: 0 };
  const sync = () => {
    w.clock.now = Date.now() + time.offset;
    const d = BigInt(w.clock.now) - w.chain.ts;
    if (d > 0n) w.chain.tick(d);
  };
  const finalBlock = w.reader.finalBlock.bind(w.reader);
  w.reader.finalBlock = async () => {
    sync();
    return finalBlock();
  };
  sync();
  w.state.store.db
    .prepare("UPDATE businesses SET name = ?, slug = ?, published_at = ? WHERE id = ?")
    .run("Ledgerline Invoice Reader", "ledgerline", new Date().toISOString(), w.f.business);
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
  store.db
    .prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
    )
    .run(FRESH, w.dana.id, new Date().toISOString());
  const signIn = new AccountSignIn(store, {
    recipient: "everstreet.local",
    network: "testnet",
    reader: {
      isFullAccessKey: async (a, k) => (a === CUSTOMER || a === FRESH) && k === accountKey,
    },
    callbackUrl: `${opts.origin}/signin/return`,
  });
  w.state.app = w.make(store, undefined, {
    localPreview: false,
    environment: "Review harness (synthetic)",
    identity: { mode: "verified", signIn },
    wallet: { network: "testnet", available: true, harness: HARNESS_LABEL },
  });
  const controls = {
    account: (opts.customer === "fresh" ? FRESH : CUSTOMER) as string | null,
    /** The next wallet action is closed by the person (cancellation). */
    cancelNext: false,
    /** The next transaction lands but its answer is lost. */
    loseNext: false,
    /** The next wallet answer (sign-in or transaction) arrives this many ms late (0 to 30000). */
    delayNextMs: 0,
    signed: 0,
    sent: [] as Json[],
  };
  /** A late wallet answer (a harness control): bounded, applied once. */
  const late = async () => {
    const ms = Math.min(Math.max(controls.delayNextMs, 0), 30_000);
    controls.delayNextMs = 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
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
    await late();
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
    await late();
    sync();
    if (controls.cancelNext) {
      controls.cancelNext = false;
      return c.json({ error: "User closed the window" }, 400);
    }
    const p = (await c.req.json()) as Json;
    // Only the fictional business contract and its token are callable (each branch checks).
    if (p.receiverId !== BUSINESS && p.receiverId !== TOKEN)
      return c.json(
        { error: "The synthetic wallet only calls the fictional business and its token." },
        400,
      );
    const signer = String(controls.account);
    if ((p.actions as Json[]).length !== 1)
      return c.json({ error: "The synthetic wallet sends one action at a time." }, 400);
    const a = (p.actions as Json[])[0] as Json;
    const call = {
      receiverId: String(p.receiverId),
      methodName: String(a.methodName),
      args: JSON.parse(a.args) as Json,
      deposit: String(a.deposit),
      gas: String(a.gas),
    };
    controls.sent.push(call);
    let outcome: Json;
    if (
      call.methodName === "install_key" ||
      call.methodName === "revoke_key" ||
      call.methodName === "revoke_key_guarded"
    ) {
      if (call.receiverId !== BUSINESS)
        return c.json(
          { error: "The synthetic wallet only calls the fictional business contract." },
          400,
        );
      const ent = w.chain.ent(signer);
      if (!ent) return c.json({ error: "E_ARGS: no entitlement" }, 400);
      try {
        applyKeyCall(ent, call, {
          plan_id: 1,
          max_hold_units: Number(w.chain.plan.max_hold_units),
          now_ms: w.chain.ts,
        });
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
      outcome = { status: { SuccessValue: "" } };
    } else {
      // Job 003web: sponsor_shell, the token's storage_deposit and ft_transfer_call, by the
      // contract's rules (FixtureChain.walletCall, checked against the contract's own outcomes).
      outcome = w.chain.walletCall(signer, call);
    }
    if (controls.loseNext) {
      controls.loseNext = false;
      return c.json({ error: "Synthetic: the wallet's answer was lost." }, 502);
    }
    // As the pinned adapter answers: the transaction's outcome (its hash is all that is used).
    return c.json(outcome);
  });
  site.all("/api/*", (c) => {
    sync();
    return w.state.app.fetch(c.req.raw);
  });
  return { site, controls, offerId, world: w, accountKey, customer: opts.customer ?? "seeded" };
}

/** How many transactions the synthetic wallet's history lists (newest first). */
export const HISTORY_LIMIT = 50;

/**
 * The synthetic wallet's activity, as a wallet's history shows it (Astra's PurchaseBrowserRepeat:
 * with the answer lost, the reviewer needs the ORIGINAL transaction's ID, as a customer would copy
 * it from the wallet). A read-only PROJECTION of the transactions the in-memory chain double
 * actually recorded (FixtureChain.txs, in the order applied), nothing computed or added: per
 * transaction, its ID, its (fictional) signer and receiver, its one method, and the transaction's
 * own top-level status. No arguments, keys, signatures, signed bytes, documents or results. The
 * status is the transaction's, not whether a purchase was accepted: a returned purchase is still a
 * successful transaction, exactly as a wallet lists it. Test support on the control listener only;
 * never an app route.
 */
export function walletHistory(txs: Map<string, Json>) {
  const out: {
    id: string;
    signer: string;
    receiver: string;
    method: string;
    status: "success" | "failure" | "unknown";
  }[] = [];
  for (const o of txs.values()) {
    const t = o?.transaction as Json | undefined;
    const st = o?.status as Json | undefined;
    out.push({
      id: String(t?.hash),
      signer: String(t?.signer_id),
      receiver: String(t?.receiver_id),
      method: String(t?.actions?.[0]?.FunctionCall?.method_name),
      status:
        st && typeof st === "object" && "Failure" in st
          ? "failure"
          : st && typeof st === "object" && typeof st.SuccessValue === "string"
            ? "success"
            : "unknown",
    });
  }
  return out.reverse().slice(0, HISTORY_LIMIT);
}

/**
 * The harness's control listener (a SEPARATE origin from the site; no control route exists in the
 * app): the wallet controls, what the synthetic wallet sent, and its read-only history.
 */
export function harnessControl(h: Awaited<ReturnType<typeof walletHarness>>) {
  const control = new Hono();
  control.get("/", (c) => c.json({ ...h.controls, offer: h.offerId }));
  control.get("/history", (c) => {
    const account = c.req.query("account");
    const all = walletHistory(h.world.chain.txs as Map<string, Json>);
    return c.json({
      note: "Synthetic wallet activity (fictional): each transaction's ID, signer, receiver, method and its own status. Not whether a purchase was accepted.",
      transactions: account ? all.filter((t) => t.signer === account) : all,
    });
  });
  control.post("/cancel-next", (c) => {
    h.controls.cancelNext = true;
    return c.json({ cancel_next: true });
  });
  control.post("/lose-next", (c) => {
    h.controls.loseNext = true;
    return c.json({ lose_next: true });
  });
  control.post("/delay-next/:ms", (c) => {
    const ms = Number(c.req.param("ms"));
    if (!Number.isInteger(ms) || ms < 0 || ms > 30_000)
      return c.json({ error: "0 to 30000 ms" }, 400);
    h.controls.delayNextMs = ms;
    return c.json({ delay_next_ms: ms });
  });
  // Job 003wec: from now on the business answers like an older deployed contract, without
  // get_key_terms, so the product must refuse revocation (never fall back). One way, until the
  // harness stops.
  control.post("/older-contract", (c) => {
    h.world.chain.keyTerms = false;
    return c.json({ guarded_revoke: false });
  });
  control.post("/account/:id", (c) => {
    h.controls.account = c.req.param("id");
    return c.json({ account: h.controls.account });
  });
  return control;
}
