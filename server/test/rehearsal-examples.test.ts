// business-v3 testnet rehearsal, LOCAL DRY RUNS of examples 2-4 (V3_TESTNET_APPROVAL_PACKET.md §6):
// the exact drivers the live runs use (scripts/lib/rehearsal/examples.ts) over the configured app
// in an actual child process, with the synthetic chain, wallet and stand-in model. SYNTHETIC: not
// testnet evidence. The faults are test-only: a one-time dropped answer and a removed token
// registration in the double.

import { afterEach, describe, expect, it } from "vitest";
import { Recorder, verifyRehearsal } from "../../scripts/lib/rehearsal/evidence.ts";
import { type RecoveryEnv, runGated, runRecovery } from "../../scripts/lib/rehearsal/examples.ts";
import type { Env, Who } from "../../scripts/lib/rehearsal/journey.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { BUYER, browser, type Cleanup, type Control, installation } from "./flagshipWorld.ts";
import { BIZ, FOUNDER, nearKey, OP, signInAs } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const header = (example: string) => ({
  example,
  network: "synthetic" as const,
  label: "synthetic dry run" as const,
  commit: "local",
  contract: { account: BIZ, wasm_sha256: "synthetic", code_hash_expected: "synthetic" },
  accounts: {},
  model: "stand-in (scripted; no AI provider)",
});
const rpcMethod = (body: string) => {
  try {
    return String((JSON.parse(body) as { method?: string }).method);
  } catch {
    return "";
  }
};

/** A brand-new fictional customer for the Gated window probe (no earlier links). */
const PROBER = "piet-prober.near";

async function world(o: { gated?: boolean; ctl?: Control } = {}) {
  const i = await installation(cleanups, { gated: o.gated });
  const dana = nearKey();
  i.b.rpc.keys.set(`${PROBER}|${dana.id}`, 0n);
  i.b.w.chain.balances.set(PROBER, 10_000_000n);
  const app = await i.start(o.ctl ?? {});
  const accounts: Record<Who, string> = {
    founder: FOUNDER,
    buyer: BUYER,
    customer: CUSTOMER,
    prober: PROBER,
  };
  const keys = { founder: i.b.ava, buyer: i.noahKey, customer: i.b.cara, prober: dana };
  const clients = new Map<Who, ReturnType<typeof browser>>();
  const env: Env = {
    label: "synthetic dry run",
    accounts,
    operator: OP,
    business: { id: i.biz, project: i.project, contract: BIZ },
    client: (who) => {
      if (!clients.has(who)) clients.set(who, browser(i.port));
      return clients.get(who) as ReturnType<typeof browser>;
    },
    signIn: (who, call) => signInAs(call, accounts[who], keys[who]),
    wallet: async (who, call) => {
      try {
        const out = i.b.w.chain.walletCall(accounts[who], call) as Json;
        return { hash: out.transaction.hash as string, ok: !out.status?.Failure };
      } catch (e) {
        return { hash: "refused", ok: false, error: (e as Error).message };
      }
    },
    views: async () => ({
      control: i.b.w.chain.sale?.controlView() ?? null,
      entitlement: i.b.w.chain.ent(CUSTOMER),
      tusd: { [CUSTOMER]: String(i.b.w.chain.balances.get(CUSTOMER) ?? 0n) },
    }),
  };
  return { i, app, env };
}

describe("business-v3 rehearsal examples 2-4: local dry runs (SYNTHETIC)", () => {
  it("example 2, Gated: 94 / 1 reserved / 5 at acceptance; the reservation returned; 95 / 5 under the buyer; one more use 94 / 6", async () => {
    const { app, env } = await world({ gated: true });
    const rec = new Recorder(header("gated"));
    const out = await runGated(env, rec, { closeWaitMs: 90_000 });
    expect(out.reserved).toBeTruthy();
    const { record, text } = rec.build({ completed: true });
    const steps = record.steps as Json[];
    expect(steps.find((s) => s.step === "request_during_gate")).toBeTruthy();
    expect(verifyRehearsal(text).ok).toBe(true);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);

  it("examples 3 and 4: a dropped readback recovered once with the original hash; a failed payout restored, untakeable by the buyer, collected once, replay refused", async () => {
    const relay = { armed: false, fired: false };
    const { i, app, env } = await world({
      ctl: {
        cut: (r) => {
          if (relay.armed && r.channel === "rpc" && rpcMethod(r.body) === "tx") {
            relay.armed = false;
            relay.fired = true;
            return "lose_once";
          }
          return "answer";
        },
      },
    });
    const sale = i.b.w.chain.sale as NonNullable<typeof i.b.w.chain.sale>;
    const renv: RecoveryEnv = {
      ...env,
      relay: { arm: () => (relay.armed = true), fired: () => relay.fired },
      unregister: async () => {
        sale.registered.delete(FOUNDER); // the synthetic token forgets the seller's registration
        return { hash: "synthetic-unregister", ok: true };
      },
      seller: async () => ({
        party: sale.partyView(FOUNDER),
        balance: String(i.b.w.chain.balances.get(FOUNDER) ?? 0n),
        registered: sale.registered.has(FOUNDER),
      }),
    };
    const rec = new Recorder(header("recovery"));
    const out = await runRecovery(renv, rec);
    expect(BigInt(out.owed)).toBeGreaterThan(0n);
    const { record, text } = rec.build({ completed: true });
    const steps = record.steps as Json[];
    expect(steps.find((s) => s.step === "readback_answer_dropped")?.facts.relay_fired).toBe(true);
    expect(steps.find((s) => s.step === "buyer_cannot_take_seller_claim")?.facts.status).toBe(409);
    expect(steps.find((s) => s.step === "replay_raw_call")?.chain.succeeded).toBe(false);
    expect(verifyRehearsal(text).ok).toBe(true);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
