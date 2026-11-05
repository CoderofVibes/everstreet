// business-v3 testnet rehearsal, LOCAL DRY RUN of example 1 (V3_TESTNET_APPROVAL_PACKET.md §6): the
// exact driver the live run uses (scripts/lib/rehearsal/journey.ts) over the configured app in an
// actual child process, with the synthetic chain, wallet and stand-in model. Then the evidence
// record is built and checked offline. SYNTHETIC: this is not testnet evidence.

import { afterEach, describe, expect, it } from "vitest";
import { Recorder, verifyRehearsal } from "../../scripts/lib/rehearsal/evidence.ts";
import { type Env, runDirect, type Who } from "../../scripts/lib/rehearsal/journey.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { BUYER, browser, type Cleanup, installation } from "./flagshipWorld.ts";
import { BIZ, FOUNDER, OP, signInAs } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe("business-v3 rehearsal driver: local dry run of example 1 (SYNTHETIC)", () => {
  it("drives found, buy 100, use 20, Direct sale, 80 at close, 79, buyer update; the evidence record verifies offline", async () => {
    const i = await installation(cleanups);
    const app = await i.start();
    const clients = new Map<Who, ReturnType<typeof browser>>();
    const accounts = { founder: FOUNDER, buyer: BUYER, customer: CUSTOMER };
    const keys = { founder: i.b.ava, buyer: i.noahKey, customer: i.b.cara };
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
        const out = i.b.w.chain.walletCall(accounts[who], call) as Json;
        return { hash: out.transaction.hash as string, ok: !out.status?.Failure };
      },
      views: async () => ({
        control: i.b.w.chain.sale?.controlView() ?? null,
        entitlement: i.b.w.chain.ent(CUSTOMER),
      }),
    };
    const rec = new Recorder({
      example: "direct",
      network: "synthetic",
      label: "synthetic dry run",
      commit: "local",
      contract: { account: BIZ, wasm_sha256: "synthetic", code_hash_expected: "synthetic" },
      accounts: { ...accounts, operator: OP },
      model: "stand-in (scripted; no AI provider)",
    });
    const out = await runDirect(env, rec);
    expect(out.uses).toHaveLength(3); // the first, the one under the buyer, the one on the update
    const { record, text } = rec.build({ completed: true });
    const at = (name: string) =>
      (record.checkpoints as Json[]).find((c) => c.name === name)?.views.entitlement;
    expect(at("bought_100")).toMatchObject({ free: "100", consumed: "0" });
    expect(at("used_20")).toMatchObject({ free: "80", consumed: "20" });
    expect(at("closed")).toMatchObject({ free: "80", consumed: "20" });
    expect(at("next_use_under_buyer")).toMatchObject({ free: "79", consumed: "21" });
    expect(at("after_update")).toMatchObject({ free: "78", consumed: "22" });
    const closedControl = (record.checkpoints as Json[]).find((c) => c.name === "closed")?.views
      .control;
    expect(closedControl).toMatchObject({ owner: BUYER, generation: 2 });
    const steps = record.steps as Json[];
    expect(steps.filter((s) => s.kind === "transaction").map((s) => s.step)).toEqual([
      "create_plan",
      "appoint",
      "purchase_step_shell",
      "purchase_100",
      "propose",
      "register",
      "fund",
      "accept",
      "accept",
    ]);
    expect(steps.find((s) => s.step === "old_owner_write_denied")?.facts.status).toBeGreaterThan(
      399,
    );
    // Offline: digests verify, and a one-character change is caught.
    expect(verifyRehearsal(text)).toEqual({ ok: true, problems: [] });
    expect(verifyRehearsal(text.replace('"free": "80"', '"free": "81"')).ok).toBe(false);
    expect(text).not.toMatch(/SH-1042|ed25519:[1-9A-Za-z]{60,}/);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
