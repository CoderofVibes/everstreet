// Job 002d: the in-memory scenario behind scripts/preview-maintenance.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC: the customer preview (in-memory database, real app and routes,
// labelled customer chain double, scripted runtime, in-memory protection, preview-only signer)
// plus a customer maintenance supervisor that is started ONLY by a preview control. It uses the
// preview's own adapters through outstanding-call guards. No model, wallet, NEAR endpoint or
// runtime database; nothing leaves this computer.

import {
  type AdapterGuards,
  guardAdapters,
  MaintenanceSupervisor,
  maintenanceHealth,
} from "../../server/src/maintenance.ts";
import { customerPreview } from "./customerPreview.ts";

export async function maintenancePreview(opts: { intervalMs?: number } = {}) {
  const p = await customerPreview({
    withOffer: true,
    label: {
      label: "Preview only: synthetic customer chain, runtime and maintenance worker",
      detail:
        "The background worker runs only when a preview control starts it. Not testnet or production evidence; nothing leaves this computer.",
    },
  });
  const { w } = p;
  // The supervisor's own service instance, over the preview's adapters wrapped with guards.
  let guards: AdapterGuards | null = null;
  const uses = w.service((o) => {
    const g = guardAdapters(o, 4);
    guards = g.guards;
    return g.options;
  });
  const g = guards as unknown as AdapterGuards;
  const supervisor = new MaintenanceSupervisor(
    w.state.store.db,
    uses,
    {
      holder: "preview-worker",
      intervalMs: opts.intervalMs ?? 15_000,
      opDeadlineMs: 10_000,
      passBudgetMs: 12_000,
      batch: 10,
      // The preview's clock follows this computer's (never backwards; the preview's own
      // "expire hold" control may have moved it ahead).
      now: () => {
        w.clock.now = Math.max(w.clock.now, Date.now());
        return w.clock.now;
      },
    },
    g,
  );
  const original = { settle: w.writer.settleHold, release: w.writer.releaseHoldFor };
  const controls = {
    ...p.controls,
    start: () => supervisor.start(),
    stop: () => supervisor.stop(),
    pass: () => supervisor.runPass(),
    /** Synthetic: the writer stops answering settle/release and ignores its abort signal. */
    hangWriter: () => {
      w.writer.settleHold = () => new Promise(() => {});
      w.writer.releaseHoldFor = () => new Promise(() => {});
    },
    healWriter: () => {
      w.writer.settleHold = original.settle;
      w.writer.releaseHoldFor = original.release;
    },
    health: () => maintenanceHealth(w.state.store.db, w.f.business, w.clock.now),
    summary: () => ({
      ...p.controls.summary(),
      maintenance: maintenanceHealth(w.state.store.db, w.f.business, w.clock.now),
      outstanding_chain_calls: g.chain.outstanding,
    }),
  };
  return { ...p, supervisor, controls };
}
