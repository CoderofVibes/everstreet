// Job 003m: durable customer preparation and reservation (docs/design/CUSTOMER_USE_RUNTIME.md §3,
// §5, §8). An owner binds a release to a contract plan (an offer). A customer prepares one use: the
// server reads the entitlement at a pinned block, allocates the next hold sequence, persists the
// exact signing envelope, and returns it. The customer's own key signs on the customer's side; the
// server only verifies. A confirmed reservation is submitted through an injected writer and
// decided only by exact pinned readback. No remote call is awaited inside a SQLite transaction.
// No provider dispatch, settlement or customer UI here; nothing is wired in main.

import { randomBytes, randomUUID } from "node:crypto";
import {
  type CustomerViewTransport,
  decideReservation,
  type EntitlementV3,
  type ExpectedHold,
  meters,
  type PinnedBlock,
  type PlanV3,
  readCustomerViews,
} from "./customerRead.ts";
import {
  ENVELOPE_VERSION,
  type Envelope,
  envelopeDigest,
  fingerprintPreimage,
  type KeyRef,
  MIN_SERVE_MS,
  preimageOfHold,
  preimageOfUse,
  sha256,
  sha256Hex,
  verifiesEd25519,
} from "./customerSigning.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import type { V3Observations } from "./v3observe.ts";
import { isAccountId, V3ReadError } from "./v3read.ts";

/** What a writer's endpoint said. Recorded as an event; never evidence by itself (§5.2). */
export type WriterAnswer =
  | { status: "opened" | "already"; tx?: string }
  | { status: "refused"; code: string; tx?: string }
  | { status: "unknown"; detail?: string };

/**
 * Submits `open_hold` with an exact stored payload, as the operator account `signer`. It holds no
 * customer key and creates no signature of a customer's. None is configured by default.
 */
export interface CustomerChainWriter {
  readonly network: string;
  readonly signer: string;
  openHold(input: {
    network: string;
    account: string;
    customer: string;
    plan_id: number;
    auth: {
      hold_seq: number;
      units: number;
      serve_until_ms: string;
      key_slot: number;
      key_epoch: number;
    };
    sig: string;
    signal: AbortSignal;
  }): Promise<WriterAnswer>;
}

/** Protects a customer's input at rest (§3.4). Without one, no input is stored at all. */
export interface InputProtection {
  readonly scheme: string;
  protect(input: { person_id: string; request_id: string; bytes: Buffer }): Promise<string>;
}

export interface CustomerUseOptions {
  /** Read-only views with block timestamps; null: customer use is unavailable (the default). */
  reader: CustomerViewTransport | null;
  /** Submits holds; null: nothing can be confirmed. */
  writer: CustomerChainWriter | null;
  /** The platform's METERING account (operator configuration, never a contract fact). */
  operatorAccount: string | null;
  protection?: InputProtection | null;
  serveWindowMs?: number;
  submitMarginMs?: number;
  leaseMs?: number;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  maxSubmissions?: number;
  now?: () => number;
}

export const LIMITS = {
  inputChars: 20_000,
  openPerPerson: 20,
  keptPerPerson: 200,
  eventsPerRequest: 50,
  duePerPass: 25,
  offersPerBusiness: 50,
} as const;

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;
const NETWORK = /^[a-z][a-z0-9-]{0,31}$/;
const OPEN = ["prepared", "reserve_requested", "reserve_unknown", "reserved"] as const;
const iso = () => new Date().toISOString();

type State =
  | "prepared"
  | "reserve_requested"
  | "reserve_unknown"
  | "reserved"
  | "refused"
  | "unresolved"
  | "cancelled"
  | "expired";

interface OfferRow {
  id: string;
  business_id: string;
  project_id: string;
  release_id: string;
  artifact_digest: string;
  network: string;
  account: string;
  plan_id: number;
  plan: string;
  asset: string;
  read_block: string;
  retention_days: number;
  state: "active" | "retired";
  idempotency_key: string;
  request_hash: string;
  created_by: string;
  owner_generation: number;
  created_at: string;
  retired_at: string | null;
}

interface RequestRow {
  id: string;
  person_id: string;
  customer_account: string;
  offer_id: string;
  business_id: string;
  idempotency_key: string;
  request_hash: string;
  input_sha: string;
  input_chars: number;
  input_ref: string | null;
  input_scheme: string | null;
  network: string;
  account: string;
  plan_id: number;
  reg_id: string;
  key_slot: number;
  key_epoch: number;
  public_key: string;
  hold_seq: number;
  units: number;
  slot: number;
  serve_until_ms: string;
  settle_until_ms: string;
  accept_by_ms: string;
  sign_by_ms: number;
  salt: string;
  fingerprint: string;
  hold_message: string;
  use_message: string;
  envelope: string;
  envelope_digest: string;
  hold_sig: string | null;
  use_sig: string | null;
  prepared_block: string;
  notice: string | null;
  state: State;
  reason: string | null;
  serving: number | null;
  evidence: string | null;
  evidence_height: string | null;
  lease_gen: number;
  lease_until: number | null;
  submissions: number;
  allocation: string | null;
  created_at: string;
  updated_at: string;
}

const LABELS: Record<State, { label: string; explanation: string }> = {
  prepared: {
    label: "Prepared",
    explanation:
      "Check the details and sign with your key before the time shown. Nothing is held yet.",
  },
  reserve_requested: {
    label: "Awaiting reservation",
    explanation: "Your signed reservation is recorded and waiting to be sent to the contract.",
  },
  reserve_unknown: {
    label: "Awaiting reservation",
    explanation:
      "Your reservation was sent; the contract hasn't confirmed it yet. It is never sent as a second, different hold.",
  },
  reserved: {
    label: "Reserved",
    explanation: "The contract shows exactly your signed hold of one unit.",
  },
  refused: {
    label: "Not reserved",
    explanation: "The contract shows this reservation did not open and can't open now.",
  },
  unresolved: {
    label: "Unknown",
    explanation:
      "The contract's records can't show whether this reservation opened. Nothing was charged by Everstreet for it, and it won't be retried automatically. You can start a new request.",
  },
  cancelled: { label: "Cancelled", explanation: "You cancelled before signing; nothing was sent." },
  expired: {
    label: "Expired",
    explanation: "It wasn't signed in time; nothing was sent. You can start a new request.",
  },
};

function bad(status: 400 | 404 | 409 | 422 | 503, message: string, code?: string): never {
  throw new HttpError(status, message, code);
}

function unavailable(): never {
  bad(
    503,
    "Customer use isn't connected on this server, so nothing was prepared or sent.",
    "customer_use_unavailable",
  );
}

function readFailed(e: unknown): never {
  if (e instanceof V3ReadError)
    bad(503, "The contract couldn't be read just now; nothing was changed.", `read_${e.code}`);
  throw e;
}

const positive = (v: number | undefined, d: number, name: string) => {
  const x = v ?? d;
  if (!Number.isSafeInteger(x) || x < 1) throw new Error(`customer options: ${name} is invalid`);
  return x;
};

export class CustomerUses {
  private readonly reader: CustomerViewTransport | null;
  private readonly writer: CustomerChainWriter | null;
  private readonly operator: string | null;
  private readonly protection: InputProtection | null;
  private readonly serveWindowMs: number;
  private readonly submitMarginMs: number;
  private readonly leaseMs: number;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly maxSubmissions: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly v3: V3Observations,
    opts: CustomerUseOptions = { reader: null, writer: null, operatorAccount: null },
  ) {
    this.reader = opts.reader;
    this.writer = opts.writer;
    this.operator = opts.operatorAccount;
    this.protection = opts.protection ?? null;
    this.serveWindowMs = positive(opts.serveWindowMs, 600_000, "serveWindowMs");
    this.submitMarginMs = positive(opts.submitMarginMs, 120_000, "submitMarginMs");
    this.leaseMs = positive(opts.leaseMs, 30_000, "leaseMs");
    this.readTimeoutMs = positive(opts.readTimeoutMs, 10_000, "readTimeoutMs");
    this.writeTimeoutMs = positive(opts.writeTimeoutMs, 20_000, "writeTimeoutMs");
    this.maxSubmissions = positive(opts.maxSubmissions, 5, "maxSubmissions");
    this.now = opts.now ?? Date.now;
    // Trusted setup must be sound; a bad option fails here, not at the first customer.
    if (this.operator !== null && !isAccountId(this.operator))
      throw new Error("customer options: operatorAccount is not an account id");
    if (this.writer && this.writer.signer !== this.operator)
      throw new Error("customer options: the writer must submit as the configured operator");
    if (this.writer && !NETWORK.test(this.writer.network))
      throw new Error("customer options: the writer names an invalid network");
    // The customer needs time to sign: the serve window must leave a minute after the margins.
    if (this.serveWindowMs < Number(MIN_SERVE_MS) + this.submitMarginMs + 60_000)
      throw new Error("customer options: the serve window is too short for its margins");
  }

  // ---------- helpers ----------

  private tx<T>(f: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = f();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private offer(id: string) {
    return this.db.prepare("SELECT * FROM customer_offers WHERE id = ?").get(id) as unknown as
      | OfferRow
      | undefined;
  }

  private request(id: string) {
    return this.db.prepare("SELECT * FROM customer_requests WHERE id = ?").get(id) as unknown as
      | RequestRow
      | undefined;
  }

  /** The caller's own request, or 404: another customer, a seller or an owner sees nothing. */
  private own(viewer: Person, id: string) {
    const r = this.request(id);
    if (!r || r.person_id !== viewer.id) bad(404, "No such request");
    return r;
  }

  private accountOf(personId: string) {
    const r = this.db
      .prepare("SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?")
      .get(personId) as { account_id: string } | undefined;
    return r?.account_id ?? null;
  }

  private event(
    id: string,
    kind: string,
    extra: { code?: string; block?: string; lease?: number },
  ) {
    const n = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM customer_request_events WHERE request_id = ?")
        .get(id) as { n: number }
    ).n;
    if (n >= LIMITS.eventsPerRequest) return; // bounded: the state itself is never skipped
    this.db
      .prepare(
        "INSERT INTO customer_request_events (request_id, seq, kind, code, block, lease_gen, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, n + 1, kind, extra.code ?? null, extra.block ?? null, extra.lease ?? null, iso());
  }

  private releaseActive(o: OfferRow) {
    const r = this.db
      .prepare("SELECT state, artifact_digest FROM runtime_releases WHERE id = ?")
      .get(o.release_id) as { state: string; artifact_digest: string } | undefined;
    return r?.state === "active" && r.artifact_digest === o.artifact_digest;
  }

  private binding(o: Pick<OfferRow, "business_id" | "network" | "account">) {
    const b = this.v3.bindingFor(o.business_id);
    if (!b || b.network !== o.network || b.account !== o.account)
      bad(
        409,
        "This business's contract binding changed; nothing was prepared.",
        "binding_changed",
      );
    return b;
  }

  // ---------- offers (the current owner, fenced on the control epoch) ----------

  private offerView(o: OfferRow) {
    return {
      id: o.id,
      state: o.state,
      release_id: o.release_id,
      project_id: o.project_id,
      artifact_digest: o.artifact_digest,
      source: { network: o.network, account: o.account },
      plan_id: o.plan_id,
      plan: JSON.parse(o.plan) as PlanV3,
      asset: o.asset,
      read_block: JSON.parse(o.read_block) as PinnedBlock,
      retention_days: o.retention_days,
      created_at: o.created_at,
      retired_at: o.retired_at,
    };
  }

  async createOffer(viewer: Person, businessId: string, input: Record<string, unknown>) {
    const epoch = this.store.controlEpoch(viewer, businessId); // the owner, or 404
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const releaseId = typeof input.release_id === "string" ? input.release_id : "";
    const planId = input.plan_id;
    if (
      typeof planId !== "number" ||
      !Number.isInteger(planId) ||
      planId < 1 ||
      planId > 0xffff_ffff
    )
      bad(400, "plan_id must be a contract plan number");
    const retention = input.retention_days ?? 30;
    if (
      typeof retention !== "number" ||
      !Number.isInteger(retention) ||
      retention < 1 ||
      retention > 365
    )
      bad(400, "retention_days must be 1 to 365");
    const hash = sha256Hex(JSON.stringify({ releaseId, planId, retention }));
    const prior = this.db
      .prepare("SELECT * FROM customer_offers WHERE business_id = ? AND idempotency_key = ?")
      .get(businessId, key) as unknown as OfferRow | undefined;
    if (prior) {
      if (prior.request_hash !== hash)
        bad(409, "That key was used for a different offer", "idempotency_conflict");
      return { created: false, offer: this.offerView(prior) };
    }
    const release = this.db
      .prepare("SELECT * FROM runtime_releases WHERE id = ? AND business_id = ?")
      .get(releaseId, businessId) as
      | { id: string; project_id: string; artifact_digest: string; state: string }
      | undefined;
    if (!release) bad(404, "No such release for this business");
    if (release.state !== "active")
      bad(409, "Only the active release can be offered", "release_not_active");
    if (!HEX32.test(release.artifact_digest))
      bad(409, "That release has no exact artifact digest", "release_not_active");
    const b = this.v3.bindingFor(businessId);
    if (!b) bad(409, "This business isn't bound to a contract here", "not_bound");
    if (!this.reader) unavailable();
    const read = await readCustomerViews(
      this.reader,
      b,
      { control: true, treasury: true, plan: planId },
      this.readTimeoutMs,
    ).catch(readFailed);
    // Still the owner after the read, before anything is written.
    this.store.stillControls(viewer, epoch);
    if (!read.plan) bad(409, "The contract has no such plan", "no_such_plan");
    const id = randomUUID();
    const at = iso();
    this.tx(() => {
      this.store.stillControls(viewer, epoch);
      const again = this.db
        .prepare("SELECT id FROM customer_offers WHERE business_id = ? AND idempotency_key = ?")
        .get(businessId, key);
      if (again) bad(409, "That key was just used; read the offers again", "idempotency_conflict");
      const n = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM customer_offers WHERE business_id = ?")
          .get(businessId) as { n: number }
      ).n;
      if (n >= LIMITS.offersPerBusiness) bad(409, "This business has the most offers allowed");
      const live = this.db
        .prepare(
          "SELECT state FROM runtime_releases WHERE id = ? AND business_id = ? AND state = 'active'",
        )
        .get(release.id, businessId);
      if (!live) bad(409, "The release changed while this was loading", "release_not_active");
      const dup = this.db
        .prepare(
          "SELECT id FROM customer_offers WHERE release_id = ? AND plan_id = ? AND state = 'active'",
        )
        .get(release.id, planId);
      if (dup) bad(409, "This release is already offered on that plan", "offer_exists");
      this.db
        .prepare(
          `INSERT INTO customer_offers (id, business_id, project_id, release_id, artifact_digest, network, account, plan_id, plan, asset, read_block, retention_days, state, idempotency_key, request_hash, created_by, owner_generation, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          businessId,
          release.project_id,
          release.id,
          release.artifact_digest,
          b.network,
          b.account,
          planId,
          JSON.stringify(read.plan),
          (read.treasury as { asset: string }).asset,
          JSON.stringify(read.block),
          retention,
          key,
          hash,
          viewer.id,
          epoch.generation,
          at,
        );
    });
    return { created: true, offer: this.offerView(this.offer(id) as OfferRow) };
  }

  listOffers(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare("SELECT * FROM customer_offers WHERE business_id = ? ORDER BY created_at, id")
      .all(businessId) as unknown as OfferRow[];
    return { offers: rows.map((o) => this.offerView(o)) };
  }

  retireOffer(viewer: Person, businessId: string, offerId: string) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    return this.tx(() => {
      this.store.stillControls(viewer, epoch);
      const o = this.offer(offerId);
      if (!o || o.business_id !== businessId) bad(404, "No such offer");
      if (o.state === "active")
        this.db
          .prepare("UPDATE customer_offers SET state = 'retired', retired_at = ? WHERE id = ?")
          .run(iso(), offerId);
      return { offer: this.offerView(this.offer(offerId) as OfferRow) };
    });
  }

  // ---------- customer: prepare, status, confirm, cancel ----------

  /** The customer's own view. The salt appears only inside the envelope, only while prepared. */
  private view(r: RequestRow) {
    const l = LABELS[r.state];
    return {
      id: r.id,
      state: r.state,
      label: l.label,
      explanation: l.explanation,
      reason: r.reason,
      serving: r.serving === null ? null : r.serving === 1,
      notice: r.notice,
      offer_id: r.offer_id,
      reservation: {
        network: r.network,
        account: r.account,
        plan_id: r.plan_id,
        customer_account: r.customer_account,
        hold_seq: r.hold_seq,
        units: r.units,
        serve_until_ms: r.serve_until_ms,
        settle_until_ms: r.settle_until_ms,
        accept_by_ms: r.accept_by_ms,
        sign_by_ms: String(r.sign_by_ms),
      },
      input: { sha256: r.input_sha, chars: r.input_chars, retained: r.input_ref !== null },
      evidence: r.evidence ? (JSON.parse(r.evidence) as Record<string, unknown>) : null,
      submissions: r.submissions,
      envelope:
        r.state === "prepared"
          ? { ...(JSON.parse(r.envelope) as Envelope), envelope_digest: r.envelope_digest }
          : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  status(viewer: Person, id: string) {
    this.expireIfDue(id);
    return { use: this.view(this.own(viewer, id)) };
  }

  /** A preparation past its signing time expires (server clock; nothing was ever sent). */
  private expireIfDue(id: string) {
    const r = this.request(id);
    if (r?.state !== "prepared" || this.now() <= r.sign_by_ms) return;
    this.tx(() => {
      const c = this.db
        .prepare(
          "UPDATE customer_requests SET state = 'expired', updated_at = ? WHERE id = ? AND state = 'prepared'",
        )
        .run(iso(), id);
      if (c.changes) this.event(id, "expired", {});
    });
  }

  async prepare(viewer: Person, offerId: string, input: Record<string, unknown>) {
    if (!this.reader || !this.operator) unavailable();
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const text = input.input;
    if (typeof text !== "string" || text.length < 1 || text.length > LIMITS.inputChars)
      bad(400, `input must be 1 to ${LIMITS.inputChars} characters`);
    const slot = input.key_slot ?? 0;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot > 3)
      bad(400, "key_slot must be 0 to 3");
    const o = this.offer(offerId);
    if (!o) bad(404, "No such offer");
    const inputSha = sha256Hex(Buffer.from(text, "utf8"));
    const hash = sha256Hex(JSON.stringify({ offerId, inputSha, slot }));
    // Same key: the same preparation, whatever happened to its reply. Changed input: a conflict.
    const prior = this.db
      .prepare(
        "SELECT id, request_hash FROM customer_requests WHERE person_id = ? AND idempotency_key = ?",
      )
      .get(viewer.id, key) as { id: string; request_hash: string } | undefined;
    if (prior) {
      if (prior.request_hash !== hash)
        bad(409, "That key was used for a different request", "idempotency_conflict");
      return { created: false, ...this.status(viewer, prior.id) };
    }
    if (o.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
    if (!this.releaseActive(o)) bad(409, "This release isn't the active one", "release_not_active");
    const customer = this.accountOf(viewer.id);
    if (!customer) bad(409, "You have no NEAR account linked here", "no_chain_account");
    this.binding(o);
    const read = await readCustomerViews(
      this.reader,
      o,
      { control: true, plan: o.plan_id, entitlement: { customer, plan_id: o.plan_id } },
      this.readTimeoutMs,
    ).catch(readFailed);
    const control = read.control as NonNullable<typeof read.control>;
    const plan = read.plan;
    const e = read.entitlement as EntitlementV3 | null;
    // Unknown or lost authority fails closed (§6); a live deal alone never pauses service.
    if (!meters(control, this.operator))
      bad(
        409,
        "Everstreet can't currently serve this business's customers",
        "operator_not_authorized",
      );
    if (!plan || JSON.stringify(plan) !== o.plan)
      bad(409, "The contract's plan differs from the offer", "plan_changed");
    if (!e?.active) bad(409, "You have no units for this product yet", "no_entitlement");
    const k = e.keys[slot];
    if (k?.state !== "active") bad(409, "That key isn't active", "key_not_active");
    if (e.paused) bad(409, "You paused new holds", "paused");
    if (e.hold_active) bad(409, "Another hold is open for you", "hold_active");
    if (BigInt(e.free) < 1n) bad(409, "You have no free units", "no_free_unit");
    const T = BigInt(read.block.timestamp_ms);
    const day = Number(T / 86_400_000n);
    if (k.day === day && k.held_today + 1 > k.max_units_per_day)
      bad(409, "Your key's daily limit is reached", "daily_cap");
    if (e.hold_seq >= 0xffff_ffff) bad(409, "The hold sequence is exhausted", "sequence_exhausted");
    const window =
      BigInt(this.serveWindowMs) < BigInt(plan.hold_ttl_ms)
        ? BigInt(this.serveWindowMs)
        : BigInt(plan.hold_ttl_ms);
    const serveUntil = T + window;
    const acceptBy = serveUntil - MIN_SERVE_MS;
    const settleUntil = serveUntil + BigInt(plan.settle_grace_ms);
    const signBy = this.now() + Number(acceptBy - T) - this.submitMarginMs;
    if (signBy <= this.now())
      bad(409, "This plan's holds are too short to sign in time", "window_too_short");
    const deal = control.live_deal;
    const notice = !deal
      ? null
      : deal.grants.some((g) => g.account === this.operator && (g.caps & 1) !== 0)
        ? "under_offer_platform_continues"
        : "under_offer_platform_not_granted";

    const id = randomUUID();
    const salt = randomBytes(32).toString("hex");
    const ref: KeyRef = {
      business: o.account,
      plan_id: o.plan_id,
      customer,
      reg_id: e.reg_id,
      key_slot: slot,
      key_epoch: k.epoch,
    };
    const holdSeq = e.hold_seq + 1;
    const fpPre = fingerprintPreimage({
      ...ref,
      network: o.network,
      hold_seq: holdSeq,
      slot: 0,
      request_id: id,
      offer_id: o.id,
      release_id: o.release_id,
      artifact_digest: o.artifact_digest,
      input_sha256: inputSha,
      salt,
    });
    const fingerprint = sha256Hex(fpPre);
    const holdPre = preimageOfHold(ref, {
      hold_seq: holdSeq,
      units: 1,
      serve_until_ms: String(serveUntil),
    });
    const usePre = preimageOfUse(ref, { hold_seq: holdSeq, slot: 0, fingerprint });
    const envelope: Envelope = {
      version: ENVELOPE_VERSION,
      request_id: id,
      offer_id: o.id,
      release_id: o.release_id,
      artifact_digest: o.artifact_digest,
      network: o.network,
      business_account: o.account,
      plan_id: o.plan_id,
      customer_account: customer,
      reg_id: e.reg_id,
      key_slot: slot,
      key_epoch: k.epoch,
      public_key: k.public_key,
      hold: {
        hold_seq: holdSeq,
        units: 1,
        serve_until_ms: String(serveUntil),
        preimage_hex: holdPre.toString("hex"),
        message_hex: sha256(holdPre).toString("hex"),
      },
      use: {
        slot: 0,
        fingerprint_hex: fingerprint,
        preimage_hex: usePre.toString("hex"),
        message_hex: sha256(usePre).toString("hex"),
      },
      commitment: {
        input_sha256: inputSha,
        salt_hex: salt,
        fingerprint_preimage_hex: fpPre.toString("hex"),
      },
      consent: {
        unit_price: plan.unit_price,
        asset: o.asset,
        units: 1,
        retention_days: o.retention_days,
        sign_by_ms: String(signBy),
        accept_by_ms: String(acceptBy),
      },
    };
    const digest = envelopeDigest(envelope);
    const allocation = [o.network, o.account, o.plan_id, customer, e.reg_id].join("|");
    const at = iso();
    const created = this.tx(() => {
      const again = this.db
        .prepare(
          "SELECT id, request_hash FROM customer_requests WHERE person_id = ? AND idempotency_key = ?",
        )
        .get(viewer.id, key) as { id: string; request_hash: string } | undefined;
      if (again) {
        if (again.request_hash !== hash)
          bad(409, "That key was used for a different request", "idempotency_conflict");
        return again.id;
      }
      const now = this.offer(offerId) as OfferRow;
      if (now.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
      if (!this.releaseActive(now))
        bad(409, "This release isn't the active one", "release_not_active");
      const counts = this.db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN state IN (${OPEN.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS open FROM customer_requests WHERE person_id = ?`,
        )
        .get(...OPEN, viewer.id) as { total: number; open: number | null };
      if ((counts.open ?? 0) >= LIMITS.openPerPerson)
        bad(409, "Too many requests are open; finish or cancel some first", "too_many_open");
      if (counts.total >= LIMITS.keptPerPerson)
        bad(409, "Your request history is full", "history_full");
      // One allocation per entitlement (§5.1).
      const held = this.db
        .prepare("SELECT * FROM customer_requests WHERE allocation = ?")
        .get(allocation) as unknown as RequestRow | undefined;
      if (held) {
        if (held.state === "prepared" && this.now() > held.sign_by_ms) {
          this.db
            .prepare("UPDATE customer_requests SET state = 'expired', updated_at = ? WHERE id = ?")
            .run(at, held.id);
          this.event(held.id, "expired", {});
          held.state = "expired";
        }
        // A never-confirmed HoldAuth frees its sequence once no block can accept it, or once the
        // contract shows that sequence used (it then can't open either).
        const neverSent = held.state === "cancelled" || held.state === "expired";
        const dead = T > BigInt(held.accept_by_ms) || e.hold_seq >= held.hold_seq;
        if (!(neverSent && dead))
          bad(409, "Another request of yours is still in progress", "use_in_progress");
        this.db
          .prepare("UPDATE customer_requests SET allocation = NULL, updated_at = ? WHERE id = ?")
          .run(at, held.id);
        this.event(held.id, "allocation_freed", { block: read.block.height });
      }
      this.db
        .prepare(
          `INSERT INTO customer_requests (id, person_id, customer_account, offer_id, business_id, idempotency_key, request_hash, input_sha, input_chars, network, account, plan_id, reg_id, key_slot, key_epoch, public_key, hold_seq, units, slot, serve_until_ms, settle_until_ms, accept_by_ms, sign_by_ms, salt, fingerprint, hold_message, use_message, envelope, envelope_digest, prepared_block, notice, state, allocation, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
        )
        .run(
          id,
          viewer.id,
          customer,
          o.id,
          o.business_id,
          key,
          hash,
          inputSha,
          text.length,
          o.network,
          o.account,
          o.plan_id,
          e.reg_id,
          slot,
          k.epoch,
          k.public_key,
          holdSeq,
          String(serveUntil),
          String(settleUntil),
          String(acceptBy),
          signBy,
          salt,
          fingerprint,
          envelope.hold.message_hex,
          envelope.use.message_hex,
          JSON.stringify(envelope),
          digest,
          JSON.stringify(read.block),
          notice,
          allocation,
          at,
          at,
        );
      this.event(id, "prepared", { block: read.block.height });
      return id;
    });
    if (created === id && this.protection) {
      // Outside the transaction: the protected copy, then its reference. No plaintext fallback.
      const ref = await this.protection.protect({
        person_id: viewer.id,
        request_id: id,
        bytes: Buffer.from(text, "utf8"),
      });
      this.tx(() =>
        this.db
          .prepare("UPDATE customer_requests SET input_ref = ?, input_scheme = ? WHERE id = ?")
          .run(ref, this.protection?.scheme ?? null, id),
      );
    }
    return { created: created === id, ...this.status(viewer, created) };
  }

  cancel(viewer: Person, id: string) {
    this.own(viewer, id);
    this.expireIfDue(id);
    this.tx(() => {
      const r = this.request(id) as RequestRow;
      if (r.state === "cancelled") return;
      if (r.state !== "prepared")
        bad(409, "Only a request that hasn't been signed can be cancelled", "not_prepared");
      this.db
        .prepare("UPDATE customer_requests SET state = 'cancelled', updated_at = ? WHERE id = ?")
        .run(iso(), id);
      this.event(id, "cancelled", {});
    });
    return this.status(viewer, id);
  }

  async confirm(viewer: Person, id: string, input: Record<string, unknown>) {
    const r = this.own(viewer, id);
    const holdSig = input.hold_signature;
    const useSig = input.use_signature;
    if (
      typeof holdSig !== "string" ||
      !HEX64.test(holdSig) ||
      typeof useSig !== "string" ||
      !HEX64.test(useSig)
    )
      bad(400, "Both signatures must be 128 lowercase hex characters");
    if (input.envelope_digest !== r.envelope_digest)
      bad(409, "That isn't the envelope prepared for this request", "envelope_mismatch");
    if (r.state !== "prepared") {
      if (r.hold_sig === holdSig && r.use_sig === useSig) return this.status(viewer, id);
      if (r.state === "cancelled") bad(409, "This request was cancelled", "preparation_cancelled");
      if (r.state === "expired")
        bad(409, "This request expired before it was signed", "preparation_expired");
      bad(409, "This request was already confirmed with other signatures", "already_confirmed");
    }
    if (this.now() > r.sign_by_ms) {
      this.expireIfDue(id);
      bad(409, "This request expired before it was signed", "preparation_expired");
    }
    // Against the stored key and digests only: never a key or message the caller supplies.
    if (
      !verifiesEd25519(r.public_key, r.hold_message, holdSig) ||
      !verifiesEd25519(r.public_key, r.use_message, useSig)
    )
      bad(422, "The signatures don't match this request and key", "signature_invalid");
    if (!this.writer) unavailable();
    const moved = this.tx(() => {
      const c = this.db
        .prepare(
          "UPDATE customer_requests SET state = 'reserve_requested', hold_sig = ?, use_sig = ?, updated_at = ? WHERE id = ? AND state = 'prepared'",
        )
        .run(holdSig, useSig, iso(), id);
      if (c.changes) this.event(id, "confirmed", {});
      return c.changes === 1;
    });
    if (!moved) {
      const now = this.request(id) as RequestRow;
      if (now.hold_sig === holdSig && now.use_sig === useSig) return this.status(viewer, id);
      bad(409, "This request changed while it was being confirmed", "already_confirmed");
    }
    await this.step(id);
    return this.status(viewer, id);
  }

  async reconcile(viewer: Person, id: string) {
    this.own(viewer, id);
    await this.step(id);
    return this.status(viewer, id);
  }

  /** One bounded pass for a later worker: expired preparations, then due reservations. */
  async reconcileDue(limit: number = LIMITS.duePerPass) {
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const stale = this.db
      .prepare(
        "SELECT id FROM customer_requests WHERE state = 'prepared' AND sign_by_ms < ? LIMIT ?",
      )
      .all(this.now(), n) as { id: string }[];
    for (const s of stale) this.expireIfDue(s.id);
    const due = this.db
      .prepare(
        "SELECT id FROM customer_requests WHERE state IN ('reserve_requested','reserve_unknown') AND (lease_until IS NULL OR lease_until <= ?) ORDER BY updated_at, id LIMIT ?",
      )
      .all(this.now(), n) as { id: string }[];
    const results: Record<string, string> = {};
    for (const d of due) results[d.id] = await this.step(d.id);
    return { expired: stale.length, stepped: due.length, results };
  }

  // ---------- one leased step: submit (if due), then exact readback ----------

  /** Claims the lease by compare-and-swap; returns its generation, or null if not ours to take. */
  private claim(id: string): number | null {
    return this.tx(() => {
      const now = this.now();
      const c = this.db
        .prepare(
          "UPDATE customer_requests SET lease_gen = lease_gen + 1, lease_until = ? WHERE id = ? AND state IN ('reserve_requested','reserve_unknown') AND (lease_until IS NULL OR lease_until <= ?)",
        )
        .run(now + this.leaseMs, id, now);
      if (!c.changes) return null;
      return (this.request(id) as RequestRow).lease_gen;
    });
  }

  /** Runs `f` in a transaction only while our lease is still the current one. */
  private underLease(id: string, gen: number, f: (r: RequestRow) => void): boolean {
    return this.tx(() => {
      const r = this.request(id) as RequestRow;
      if (r.lease_gen !== gen || !["reserve_requested", "reserve_unknown"].includes(r.state))
        return false;
      f(r);
      return true;
    });
  }

  private async submit(r: RequestRow, gen: number): Promise<"sent" | "stale"> {
    const writer = this.writer;
    if (!writer) return "sent";
    // Intent first, under the lease: once the call starts its outcome is unknown.
    const ok = this.underLease(r.id, gen, (cur) => {
      this.db
        .prepare(
          "UPDATE customer_requests SET state = 'reserve_unknown', submissions = submissions + 1, updated_at = ? WHERE id = ?",
        )
        .run(iso(), cur.id);
      this.event(cur.id, "submit", { code: String(cur.submissions + 1), lease: gen });
    });
    if (!ok) return "stale";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.writeTimeoutMs);
    let answer: WriterAnswer;
    try {
      answer = await Promise.race([
        writer.openHold({
          network: r.network,
          account: r.account,
          customer: r.customer_account,
          plan_id: r.plan_id,
          auth: {
            hold_seq: r.hold_seq,
            units: r.units,
            serve_until_ms: r.serve_until_ms,
            key_slot: r.key_slot,
            key_epoch: r.key_epoch,
          },
          sig: r.hold_sig as string,
          signal: controller.signal,
        }),
        new Promise<WriterAnswer>((resolve) =>
          controller.signal.addEventListener(
            "abort",
            () => resolve({ status: "unknown", detail: "timeout" }),
            {
              once: true,
            },
          ),
        ),
      ]);
    } catch {
      answer = { status: "unknown", detail: "no answer" };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    const code =
      answer.status === "refused"
        ? /^E_[A-Z_]{1,40}$/.test(answer.code)
          ? answer.code
          : "E_UNRECOGNIZED"
        : answer.status;
    // A writer's answer is an event only; the readback decides (§5.2).
    return this.underLease(r.id, gen, (cur) =>
      this.event(cur.id, "writer_answer", { code, lease: gen }),
    )
      ? "sent"
      : "stale";
  }

  /** One step for one request. Returns what happened, for workers and tests. */
  async step(id: string): Promise<string> {
    const gen = this.claim(id);
    if (gen === null) return "not_due";
    const finish = () =>
      this.underLease(id, gen, () =>
        this.db.prepare("UPDATE customer_requests SET lease_until = NULL WHERE id = ?").run(id),
      );
    let r = this.request(id) as RequestRow;
    if (r.state === "reserve_requested") {
      if (!this.writer) {
        finish();
        return "writer_unavailable";
      }
      if ((await this.submit(r, gen)) === "stale") return "stale";
    }
    if (!this.reader) {
      finish();
      return "reader_unavailable";
    }
    let read: Awaited<ReturnType<typeof readCustomerViews>>;
    try {
      read = await readCustomerViews(
        this.reader,
        r,
        { entitlement: { customer: r.customer_account, plan_id: r.plan_id } },
        this.readTimeoutMs,
      );
    } catch (e) {
      const code = e instanceof V3ReadError ? e.code : "unavailable";
      return this.underLease(id, gen, () => {
        this.event(id, "read_failed", { code, lease: gen });
        this.db.prepare("UPDATE customer_requests SET lease_until = NULL WHERE id = ?").run(id);
      })
        ? "read_failed"
        : "stale";
    }
    r = this.request(id) as RequestRow;
    // An older block than our newest evidence is stale: it never moves the state.
    if (r.evidence_height !== null && BigInt(read.block.height) < BigInt(r.evidence_height)) {
      return this.underLease(id, gen, () => {
        this.event(id, "stale_read", { block: read.block.height, lease: gen });
        this.db.prepare("UPDATE customer_requests SET lease_until = NULL WHERE id = ?").run(id);
      })
        ? "stale_read"
        : "stale";
    }
    const exp: ExpectedHold = {
      reg_id: r.reg_id,
      key_slot: r.key_slot,
      key_epoch: r.key_epoch,
      hold_seq: r.hold_seq,
      units: r.units,
      serve_until_ms: r.serve_until_ms,
      settle_until_ms: r.settle_until_ms,
      accept_by_ms: r.accept_by_ms,
    };
    const e = read.entitlement ?? null;
    const d = decideReservation(exp, e, read.block.timestamp_ms);
    const evidence = JSON.stringify({
      block: read.block,
      decision: d.kind,
      row: d.row,
      reason: "reason" in d ? d.reason : null,
      observed: e
        ? {
            reg_id: e.reg_id,
            hold_seq: e.hold_seq,
            hold_active: e.hold_active,
            hold_units: e.hold_units,
            hold_key_slot: e.hold_key_slot,
            hold_key_epoch: e.hold_key_epoch,
            serve_until_ms: e.serve_until_ms,
            settle_until_ms: e.settle_until_ms,
            last_hold_seq: e.last_hold_seq,
            last_hold_used: e.last_hold_used,
            last_hold_charged: e.last_hold_charged,
          }
        : null,
    });
    let resend = false;
    const applied = this.underLease(id, gen, (cur) => {
      const set = (state: State, reason: string | null, serving: number | null, free: boolean) =>
        this.db
          .prepare(
            `UPDATE customer_requests SET state = ?, reason = ?, serving = ?, evidence = ?, evidence_height = ?, lease_until = NULL, updated_at = ?${free ? ", allocation = NULL" : ""} WHERE id = ?`,
          )
          .run(state, reason, serving, evidence, read.block.height, iso(), id);
      this.event(id, "read", { code: `${d.kind}:${d.row}`, block: read.block.height, lease: gen });
      if (d.kind === "reserved") set("reserved", d.reason, d.serving ? 1 : 0, false);
      else if (d.kind === "refused") set("refused", d.reason, null, true);
      else if (d.kind === "unresolved") set("unresolved", d.reason, null, true);
      else if (d.kind === "inconsistent") set("reserve_unknown", "inconsistent", null, false);
      else {
        // Still acceptable: resend the identical payload, within the bounded number of attempts.
        // Server clock, as policy only: the proof of expiry is row 7's block timestamp.
        const canSend =
          cur.submissions < this.maxSubmissions && this.now() <= Number(cur.accept_by_ms);
        set("reserve_unknown", d.blocked, null, false);
        resend = canSend && d.blocked === null && this.writer !== null;
        if (resend)
          this.db
            .prepare("UPDATE customer_requests SET lease_until = ? WHERE id = ?")
            .run(this.now() + this.leaseMs, id);
      }
    });
    if (!applied) return "stale";
    if (!resend) return d.kind;
    if ((await this.submit(this.request(id) as RequestRow, gen)) === "stale") return "stale";
    finish();
    return "resent";
  }
}
