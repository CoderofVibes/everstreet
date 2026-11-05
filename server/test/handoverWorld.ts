// Job 003wf3 test world (MANAGED_HANDOVER.md §10): a configured installation (lifecycleWorld.ts
// bootstrap, the accepted 003wf1 prerequisites) with the sale half of the SAME synthetic state
// attached in Gated mode (a fictional closer), composed IN THIS PROCESS by the production
// composition with `handover` configured: the real SaleActions, CustomerUses, V3Observations,
// V3Intents, customer writer, closer writer and HandoverCoordinator, over TestnetTxTransport /
// TestnetCustomerRpcTransport answered by SyntheticRpc. The composition is never started (no
// timers): tests drive `composed.handover.pass()` themselves, so every step is deterministic.
// Ephemeral keys, fictional accounts, a disposable directory. Never used by the application.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  appBrowser,
  BIZ,
  bootstrap,
  composeIn,
  FOUNDER,
  nearKey,
  OP,
  signInAs,
} from "./lifecycleWorld.ts";

export const BUYER = "noah-buyer.near";
export const CLOSER = "closer-synthetic.testnet";
export const PRICE = "250000000";

export type Call = ReturnType<typeof appBrowser>;

export interface HandoverWorldOptions {
  /** The closer key's permission on chain (default: a function-call key for close_sale). */
  closerKey?: "fc" | "full" | "other_method" | "other_receiver" | "low_allowance";
  /** False: the business answers like contract code without get_handover_terms. */
  terms?: boolean;
  /** Overrides for the `handover` config section. */
  handover?: Json;
}

/**
 * The installation's handover prerequisites on a bootstrapped directory (shared with the actual-
 * process tests): the sale half in Gated mode, the buyer linked, the closer's ephemeral key and its
 * on-chain permission, and the `handover` config section.
 */
export function prepareHandover(
  b: Awaited<ReturnType<typeof bootstrap>>,
  dir: string,
  o: HandoverWorldOptions = {},
) {
  const sale = b.w.chain.attachSale({ owner: FOUNDER, closer: CLOSER });
  sale.handoverTerms = o.terms ?? true;
  b.w.chain.balances.set(BUYER, 1_000_000_000n);
  const db = openDb(b.db);
  try {
    const t = new Date().toISOString();
    db.prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
    ).run(b.w.f.ava.id, FOUNDER, t);
    db.prepare(
      "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES ('person-noah', 'Noah Brandt', '', '', ?)",
    ).run(t);
    db.prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, 'person-noah', 'testnet', ?)",
    ).run(BUYER, t);
    db.prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', 'person-noah', ?, NULL, 'fixture', ?)",
    ).run(BUYER, t);
  } finally {
    db.close();
  }
  const noah = nearKey();
  b.rpc.keys.set(`${BUYER}|${noah.id}`, 0n);
  // The closer: an ephemeral key, by default a function-call key for exactly close_sale on BIZ.
  const ck = nearKey();
  const k = `${CLOSER}|${ck.id}`;
  b.rpc.keys.set(k, 0n);
  const fc = (over: Json = {}) => ({
    FunctionCall: { receiver_id: BIZ, method_names: ["close_sale"], allowance: null, ...over },
  });
  const kind = o.closerKey ?? "fc";
  if (kind === "fc") b.rpc.permissions.set(k, fc());
  if (kind === "other_method")
    b.rpc.permissions.set(k, fc({ method_names: ["close_sale", "abort_close"] }));
  if (kind === "other_receiver") b.rpc.permissions.set(k, fc({ receiver_id: "other.testnet" }));
  if (kind === "low_allowance") b.rpc.permissions.set(k, fc({ allowance: "1" }));
  const keyFile = join(dir, "closer-key.json");
  writeFileSync(
    keyFile,
    JSON.stringify({ account_id: CLOSER, public_key: ck.id, private_key: ck.secret }),
  );
  const handover = {
    enabled: true,
    closer: { account: CLOSER, keys: [{ business_id: b.w.f.business, key_file: keyFile }] },
    interval_ms: 3_600_000,
    batch: 5,
    pass_budget_ms: 30_000,
    op_deadline_ms: 15_000,
    dispatch_margin_ms: 60_000,
    max_orders: 8,
    stop_timeout_ms: 5_000,
    min_allowance_yocto: "1000",
    ...(o.handover ?? {}),
  };
  return { sale, noah, ck, closerKeyId: k, handover };
}

export async function handoverWorld(o: HandoverWorldOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "handover-world-"));
  const b = await bootstrap(dir, 1, {
    interval_ms: 60_000,
    batch: 5,
    pass_budget_ms: 3_000,
    op_deadline_ms: 2_000,
    stop_timeout_ms: 5_000,
  });
  const { sale, noah, ck, closerKeyId: k, handover } = prepareHandover(b, dir, o);
  const composed = composeIn(b, { config: { handover } });
  const coordinator = composed.handover;
  if (!coordinator) throw new Error("handover world: the coordinator wasn't composed");
  const biz = b.w.f.business as string;
  const seller = appBrowser(composed.app);
  const buyer = appBrowser(composed.app);
  const cara = appBrowser(composed.app);
  await signInAs(seller, FOUNDER, b.ava);
  await signInAs(buyer, BUYER, noah);
  await signInAs(cara, CUSTOMER, b.cara);

  /** One wallet action through the real routes: preview, store, ask, the wallet, hash, check. */
  const act = async (
    call: Call,
    account: string,
    kind: string,
    input: Json = {},
    opt: { lose?: boolean } = {},
  ) => {
    const p = await call(`/api/sales/${biz}/prepare`, "POST", { kind, input });
    if (p.status !== 200) return { p, created: null, outcome: null, check: null };
    const c = await call(`/api/sales/${biz}/actions`, "POST", {
      kind,
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: `handover-${kind}-${Math.random().toString(36).slice(2, 10)}`,
    });
    if (c.status !== 201) return { p, created: c, outcome: null, check: null };
    const a = c.body.action as Json;
    await call(`/api/sales/actions/${a.id}/requested`, "POST", {});
    const outcome = b.w.chain.walletCall(account, a.call);
    if (!opt.lose)
      await call(`/api/sales/actions/${a.id}/requested`, "POST", {
        tx_hash: outcome.transaction.hash,
      });
    const check = opt.lose ? null : await call(`/api/sales/actions/${a.id}/check`, "POST", {});
    return { p, created: c, action: a, outcome, check };
  };

  const terms = (over: Json = {}) => ({
    buyer_account: BUYER,
    price: PRICE,
    expires_in_days: 7,
    available_floor: "0",
    grants: [{ account: OP, caps: 1 }],
    exclusions: [],
    note: "",
    close_window_minutes: 30,
    ...over,
  });

  /** Proposed, registered, funded and accepted by the buyer: the seller's acceptance closes in. */
  const toBuyerAccepted = async (over: Json = {}) => {
    const proposed = await act(seller, FOUNDER, "propose", terms(over));
    if (proposed.check?.body.resolution?.kind !== "confirmed")
      throw new Error(`propose: ${JSON.stringify(proposed.p.body ?? proposed.created?.body)}`);
    for (const k of ["register", "fund", "accept"]) {
      const r = await act(buyer, BUYER, k);
      if (r.check?.body.resolution?.kind !== "confirmed")
        throw new Error(`${k}: ${JSON.stringify(r.check?.body ?? r.created?.body ?? r.p.body)}`);
    }
  };

  const handoverRow = () => {
    const d = openDb(b.db);
    try {
      return d
        .prepare(
          "SELECT * FROM business_handovers WHERE business_id = ? ORDER BY created_ms DESC LIMIT 1",
        )
        .get(biz) as Json | undefined;
    } finally {
      d.close();
    }
  };
  const rows = (sql: string, ...args: (string | number)[]) => {
    const d = openDb(b.db);
    try {
      return d.prepare(sql).all(...args) as Json[];
    } finally {
      d.close();
    }
  };

  const cleanup = async () => {
    await composed.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return {
    b,
    sale,
    biz,
    composed,
    coordinator,
    seller,
    buyer,
    cara,
    act,
    terms,
    toBuyerAccepted,
    handoverRow,
    rows,
    cleanup,
    closerKey: ck,
    closerKeyId: k,
    /** The buyer's sign-in key and the handover config, for a restarted composition. */
    noah,
    handoverConfig: handover,
  };
}

export type HandoverWorld = Awaited<ReturnType<typeof handoverWorld>>;
