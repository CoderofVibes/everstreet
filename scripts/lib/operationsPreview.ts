// Job 003t: the in-memory scenario behind scripts/preview-operations.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout. It is the acquisition preview (scripts/lib/
// acquisitionPreview.ts: in-memory database, real app and routes, labelled customer chain double,
// scripted extractor, in-memory protection, contract fixture sale views, a preview-only synthetic
// signer) plus a customer maintenance supervisor that runs a pass ONLY when a preview control asks.
// Its activity is recorded by the app's own routes: fictional customers prepare, confirm and run
// uses; the worker settles them. Nothing is backdated: every figure is in the month it happened,
// and earlier months show as recorded zeros. The business changes hands ONLY through the app's
// own reconciliation. No model, wallet, NEAR endpoint or runtime database; nothing leaves here.

import { guardAdapters, MaintenanceSupervisor } from "../../server/src/maintenance.ts";
import { customerOperations } from "../../server/src/operations.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { acquisitionPreview, FIXTURE_START_MS } from "./acquisitionPreview.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const UNSUPPORTED = "A fictional shopping list: oat milk, rye bread, two lemons";

export async function operationsPreview() {
  const p = await acquisitionPreview({
    label: {
      label: "Preview only: synthetic customers, runtime, worker and sale evidence",
      // 003t1: the fixture sale clock is stated here too (as in 003s1), never the wall clock.
      detail: `Fictional customer uses recorded by the app's own routes this month; earlier months are recorded zeros, not history. Sale views are the contract tests' fixtures, read on a fixture clock that started at ${new Date(FIXTURE_START_MS).toISOString()}; customer uses run on this computer's clock. Not testnet or production evidence; nothing leaves this computer.`,
    },
  });
  const { w } = p;
  const db = w.state.store.db;
  const uses = w.service((o) => guardAdapters(o, 4).options);
  const supervisor = new MaintenanceSupervisor(db, uses, {
    holder: "preview-worker",
    opDeadlineMs: 10_000,
    passBudgetMs: 12_000,
    batch: 10,
    now: () => {
      w.clock.now = Math.max(w.clock.now, Number(w.chain.ts), Date.now());
      return w.clock.now;
    },
  });
  const sync = () => {
    w.clock.now = Math.max(w.clock.now, Number(w.chain.ts));
  };

  let n = 0;
  /** Another fictional customer with the fixture's funded entitlement. */
  const customer = (name: string) => {
    const who = w.person(name);
    const account = `ops-${++n}.near`;
    w.link(who.id, account);
    w.chain.ents.set(account, structuredClone(p.pristineEntitlement as Json));
    return who;
  };
  type Who = ReturnType<typeof customer>;
  const prepare = async (who: Who, key: string, input = INVOICE) => {
    sync();
    const r = await who(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
      idempotency_key: key,
      input,
    });
    if (r.status !== 201) throw new Error(`preview setup: prepare ${r.status}`);
    return r.body.use as Json;
  };
  const reserve = async (who: Who, key: string, input = INVOICE) => {
    const u = await prepare(who, key, input);
    const c = await who(`/api/customer/uses/${u.id}/confirm`, "POST", w.signed(u.envelope));
    if (c.body.use?.state !== "reserved") throw new Error("preview setup: confirm");
    return u.id as string;
  };
  const run = async (who: Who, key: string, input = INVOICE) => {
    const id = await reserve(who, key, input);
    sync();
    await who(`/api/customer/uses/${id}/execute`, "POST", {});
    return id;
  };

  // Recorded activity, this month: two more supported invoices (charged by the worker), an
  // unsupported document (returned by the worker), one whose settle answer is lost (settling), one
  // reserved and never run, one prepared only, one prepared and cancelled.
  await run(customer("Customer Ines"), "ops-preview-0001");
  await run(customer("Customer Jonah"), "ops-preview-0002");
  await run(customer("Customer Kemi"), "ops-preview-0003", UNSUPPORTED);
  for (let i = 0; i < 4; i++) {
    sync();
    await supervisor.runPass();
  }
  await run(customer("Customer Lior"), "ops-preview-0004");
  w.writer.unitModes.push("drop"); // synthetic: this settle submission is lost on the way
  await supervisor.runPass();
  await reserve(customer("Customer Mara"), "ops-preview-0005");
  await prepare(customer("Customer Nils"), "ops-preview-0006");
  const otto = customer("Customer Otto");
  const cancelled = await prepare(otto, "ops-preview-0007");
  await otto(`/api/customer/uses/${cancelled.id}/cancel`, "POST");

  const controls = {
    ...p.controls,
    /** One maintenance pass (the worker never runs on its own here). */
    pass: () => supervisor.runPass(),
    /** One more fictional customer use, run now; the next passes settle it. */
    use: async () => {
      const k = String(++n).padStart(4, "0");
      return run(customer(`Customer ${k}`), `ops-preview-extra-${k}`);
    },
    summary: () => ({
      ...p.controls.summary(),
      operations: customerOperations(db, w.f.business, 6).totals,
    }),
  };
  return { ...p, supervisor, controls };
}
