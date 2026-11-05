// business-v3 testnet rehearsal, examples 2-4 (V3_TESTNET_APPROVAL_PACKET.md §2), written once
// against `Env` like example 1: dry-run locally against the synthetic chain, then live.
//   2. Gated close with work outstanding (a fresh business with a restricted closer).
//   3. Lost purchase response: the purchase lands; the app's readback answer is dropped (a
//      test-only relay / test-only cut, never production code); a recheck confirms it once.
//   4. Failed token payout: after a small Direct sale the seller prepares a proceeds claim, then
//      (the deliberate fault) unregisters from the token before signing; the transfer fails and
//      the contract restores the claim; the buyer can't take it; the seller registers again and
//      collects once; a replay pays nothing.

import type { Recorder } from "./evidence.ts";
import {
  buy,
  type DeviceKey,
  type Env,
  found,
  type Json,
  newDeviceKey,
  readAgain,
  StopRun,
  steps,
  type WalletCall,
} from "./journey.ts";

const ok = (r: { status: number; body: Json }, want: number | number[], what: string) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new StopRun(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const expect = (cond: boolean, what: string, detail?: unknown) => {
  if (!cond)
    throw new StopRun(
      `expected ${what}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`,
    );
};
const until = async <T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  what: string,
  ms: number,
) => {
  const end = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new StopRun(`timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 400)}`);
};
const ent = (v: Json) => v.entitlement as Json | null;

// ---------- example 2: Gated close with work outstanding ----------

export interface GatedContext {
  offer: string;
  key: DeviceKey;
  slot: number;
  probeKey: DeviceKey;
  probeSlot: number;
  /** Earlier requests whose unit outcome must be decided first (a resume). */
  pending?: string[];
  /** The next use number to prepare. */
  nextN: number;
  /**
   * A resume after the proposal: the use already reserved for the gate (kept as it is, never
   * re-decided first), and the earlier result to compare against.
   */
  reservedId?: string;
  firstUse?: string;
}

export async function runGated(
  env: Env,
  rec: Recorder,
  o: {
    settleWaitMs?: number;
    closeWaitMs?: number;
    keepKeys?: (k: { key: DeviceKey; probeKey: DeviceKey }) => void;
  } = {},
) {
  const s = steps(env, rec, o.settleWaitMs ?? 120_000);
  for (const w of ["founder", "customer", "buyer", "prober"] as const)
    await env.signIn(w, env.client(w));
  await rec.checkpoint("start", await env.views());
  const { offer } = await found(env, rec, s, "gated");
  const key = newDeviceKey();
  const probeKey = newDeviceKey();
  o.keepKeys?.({ key, probeKey });
  await buy(env, rec, s, { who: "customer", offer, units: 100, key, slot: 0, tag: "gated" });
  await buy(env, rec, s, { who: "prober", offer, units: 2, key: probeKey, slot: 0, tag: "gated" });
  return continueGated(
    env,
    rec,
    { offer, key, slot: 0, probeKey, probeSlot: 0, nextN: 1 },
    { ...o, signedIn: true },
  );
}

/**
 * From "bought" to the end: (after a resume, the earlier requests' outcomes first) uses until five
 * are consumed, one reserved and not run, the Gated sale, a request during the gate, the managed
 * close, the reservation returned, service under the buyer. Counts are taken from the chain at
 * acceptance and checked RELATIVE to it (a resumed run may have had a use released, not charged).
 */
export async function continueGated(
  env: Env,
  rec: Recorder,
  ctx: GatedContext,
  o: { settleWaitMs?: number; closeWaitMs?: number; signedIn?: boolean } = {},
) {
  const settleMs = o.settleWaitMs ?? 120_000;
  const s = steps(env, rec, settleMs);
  const { ava, cara, noah } = s;
  const probe = env.client("prober");
  if (!o.signedIn)
    for (const w of ["founder", "customer", "buyer", "prober"] as const)
      await env.signIn(w, env.client(w));
  const { id: biz } = env.business;
  const { offer, key, slot } = ctx;
  // A resume: each earlier request's unit is decided by the contract first (charged or returned).
  for (const id of (ctx.pending ?? []).filter((x) => x !== ctx.reservedId)) {
    const v = await until(
      async () => {
        await cara(`/api/customer/uses/${id}/units/reconcile`, "POST");
        return (await cara(`/api/customer/uses/${id}`)).body;
      },
      (x) => ["charged", "returned"].includes(String(x?.use?.units?.unit)),
      `request ${id} decided by the contract`,
      1_800_000,
    );
    rec.app("earlier_request_decided", {
      use: id,
      unit: v.use.units.unit,
      note:
        v.use.units.unit === "returned"
          ? "its charge never landed (the platform never re-sent it); the contract's deadline returned the unit: delivered, not charged"
          : "charged once",
    });
  }
  let n = ctx.nextN;
  const uses: string[] = [];
  while (!ctx.reservedId && ent(await env.views())?.consumed !== "5")
    uses.push(await s.serve(offer, n++, key, slot, "customer", "gated-use"));
  const firstUse =
    ctx.firstUse ??
    uses[0] ??
    ((await cara("/api/customer/requests/by-key/gated-use-00001")).body as Json).use?.id;
  const first = ok(await cara(`/api/customer/uses/${firstUse}/result`), 200, "an earlier result");
  // One use reserved, not run, when the seller accepts (a resume keeps the one already reserved).
  let reservedId = ctx.reservedId ?? "";
  if (!reservedId) {
    const prep = ok(
      await readAgain(() =>
        cara(`/api/customer/offers/${offer}/prepare`, "POST", {
          idempotency_key: `gated-use-${String(n).padStart(5, "0")}`,
          input: `Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (copy ${n})`,
          key_slot: slot,
        }),
      ),
      [200, 201],
      "prepare the reserved use",
    );
    n++;
    reservedId = prep.use.id as string;
    const e6 = prep.use.envelope as Json;
    const conf = ok(
      await cara(`/api/customer/uses/${reservedId}/confirm`, "POST", {
        envelope_digest: e6.envelope_digest,
        hold_signature: key.sign(e6.hold.message_hex),
        use_signature: key.sign(e6.use.message_hex),
      }),
      200,
      "confirm the reserved use",
    );
    if (conf.use?.state !== "reserved")
      await until(
        async () => (await cara(`/api/customer/uses/${reservedId}/reconcile`, "POST")).body,
        (v) => v.use?.state === "reserved",
        "the use reserved",
        settleMs,
      );
  }
  rec.app("reserved_not_run", { use: reservedId });
  const before = await env.views();
  await rec.checkpoint("reserved_before_close", before);
  const F = BigInt(ent(before)?.free ?? "0");
  const C = BigInt(ent(before)?.consumed ?? "0");
  expect(C === 5n && ent(before)?.hold_active === true, "five consumed and one held", ent(before));

  // The Gated sale; the seller's acceptance starts the managed close.
  const terms = {
    buyer_account: env.accounts.buyer,
    price: "50000000",
    expires_in_days: 7,
    available_floor: "0",
    grants: [{ account: env.operator, caps: 1 }],
    exclusions: ["The ledgerline.example domain and its DNS account"],
    note: "Fictional terms for the business-v3 Gated rehearsal.",
  };
  await s.act("founder", ava, "propose", terms, "gated-propose-01", { satisfiedBy: "deal_live" });
  await s.act("buyer", noah, "register", {}, "gated-register-0001", { satisfiedBy: "registered" });
  await s.act("buyer", noah, "fund", {}, "gated-fund-0001", { satisfiedBy: "funded" });
  await s.act("buyer", noah, "accept", {}, "gated-accept-0001", {
    satisfiedBy: "already_accepted",
  });
  await s.act("founder", ava, "accept", {}, "gated-close-00001");

  // While the gate is up: a fresh request by another customer is paused (no hold, no charge). If
  // the close had already finished, that is recorded as "window missed".
  const pr = await probe(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: "gated-probe-00001",
    input:
      "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (probe)",
    key_slot: ctx.probeSlot,
  });
  let probeOutcome: Json = { at: "prepare", status: pr.status, code: pr.body?.code ?? null };
  if (pr.status === 200 || pr.status === 201) {
    const pe = pr.body.use.envelope as Json;
    const pc = await probe(`/api/customer/uses/${pr.body.use.id}/confirm`, "POST", {
      envelope_digest: pe.envelope_digest,
      hold_signature: ctx.probeKey.sign(pe.hold.message_hex),
      use_signature: ctx.probeKey.sign(pe.use.message_hex),
    });
    probeOutcome = {
      at: "confirm",
      status: pc.status,
      code: pc.body?.code ?? null,
      state: pc.body?.use?.state ?? null,
    };
  }
  const paused =
    probeOutcome.code === "handover_pause" || probeOutcome.code === "handover_in_progress";
  rec.app("request_during_gate", {
    ...probeOutcome,
    result: paused
      ? "paused: no hold, no charge"
      : "window missed (the close had finished); the local suite keeps this assertion",
  });

  // The managed close: the buyer manages the business; the reservation is returned once.
  await until(
    async () => (await noah(`/api/sales/${biz}`)).body,
    (v) => v?.local_owner === true,
    "the buyer managing after the managed close",
    o.closeWaitMs ?? 900_000,
  );
  await until(
    async () => {
      await cara(`/api/customer/uses/${reservedId}/units/reconcile`, "POST");
      return (await cara(`/api/customer/uses/${reservedId}`)).body;
    },
    (v) => v?.use?.units?.unit === "returned",
    "the reserved unit returned",
    settleMs,
  );
  const after = await env.views();
  await rec.checkpoint("released_to_buyer", after);
  expect(after.control?.owner === env.accounts.buyer, "the buyer owns the business", after.control);
  expect(
    BigInt(ent(after)?.free ?? "-1") === F + 1n && BigInt(ent(after)?.consumed ?? "-1") === C,
    `${F + 1n} free / ${C} consumed under the buyer (the reservation back, nothing charged)`,
    ent(after),
  );
  const firstAfter = ok(await cara(`/api/customer/uses/${firstUse}/result`), 200, "result after");
  expect(JSON.stringify(firstAfter) === JSON.stringify(first), "the earlier result unchanged");
  const denied = await ava(`/api/product-projects/${env.business.project}/releases`, "POST", {});
  rec.app("old_owner_write_denied", { route: "POST releases", status: denied.status });
  expect(denied.status === 404 || denied.status === 403, "the former owner refused", denied.status);
  // Service under the buyer.
  await s.serve(offer, n, key, slot, "customer", "gated-use");
  const end = await env.views();
  await rec.checkpoint("next_use_under_buyer", end);
  expect(
    BigInt(ent(end)?.free ?? "-1") === F && BigInt(ent(end)?.consumed ?? "-1") === C + 1n,
    `${F} free / ${C + 1n} consumed`,
    ent(end),
  );
  const record = await noah(`/api/businesses/${biz}/handover-record`);
  rec.app("handover_record", {
    status: record.status,
    digests: record.body?.digests ?? null,
    receipt: record.body?.body?.receipt ?? record.body?.receipt ?? null,
  });
  return { offer, reserved: reservedId, probe: probeOutcome };
}

// ---------- examples 3 and 4: lost purchase response, then failed token payout ----------

export interface RecoveryEnv extends Env {
  /** Arms a one-time drop of the next transaction-status answer to the app. */
  relay: { arm: () => void; fired: () => boolean };
  /** The deliberate fault for example 4: the account unregisters from the token. */
  unregister: (who: "founder") => Promise<{ hash: string; ok: boolean; error?: string }>;
  /** The seller's party view and token balance (chain views). */
  seller: () => Promise<{ party: Json | null; balance: string; registered: boolean }>;
}

export async function runRecovery(
  env: RecoveryEnv,
  rec: Recorder,
  o: { settleWaitMs?: number; keepKey?: (k: DeviceKey) => void } = {},
) {
  const settleMs = o.settleWaitMs ?? 120_000;
  const s = steps(env, rec, settleMs);
  const { ava, cara, noah } = s;
  for (const w of ["founder", "customer", "buyer"] as const) await env.signIn(w, env.client(w));
  const { id: biz } = env.business;
  await rec.checkpoint("start", await env.views());
  const { offer } = await found(env, rec, s, "recovery");

  // ---- Example 3: the purchase lands; the app's readback answer is dropped; a recheck recovers.
  const key = newDeviceKey();
  o.keepKey?.(key);
  const before = await env.views();
  await buy(env, rec, s, {
    who: "customer",
    offer,
    units: 10,
    key,
    slot: 0,
    tag: "recovery",
    check: async (pid, hash) => {
      env.relay.arm();
      const lost = await cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: hash });
      rec.app("readback_answer_dropped", {
        fault: "test-only: one transaction-status answer to the app dropped",
        relay_fired: env.relay.fired(),
        app_status: lost.status,
        app_code: lost.body?.code ?? null,
        app_resolution: lost.body?.resolution ?? null,
        original_hash: hash,
      });
      expect(env.relay.fired(), "the relay to drop the readback answer");
      expect(
        lost.body?.resolution?.kind !== "confirmed",
        "the dropped readback not confirmed",
        lost.body,
      );
      // Recovery: the original hash, checked again (twice: the second must change nothing).
      const again = ok(
        await readAgain(() =>
          cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: hash }),
        ),
        200,
        "recheck",
      );
      const third = ok(
        await readAgain(() =>
          cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: hash }),
        ),
        200,
        "third check",
      );
      rec.app("recovered_with_original_hash", {
        second: again.resolution,
        third: third.resolution,
      });
      return again;
    },
  });
  const after = await env.views();
  await rec.checkpoint("recovered_purchase", after);
  expect(ent(after)?.free === "10", "exactly one entitlement increase (10)", ent(after));
  const paid =
    BigInt(before.tusd?.[env.accounts.customer] ?? "0") -
    BigInt(after.tusd?.[env.accounts.customer] ?? "0");
  expect(paid === 1_500_000n, "exactly one payment of 1.5 tUSD", paid.toString());
  const purchases = ok(await cara("/api/customer/purchases"), 200, "purchases").purchases as Json[];
  rec.app("purchases_listed", {
    count: purchases.length,
    states: purchases.map((p) => p.state ?? p.outcome ?? null),
  });

  // ---- Example 4: a small Direct sale, then the seller's proceeds payout fails and recovers.
  const terms = {
    buyer_account: env.accounts.buyer,
    price: "10000000",
    expires_in_days: 7,
    available_floor: "0",
    grants: [{ account: env.operator, caps: 1 }],
    exclusions: ["The ledgerline.example domain and its DNS account"],
    note: "Fictional terms for the business-v3 payout-recovery rehearsal.",
  };
  await s.act("founder", ava, "propose", terms, "recovery-propose-01");
  await s.act("buyer", noah, "register", {}, "recovery-register-0001", {
    satisfiedBy: "registered",
  });
  await s.act("buyer", noah, "fund", {}, "recovery-fund-0001", { satisfiedBy: "funded" });
  await s.act("buyer", noah, "accept", {}, "recovery-accept-0001", {
    satisfiedBy: "already_accepted",
  });
  const close = await s.act("founder", ava, "accept", {}, "recovery-close-001");
  expect(close?.resolution?.result === "closed", "the small sale closed", close?.resolution);
  await rec.checkpoint("small_sale_closed", await env.views());
  const s0 = await env.seller();
  const owed = (s0.party?.sale_proceeds_claim as string | undefined) ?? "0";
  expect(owed !== "0", "the seller is owed sale proceeds", s0.party);
  rec.app("seller_owed", {
    sale_proceeds_claim: owed,
    registered: s0.registered,
    balance: s0.balance,
  });

  // The seller registers with the token (an ordinary app action), and the app prepares the claim.
  await s.act("founder", ava, "register", {}, "recovery-seller-register-01", {
    satisfiedBy: "registered",
  });
  const claimAction = async (key: string) => {
    const p = ok(
      await readAgain(() =>
        ava(`/api/sales/${biz}/prepare`, "POST", { kind: "claim", input: { category: 2 } }),
      ),
      200,
      "prepare claim",
    );
    const made = ok(
      await readAgain(() =>
        ava(`/api/sales/${biz}/actions`, "POST", {
          kind: "claim",
          input: p.input,
          action_digest: p.action_digest,
          idempotency_key: key,
        }),
      ),
      [200, 201],
      "create claim",
    );
    const id = made.action.id as string;
    expect(
      (await ava(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask === "granted",
      "claim granted",
    );
    return { id, call: made.action.call as WalletCall };
  };
  const first = await claimAction("recovery-claim-0001");
  // THE DELIBERATE FAULT (outside the app): the seller unregisters from the token after review.
  const fault = await env.unregister("founder");
  rec.tx(
    "fault_seller_unregisters",
    "founder",
    env.accounts.founder,
    {
      receiverId: "token",
      methodName: "storage_unregister",
      args: {},
      deposit: "1",
      gas: "30000000000000",
    },
    fault,
    null,
  );
  expect(fault.ok, "the seller's unregistration", fault.error);
  const tx1 = await env.wallet("founder", first.call);
  await ava(`/api/sales/actions/${first.id}/requested`, "POST", { tx_hash: tx1.hash });
  const c1 = ok(
    await readAgain(() => ava(`/api/sales/actions/${first.id}/check`, "POST", {})),
    200,
    "check claim 1",
  );
  rec.tx("claim_transfer_fails", "founder", env.accounts.founder, first.call, tx1, c1.resolution);
  const s1 = await env.seller();
  await rec.checkpoint("payout_failed_restored", await env.views());
  expect(
    s1.party?.sale_proceeds_claim === owed,
    "the same amount restored as sale proceeds",
    s1.party,
  );
  expect(s1.balance === s0.balance, "nothing paid to the seller", s1.balance);
  // The buyer can't take the seller's claim.
  const steal = await noah(`/api/sales/${biz}/prepare`, "POST", {
    kind: "claim",
    input: { category: 2 },
  });
  rec.app("buyer_cannot_take_seller_claim", {
    status: steal.status,
    code: steal.body?.code ?? null,
  });
  expect(steal.status === 409, "the buyer refused", steal.body);
  // The seller registers again and collects once.
  await s.act("founder", ava, "register", {}, "recovery-seller-register-02", {
    satisfiedBy: "registered",
  });
  const second = await claimAction("recovery-claim-0002");
  const tx2 = await env.wallet("founder", second.call);
  await ava(`/api/sales/actions/${second.id}/requested`, "POST", { tx_hash: tx2.hash });
  const c2 = ok(
    await readAgain(() => ava(`/api/sales/actions/${second.id}/check`, "POST", {})),
    200,
    "check claim 2",
  );
  rec.tx("claim_collected", "founder", env.accounts.founder, second.call, tx2, c2.resolution);
  const s2 = await env.seller();
  await rec.checkpoint("payout_collected", await env.views());
  expect(s2.party?.sale_proceeds_claim === "0", "the claim cleared", s2.party);
  expect(
    BigInt(s2.balance) - BigInt(s1.balance) === BigInt(owed),
    "paid exactly once, the owed amount",
    { before: s1.balance, after: s2.balance },
  );
  // Replays: the app refuses; the raw earlier call fails on the contract; nothing more is paid.
  const replay = await ava(`/api/sales/${biz}/prepare`, "POST", {
    kind: "claim",
    input: { category: 2 },
  });
  rec.app("replay_refused_by_app", { status: replay.status, code: replay.body?.code ?? null });
  expect(replay.status === 409, "the app refuses a second claim", replay.body);
  const raw = await env.wallet("founder", second.call);
  rec.tx("replay_raw_call", "founder", env.accounts.founder, second.call, raw, null);
  expect(!raw.ok, "the contract refuses the replayed claim", raw);
  const s3 = await env.seller();
  expect(s3.balance === s2.balance, "no second payout", s3.balance);
  await rec.checkpoint("after_replay", await env.views());
  return { offer, owed };
}
