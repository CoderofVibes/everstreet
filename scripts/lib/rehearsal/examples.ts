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

export async function runGated(
  env: Env,
  rec: Recorder,
  o: { settleWaitMs?: number; closeWaitMs?: number } = {},
) {
  const settleMs = o.settleWaitMs ?? 120_000;
  const s = steps(env, rec, settleMs);
  const { ava, cara, noah } = s;
  const probe = env.client("prober");
  for (const w of ["founder", "customer", "buyer", "prober"] as const)
    await env.signIn(w, env.client(w));
  const { id: biz } = env.business;
  await rec.checkpoint("start", await env.views());
  const { offer } = await found(env, rec, s, "gated");
  const key = newDeviceKey();
  await buy(env, rec, s, { who: "customer", offer, units: 100, key, slot: 0, tag: "gated" });
  const probeKey = newDeviceKey();
  await buy(env, rec, s, { who: "prober", offer, units: 2, key: probeKey, slot: 0, tag: "gated" });
  const uses: string[] = [];
  for (let n = 1; n <= 5; n++) uses.push(await s.serve(offer, n, key, 0, "customer", "gated-use"));
  const first = ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1");
  // One use reserved, not run, when the seller accepts.
  const prep = ok(
    await readAgain(() =>
      cara(`/api/customer/offers/${offer}/prepare`, "POST", {
        idempotency_key: "gated-use-00006",
        input:
          "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (copy 6)",
        key_slot: 0,
      }),
    ),
    [200, 201],
    "prepare 6",
  );
  const reservedId = prep.use.id as string;
  const e6 = prep.use.envelope as Json;
  const conf = ok(
    await cara(`/api/customer/uses/${reservedId}/confirm`, "POST", {
      envelope_digest: e6.envelope_digest,
      hold_signature: key.sign(e6.hold.message_hex),
      use_signature: key.sign(e6.use.message_hex),
    }),
    200,
    "confirm 6",
  );
  if (conf.use?.state !== "reserved")
    await until(
      async () => (await cara(`/api/customer/uses/${reservedId}/reconcile`, "POST")).body,
      (v) => v.use?.state === "reserved",
      "use 6 reserved",
      settleMs,
    );
  rec.app("reserved_not_run", { use: reservedId });
  const before = await env.views();
  await rec.checkpoint("reserved_before_close", before);
  expect(ent(before)?.consumed === "5", "five consumed before the close", ent(before));

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
  await s.act("founder", ava, "propose", terms, "gated-propose-01");
  await s.act("buyer", noah, "register", {}, "gated-register-0001", { satisfiedBy: "registered" });
  await s.act("buyer", noah, "fund", {}, "gated-fund-0001", { satisfiedBy: "funded" });
  await s.act("buyer", noah, "accept", {}, "gated-accept-0001", {
    satisfiedBy: "already_accepted",
  });
  await s.act("founder", ava, "accept", {}, "gated-close-00001");

  // While the gate is up: a fresh customer request is paused (no hold, no charge). If the close
  // was already done by now, that is recorded as "window missed" (the local process suite keeps
  // the paused-admission assertion).
  const pr = await probe(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: "gated-probe-00001",
    input:
      "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (probe)",
    key_slot: 0,
  });
  let probeOutcome: Json = { at: "prepare", status: pr.status, code: pr.body?.code ?? null };
  if (pr.status === 200 || pr.status === 201) {
    const pe = pr.body.use.envelope as Json;
    const pc = await probe(`/api/customer/uses/${pr.body.use.id}/confirm`, "POST", {
      envelope_digest: pe.envelope_digest,
      hold_signature: probeKey.sign(pe.hold.message_hex),
      use_signature: probeKey.sign(pe.use.message_hex),
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
      : "window missed (the close had finished); local suite keeps this assertion",
  });

  // The managed close: wait for the buyer to manage the business and the reservation's return.
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
    ent(after)?.free === "95" && ent(after)?.consumed === "5",
    "95 free / 5 consumed under the buyer",
    ent(after),
  );
  const firstAfter = ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1 after");
  expect(JSON.stringify(firstAfter) === JSON.stringify(first), "the earlier result unchanged");
  const denied = await ava(`/api/product-projects/${env.business.project}/releases`, "POST", {});
  rec.app("old_owner_write_denied", { route: "POST releases", status: denied.status });
  expect(denied.status === 404 || denied.status === 403, "the former owner refused", denied.status);
  // Service under the buyer.
  await s.serve(offer, 7, key, 0, "customer", "gated-use");
  const end = await env.views();
  await rec.checkpoint("next_use_under_buyer", end);
  expect(ent(end)?.free === "94" && ent(end)?.consumed === "6", "94 free / 6 consumed", ent(end));
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
  o: { settleWaitMs?: number } = {},
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
