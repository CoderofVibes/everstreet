// The attack suite (Case Docket): nine groups of attacks on a sale and its companions (the
// external feed and the supplier allowance), each run beside a clean run from the same pinned
// starting state. After each attack the protected values (owner, generation, escrow, customer
// units, pending payouts, the feed's controller, the supplier budget) are read again and must
// equal what they were before it. Group 9 plants faults into the state on purpose and shows which named check
// catches each one, so a passing suite means something.
//
// SYNTHETIC: these cases run through Everstreet's real routes over the synthetic chain
// (server/test/sale-chain.ts), which follows the business contract's rules; they are labelled
// fixtures. The contract's own code is attacked separately on a local NEAR node
// (contracts/business-v3/tests, reports/2026-11-06_attack-review.md).
//   npx tsx scripts/attack-suite.ts            # writes data/evidence/attack-suite.json
//   npx tsx scripts/attack-suite.ts --check    # runs it and fails if any case fails

import { execFileSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { nep413Digest } from "../server/src/identity.ts";
import { intentMessage, versionedNonce } from "../server/src/intentsFunding.ts";
import { toB58 } from "../server/src/lightClient.ts";
import { attachCompanions, signerOf, testAddress } from "../server/test/companion-chain.ts";
import { CUSTOMER, FixtureReader, type Json } from "../server/test/customer-world.ts";
import { ALT_TOKEN, attachIntents, VERIFIER } from "../server/test/intents-chain.ts";
import { BUYER, PRICE, proposal, SELLER, saleWorld } from "../server/test/sale-world.ts";

type World = Awaited<ReturnType<typeof saleWorld>>;
type Companions = ReturnType<typeof attachCompanions>;

const FEED = "feed.synthetic.near";
const BUDGET = "budget.synthetic.near";
const AGENT = "agent.synthetic.near";
const SUPPLIER = "larchmere.synthetic.near";
/** An EVM address the former seller controls outside the business (fictional). */
const SELLER_EVM = `0x${"5e11e7".repeat(6)}5e11`;
/** Each world's companions (the external feed and the supplier allowance). */
const companionsOf = new WeakMap<World, Companions>();
const co = (s: World) => companionsOf.get(s) as Companions;
type Intents = ReturnType<typeof attachIntents> & { buyerKey: KeyObject; buyerPk: string };
/** Each world's intents verifier, second token and solver (escrow funding from another token). */
const intentsOf = new WeakMap<World, Intents>();
const ix = (s: World) => intentsOf.get(s) as Intents;

/** A sale world with both companions: the feed at generation 1's address, a granted budget. */
async function world(grant: { per_payment?: string; per_period?: string } = {}) {
  const s = await saleWorld();
  const c = attachCompanions(
    s.w.chain,
    s.BUSINESS,
    () => {
      const v = s.sale.controlView() as Json;
      return {
        owner: String(v.owner),
        generation: Number(v.generation),
        control_seq: String(v.control_seq),
      };
    },
    { asset: FEED, allowance: BUDGET, token: s.TOKEN },
  );
  c.allowance.fund(60_000_000n);
  c.allowance.walletCall(SELLER, {
    methodName: "grant",
    args: {
      agent: AGENT,
      suppliers: [SUPPLIER],
      per_payment: grant.per_payment ?? "2000000",
      per_period: grant.per_period ?? "60000000",
      period_ms: "604800000",
      review_above: "5000000",
    },
    gas: "1",
    deposit: "0",
  });
  companionsOf.set(s, c);
  const chain = s.w.chain as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
  };
  const x = attachIntents(
    s.w.chain,
    { token: s.TOKEN, ledger: { balances: chain.balances, registered: chain.tokenRegistered } },
    1_000_000_000n,
  );
  x.alt.ledger.balances.set(BUYER, 400_000_000n);
  x.alt.ledger.registered.add(BUYER);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  intentsOf.set(s, {
    ...x,
    buyerKey: privateKey,
    buyerPk: `ed25519:${toB58(Uint8Array.from(raw))}`,
  });
  s.w.state.app = s.w.make(s.w.state.store, undefined, {
    customer: s.w.options(),
    intents: {
      bindings: [
        {
          business_id: s.biz,
          network: "testnet",
          account: s.BUSINESS,
          asset: s.TOKEN,
          verifier: VERIFIER,
          offers: [{ token: ALT_TOKEN, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" }],
        },
      ],
      solver: x.solver,
    },
  });
  return s;
}

interface Protected {
  owner: string;
  generation: number;
  escrow: string;
  customer_units: string;
  pending_payouts: number;
  /** The external feed's controller (an EVM address on the registry). */
  feed_controller: string;
  /** The supplier budget held by the allowance companion. */
  supplier_budget: string;
  /** Every balance held inside the intents verifier (the buyer's deposit, the solver's float). */
  verifier_balances: string;
}

interface Case {
  group: number;
  name: string;
  clean: { what: string; result: string };
  attack: { what: string; refusal: string };
  protected: { before: Protected; after: Protected };
  unchanged: boolean;
  passed: boolean;
}

const protectedOf = (s: World): Protected => {
  const c = s.control();
  const d = c.live_deal as Json | null;
  return {
    owner: String(c.owner),
    generation: Number(c.generation),
    escrow: d ? String(d.escrow) : "0",
    customer_units: String((s.w.chain.ent(CUSTOMER) as Json)?.free ?? "0"),
    pending_payouts: (s.sale.pendingView() as Json[]).length,
    feed_controller: co(s).registry.controller,
    supplier_budget: String(co(s).allowance.balance),
    verifier_balances: JSON.stringify(
      [...ix(s).verifier.inside].map(([a, m]) => [a, [...m].map(([k, v]) => [k, String(v)])]),
    ),
  };
};
const same = (a: Protected, b: Protected) => JSON.stringify(a) === JSON.stringify(b);

/** The contract's error code from a refused wallet transaction (its failed receipt). */
const refusalOf = (out: Json): string | null => {
  const text = JSON.stringify(out);
  return /Smart contract panicked: (E_[A-Z_]+)/.exec(text)?.[1] ?? null;
};

/** A proposed and funded sale (the pinned start for most cases). */
async function funded() {
  const s = await world();
  await s.act(s.ava, SELLER, "propose", proposal());
  await s.act(s.noah, BUYER, "register");
  await s.act(s.noah, BUYER, "fund");
  return s;
}
/** A closed sale: the buyer accepted, then the seller's acceptance closed it. */
async function closed() {
  const s = await funded();
  await s.act(s.noah, BUYER, "accept");
  await s.act(s.ava, SELLER, "accept");
  return s;
}

const cases: Case[] = [];
const failures: string[] = [];

async function pair(
  group: number,
  name: string,
  start: () => Promise<World>,
  clean: (s: World) => Promise<{ what: string; result: string }>,
  attack: (s: World) => Promise<{ what: string; refusal: string | null }>,
  /**
   * For an attack whose legitimate effect does land (a lost answer for a request that did go
   * through): the protected values must show it exactly once instead of not at all.
   */
  exactlyOnce?: (before: Protected, after: Protected) => boolean,
) {
  const c = await clean(await start());
  const s = await start();
  const before = protectedOf(s);
  const a = await attack(s);
  const after = protectedOf(s);
  const unchanged = exactlyOnce ? exactlyOnce(before, after) : same(before, after);
  const passed = unchanged && a.refusal !== null;
  if (!passed) failures.push(`${group} · ${name}`);
  cases.push({
    group,
    name,
    clean: c,
    attack: { what: a.what, refusal: a.refusal ?? "NOT REFUSED" },
    protected: { before, after },
    unchanged,
    passed,
  });
}

/** The live deal's exact accept call, as the app prepares it. */
const acceptCall = async (s: World, who: World["noah"]) =>
  (await s.prepare(who, "accept")).body.call as Json;

// ---------- 1. Changed terms and stale seller ----------
await pair(
  1,
  "Acceptance of changed terms",
  funded,
  async (s) => {
    const r = await s.act(s.noah, BUYER, "accept");
    return { what: "Buyer accepts the exact terms", result: r.check?.body.resolution.result };
  },
  async (s) => {
    const call = await acceptCall(s, s.noah);
    const d = String(call.args.digest);
    call.args.digest = `${d.slice(0, -1)}${d.endsWith("0") ? "1" : "0"}`;
    return {
      what: "Buyer accepts a digest with one character changed",
      refusal: refusalOf(s.wallet(BUYER, call)),
    };
  },
);
await pair(
  1,
  "Former seller acts as owner",
  closed,
  async (s) => {
    // The same owner action, signed by the new owner: allowed.
    const call = (await s.prepare(s.ava, "owner_probe")).body.call as Json;
    const out = s.wallet(BUYER, call);
    return {
      what: "New owner sends the same owner action",
      result: refusalOf(out) ?? "allowed",
    };
  },
  async (s) => {
    const r = await s.act(s.ava, SELLER, "owner_probe");
    return {
      what: "Former seller's wallet asks to appoint itself after the close",
      refusal: r.check?.body.resolution.reason ?? null,
    };
  },
);
await pair(
  1,
  "Replayed acceptance",
  async () => {
    const s = await funded();
    await s.act(s.noah, BUYER, "accept");
    return s;
  },
  async (s) => {
    const r = await s.act(s.ava, SELLER, "accept");
    return { what: "Seller accepts once", result: r.check?.body.resolution.result };
  },
  async (s) => {
    const call = (
      s.w.state.store.db
        .prepare("SELECT call FROM sale_actions WHERE kind = 'accept' AND account = ?")
        .get(BUYER) as { call: string }
    ).call;
    return {
      what: "Buyer's acceptance sent a second time",
      refusal: refusalOf(s.wallet(BUYER, JSON.parse(call))),
    };
  },
);

// ---------- 2. Dropped response or misleading success ----------
await pair(
  2,
  "Wallet answer lost",
  async () => {
    const s = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    return s;
  },
  async (s) => {
    const r = await s.act(s.noah, BUYER, "fund");
    return { what: "Buyer funds escrow", result: r.check?.body.resolution.result };
  },
  async (s) => {
    // The funding lands but its answer is lost: the app never claims it, and a fresh request
    // for the same funding can't be made (nothing is funded twice).
    const r = await s.act(s.noah, BUYER, "fund", {}, { lose: true });
    const again = await s.prepare(s.noah, "fund");
    return {
      what: "Funding lands but the wallet's answer is lost; the buyer tries to fund again",
      refusal:
        r.action && again.status !== 200
          ? `Not claimed until its own transaction shows it · ${again.body.code}`
          : null,
    };
  },
  (before, after) => before.escrow === "0" && after.escrow === PRICE,
);
await pair(
  2,
  "Customer's settle answer lost",
  closed,
  async (s) => {
    const r = await s.customerUse();
    return { what: "Customer's use settles", result: `one unit ${r.unit}` };
  },
  async (s) => {
    s.w.writer.unitModes.push("lose_reply");
    const r = await s.customerUse();
    return {
      what: "The operator's settle lands but its answer is lost; it is retried",
      refusal: r.unit === "charged" ? "Charged exactly once" : null,
    };
  },
  (before, after) =>
    BigInt(before.customer_units) - BigInt(after.customer_units) === 1n &&
    before.owner === after.owner &&
    before.escrow === after.escrow,
);

// ---------- 3. Old write admitted before the close ----------
await pair(
  3,
  "New customer hold while closing",
  async () => {
    const s = await funded();
    s.sale.closeMode = "gated";
    (s.sale as unknown as { closer: string }).closer = "closer.near";
    return s;
  },
  async (s) => {
    const r = await s.customerUse();
    return { what: "Customer's use before the closing starts", result: `one unit ${r.unit}` };
  },
  async (s) => {
    // Both accept on the contract: a Gated deal enters Closing; a new hold must be refused.
    // accept_sale takes the same arguments from either party.
    const call = await acceptCall(s, s.noah);
    s.wallet(BUYER, call);
    s.wallet(SELLER, call);
    const r = await s.customerUse();
    return {
      what: "Customer's new use arrives after both accepted, before the closer closes",
      refusal:
        r.unit === "charged" ? null : `New holds refused while closing · ${r.code ?? r.unit}`,
    };
  },
);
// Entering Closing moves the deal's state (not a protected value); escrow and units hold.

// ---------- 4. Signed before the change ----------
await pair(
  4,
  "Acceptance signed before a revision",
  funded,
  async (s) => {
    const r = await s.act(s.noah, BUYER, "accept");
    return { what: "Buyer accepts the current version", result: r.check?.body.resolution.result };
  },
  async (s) => {
    const old = await acceptCall(s, s.noah);
    await s.act(s.ava, SELLER, "revise", { ...proposal() });
    return {
      what: "Buyer's acceptance prepared for version 1, sent after the seller revised",
      refusal: refusalOf(s.wallet(BUYER, old)),
    };
  },
);

// ---------- 5. Poisoned observation ----------
/** The same world with a second provider over the same chain (it can misreport the owner). */
const withSecond = (s: World) => {
  const second = new FixtureReader(s.w.chain);
  second.ceiling = 10_000;
  s.w.state.app = s.w.make(s.w.state.store, undefined, {
    customer: {
      ...s.w.options(),
      proof: { source: "synthetic", second: { name: "Provider B", reader: second } },
    },
  });
  return second;
};
await pair(
  5,
  "Provider reports another owner",
  closed,
  async (s) => {
    withSecond(s);
    const r = await s.noah(`/api/sales/${s.biz}/proof`);
    return { what: "Two providers agree at the same block", result: r.body.agreement.status };
  },
  async (s) => {
    withSecond(s).disagreeOwner = "someone-else.testnet";
    const r = await s.noah(`/api/sales/${s.biz}/proof`);
    const owner = (
      s.w.state.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(s.biz) as {
        owner_id: string;
      }
    ).owner_id;
    return {
      what: "The second provider reports a different owner at the same block",
      refusal:
        r.body.agreement.status === "uncertain" && owner === s.noah.id
          ? "Uncertain · ownership record unchanged"
          : null,
    };
  },
);
await pair(
  5,
  "Answers from mixed blocks",
  funded,
  async (s) => {
    const r = await s.setup(s.noah);
    return { what: "A coherent read at one block", result: `read at block ${r.body.block.height}` };
  },
  async (s) => {
    s.w.reader.mixNext = true;
    const r = await s.setup(s.noah);
    return {
      what: "One view answers from a different block than the rest",
      refusal: r.status === 503 ? `Read refused · ${r.body.code}` : null,
    };
  },
);

// ---------- 6. Quote or signer substitution ----------
await pair(
  6,
  "Request changed after review",
  funded,
  async (s) => {
    const r = await s.act(s.ava, SELLER, "revise", proposal());
    return {
      what: "The seller's revision is stored and sent exactly as reviewed",
      result: r.check?.body.resolution.result,
    };
  },
  async (s) => {
    const p = await s.prepare(s.ava, "revise", proposal());
    const c = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "revise",
      input: { ...p.body.input, price: "1000000" },
      action_digest: p.body.action_digest,
      idempotency_key: "attack-changed-after-review",
    });
    return {
      what: "The seller's revision is changed to a lower price after review, keeping the old review digest",
      refusal: c.status === 409 ? String(c.body.code) : null,
    };
  },
);
await pair(
  6,
  "Signed by another account",
  funded,
  async (s) => {
    const r = await s.act(s.noah, BUYER, "accept");
    return {
      what: "The buyer signs the buyer's acceptance",
      result: r.check?.body.resolution.result,
    };
  },
  async (s) => {
    const call = await acceptCall(s, s.noah);
    return {
      what: "Another account signs the buyer's exact acceptance",
      refusal: refusalOf(s.wallet("stranger.near", call)),
    };
  },
);

// ---------- 7. Shared-cap race and storage pressure ----------
await pair(
  7,
  "One request asked twice",
  funded,
  async (s) => {
    const r = await s.act(s.noah, BUYER, "accept");
    return { what: "One wallet ask for one request", result: r.check?.body.resolution.result };
  },
  async (s) => {
    const p = await s.prepare(s.noah, "accept");
    const c = await s.noah(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "accept",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "attack-two-tabs",
    });
    const id = c.body.action.id as string;
    const [a, b] = await Promise.all([
      s.noah(`/api/sales/actions/${id}/requested`, "POST", {}),
      s.noah(`/api/sales/actions/${id}/requested`, "POST", {}),
    ]);
    const asks = [a.body.ask, b.body.ask].sort();
    return {
      what: "Two tabs ask the wallet for the same request at once",
      refusal: asks.join(",") === "already_asked,granted" ? "One winner · already_asked" : null,
    };
  },
);
await pair(
  7,
  "Escrow beyond the price",
  funded,
  async (s) => {
    const r = await s.setup(s.noah);
    return {
      what: "Escrow holds exactly the price",
      result: (r.body.control.live_deal as Json).escrow,
    };
  },
  async (s) => {
    const p = await s.prepare(s.noah, "fund");
    return {
      what: "The buyer tries to fund the same deal again",
      refusal: p.status === 409 ? String(p.body.code) : null,
    };
  },
);

// ---------- 8. Evidence substitution ----------
await pair(
  8,
  "Another transaction's ID",
  funded,
  async (s) => {
    const r = await s.act(s.noah, BUYER, "accept");
    return {
      what: "A request is confirmed by its own transaction",
      result: r.check?.body.resolution.result,
    };
  },
  async (s) => {
    const other = s.w.state.store.db
      .prepare("SELECT tx_hash FROM sale_actions WHERE kind = 'fund' AND tx_hash IS NOT NULL")
      .get() as { tx_hash: string };
    const r = await s.act(s.noah, BUYER, "accept", {}, { send: false });
    const id = r.action?.id as string;
    const check = await s.noah(`/api/sales/actions/${id}/check`, "POST", {
      tx_hash: other.tx_hash,
    });
    return {
      what: "The buyer's acceptance is checked with the funding transaction's ID",
      refusal:
        check.body.transaction?.matched === false || check.body.action?.state !== "confirmed"
          ? "Not this request's transaction · not recorded"
          : null,
    };
  },
);
await pair(
  8,
  "Former owner reads customer data",
  closed,
  async (s) => {
    const r = await s.setup(s.noah);
    return {
      what: "The new owner sees customer obligations",
      result: r.body.customer_obligations ? "shown" : "hidden",
    };
  },
  async (s) => {
    const r = await s.setup(s.ava);
    const p = await s.ava(`/api/sales/${s.biz}/proof`);
    const leaks =
      JSON.stringify(r.body).includes(CUSTOMER) || JSON.stringify(p.body).includes(CUSTOMER);
    return {
      what: "The former seller reads the sale page and the proof after the close",
      refusal:
        !leaks && r.body.customer_obligations === null ? "Counts only · no customer named" : null,
    };
  },
);

// ---------- Companions: the external feed and the supplier allowance ----------

/** One request to the feed companion; its answer (signed, or refused with a code). */
function feedRequest(s: World, signer: string, action: Json, nonce: number) {
  const out = co(s).asset.walletCall(signer, {
    methodName: "request",
    args: {
      action,
      tx: {
        nonce: String(nonce),
        gas_limit: "80000",
        max_fee_per_gas: "3000000000",
        max_priority_fee_per_gas: "1000000000",
      },
    },
    gas: "1",
    deposit: "1",
  });
  const v = (out.status as Json).SuccessValue;
  return v
    ? (JSON.parse(Buffer.from(String(v), "base64").toString()) as Json)
    : { refused: refusalOf(out) };
}
/** Relays a signed feed answer to the registry and lets it become final. */
function relay(s: World, answer: Json, action: Json, nonce: number) {
  const from = signerOf(
    Uint8Array.from(Buffer.from(String(answer.payload), "hex")),
    answer.signature,
  );
  const hash = `0x${String(answer.payload)}`;
  co(s).registry.submit(hash, from, nonce, action as never);
  co(s).registry.mine(3);
  return co(s).registry.statusOf(hash);
}
/** The allowance's answer to one agent payment: a refusal code, or null if it went through. */
function payRefusal(s: World, supplier: string, amount: bigint, invoice: string) {
  try {
    const r = co(s).allowance.pay(AGENT, supplier, amount, invoice);
    return r.value.startsWith("E_") ? r.value : null;
  } catch (e) {
    return /^(E_[A-Z_]+)/.exec((e as Error).message)?.[1] ?? null;
  }
}
const gen = (n: number) => testAddress(FEED, `gen-${n}`);
const inv = (i: number) => i.toString(16).padStart(2, "0").repeat(32);
await pair(
  1,
  "Former seller asks for the feed role",
  closed,
  async (s) => {
    const move = { kind: "set_controller", to: gen(2), from_generation: 1 };
    const a = feedRequest(s, BUYER, move, 0);
    return { what: "New owner moves the feed role to their address", result: relay(s, a, move, 0) };
  },
  async (s) => {
    const a = feedRequest(
      s,
      SELLER,
      { kind: "set_controller", to: SELLER_EVM, from_generation: 1 },
      0,
    );
    return {
      what: "Former seller asks the feed companion to sign the role over to an address of theirs",
      refusal: a.refused ? String(a.refused) : null,
    };
  },
);

/** Held between the start and the attack: the seller's publish signed before the close. */
const held = new WeakMap<World, { answer: Json; action: Json }>();
await pair(
  4,
  "Feed signature from before the close",
  async () => {
    const s = await funded();
    const action = { kind: "publish", digest: "22".repeat(32) };
    held.set(s, { answer: feedRequest(s, SELLER, action, 0), action });
    await s.act(s.noah, BUYER, "accept");
    await s.act(s.ava, SELLER, "accept");
    const move = { kind: "set_controller", to: gen(2), from_generation: 1 };
    relay(s, feedRequest(s, BUYER, move, 0), move, 0);
    return s;
  },
  async (s) => {
    const action = { kind: "publish", digest: "44".repeat(32) };
    return {
      what: "The buyer publishes from generation 2's address",
      result: relay(s, feedRequest(s, BUYER, action, 0), action, 0),
    };
  },
  async (s) => {
    const h = held.get(s) as { answer: Json; action: Json };
    const status = relay(s, h.answer, h.action, 1);
    return {
      what: "A publish the seller signed before the close is sent after the role moved",
      refusal: status === "failed" ? "Registry: not controller" : null,
    };
  },
);

await pair(
  3,
  "Supplier payment after the close",
  closed,
  async (s) => {
    const w = await world();
    const r = payRefusal(w, SUPPLIER, 900_000n, inv(1));
    void s;
    return { what: "Agent pays the supplier before any sale", result: r ?? "paid" };
  },
  async (s) => ({
    what: "Agent pays the supplier under the seller's grant after the business changed hands",
    refusal: payRefusal(s, SUPPLIER, 900_000n, inv(2)),
  }),
);

await pair(
  6,
  "Invoice from a supplier not allowed",
  funded,
  async (s) => ({
    what: "Agent pays the allowed supplier",
    result: payRefusal(s, SUPPLIER, 900_000n, inv(3)) ?? "paid",
  }),
  async (s) => ({
    what: "Agent is given an invoice from another payee",
    refusal: payRefusal(s, "invoice-forger.near", 900_000n, inv(4)),
  }),
);

await pair(
  6,
  "Invoice paid twice",
  async () => {
    const s = await funded();
    payRefusal(s, SUPPLIER, 900_000n, inv(5));
    return s;
  },
  async (s) => ({
    what: "Agent pays a new invoice",
    result: payRefusal(s, SUPPLIER, 900_000n, inv(6)) ?? "paid",
  }),
  async (s) => ({
    what: "The same invoice is submitted again",
    refusal: payRefusal(s, SUPPLIER, 900_000n, inv(5)),
  }),
);

await pair(
  7,
  "The last of the period's cap, asked for twice",
  async () => {
    const s = await world({ per_period: "3000000" });
    payRefusal(s, SUPPLIER, 2_000_000n, inv(7));
    payRefusal(s, SUPPLIER, 1_000_000n, inv(8));
    return s;
  },
  async () => {
    const s = await world({ per_period: "3000000" });
    payRefusal(s, SUPPLIER, 2_000_000n, inv(7));
    return {
      what: "The last 1 TUSD of a 3 TUSD period is paid once",
      result: payRefusal(s, SUPPLIER, 1_000_000n, inv(8)) ?? "paid",
    };
  },
  async (s) => ({
    what: "A second payment asks for the same last 1 TUSD",
    refusal: payRefusal(s, SUPPLIER, 1_000_000n, inv(9)),
  }),
);

// ---------- Escrow funding from another token: the intents verifier and the solver ----------

const GIVE = (BigInt(PRICE) * 5n) / 4n;
/** One side of a swap, signed with the buyer's own key or the solver's. */
function side(
  s: World,
  o: { signer: string; give: [string, bigint]; get: [string, bigint]; key: "buyer" | "solver" },
) {
  const deadline = Date.now() + 120_000;
  const nonce = versionedNonce(ix(s).verifier.salt, deadline);
  const message = intentMessage({
    signer: o.signer,
    deadlineMs: deadline,
    give: { token: o.give[0], amount: String(o.give[1]) },
    get: { token: o.get[0], amount: String(o.get[1]) },
  });
  const digest = nep413Digest({ message, nonce, recipient: VERIFIER });
  const signature =
    o.key === "buyer" ? sign(null, digest, ix(s).buyerKey) : ix(s).solver.sign(digest);
  return {
    standard: "nep413",
    payload: { message, nonce: nonce.toString("base64"), recipient: VERIFIER },
    public_key: o.key === "buyer" ? ix(s).buyerPk : ix(s).solver.publicKey,
    signature: `ed25519:${toB58(Uint8Array.from(signature))}`,
  };
}
const buyerSide = (s: World) =>
  side(s, { signer: BUYER, give: [ALT_TOKEN, GIVE], get: [s.TOKEN, BigInt(PRICE)], key: "buyer" });
const solverSide = (s: World, pay = BigInt(PRICE)) =>
  side(s, {
    signer: ix(s).solver.account,
    give: [s.TOKEN, pay],
    get: [ALT_TOKEN, GIVE],
    key: "solver",
  });
/** The verifier's answer to one execute_intents: its refusal text, or null if it ran. */
function execute(s: World, signed: Json[]) {
  const out = ix(s).verifier.walletCall(ix(s).solver.account, {
    methodName: "execute_intents",
    args: { signed },
    gas: "1",
    deposit: "0",
  });
  return /Smart contract panicked: ([^"]+)/.exec(JSON.stringify(out.status))?.[1] ?? null;
}
const buyerCall = (s: World, receiverId: string, methodName: string, args: Json) =>
  s.wallet(BUYER, { receiverId, methodName, args, gas: "100000000000000", deposit: "1" });
/** A proposed, unfunded sale; the buyer's key registered and their tALT deposited. */
async function deposited() {
  const s = await world();
  await s.act(s.ava, SELLER, "propose", proposal());
  await s.act(s.noah, BUYER, "register");
  buyerCall(s, VERIFIER, "add_public_key", { public_key: ix(s).buyerPk });
  buyerCall(s, ALT_TOKEN, "ft_transfer_call", {
    receiver_id: VERIFIER,
    amount: String(GIVE),
    msg: "",
  });
  return s;
}
const heldSwap = new WeakMap<World, Json[]>();

await pair(
  6,
  "Solver signs the buyer's side",
  deposited,
  async (s) => ({
    what: "Buyer and solver each sign their own side; the verifier swaps",
    result: execute(s, [buyerSide(s), solverSide(s)]) ?? "swapped",
  }),
  async (s) => {
    const forged = side(s, {
      signer: BUYER,
      give: [ALT_TOKEN, GIVE],
      get: [s.TOKEN, 1n],
      key: "solver",
    });
    const e = execute(s, [forged, solverSide(s, 1n)]);
    return {
      what: "The solver signs a side as the buyer, giving the buyer 1 base unit of tUSD",
      refusal: e?.includes("doesn't exist for account") ? "Verifier: not the buyer's key" : null,
    };
  },
);
await pair(
  6,
  "Fill smaller than the quote",
  deposited,
  async (s) => ({
    what: "The solver pays exactly the quoted tUSD",
    result: execute(s, [buyerSide(s), solverSide(s)]) ?? "swapped",
  }),
  async (s) => {
    const e = execute(s, [buyerSide(s), solverSide(s, BigInt(PRICE) - 1_000_000n)]);
    return {
      what: "The solver's side pays 1 tUSD less than the buyer signed for",
      refusal: e?.includes("invariant") ? "Verifier: the sides don't balance" : null,
    };
  },
);
await pair(
  2,
  "A filled swap sent again",
  async () => {
    const s = await deposited();
    const signed = [buyerSide(s), solverSide(s)];
    execute(s, signed);
    heldSwap.set(s, signed);
    return s;
  },
  async (s) => {
    const nonce = ((heldSwap.get(s) as Json[])[0] as Json).payload.nonce;
    const used = ix(s).verifier.view("is_nonce_used", { account_id: BUYER, nonce });
    return {
      what: "After a lost response, the verifier is asked whether the buyer's nonce is spent",
      result: used === "true" ? "spent: the swap happened once" : "not spent",
    };
  },
  async (s) => {
    const e = execute(s, heldSwap.get(s) as Json[]);
    return {
      what: "The same signed pair is submitted a second time",
      refusal: e?.includes("nonce was already used") ? "Verifier: nonce already used" : null,
    };
  },
);
await pair(
  2,
  "Delivered shown as funded",
  async () => {
    const s = await deposited();
    const q = await s.noah(`/api/sales/${s.biz}/intents/quote`, "POST", { token: ALT_TOKEN });
    const digest = nep413Digest({
      message: q.body.sign.message,
      nonce: Buffer.from(q.body.sign.nonce, "base64"),
      recipient: VERIFIER,
    });
    await s.noah(`/api/intents/${q.body.id}/sign`, "POST", {
      public_key: ix(s).buyerPk,
      signature: sign(null, digest, ix(s).buyerKey).toString("base64"),
      callback_url: null,
    });
    buyerCall(s, VERIFIER, "ft_withdraw", { token: s.TOKEN, receiver_id: BUYER, amount: PRICE });
    return s;
  },
  async (s) => {
    await s.act(s.noah, BUYER, "fund");
    const f = await s.noah(`/api/sales/${s.biz}/intents`);
    const escrow = String((s.control().live_deal as Json).escrow);
    return {
      what: "The buyer funds escrow with the existing request",
      result: `${f.body.funding.stage} · escrow ${escrow}`,
    };
  },
  async (s) => {
    const f = await s.noah(`/api/sales/${s.biz}/intents`);
    const escrow = String((s.control().live_deal as Json).escrow);
    return {
      what: "The swapped tUSD is in the buyer's account; the app is asked whether escrow is funded",
      refusal:
        f.body.funding?.stage === "delivered" && escrow === "0"
          ? "Not funded until the business contract shows it"
          : null,
    };
  },
);

// ---------- 9. Faults planted in our own checks ----------
interface Planted {
  fault: string;
  invariant: string;
  caught: boolean;
}
const planted: Planted[] = [];
{
  const plant = async (fault: string, invariant: keyof Protected, apply: (s: World) => void) => {
    const s = await closed();
    const before = protectedOf(s);
    apply(s);
    const after = protectedOf(s);
    const caught = before[invariant] !== after[invariant];
    planted.push({ fault, invariant, caught });
    if (!caught) failures.push(`9 · ${fault}`);
  };
  await plant(
    "The generation guard removed: control moves without a matching close",
    "owner",
    (s) => {
      (s.sale as unknown as { owner: string }).owner = SELLER;
    },
  );
  await plant("A duplicate charge allowed", "customer_units", (s) => {
    const e = s.w.chain.ent(CUSTOMER) as Json;
    e.free = String(BigInt(e.free) - 1n);
  });
  await plant("A payout marked complete before its callback", "pending_payouts", (s) => {
    const v = s.sale.pendingView.bind(s.sale);
    s.sale.pendingView = () => [...v(), { planted: true } as never];
  });
  await plant("The feed role moved without the owner", "feed_controller", (s) => {
    co(s).registry.controller = SELLER_EVM.toLowerCase();
  });
  await plant("The generation number skipped", "generation", (s) => {
    (s.sale as unknown as { generation: number }).generation += 1;
  });
}

const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();
/** Whether the code it ran had changes beyond `commit` (results of uncommitted code say so). */
const uncommitted = (() => {
  try {
    return (
      execFileSync("git", ["status", "--porcelain", "--", "scripts", "server", "web/src"], {
        encoding: "utf8",
      }).trim() !== ""
    );
  } catch {
    return true;
  }
})();
const report = {
  format: "everstreet.attack-suite",
  version: 1,
  commit,
  uncommitted,
  source: "synthetic",
  label:
    "Fixture results: Everstreet's real routes over the synthetic chain, which follows the business contract's rules. Not the contract's own code.",
  groups: [
    "Changed terms and stale seller",
    "Dropped response or misleading success",
    "Old write admitted before close",
    "Signed before the change",
    "Poisoned observation",
    "Quote or signer substitution",
    "Shared-cap race and storage pressure",
    "Evidence substitution",
    "Faults planted in our checks",
  ].map((title, i) => ({ n: i + 1, title })),
  cases,
  planted,
  summary: {
    cases: cases.length,
    passed: cases.filter((c) => c.passed).length,
    planted: planted.length,
    caught: planted.filter((p) => p.caught).length,
    failures,
  },
};
if (!process.argv.includes("--check"))
  writeFileSync("data/evidence/attack-suite.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `${failures.length === 0 ? "OK" : "FAILED"}: ${report.summary.passed}/${cases.length} cases, ${report.summary.caught}/${planted.length} planted faults caught`,
);
for (const f of failures) console.log(`  failed: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
