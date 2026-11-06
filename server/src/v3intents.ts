// Job 003k: durable v3 acquisition intents, and a deliberate local reconciliation of a proven
// close (docs/design/V3_RECONCILIATION.md). Keyless and read-only towards NEAR: evidence comes
// from the observation service's trusted transport, through its normal ordering rules. A
// reconciliation is a chain read followed by one local transaction; NEAR and SQLite never change
// atomically together. Nothing here signs, pays or closes a deal.

import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { resolveFromEvidence } from "./handover.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import type { CoreSnapshot, V3Observations } from "./v3observe.ts";
import { type OutcomeV3, V3ReadError, type V3Snapshot } from "./v3read.ts";

export const MAX_INTENTS = 20;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const DEC = /^(0|[1-9][0-9]{0,19})$/;
const HEX32 = /^[0-9a-f]{64}$/;

type Status = "recorded" | "applied" | "ended" | "superseded";

interface IntentRow {
  id: string;
  business_id: string;
  network: string;
  account: string;
  schema: string;
  deal_seq: string;
  version: number;
  digest: string;
  terms: string;
  seller_account: string;
  buyer_account: string;
  expected_generation: number;
  seller_person_id: string;
  buyer_person_id: string;
  local_epoch: number;
  recorded_block: string;
  status: Status;
  idempotency_key: string;
  request_hash: string;
  result: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ReconcileState =
  | "pending"
  | "unavailable"
  | "conflict"
  | "ended"
  | "applied"
  | "already"
  | "superseded";

const MESSAGES: Record<ReconcileState, string> = {
  pending: "The contract doesn't show this sale closed yet. Nothing was changed.",
  unavailable: "The evidence needed couldn't be read or doesn't exist. Nothing was changed.",
  conflict:
    "The contract's evidence doesn't match this recorded intent, or something changed since. Nothing was changed automatically.",
  ended: "This deal ended without a sale on the contract. Nothing was changed.",
  applied: "The contract shows this exact sale closed; the business now belongs to the buyer here.",
  already: "This sale was already applied here.",
  superseded:
    "Another sale of this business was applied here first; this intent no longer applies.",
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
function bad(status: 400 | 404 | 409, message: string, code?: string): never {
  throw new HttpError(status, message, code);
}

class Stale extends Error {}

export class V3Intents {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly obs: V3Observations,
  ) {}

  /** The one person a chain account maps to here (the app's own account records), or null. */
  private personFor(account: string): string | null {
    const r = this.db
      .prepare("SELECT owner_id FROM chain_accounts WHERE owner_kind = 'person' AND account_id = ?")
      .get(account) as { owner_id: string } | undefined;
    return r?.owner_id ?? null;
  }

  private row(businessId: string, id: string): IntentRow | undefined {
    return this.db
      .prepare("SELECT * FROM v3_intents WHERE id = ? AND business_id = ?")
      .get(id, businessId) as unknown as IntentRow | undefined;
  }

  /** The smallest useful receipt for a participant: no business data, no successor records. */
  private receipt(r: IntentRow, viewer: Person) {
    const result = r.result ? (JSON.parse(r.result) as Record<string, unknown>) : null;
    return {
      intent_id: r.id,
      // Job 003s: where the receipt belongs, so a participant can come back to it.
      business_id: r.business_id,
      role: viewer.id === r.seller_person_id ? ("seller" as const) : ("buyer" as const),
      status: r.status,
      deal: { seq: r.deal_seq, version: r.version, digest: r.digest },
      target_generation: r.expected_generation + 1,
      recorded_at: r.created_at,
      applied_at: r.status === "applied" ? r.updated_at : null,
      outcome_control_seq: (result?.outcome_control_seq as string | undefined) ?? null,
    };
  }

  /**
   * Job 003s: the viewer's own handover receipts, as seller or buyer, newest first (bounded).
   * Each is the same minimal receipt; the business is named only where that name is already
   * visible to the viewer (they own it now, or its page is published). Nothing else is added.
   */
  mine(viewer: Person) {
    const rows = this.db
      .prepare(
        `SELECT * FROM v3_intents WHERE seller_person_id = ? OR buyer_person_id = ? ORDER BY created_at DESC, id LIMIT ${MAX_INTENTS}`,
      )
      .all(viewer.id, viewer.id) as unknown as IntentRow[];
    return {
      handovers: rows.map((r) => {
        const b = this.db
          .prepare("SELECT name, owner_id, published_at FROM businesses WHERE id = ?")
          .get(r.business_id) as
          | { name: string; owner_id: string; published_at: string | null }
          | undefined;
        const named = b && (b.owner_id === viewer.id || b.published_at !== null);
        return {
          business: { id: r.business_id, name: named ? b.name : null },
          you_own_it_now: b?.owner_id === viewer.id,
          receipt: this.receipt(r, viewer),
        };
      }),
    };
  }

  /** The owner's full view of an intent (the terms are the business's own sale record). */
  private full(r: IntentRow) {
    return {
      id: r.id,
      status: r.status,
      source: { network: r.network, account: r.account, schema: r.schema },
      deal: { seq: r.deal_seq, version: r.version, digest: r.digest },
      terms: JSON.parse(r.terms) as Record<string, unknown>,
      seller_account: r.seller_account,
      buyer_account: r.buyer_account,
      expected_generation: r.expected_generation,
      recorded_block: JSON.parse(r.recorded_block) as { height: string; hash: string },
      result: r.result ? (JSON.parse(r.result) as Record<string, unknown>) : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      note: "Terms come from the contract's live deal as observed; the digest is the contract's own.",
    };
  }

  // ---------- recording an intent (current owner only) ----------

  record(viewer: Person, businessId: string, input: Record<string, unknown>) {
    const business = this.store.ownedBusiness(viewer, businessId);
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const seq = input.deal_seq;
    if (typeof seq !== "string" || !DEC.test(seq)) bad(400, "deal_seq must be a decimal string");
    const version = input.version;
    if (
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > 0xffff_ffff
    )
      bad(400, "version must be a whole number from 1");
    const digest = input.digest;
    if (typeof digest !== "string" || !HEX32.test(digest))
      bad(400, "digest must be 64 lowercase hex characters");
    const requestHash = sha256(JSON.stringify({ seq, version, digest }));

    const replay = () => {
      const r = this.db
        .prepare("SELECT * FROM v3_intents WHERE business_id = ? AND idempotency_key = ?")
        .get(businessId, key) as unknown as IntentRow | undefined;
      if (!r) return null;
      if (r.request_hash !== requestHash)
        bad(
          409,
          "This request key was already used for a different intent. Nothing was recorded.",
          "key_reused",
        );
      return r;
    };
    const earlier = replay();
    if (earlier) return { created: false, intent: this.full(earlier) };

    const binding = this.obs.bindingFor(businessId);
    if (!binding) bad(409, "This business isn't connected to a v3 contract here.", "unbound");
    const latest = this.obs.latest(businessId);
    if (!latest)
      bad(409, "Nothing has been observed yet. Refresh the evidence first.", "never_observed");
    if (latest.flag)
      bad(
        409,
        "The recorded evidence is flagged as conflicting; no intent can be based on it.",
        "evidence_flagged",
      );
    if (latest.source.network !== binding.network || latest.source.account !== binding.account)
      bad(
        409,
        "The recorded evidence is from another contract than the one configured.",
        "source_changed",
      );
    const d = latest.snapshot.control.live_deal;
    if (!d) bad(409, "The recorded evidence shows no sale in progress.", "no_live_deal");
    if (d.seq !== seq || d.version !== version || d.digest !== digest)
      bad(
        409,
        "The recorded live deal isn't this exact deal, version and digest.",
        "deal_mismatch",
      );
    if (this.personFor(d.seller) !== viewer.id || business.owner_id !== viewer.id)
      bad(409, "The deal's seller account isn't yours here.", "seller_unmapped");
    const buyer = this.personFor(d.buyer);
    if (!buyer) bad(409, "The deal's buyer account isn't linked to anyone here.", "buyer_unmapped");
    if (buyer === viewer.id) bad(409, "The buyer account maps to the seller.", "buyer_is_seller");
    const epoch = this.store.controlEpoch(viewer, businessId);
    const id = randomUUID();
    const t = now();
    this.store.tx(() => {
      if (replay()) return;
      // Job 003wf3: recording the exact intent stays possible during a handover (it is evidence
      // the reconciliation needs, not an owner change).
      this.store.stillControls(viewer, epoch, { handover: "allow" });
      const n = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM v3_intents WHERE business_id = ?")
          .get(businessId) as {
          n: number;
        }
      ).n;
      if (n >= MAX_INTENTS) bad(409, `At most ${MAX_INTENTS} intents per business.`, "too_many");
      const same = this.db
        .prepare(
          "SELECT id FROM v3_intents WHERE business_id = ? AND network = ? AND account = ? AND deal_seq = ? AND version = ?",
        )
        .get(businessId, binding.network, binding.account, seq, version);
      if (same)
        bad(409, "An intent for this exact deal version is already recorded.", "already_recorded");
      const terms = {
        price: d.price,
        available_floor: d.available_floor,
        expires_at_ms: d.expires_at_ms,
        close_window_ms: d.close_window_ms,
        grants: d.grants,
        terms_hash: d.terms_hash,
        close_mode: latest.snapshot.control.close_mode,
        closer: latest.snapshot.control.closer,
      };
      this.db
        .prepare(
          `INSERT INTO v3_intents (id, business_id, network, account, schema, deal_seq, version, digest, terms,
             seller_account, buyer_account, expected_generation, seller_person_id, buyer_person_id, local_epoch,
             recorded_block, status, idempotency_key, request_hash, result, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          businessId,
          binding.network,
          binding.account,
          latest.source.schema,
          seq,
          version,
          digest,
          JSON.stringify(terms),
          d.seller,
          d.buyer,
          d.expected_generation,
          viewer.id,
          buyer,
          epoch.generation,
          JSON.stringify(latest.snapshot.block),
          key,
          requestHash,
          viewer.id,
          t,
          t,
        );
      this.db
        .prepare(
          "INSERT INTO events (type, subject, actor, payload, at) VALUES ('v3.intent_recorded', ?, ?, ?, ?)",
        )
        .run(businessId, viewer.id, JSON.stringify({ intent: id, deal_seq: seq, version }), t);
    });
    const made = replay() as IntentRow;
    return { created: made.id === id, intent: this.full(made) };
  }

  /** The current owner's list of a business's intents. */
  list(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare("SELECT * FROM v3_intents WHERE business_id = ? ORDER BY created_at DESC")
      .all(businessId) as unknown as IntentRow[];
    return { intents: rows.map((r) => this.full(r)) };
  }

  /** A participant's receipt; anyone else (and any other intent) is a 404. */
  read(viewer: Person, businessId: string, intentId: string) {
    const r = this.row(businessId, intentId);
    if (!r || (viewer.id !== r.seller_person_id && viewer.id !== r.buyer_person_id))
      bad(404, "No such intent");
    return { receipt: this.receipt(r, viewer) };
  }

  // ---------- reconciling (a participant: the intent's seller or buyer person) ----------

  /**
   * `system` (job 003wf3, Q9): the managed handover's own entry, never a route. It must name the
   * stored handover whose intent, deal, version and digest are exactly this intent's; it runs the
   * same decide/apply code with every monotonic check, and is attributed to `system:handover`.
   * `fence` (Astra 01:47) runs first inside each of its write transactions: a coordinator whose
   * lease or operation lapsed during the awaited read throws there, and nothing is written.
   */
  async reconcile(
    viewer: Person | null,
    businessId: string,
    intentId: string,
    system?: { handoverId: string; fence?: () => void } | { watcher: true; fence?: () => void },
  ) {
    const fence = () => system?.fence?.();
    const first = this.row(businessId, intentId);
    const allowed =
      first &&
      (system
        ? "watcher" in system || this.handoverNames(first, system.handoverId)
        : viewer !== null &&
          (viewer.id === first.seller_person_id || viewer.id === first.buyer_person_id));
    if (!first || !allowed) bad(404, "No such intent");
    const answer = (state: ReconcileState, code: string | null, r: IntentRow = first) => {
      const fresh = this.row(businessId, intentId) ?? r;
      return {
        state,
        code,
        message: MESSAGES[state],
        receipt: viewer ? this.receipt(fresh, viewer) : null,
      };
    };
    if (first.status === "applied") return answer("already", null);
    if (first.status === "ended") return answer("ended", null);
    if (first.status === "superseded") return answer("superseded", null);

    const binding = this.obs.bindingFor(businessId);
    if (!binding || binding.network !== first.network || binding.account !== first.account)
      return answer("conflict", "binding_changed");

    // 1. Fresh evidence, through the trusted transport and the normal ordering rules.
    let snap: V3Snapshot | null;
    try {
      snap = await this.obs.readFresh(binding);
    } catch (e) {
      return answer("unavailable", e instanceof V3ReadError ? e.code : "unavailable");
    }
    if (!snap) return answer("unavailable", "no_transport");
    const s = snap;
    const recorded = this.store.tx(() => {
      fence();
      return this.obs.record(businessId, s);
    }).outcome;
    if (recorded === "stale") return answer("unavailable", "evidence_stale");
    if (recorded !== "accepted" && recorded !== "duplicate")
      return answer("conflict", `evidence_${recorded}`);
    const latest = this.obs.latest(businessId);
    if (latest?.flag) return answer("conflict", "evidence_flagged");
    if (s.source.schema !== first.schema) return answer("conflict", "schema_changed");

    // 2. Decide.
    const decision = this.decide(first, s);
    if (decision.state === "ended" || decision.state === "superseded") {
      const status = decision.state;
      this.store.tx(() => {
        fence();
        this.db
          .prepare(
            "UPDATE v3_intents SET status = ?, result = ?, updated_at = ? WHERE id = ? AND status = 'recorded'",
          )
          .run(status, JSON.stringify({ outcome: decision.code, block: s.block }), now(), first.id);
      });
      // The answer follows what is actually stored, whichever call reached it first.
      const stored = (this.row(businessId, intentId) as IntentRow).status;
      const state: ReconcileState =
        stored === "applied" ? "already" : stored === "recorded" ? status : stored;
      return answer(state, decision.code);
    }
    if (decision.state !== "apply") return answer(decision.state, decision.code);

    // 3. Apply, with every local fact rechecked inside one transaction.
    const o = decision.outcome;
    const target = o.generation_after;
    const t = now();
    try {
      const won = this.store.tx(() => {
        fence();
        const cas = this.db
          .prepare(
            "UPDATE v3_intents SET status = 'applied', result = ?, updated_at = ? WHERE id = ? AND status = 'recorded'",
          )
          .run(
            JSON.stringify({
              outcome_control_seq: o.control_seq,
              block: s.block,
              generation: target,
            }),
            t,
            first.id,
          );
        if (cas.changes === 0) return false;
        const owner = (
          this.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(businessId) as {
            owner_id: string;
          }
        ).owner_id;
        const h = this.db
          .prepare(
            "SELECT COUNT(*) AS n, MAX(generation) AS g FROM ownership WHERE business_id = ?",
          )
          .get(businessId) as { n: number; g: number | null };
        // Monotonic: never replace a newer local owner, nor apply over a history that moved on.
        if (
          owner !== first.seller_person_id ||
          h.n !== first.local_epoch ||
          (h.g !== null && h.g >= target)
        )
          throw new Stale();
        this.db
          .prepare("UPDATE businesses SET owner_id = ?, updated_at = ? WHERE id = ?")
          .run(first.buyer_person_id, t, businessId);
        this.db
          .prepare(
            "INSERT INTO ownership (business_id, from_id, to_id, buyer_id, deal_id, generation, tx, at, v3_intent_id) VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?)",
          )
          .run(businessId, first.seller_person_id, first.buyer_person_id, target, t, first.id);
        // What the seller set up ends with the sale, as in the v2 reconciler.
        this.db
          .prepare("UPDATE team SET revoked_at = ? WHERE business_id = ? AND revoked_at IS NULL")
          .run(t, businessId);
        const listing = this.db
          .prepare("SELECT id FROM listings WHERE business_id = ?")
          .get(businessId) as { id: string } | undefined;
        if (listing) {
          this.db
            .prepare("UPDATE listings SET mode = 'closed', updated_at = ? WHERE id = ?")
            .run(t, listing.id);
          this.db
            .prepare(
              "UPDATE access_requests SET status = 'revoked', revoked_at = ?, access_version = access_version + 1 WHERE listing_id = ? AND status = 'granted'",
            )
            .run(t, listing.id);
          this.db
            .prepare(
              "UPDATE access_requests SET status = 'withdrawn', access_version = access_version + 1 WHERE listing_id = ? AND status = 'pending'",
            )
            .run(listing.id);
        }
        this.db
          .prepare(
            "UPDATE value_settings SET founder_hours_week = NULL, hourly_rate_cents = NULL, share_numbers = 0, updated_at = ? WHERE business_id = ?",
          )
          .run(t, businessId);
        this.db
          .prepare(
            "UPDATE deals SET status = 'void', updated_at = ? WHERE business_id = ? AND status = 'open'",
          )
          .run(t, businessId);
        this.db
          .prepare(
            "UPDATE v3_intents SET status = 'superseded', updated_at = ? WHERE business_id = ? AND status = 'recorded' AND id != ?",
          )
          .run(t, businessId, first.id);
        this.db
          .prepare(
            "INSERT INTO events (type, subject, actor, payload, at) VALUES ('business.sold', ?, ?, ?, ?)",
          )
          .run(
            businessId,
            first.seller_person_id,
            JSON.stringify({
              v3_intent: first.id,
              to: first.buyer_person_id,
              generation: target,
              contract: { network: first.network, account: first.account },
            }),
            t,
          );
        if (system && "handoverId" in system)
          this.db
            .prepare(
              "INSERT INTO events (type, subject, actor, payload, at) VALUES ('v3.reconciled_by_handover', ?, 'system:handover', ?, ?)",
            )
            .run(
              businessId,
              JSON.stringify({ v3_intent: first.id, handover: system.handoverId }),
              t,
            );
        else if (system)
          this.db
            .prepare(
              "INSERT INTO events (type, subject, actor, payload, at) VALUES ('v3.reconciled_by_watcher', ?, 'system:watcher', ?, ?)",
            )
            .run(businessId, JSON.stringify({ v3_intent: first.id }), t);
        return true;
      });
      // Job 003wf3: the handover follows the same evidence, now that it is applied here.
      resolveFromEvidence(this.db, {
        businessId,
        network: first.network,
        account: first.account,
        evidence: { block: s.block, control: s.control, outcomes: s.outcomes },
        source: system && "handoverId" in system ? "handover_reconcile" : "reconcile",
        now: Date.now(),
      });
      return answer(won ? "applied" : "already", null);
    } catch (e) {
      if (e instanceof Stale) return answer("conflict", "local_owner_changed");
      throw e;
    }
  }

  private watchCursor = "";

  /**
   * Permissions review, finding 1: a sale can close on the contract without anyone telling
   * Everstreet (the closing acceptance's answer is lost, or it was sent from another wallet), and
   * until then the seller would still run the business here. Each pass reconciles up to `limit`
   * recorded intents from fresh chain evidence, through the same checks as a participant's own
   * reconcile, rotating through them so every one is read within a few passes. Direct sales only:
   * a Gated sale is closed by the managed handover's closer, whose coordinator applies it with the
   * steps that follow (this would pre-empt them). Never throws.
   */
  async watchPass(limit = 5) {
    const next = (after: string) =>
      this.db
        .prepare(
          "SELECT id, business_id FROM v3_intents WHERE status = 'recorded' AND id > ? ORDER BY id LIMIT ?",
        )
        .all(after, limit) as { id: string; business_id: string }[];
    let rows = next(this.watchCursor);
    if (rows.length === 0 && this.watchCursor !== "") rows = next("");
    const states: ReconcileState[] = [];
    const gated = (businessId: string) =>
      this.obs.latest(businessId)?.snapshot.control.close_mode === "gated" ||
      this.db
        .prepare("SELECT 1 FROM business_handovers WHERE business_id = ? LIMIT 1")
        .get(businessId) !== undefined;
    for (const r of rows) {
      this.watchCursor = r.id;
      if (gated(r.business_id)) continue;
      try {
        states.push((await this.reconcile(null, r.business_id, r.id, { watcher: true })).state);
      } catch {
        // A busy database or a vanished row: the next pass reads it again.
      }
    }
    return states;
  }

  /** Whether a stored handover names exactly this intent, deal, version and digest (Q9). */
  private handoverNames(r: IntentRow, handoverId: string) {
    const h = this.db
      .prepare(
        "SELECT 1 FROM business_handovers WHERE id = ? AND business_id = ? AND intent_id = ? AND deal_seq = ? AND version = ? AND digest = ?",
      )
      .get(handoverId, r.business_id, r.id, r.deal_seq, r.version, r.digest);
    return Boolean(h);
  }

  /** Matches the intent against fresh evidence (§4.2 of the design); changes nothing. */
  private decide(
    r: IntentRow,
    s: CoreSnapshot,
  ):
    | { state: "pending" | "unavailable" | "conflict" | "ended" | "superseded"; code: string }
    | { state: "apply"; outcome: OutcomeV3 } {
    const seq = r.deal_seq;
    const live = s.control.live_deal;
    if (live?.seq === seq) return { state: "pending", code: `deal_${live.state}` };
    const o = s.outcomes.find((x) => x.seq === seq) ?? this.obs.storedOutcome(r.business_id, seq);
    if (!o)
      return this.obs.inHistoryGap(r.business_id, seq, s)
        ? { state: "unavailable", code: "history_gap" }
        : { state: "pending", code: "no_outcome" };
    // Job 003k1: the outcome's identity is compared before ANY terminal state. Versions only rise
    // while a deal is live (revise_sale), so an outcome at a later version means the recorded
    // version was revised away and that later version ended or closed: this intent is
    // superseded, never "ended" or "applied" by another version's outcome. An earlier version, or
    // the same version with another digest, party or price, contradicts the contract: conflict.
    const terms = JSON.parse(r.terms) as { price: string };
    if (o.version > r.version) return { state: "superseded", code: `revised_then_${o.status}` };
    if (
      o.version !== r.version ||
      o.digest !== r.digest ||
      o.seller !== r.seller_account ||
      o.buyer !== r.buyer_account ||
      o.price !== terms.price
    )
      return { state: "conflict", code: "outcome_mismatch" };
    if (o.status !== "closed")
      // terminate keeps the generation: an exact ended outcome names the expected one.
      return o.generation_after === r.expected_generation
        ? { state: "ended", code: o.status }
        : { state: "conflict", code: "outcome_mismatch" };
    if (o.generation_after !== r.expected_generation + 1)
      return { state: "conflict", code: "outcome_mismatch" };
    const c = s.control;
    if (c.generation < o.generation_after) return { state: "pending", code: "control_behind" };
    if (c.generation > o.generation_after || c.owner !== r.buyer_account)
      return { state: "conflict", code: "newer_transfer" };
    if (
      this.personFor(r.buyer_account) !== r.buyer_person_id ||
      this.personFor(r.seller_account) !== r.seller_person_id
    )
      return { state: "conflict", code: "mapping_changed" };
    return { state: "apply", outcome: o };
  }
}
