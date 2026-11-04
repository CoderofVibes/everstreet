// Job 003s: the in-memory scenario behind scripts/preview-acquisition.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout. It is the customer preview (scripts/lib/customerPreview.ts:
// in-memory database, real app and routes, labelled customer chain double, scripted extractor,
// in-memory protection, a preview-only synthetic signer) plus an in-memory v3 VIEW transport
// serving the business-v3 contract's own fixture JSON (server/test/fixtures/v3). Sale states are
// set only by preview controls, never by product buttons. The business changes hands here ONLY
// through the app's own reconciliation (POST .../v3/intents/:intent/reconcile); no control writes
// ownership. Nothing is signed for a sale, nothing is paid, nothing reaches NEAR.

import {
  editView,
  FixtureV3Transport,
  V3_ACCEPTING,
  V3_CLOSED,
  V3_PROPOSED,
  v3Ended,
  v3Fixture,
} from "../../server/test/v3-fixture-transport.ts";
import { customerPreview } from "./customerPreview.ts";

export type DealControl =
  | "proposed"
  | "accepting"
  | "closing"
  | "closed"
  | "cancelled"
  | "expired"
  | "conflict"
  | "unavailable";
export const DEAL_CONTROLS: DealControl[] = [
  "proposed",
  "accepting",
  "closing",
  "closed",
  "cancelled",
  "expired",
  "conflict",
  "unavailable",
];

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

/** The contract tests' T0 (2026-11-02T00:00Z) plus 10 minutes: where the fixture clock starts. */
export const FIXTURE_START_MS = 1_793_577_600_000 + 10 * 60_000;

/** `gated` uses the contract's Gated fixtures (closing by a closer); otherwise Direct. */
export async function acquisitionPreview(opts: { gated?: boolean } = {}) {
  const t = new FixtureV3Transport();
  const gated = opts.gated === true;
  const GATED_CLOSING = gated ? v3Fixture("gated-closing") : null;
  const GATED_CLOSED = gated ? v3Fixture("gated-closed") : null;
  t.views = gated ? (GATED_CLOSING as Record<string, string>) : V3_PROPOSED;
  // Job 003s1: the sale views are the contract tests' fixtures, whose deal terms (and digest) fix
  // their times: started at T0 = 2026-11-02T00:00Z, Gated closer deadline T0 + 30 min, offer open
  // until 2026-11-03T00:00Z. They are read on a FIXTURE CLOCK that starts at T0 + 10 min and runs
  // at real speed, so the evidence is coherent with its own terms. Customer uses keep this
  // computer's clock. The terms are never rewritten to fit the wall clock.
  const started = Date.now();
  const fixtureClock = () => FIXTURE_START_MS + (Date.now() - started);
  const p = await customerPreview({
    withOffer: true,
    v3Transport: t,
    v3Now: fixtureClock,
    label: {
      label: "Preview only: synthetic sale evidence, customer chain and runtime",
      detail: `Sale views are the contract tests' fixtures, read on a fixture clock that started at ${new Date(FIXTURE_START_MS).toISOString()}; customer uses run on this computer's clock. Not testnet proof; nothing leaves this computer.`,
    },
  });
  const { w } = p;
  // The app's own account records (fixtures): the seller and the buyer named by the deal.
  w.link(w.f.ava.id, "founder.near");
  w.link(p.people.noah, "buyer.near");

  // One completed customer use before any sale, so continuity has something to keep.
  w.clock.now = Number(w.chain.ts);
  const prep = await w.cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
    idempotency_key: "acq-preview-use-0001",
    input: INVOICE,
  });
  if (prep.status !== 201) throw new Error(`preview setup: prepare ${prep.status}`);
  const useId = prep.body.use.id as string;
  await w.cara(`/api/customer/uses/${useId}/confirm`, "POST", w.signed(prep.body.use.envelope));
  await w.cara(`/api/customer/uses/${useId}/execute`, "POST", {});
  let unit = "";
  for (let i = 0; i < 3 && unit !== "charged"; i++)
    unit = (await w.cara(`/api/customer/uses/${useId}/units/reconcile`, "POST")).body.use.units
      .unit;
  if (unit !== "charged") throw new Error(`preview setup: the first use ended ${unit}`);

  /** Sets the observed contract state. Only a later read (a person's action) records it. */
  const deal = (s: DealControl) => {
    if (gated && (s === "proposed" || s === "accepting"))
      throw new Error("This preview closes through a closer; use closing or closed.");
    if (!gated && s === "closing")
      throw new Error("This preview closes directly; start it with --gated for closing.");
    if (s === "unavailable") {
      t.failNext = 1;
      return;
    }
    if (s === "conflict") {
      // Synthetic: the block already read answers with other content (a sticky conflict).
      t.conflictAtSameHeight(editView(t.views, "get_control", (c) => (c.manifest_seq = "9")));
      return;
    }
    const views =
      s === "proposed"
        ? V3_PROPOSED
        : s === "accepting"
          ? V3_ACCEPTING
          : s === "closing"
            ? (GATED_CLOSING as Record<string, string>)
            : s === "closed"
              ? gated
                ? (GATED_CLOSED as Record<string, string>)
                : V3_CLOSED
              : v3Ended(s);
    t.next(views);
    // Keep the customer chain double coherent with a close: the contract-produced after-sale
    // control (owner buyer.near; METERING granted only as the deal said).
    if (s === "closed") w.chain.afterSale();
  };

  const controls = {
    deal,
    /** Synthetic: the new owner appoints the platform's metering account on the contract. */
    appointMetering: () => w.chain.reappointPlatform(),
    lose: p.controls.lose,
    authorizer: p.controls.authorizer,
    summary: () => ({
      ...p.controls.summary(),
      contract_block: t.at.height,
      fixture_clock: new Date(fixtureClock()).toISOString(),
      intents: w.state.store.db
        .prepare("SELECT id, status, deal_seq, version FROM v3_intents ORDER BY created_at")
        .all(),
      ownership: w.state.store.db
        .prepare(
          "SELECT from_id, to_id, generation, v3_intent_id FROM ownership WHERE business_id = ?",
        )
        .all(w.f.business),
    }),
  };
  return {
    site: p.site,
    w,
    offerId: p.offerId as string,
    businessId: w.f.business,
    useId,
    gated,
    people: p.people,
    controls,
    fixtureClock,
  };
}
