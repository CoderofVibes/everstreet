// The business contract's own refusal, on NEAR testnet: the Ledgerline example's former owner
// (noor-v3s3, the owner at generation 3, who sold it in series 4) signs two owner-only calls and
// sends them straight to the business contract, with no app in between: appoint itself as an
// operator (the call the app's "try an owner action" builds) and withdraw 1 base unit of profit.
// Each should fail with E_NOT_OWNER and change nothing. Gas only; fictional, script-held accounts.
//
//   npx tsx scripts/former-owner-probe-testnet.ts
//   npx tsx scripts/verify-rehearsal.ts data/evidence/former-owner-probe-testnet.json --live

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { provider, ROOT } from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import { type Json, StopRun, type WalletCall } from "./lib/rehearsal/journey.ts";
import { sendAs, spendGuard, startSpend } from "./lib/testnetRun.ts";

const BIZ = `ledgerline-v3-3b.${ROOT}`;
const FORMER = `noor-v3s3.${ROOT}`; // owner at generation 3; sold to ines-v3s4 in series 4
const OWNER = `ines-v3s4.${ROOT}`; // generation 4
const OUT = join("data", "evidence", "former-owner-probe-testnet.json");
const SPEND = join("data", "runtime", "rehearsal-spend-probe.json");
const guard = spendGuard(SPEND, 0.2);

if (existsSync(OUT) && (JSON.parse(readFileSync(OUT, "utf8")) as Json).outcome?.completed)
  throw new StopRun("already recorded as complete");
await startSpend(SPEND);
await guard("start");

const views = async () => {
  const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
  // Both views read at that one final block, so the checkpoint names exactly what it shows.
  const call = async <T>(method: string) =>
    (await provider.callFunction({
      contractId: BIZ,
      method,
      args: {},
      blockQuery: { blockId: block.header.height },
    } as never)) as T;
  return {
    block: { height: String(block.header.height), hash: block.header.hash },
    control: await call<Json>("get_control"),
    treasury: await call<Json>("get_treasury").catch(() => null),
  };
};

const before = await views();
if (before.control.owner !== OWNER)
  throw new StopRun(`expected ${OWNER} as owner, saw ${before.control.owner}`);
if (before.control.owner === FORMER) throw new StopRun(`${FORMER} is the owner`);

const rec = new Recorder({
  example: "former-owner-probe",
  network: "testnet",
  label: "NEAR testnet",
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  contract: {
    account: BIZ,
    wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
    code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
  },
  accounts: { founder: OWNER, prober: FORMER },
  model: "none (no app, no AI: two transactions signed by the former owner)",
});

try {
  await rec.checkpoint("before", before);
  const probes: [string, WalletCall][] = [
    [
      "former_owner_appoints_itself",
      {
        receiverId: BIZ,
        methodName: "appoint_operator_guarded",
        // METERING (1), with the control sequence as it is now: only ownership can refuse it.
        args: {
          account: FORMER,
          caps: 1,
          expected_control_seq: String(before.control.control_seq),
        },
        gas: "30000000000000",
        deposit: "1",
      },
    ],
    [
      "former_owner_withdraws_profit",
      {
        receiverId: BIZ,
        methodName: "withdraw_profit",
        args: { amount: "1" },
        gas: "30000000000000",
        deposit: "1",
      },
    ],
  ];
  for (const [step, call] of probes) {
    const out = await sendAs(FORMER, call);
    rec.tx(step, "prober", FORMER, call, out, null);
    if (out.ok) throw new StopRun(`${call.methodName} by the former owner succeeded`);
    if (!out.error?.includes("E_NOT_OWNER"))
      throw new StopRun(`${call.methodName} failed, but not for ownership: ${out.error}`);
  }
  const after = await views();
  await rec.checkpoint("after", after);
  const same = (k: string) =>
    JSON.stringify((before.control as Json)[k]) === JSON.stringify((after.control as Json)[k]);
  for (const k of ["owner", "generation", "control_seq", "operators"])
    if (!same(k)) throw new StopRun(`control.${k} changed`);
  rec.app("unchanged", {
    owner: after.control.owner,
    generation: after.control.generation,
    control_seq: after.control.control_seq,
    operators: after.control.operators,
  });
  rec.write(OUT, { completed: true });
  console.log(`✓ recorded: ${OUT}`);
} catch (e) {
  rec.write(OUT, { completed: false, reason: (e as Error).message.slice(0, 600) });
  throw e;
} finally {
  await guard("end").catch(() => {});
}
