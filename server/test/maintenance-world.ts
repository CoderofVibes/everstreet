// Job 002d: a test world for the customer maintenance supervisor: the labelled customer world
// (fixture chain, scripted runtime, synthetic protection) plus more fictional customers with
// funded entitlements (copies of the contract-produced one), and helpers to reserve, run and
// supervise. Finite: every fixture keeps its own read/submit ceilings.

import type { CustomerUseOptions } from "../src/customerUse.ts";
import { type MaintenanceOptions, MaintenanceSupervisor } from "../src/maintenance.ts";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

export const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
export const DAY = 86_400_000;

const letters = (n: number) => {
  let s = "";
  let x = n + 1;
  while (x > 0) {
    s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

export async function maintenanceWorld(
  opts: { customer?: Partial<CustomerUseOptions>; noWriter?: boolean } = {},
) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({
    customer: { protection, ...opts.customer },
    noWriter: opts.noWriter,
  });
  const pristine = structuredClone(w.chain.ent() as Json);
  const offer = await w.offer();
  /** Another fictional customer with a funded entitlement. */
  const customer = (n: number) => {
    const p = w.person(`Customer ${letters(n)}`);
    const account = `c${letters(n)}.near`;
    w.link(p.id, account);
    w.chain.ents.set(account, structuredClone(pristine));
    return p;
  };
  const sync = () => {
    w.clock.now = Number(w.chain.ts);
  };
  /** Time passes on both clocks (the chain moves forward a block). */
  const advance = (ms: number) => {
    w.chain.tick(BigInt(ms));
    sync();
  };
  const prepare = async (who: CustomerWorld["cara"], key: string) => {
    sync();
    const p = await who(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: key,
      input: INVOICE,
    });
    if (p.status !== 201) throw new Error(`prepare ${p.status} ${p.body.code}`);
    return p.body.use as Json;
  };
  const reserve = async (who: CustomerWorld["cara"], key: string) => {
    const u = await prepare(who, key);
    const c = await who(`/api/customer/uses/${u.id}/confirm`, "POST", w.signed(u.envelope));
    if (c.body.use?.state !== "reserved") throw new Error(`confirm ${c.body.use?.state}`);
    return u.id as string;
  };
  const execute = async (who: CustomerWorld["cara"], id: string) => {
    sync();
    const x = await who(`/api/customer/uses/${id}/execute`, "POST", {});
    if (!x.body.use?.execution?.fulfilled) throw new Error("execute");
  };
  const supervisor = (
    holder = "worker-a",
    extra: Partial<MaintenanceOptions> = {},
    uses = w.service(),
    guards: ConstructorParameters<typeof MaintenanceSupervisor>[3] = null,
  ) =>
    new MaintenanceSupervisor(
      w.state.store.db,
      uses,
      {
        holder,
        now: () => w.clock.now,
        batch: 2,
        opDeadlineMs: 5_000,
        passBudgetMs: 60_000,
        ...extra,
      },
      guards,
    );
  const unit = (id: string) =>
    (
      w.state.store.db
        .prepare("SELECT state FROM customer_settlements WHERE request_id = ?")
        .get(id) as { state: string } | undefined
    )?.state ?? null;
  const requestState = (id: string) =>
    (
      w.state.store.db.prepare("SELECT state FROM customer_requests WHERE id = ?").get(id) as {
        state: string;
      }
    ).state;
  return {
    w,
    protection,
    offer,
    customer,
    prepare,
    reserve,
    execute,
    supervisor,
    unit,
    requestState,
    sync,
    advance,
  };
}
