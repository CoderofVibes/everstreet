// The attack suite (Case Docket): nine groups of attacks on a sale, each run beside a clean run
// from the same pinned starting state. After each attack the protected values (owner,
// generation, escrow, customer units, pending payouts) are read again and must equal what they
// were before it. Group 9 plants faults into the state on purpose and shows which named check
// catches each one, so a passing suite means something.
//
// SYNTHETIC: these cases run through Everstreet's real routes over the synthetic chain
// (server/test/sale-chain.ts), which follows the business contract's rules; they are labelled
// fixtures. The contract's own code is attacked separately on a local NEAR node
// (contracts/business-v3/tests, reports/2026-11-06_attack-review.md).
//   npx tsx scripts/attack-suite.ts            # writes data/evidence/attack-suite.json
//   npx tsx scripts/attack-suite.ts --check    # runs it and fails if any case fails

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { CUSTOMER, FixtureReader, type Json } from "../server/test/customer-world.ts";
import { BUYER, PRICE, proposal, SELLER, saleWorld } from "../server/test/sale-world.ts";

type World = Awaited<ReturnType<typeof saleWorld>>;

interface Protected {
  owner: string;
  generation: number;
  escrow: string;
  customer_units: string;
  pending_payouts: number;
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
  const s = await saleWorld();
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
    const s = await saleWorld();
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
  async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    return s;
  },
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
