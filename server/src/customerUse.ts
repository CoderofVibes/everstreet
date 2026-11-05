// Job 003m: durable customer preparation and reservation (docs/design/CUSTOMER_USE_RUNTIME.md §3,
// §5, §8). An owner binds a release to a contract plan (an offer). A customer prepares one use: the
// server reads the entitlement at a pinned block, allocates the next hold sequence, persists the
// exact signing envelope, and returns it. The customer's own key signs on the customer's side; the
// server only verifies. A confirmed reservation is submitted through an injected writer and
// decided only by exact pinned readback. No remote call is awaited inside a SQLite transaction.
// No provider dispatch, settlement or customer UI here; nothing is wired in main.

import { randomBytes, randomUUID } from "node:crypto";
import { validateAnalysisSpec } from "./analysis.ts";
import {
  type CustomerViewTransport,
  decideReservation,
  decideSettlement,
  type EntitlementV3,
  type EvidenceMark,
  type ExpectedHold,
  evidenceProblem,
  markOf,
  type PinnedBlock,
  type PlanV3,
  platformMeters,
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
import { armHandover, openHandover, pauseError, requireCustomerAdmission } from "./handover.ts";
import type { InvocationRow, ManagedRuntime } from "./invocations.ts";
import { inputCeiling, isFulfilled, type RunResult } from "./invocations.ts";
import { maintenanceHealth } from "./maintenance.ts";
import { RUNTIME_LIMITS } from "./runtime.ts";
import { cutoffs, MIN_SIGN_MS, planUsability, reserveMs, type ServeTiming } from "./servePolicy.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { tokenMetaOf } from "./tokenMeta.ts";
import type { V3Observations } from "./v3observe.ts";
import { type ControlV3, isAccountId, V3ReadError } from "./v3read.ts";
import { validateWorkflowSpec } from "./workflow.ts";
import { openCase } from "./workflowCases.ts";

/** What a writer's endpoint said. Recorded as an event; never evidence by itself (§5.2). */
export type WriterAnswer =
  | { status: "opened" | "already" | "applied"; tx?: string }
  | { status: "refused"; code: string; tx?: string }
  | { status: "unknown"; detail?: string };

/**
 * Submits `open_hold` with an exact stored payload, as the operator account `signer`. It holds no
 * customer key and creates no signature of a customer's. None is configured by default.
 */
export interface CustomerChainWriter {
  readonly network: string;
  readonly signer: string;
  /**
   * Job 003w-d: every call carries `operation`, the durable identity of this one submission (the
   * request's id; the writer adds the method). A real writer keeps at most one transaction that
   * can land per operation, so the callers' bounded resends of the identical payload never become
   * a second transaction while an earlier one may still land.
   */
  openHold(input: {
    operation?: string;
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
  /**
   * Job 003o: `settle_hold` with the customer's stored UseAuth, exactly as signed, closing the
   * one-unit hold. The answer is an event; only readback proves a charge.
   */
  settleHold?(input: {
    operation?: string;
    network: string;
    account: string;
    customer: string;
    plan_id: number;
    hold_seq: number;
    uses: { slot: number; fingerprint: string; sig: string }[];
    close: boolean;
    signal: AbortSignal;
  }): Promise<WriterAnswer>;
  /**
   * Job 003o1: `release_hold_for` for this exact registration and hold. The contract checks
   * `reg_id` in the same call, so a delayed release can never close a later registration's hold
   * with the same number (unit test c05/c06). The worker has no unguarded release: a writer
   * without this method can't release at all. Only readback proves the unit returned.
   */
  releaseHoldFor?(input: {
    operation?: string;
    network: string;
    account: string;
    customer: string;
    plan_id: number;
    reg_id: string;
    hold_seq: number;
    signal: AbortSignal;
  }): Promise<WriterAnswer>;
}

/**
 * Protects a customer's input and result at rest (§3.4, §13.5). Without one, no input is stored
 * at all and nothing can be executed: there is no plaintext fallback. `load` and `delete` are
 * needed only for execution and retention (job 003n).
 */
export interface InputProtection {
  readonly scheme: string;
  protect(input: ProtectedContext & { bytes: Buffer }): Promise<string>;
  /**
   * Job 003v: every load and delete carries the caller's EXPECTED context, read from the
   * persisted customer request (never the current business owner or an HTTP viewer). An object
   * stored under another context is refused, so a swapped valid reference can't be read or
   * deleted. Delete is idempotent: an absent object counts as deleted.
   */
  load?(ref: string, ctx: ProtectedContext): Promise<Buffer>;
  delete?(ref: string, ctx: ProtectedContext): Promise<void>;
  /** Stored objects in reference order, for the orphan sweep (`sweepProtected`). */
  list?(after: string | null, limit: number): Promise<ProtectedObjectInfo[]>;
  /** Fixed problem codes (e.g. a wrong key); not ready means nothing new is protected. */
  readiness?(): { ready: boolean; problems: string[] };
}

/** What a protected object belongs to: the customer person, the request, input or result. */
export interface ProtectedContext {
  person_id: string;
  request_id: string;
  kind: "input" | "result";
}

export interface ProtectedObjectInfo extends ProtectedContext {
  ref: string;
  created_ms: number;
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
  /** Time left before serve_until, beyond the runtime's own limit, to admit an execution. */
  executionMarginMs?: number;
  /**
   * Admission freshness (job 003n1): the newest final block must be at most this old by the
   * local clock, and at most `maxFutureSkewMs` ahead of it. Policy, not a chain proof.
   */
  maxBlockAgeMs?: number;
  maxFutureSkewMs?: number;
  /**
   * Job 003o1: how long a completed execution's result may stay undecided (not yet protected)
   * before recovery finalizes it as not delivered. A later protection is then discarded.
   */
  deliveryTimeoutMs?: number;
  /**
   * Job 003wf4: how long a decidable settlement can wait for background maintenance to reach it
   * (servePolicy.ts ServeTiming.settleScheduleMs). The composition sets it from the configured
   * maintenance; 0 (the default) when nothing schedules settlement.
   */
  settleScheduleMs?: number;
  now?: () => number;
}

export const LIMITS = {
  inputChars: 20_000,
  openPerPerson: 20,
  keptPerPerson: 200,
  eventsPerRequest: 50,
  duePerPass: 25,
  offersPerBusiness: 50,
  /** Job 003r: plan inspections per business per minute (each is one bounded contract read). */
  inspectionsPerMinute: 12,
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
  input_deleted_at: string | null;
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
  /** Job 003wf4: the last moment a FIRST submission may start (null: prepared before 003wf4). */
  submit_by_ms: number | null;
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
  evidence_mark: string | null;
  conflict: string | null;
  lease_gen: number;
  lease_until: number | null;
  submissions: number;
  allocation: string | null;
  created_at: string;
  updated_at: string;
}

/** Job 003wf4 (§5): a confirmation that couldn't be sent in time to run. */
const SUBMIT_CUTOFF =
  "It was confirmed too late to send in time to run here, so nothing was sent and nothing is held. You can start a new request.";
/** Job 003wf4 (§5, D1): the original hold opened too late to run here. */
const TOO_LATE = {
  returning:
    "Your hold opened too late to run safely here, so it wasn't run. Your unit is being returned; nothing is charged.",
  returned:
    "Your hold opened too late to run safely here, so it wasn't run. The contract shows your unit back with you; nothing was charged.",
};

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
  cancelled: {
    label: "Cancelled",
    explanation: "You cancelled it here before it was confirmed; nothing was sent from here.",
  },
  expired: {
    label: "Expired",
    explanation: "It wasn't confirmed in time; nothing was sent from here.",
  },
};

function bad(
  status: 400 | 404 | 409 | 422 | 429 | 503,
  message: string,
  code?: string,
  detail?: Record<string, string | number | null>,
): never {
  throw new HttpError(status, message, code, detail);
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
  private readonly executionMarginMs: number;
  private readonly maxBlockAgeMs: number;
  private readonly maxFutureSkewMs: number;
  private readonly deliveryTimeoutMs: number;
  /** Job 003wf4: the configured timing the serve policy (servePolicy.ts) is evaluated against. */
  readonly timing: ServeTiming;

  /** Job 003wf4 (§5): whether this server can serve a plan's holds, under the current settings. */
  planUsability(plan: { hold_ttl_ms: string; settle_grace_ms: string }) {
    return planUsability(this.timing, plan);
  }

  /**
   * Admission freshness (003n1): a block read now is fresh only if its own timestamp is close
   * to the local clock. An endpoint returning a coherent but old final block can't authorize
   * work; a block from the future means the clocks disagree, which also fails closed.
   */
  private fresh(block: PinnedBlock) {
    const t = Number(block.timestamp_ms);
    const now = this.now();
    if (!Number.isSafeInteger(t) || t - now > this.maxFutureSkewMs)
      bad(503, "The server's clock and NEAR's disagree; nothing was run", "clock_uncertain");
    if (now - t > this.maxBlockAgeMs)
      bad(503, "The newest NEAR block read is too old; nothing was run", "evidence_too_old");
  }

  /**
   * Time left on a hold for work starting now, by the later of the local clock and the block
   * time (003n1): neither clock alone may stretch the deadline.
   */
  private timeLeft(serveUntil: string, blockTimestampMs: string) {
    const start = Math.max(this.now(), Number(blockTimestampMs));
    return Number(serveUntil) - start;
  }
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly v3: V3Observations,
    opts: CustomerUseOptions = { reader: null, writer: null, operatorAccount: null },
    /** The managed runtime that executes reserved requests (job 003n); null: not available. */
    private readonly runtime: ManagedRuntime | null = null,
  ) {
    this.executionMarginMs = positive(opts.executionMarginMs, 60_000, "executionMarginMs");
    this.maxBlockAgeMs = positive(opts.maxBlockAgeMs, 120_000, "maxBlockAgeMs");
    this.maxFutureSkewMs = positive(opts.maxFutureSkewMs, 30_000, "maxFutureSkewMs");
    this.deliveryTimeoutMs = positive(opts.deliveryTimeoutMs, 300_000, "deliveryTimeoutMs");
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
    this.timing = {
      serveWindowMs: this.serveWindowMs,
      submitMarginMs: this.submitMarginMs,
      executionMarginMs: this.executionMarginMs,
      deliveryTimeoutMs: this.deliveryTimeoutMs,
      maxBlockAgeMs: this.maxBlockAgeMs,
      maxFutureSkewMs: this.maxFutureSkewMs,
      timeoutMs: runtime?.timeoutMs ?? RUNTIME_LIMITS.maxSeconds * 1000,
      settleScheduleMs: opts.settleScheduleMs ?? 0,
    };
    if (!Number.isSafeInteger(this.timing.settleScheduleMs) || this.timing.settleScheduleMs < 0)
      throw new Error("customer options: settleScheduleMs is invalid");
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

  /**
   * Whether the configured writer and reader serve exactly this request's network as the
   * configured operator (003m1). A mismatch is refused before anything is called.
   */
  private adaptersFit(r: { network: string }) {
    if (this.writer && (this.writer.network !== r.network || this.writer.signer !== this.operator))
      return false;
    if (this.reader?.network !== undefined && this.reader.network !== r.network) return false;
    return true;
  }

  private writerFits(r: { network: string }) {
    if (!this.adaptersFit(r))
      bad(
        409,
        "The configured NEAR connection is for another network or account; nothing was sent.",
        "binding_mismatch",
      );
  }

  /** The last accepted evidence for a request: its mark, or (003m rows) one from its prepared block. */
  private markFor(r: RequestRow): { mark: EvidenceMark; digestKnown: boolean } {
    if (r.evidence_mark)
      return { mark: JSON.parse(r.evidence_mark) as EvidenceMark, digestKnown: true };
    const b = JSON.parse(r.prepared_block) as PinnedBlock;
    const epochs = [0, 0, 0, 0];
    epochs[r.key_slot] = r.key_epoch;
    return {
      mark: {
        ...b,
        digest: "",
        summary: { reg_id: r.reg_id, hold_seq: r.hold_seq - 1, key_epochs: epochs },
      },
      digestKnown: false,
    };
  }

  // ---------- offers (the current owner, fenced on the control epoch) ----------

  private offerView(o: OfferRow) {
    return {
      id: o.id,
      state: o.state,
      release_id: o.release_id,
      project_id: o.project_id,
      artifact_digest: o.artifact_digest,
      product: this.productName(o.release_id),
      source: { network: o.network, account: o.account },
      plan_id: o.plan_id,
      plan: JSON.parse(o.plan) as PlanV3,
      asset: o.asset,
      // As read on the chain (ft_metadata), or null: never a guessed scale.
      token: tokenMetaOf(this.db, o.network, o.asset),
      read_block: JSON.parse(o.read_block) as PinnedBlock,
      retention_days: o.retention_days,
      created_at: o.created_at,
      retired_at: o.retired_at,
    };
  }

  /** The terms a founder is asked to review (003r): what is offered, on which plan, for how long. */
  private offerInput(input: Record<string, unknown>) {
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
    return { releaseId, planId, retention };
  }

  /** The active release, exactly, or a refusal (offers name one tested version). */
  private activeRelease(businessId: string, releaseId: string) {
    const release = this.db
      .prepare("SELECT * FROM runtime_releases WHERE id = ? AND business_id = ?")
      .get(releaseId, businessId) as
      | {
          id: string;
          project_id: string;
          artifact_digest: string;
          artifact_job: string;
          state: string;
          activated_at: string;
        }
      | undefined;
    if (!release) bad(404, "No such release for this business");
    if (release.state !== "active")
      bad(409, "Only the active release can be offered", "release_not_active");
    if (!HEX32.test(release.artifact_digest))
      bad(409, "That release has no exact artifact digest", "release_not_active");
    return release;
  }

  /**
   * Job 003r: one fresh, bounded read of the plan and treasury for exact offer terms, checked
   * after the await: the same owner epoch, the same release and the same contract binding, and
   * a block recent by both clocks. The digest names everything a founder reviews; creating an
   * offer requires it to match a fresh read, so changed terms always need a fresh review.
   */
  private async readTerms(
    viewer: Person,
    businessId: string,
    v: { releaseId: string; planId: number; retention: number },
  ) {
    const epoch = this.store.controlEpoch(viewer, businessId); // the owner, or 404
    const release = this.activeRelease(businessId, v.releaseId);
    const b = this.v3.bindingFor(businessId);
    if (!b) bad(409, "This business isn't bound to a contract here", "not_bound");
    if (!this.reader) unavailable();
    const read = await readCustomerViews(
      this.reader,
      b,
      { control: true, treasury: true, plan: v.planId },
      this.readTimeoutMs,
    ).catch(readFailed);
    // Still the owner, release and binding after the read.
    this.store.stillControls(viewer, epoch);
    this.sameRelease(businessId, release);
    this.sameBinding(businessId, b);
    this.fresh(read.block);
    if (!read.plan) bad(409, "The contract has no such plan", "no_such_plan");
    // Job 003wf4 (§5): whether THIS server can serve the plan's holds, under the current settings.
    // Not part of the reviewed digest: it is the server's capability, evaluated at every read.
    const usability = this.planUsability(read.plan);
    const terms = {
      release_id: release.id,
      artifact_digest: release.artifact_digest,
      network: b.network,
      account: b.account,
      plan_id: v.planId,
      plan: read.plan,
      asset: (read.treasury as { asset: string }).asset,
      retention_days: v.retention,
      owner_generation: epoch.generation,
    };
    return {
      epoch,
      release,
      b,
      read,
      terms,
      usability,
      digest: sha256Hex(JSON.stringify(terms)),
    };
  }

  private sameRelease(businessId: string, r: { id: string; artifact_digest: string }) {
    const live = this.db
      .prepare(
        "SELECT 1 FROM runtime_releases WHERE id = ? AND business_id = ? AND state = 'active' AND artifact_digest = ?",
      )
      .get(r.id, businessId, r.artifact_digest);
    if (!live) bad(409, "The release changed while this was loading", "release_not_active");
  }

  private sameBinding(businessId: string, b: { network: string; account: string }) {
    const now = this.v3.bindingFor(businessId);
    if (!now || now.network !== b.network || now.account !== b.account)
      bad(
        409,
        "This business's contract binding changed while this was loading; nothing was saved.",
        "binding_changed",
      );
  }

  private readonly inspections = new Map<string, number[]>();

  /** A bounded number of inspections per business per minute: each is a contract read. */
  private inspectionAllowed(businessId: string) {
    const now = this.now();
    const recent = (this.inspections.get(businessId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= LIMITS.inspectionsPerMinute)
      bad(429, "Too many plan inspections just now; wait a minute.", "too_many_inspections");
    recent.push(now);
    this.inspections.set(businessId, recent);
    if (this.inspections.size > 1000) this.inspections.clear(); // bounded memory
  }

  private productName(releaseId: string) {
    const a = this.db
      .prepare(
        "SELECT a.content, j.revision FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job JOIN build_jobs j ON j.id = r.artifact_job WHERE r.id = ?",
      )
      .get(releaseId) as { content: string; revision: number } | undefined;
    let name = "Released product";
    try {
      const n = a ? (JSON.parse(a.content) as { name?: unknown }).name : undefined;
      if (typeof n === "string" && n.trim()) name = n.slice(0, 120);
    } catch {
      // an unreadable artifact keeps the neutral name
    }
    return { name, revision: a?.revision ?? null };
  }

  /**
   * Job 003r: the owner's plan inspector. One plan number, one bounded read; it returns the
   * observed terms with their block and the digest a create must present. Nothing is written.
   */
  async inspectOffer(viewer: Person, businessId: string, input: Record<string, unknown>) {
    this.store.controlEpoch(viewer, businessId); // the owner, or 404, before any read
    const v = this.offerInput(input);
    this.inspectionAllowed(businessId);
    const t = await this.readTerms(viewer, businessId, v);
    const existing = this.db
      .prepare(
        "SELECT id FROM customer_offers WHERE release_id = ? AND plan_id = ? AND state = 'active'",
      )
      .get(t.release.id, v.planId) as { id: string } | undefined;
    return {
      inspection: {
        release: {
          id: t.release.id,
          project_id: t.release.project_id,
          artifact_digest: t.release.artifact_digest,
          activated_at: t.release.activated_at,
          product: this.productName(t.release.id),
        },
        source: { network: t.b.network, account: t.b.account },
        plan_id: v.planId,
        plan: t.terms.plan,
        asset: t.terms.asset,
        retention_days: v.retention,
        block: t.read.block,
        metering: {
          operator: this.operator,
          platform_meters:
            this.operator !== null && t.read.control
              ? platformMeters(t.read.control, this.operator)
              : null,
        },
        owner_generation: t.epoch.generation,
        terms_digest: t.digest,
        active_offer: existing?.id ?? null,
        serve: t.usability,
      },
    };
  }

  /**
   * Job 003r: what is configured here, what is unavailable and what is unknown, in order, from
   * local facts only. It never claims a plan exists or that anything is live: plan terms are
   * observed only by an inspection, and live use only by a customer's completed use.
   */
  offerReadiness(viewer: Person, businessId: string, projectId: string | undefined) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const business = this.db
      .prepare("SELECT published_at FROM businesses WHERE id = ?")
      .get(businessId) as { published_at: string | null };
    const release = (
      projectId
        ? this.db
            .prepare(
              "SELECT id, project_id, artifact_digest, activated_at FROM runtime_releases WHERE business_id = ? AND project_id = ? AND state = 'active'",
            )
            .get(businessId, projectId)
        : undefined
    ) as
      | { id: string; project_id: string; artifact_digest: string; activated_at: string }
      | undefined;
    const b = this.v3.bindingFor(businessId);
    const runtime = this.runtime?.availability() ?? null;
    const counts = this.db
      .prepare(
        "SELECT SUM(state = 'active') AS active, SUM(state = 'retired') AS retired FROM customer_offers WHERE business_id = ? AND (? IS NULL OR project_id = ?)",
      )
      .get(businessId, projectId ?? null, projectId ?? null) as {
      active: number | null;
      retired: number | null;
    };
    type Item = {
      key: string;
      label: string;
      state: "observed" | "configured" | "unavailable" | "unknown";
      detail: string;
      next: string | null;
    };
    const items: Item[] = [
      release
        ? {
            key: "release",
            label: "Tested release",
            state: "configured",
            detail: `${this.productName(release.id).name} is the active release here, since ${release.activated_at}.`,
            next: null,
          }
        : {
            key: "release",
            label: "Tested release",
            state: "unavailable",
            detail: "No version of this product is released.",
            next: "Run checks and release a version above.",
          },
      business.published_at
        ? {
            key: "page",
            label: "Business page",
            state: "configured",
            detail: "Published: customers can find this business's page.",
            next: null,
          }
        : {
            key: "page",
            label: "Business page",
            state: "unavailable",
            detail: "Not published, so customers can't open any offer.",
            next: "Publish the business page from the studio.",
          },
      b
        ? {
            key: "binding",
            label: "Contract",
            state: "configured",
            detail: `Bound here to ${b.account} on ${b.network}.`,
            next: null,
          }
        : {
            key: "binding",
            label: "Contract",
            state: "unavailable",
            detail: "This business isn't connected to a v3 contract on this server.",
            next: "Connect the business's contract before offering anything.",
          },
      {
        key: "plan",
        label: "Plan and price",
        state: "unknown",
        detail: "Not read yet. Terms are only shown as observed from a fresh inspection.",
        next: "Inspect a plan number below.",
      },
      this.reader
        ? {
            key: "reader",
            label: "Reading NEAR",
            state: "configured",
            detail:
              "A reader is set on this server; it's observed only when an inspection succeeds.",
            next: null,
          }
        : {
            key: "reader",
            label: "Reading NEAR",
            state: "unavailable",
            detail: "Reading the contract isn't connected on this server.",
            next: "The operator connects a NEAR reader; nothing can be offered or used until then.",
          },
      this.writer && this.operator
        ? {
            key: "metering",
            label: "Metering",
            state: "configured",
            detail: `The platform submits as ${this.operator}; whether the contract lets it meter is read at inspection.`,
            next: null,
          }
        : {
            key: "metering",
            label: "Metering",
            state: "unavailable",
            detail: "No metering account is connected, so no unit can be reserved or charged.",
            next: "The operator connects a metering account.",
          },
      this.protection && this.protection.readiness?.().ready === false
        ? {
            key: "protection",
            label: "Protected storage",
            state: "unavailable",
            detail:
              "Protected storage is connected but its key doesn't match the stored documents, so nothing new is kept.",
            next: "The operator checks the protected storage keys.",
          }
        : this.protection && (this.protection.readiness?.().problems.length ?? 0) > 0
          ? {
              // 003v (Astra): new documents can still be kept, but some stored ones can't be read,
              // because a key they were written with is missing or wrong. Writes work; reads of
              // those objects don't, and the item says so with an operator action.
              key: "protection",
              label: "Protected storage",
              state: "configured",
              detail: `New documents and results are protected at rest (${this.protection.scheme}), but some kept ones can't be read: a key they were written with is missing or doesn't match.`,
              next: "The operator restores the older protected storage key.",
            }
          : this.protection
            ? {
                key: "protection",
                label: "Protected storage",
                state: "configured",
                detail: `Documents and results are protected at rest (${this.protection.scheme}).`,
                next: null,
              }
            : {
                key: "protection",
                label: "Protected storage",
                state: "unavailable",
                detail: "No protected storage is connected, so no document can be kept or run.",
                next: "The operator connects protected storage.",
              },
      this.cleanupItem(businessId),
      this.maintenanceItem(businessId),
      runtime?.available
        ? {
            key: "runtime",
            label: "Running the product",
            state: "configured",
            detail: "The managed runtime is available here.",
            next: null,
          }
        : {
            key: "runtime",
            label: "Running the product",
            state: "unavailable",
            detail: runtime?.reason ?? "Running products isn't connected on this server.",
            next: "The operator connects the runtime.",
          },
      {
        key: "authorization",
        label: "Customer authorization",
        state: "unavailable",
        detail:
          "The app ships no signer or wallet connection, so customers can't authorize a use here yet.",
        next: "A wallet connection is a later, reviewed step; nothing to enter here.",
      },
      (counts.active ?? 0) > 0
        ? {
            key: "offer",
            label: "Customer offer",
            state: "configured",
            detail: `${counts.active} active here. An offer is a local configuration, not proof that use works.`,
            next: null,
          }
        : {
            key: "offer",
            label: "Customer offer",
            state: "unknown",
            detail: "None active for this product.",
            next: "Review an inspected plan and create the offer.",
          },
    ];
    return {
      readiness: {
        owner_generation: epoch.generation,
        evaluated_at: iso(),
        items,
        next: items.find((i) => i.next !== null)?.next ?? null,
        binding: b ? { network: b.network, account: b.account } : null,
        release: release
          ? {
              id: release.id,
              artifact_digest: release.artifact_digest,
              activated_at: release.activated_at,
              product: this.productName(release.id),
            }
          : null,
        offers: { active: counts.active ?? 0, retired: counts.retired ?? 0 },
      },
    };
  }

  /**
   * Job 003r1: retention, honestly. Every read refuses a result past its retention time (always
   * enforced). Deleting it needs a deletion capability AND a retention pass; this server
   * schedules none, so cleanup is "unknown" unless recorded deletions show a pass has run.
   */
  private cleanupItem(businessId: string) {
    const label = "Result cleanup";
    const enforced = "Every read refuses a result past its retention time.";
    if (!this.protection?.delete)
      return {
        key: "cleanup",
        label,
        state: "unavailable" as const,
        detail: `${enforced} No deletion is connected, so results past retention aren't deleted here.`,
        next: "The operator connects storage that can delete and schedules the retention pass.",
      };
    const facts = this.db
      .prepare(
        `SELECT SUM(x.result_state = 'deleted') AS deleted, MAX(CASE WHEN x.result_state = 'deleted' THEN x.updated_at END) AS last,
                SUM(x.result_state = 'stored' AND x.retention_until_ms <= ?) AS overdue
         FROM customer_executions x JOIN customer_requests r ON r.id = x.request_id WHERE r.business_id = ?`,
      )
      .get(this.now(), businessId) as {
      deleted: number | null;
      last: string | null;
      overdue: number | null;
    };
    const deleted = facts.deleted ?? 0;
    const overdue = facts.overdue ?? 0;
    const waiting = overdue > 0 ? ` ${overdue} past retention not yet deleted.` : "";
    // Job 002d: three separate facts: capability (above), scheduled work actually observed (a
    // running maintenance heartbeat), and recorded deletions and failures.
    const h = maintenanceHealth(this.db, businessId, this.now());
    const failing =
      h.work.deletions_failing > 0
        ? ` ${h.work.deletions_failing} deletions failing, retried later.`
        : "";
    if (h.worker.state === "running")
      return {
        key: "cleanup",
        label,
        state: "observed" as const,
        detail: `${enforced} Background maintenance is running (last heartbeat ${h.worker.heartbeat_at}); ${deleted} deleted so far.${waiting}${failing}`,
        next: null,
      };
    if (deleted > 0)
      return {
        key: "cleanup",
        label,
        state: "observed" as const,
        detail: `${enforced} A retention pass deleted ${deleted}, most recently at ${facts.last}.${waiting}${failing} That shows it has run, not that it runs on a schedule.`,
        next: null,
      };
    return {
      key: "cleanup",
      label,
      state: "unknown" as const,
      detail: `${enforced} Storage here can delete, but no retention pass is scheduled on this server and none has been recorded.${waiting}`,
      next: "The operator schedules the retention pass; nothing to enter here.",
    };
  }

  /**
   * Job 003t1: this service's clock and the background worker's health, for the owner's books
   * (read only; the caller has already checked control).
   */
  operationsService(businessId: string) {
    const nowMs = this.now();
    return { nowMs, health: maintenanceHealth(this.db, businessId, nowMs) };
  }

  /**
   * Job 002d: the background maintenance item. Its worker state is the platform's; its counts are
   * this business's own obligations. A heartbeat alone isn't presented as everything healthy.
   */
  private maintenanceItem(businessId: string) {
    const h = maintenanceHealth(this.db, businessId, this.now());
    const w = h.work;
    const work = [
      w.reservations_pending && `${w.reservations_pending} reservations awaiting readback`,
      w.units_waiting && `${w.units_waiting} units waiting to settle`,
      w.units_unknown && `${w.units_unknown} unit outcomes not yet known`,
      w.paused_by_authority &&
        `${w.paused_by_authority} paused: the platform isn't allowed to meter on the contract now`,
      w.needs_attention && `${w.needs_attention} need attention`,
    ]
      .filter(Boolean)
      .join("; ");
    const tail = work ? ` ${work}.` : " Nothing waiting for this business.";
    const label = "Background maintenance";
    const attention = w.needs_attention > 0 || w.paused_by_authority > 0;
    if (h.worker.state === "running")
      return {
        key: "maintenance",
        label,
        state: "observed" as const,
        detail: `Running: last heartbeat ${h.worker.heartbeat_at}, last pass ${h.worker.last_pass_at ?? "not finished yet"}.${tail} A heartbeat doesn't show every connected service is healthy.`,
        next: attention ? "Open the affected customer uses; they say what is needed." : null,
      };
    if (h.worker.state === "overdue")
      return {
        key: "maintenance",
        label,
        state: "unknown" as const,
        detail: `Overdue: the last heartbeat was ${h.worker.heartbeat_at}.${tail}`,
        next: "The operator checks the maintenance process; customers can still check their own uses.",
      };
    // Job 002d2: a pass run on request is evidence that it ran, not a schedule.
    const why =
      h.worker.state === "stopped"
        ? "Stopped"
        : h.worker.state === "not_scheduled"
          ? `Not scheduled: a pass ran only when asked${h.worker.last_pass_at ? ` (last at ${h.worker.last_pass_at})` : ""}${h.worker.in_flight ? "; one is in progress now" : ""}`
          : "Not started on this server";
    return {
      key: "maintenance",
      label,
      state: "unavailable" as const,
      detail: `${why}: reservations, units and cleanup advance only when another pass runs or a customer or owner asks.${tail}`,
      next: "The operator starts background maintenance; nothing to enter here.",
    };
  }

  async createOffer(viewer: Person, businessId: string, input: Record<string, unknown>) {
    this.store.controlEpoch(viewer, businessId); // the owner, or 404
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const v = this.offerInput(input);
    const reviewed = typeof input.reviewed_terms === "string" ? input.reviewed_terms : "";
    if (!HEX32.test(reviewed))
      bad(400, "reviewed_terms must be the digest of an inspection you reviewed", "not_reviewed");
    const { releaseId, planId, retention } = v;
    const hash = sha256Hex(JSON.stringify({ releaseId, planId, retention, reviewed }));
    const replay = () => {
      const prior = this.db
        .prepare("SELECT * FROM customer_offers WHERE business_id = ? AND idempotency_key = ?")
        .get(businessId, key) as unknown as OfferRow | undefined;
      if (!prior) return null;
      if (prior.request_hash !== hash)
        bad(409, "That key was used for a different offer", "idempotency_conflict");
      // The original, as it is now: a retired offer is never reactivated by a retry.
      return { created: false, offer: this.offerView(prior) };
    };
    const first = replay();
    if (first) return first;
    const t = await this.readTerms(viewer, businessId, v);
    if (t.digest !== reviewed)
      bad(
        409,
        "The terms changed since you reviewed them; nothing was created. Inspect again and review the new terms.",
        "terms_changed",
      );
    if (!t.usability.usable)
      bad(409, t.usability.reason ?? "This plan can't be served here", "plan_unusable", {
        min_hold_ms: t.usability.min_hold_ms,
      });
    const { epoch, release, b, read } = t;
    const id = randomUUID();
    const at = iso();
    const done = this.tx(() => {
      const again = replay(); // a concurrent retry of this same request
      if (again) return again;
      this.store.stillControls(viewer, epoch);
      this.sameRelease(businessId, release);
      this.sameBinding(businessId, b);
      const n = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM customer_offers WHERE business_id = ?")
          .get(businessId) as { n: number }
      ).n;
      if (n >= LIMITS.offersPerBusiness) bad(409, "This business has the most offers allowed");
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
      return null;
    });
    if (done) return done;
    return { created: true, offer: this.offerView(this.offer(id) as OfferRow) };
  }

  listOffers(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare(
        `SELECT * FROM customer_offers WHERE business_id = ? ORDER BY created_at, id LIMIT ${LIMITS.offersPerBusiness}`,
      )
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

  // ---------- public product summaries and the customer's own list (job 003q) ----------

  /**
   * What anyone may know about an offer: the business, the product's declared fields and input
   * limit (from the released artifact), and the exact one-use terms. No customer data.
   */
  private productOf(o: OfferRow) {
    const b = this.db
      .prepare("SELECT name, slug FROM businesses WHERE id = ?")
      .get(o.business_id) as { name: string; slug: string };
    const a = this.db
      .prepare(
        "SELECT a.kind, a.content FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job WHERE r.id = ?",
      )
      .get(o.release_id) as { kind: string; content: string } | undefined;
    // Workflow engine: the public product is the intake form and its stages (no document limit).
    const wf = a?.kind === "workflow_spec" ? validateWorkflowSpec(JSON.parse(a.content)) : null;
    // Analysis engine: the public product is the form (what the agent reads, and context).
    const an = a?.kind === "analysis_spec" ? validateAnalysisSpec(JSON.parse(a.content)) : null;
    const spec =
      a && !wf && !an
        ? (JSON.parse(a.content) as {
            name?: string;
            input?: { max_chars?: number };
            fields?: { key: string; label: string; type: string; required: boolean }[];
          })
        : {};
    const plan = JSON.parse(o.plan) as PlanV3;
    return {
      offer_id: o.id,
      offer_state: o.state,
      business: { name: b.name, slug: b.slug },
      product: wf
        ? {
            kind: "workflow" as const,
            name: wf.name,
            max_chars: inputCeiling({ kind: "workflow_spec", spec: wf }, LIMITS.inputChars),
            fields: wf.intake.fields.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              required: f.required,
              max_chars: f.max_chars,
              options: f.options,
            })),
            stages: wf.stages.map((st) => ({ key: st.key, label: st.label })),
          }
        : an
          ? {
              kind: "analysis" as const,
              name: an.name,
              result_title: an.result_title,
              max_chars: inputCeiling({ kind: "analysis_spec", spec: an }, LIMITS.inputChars),
              fields: [an.source, ...an.context].map((f, i) => ({
                key: f.key,
                label: f.label,
                type: "long_text",
                required: i === 0,
                max_chars: f.max_chars,
                options: [] as string[],
              })),
              stages: [] as { key: string; label: string }[],
            }
          : {
              kind: "extraction" as const,
              name: spec.name ?? "Released product",
              max_chars: Math.min(spec.input?.max_chars ?? LIMITS.inputChars, LIMITS.inputChars),
              fields: (spec.fields ?? []).slice(0, 40).map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                required: f.required,
              })),
            },
      terms: {
        units_per_use: 1,
        unit_price: plan.unit_price,
        asset: o.asset,
        retention_days: o.retention_days,
        network: o.network,
        contract: o.account,
        token: tokenMetaOf(this.db, o.network, o.asset),
      },
    };
  }

  /** Active offers of a published business; an unpublished one is not found (no guessing). */
  publicOffers(slug: string) {
    const b = this.db
      .prepare("SELECT id FROM businesses WHERE slug = ? AND published_at IS NOT NULL")
      .get(slug) as { id: string } | undefined;
    if (!b) bad(404, "This page is not published");
    const rows = this.db
      .prepare(
        "SELECT * FROM customer_offers WHERE business_id = ? AND state = 'active' ORDER BY created_at, id LIMIT 10",
      )
      .all(b.id) as unknown as OfferRow[];
    return { offers: rows.map((o) => this.productOf(o)) };
  }

  /** One offer, only while it is active on a published business. */
  publicOffer(offerId: string) {
    const o = this.offer(offerId);
    const published = o
      ? this.db
          .prepare("SELECT 1 AS ok FROM businesses WHERE id = ? AND published_at IS NOT NULL")
          .get(o.business_id)
      : undefined;
    if (o?.state !== "active" || !published) bad(404, "No such product offer");
    return { offer: this.productOf(o) };
  }

  /**
   * The caller's own requests, newest first, bounded. A summary only: no envelope, salt,
   * signatures, input or result. Retired offers still show (it's the customer's history).
   */
  listUses(viewer: Person, limit = 20) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
    const rows = this.db
      .prepare(
        "SELECT * FROM customer_requests WHERE person_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(viewer.id, n) as unknown as RequestRow[];
    return {
      uses: rows.map((r) => {
        const o = this.offer(r.offer_id) as OfferRow;
        const p = this.productOf(o);
        const x = this.executionView(this.execution(r.id));
        return {
          id: r.id,
          state: r.state,
          label: LABELS[r.state].label,
          offer_id: r.offer_id,
          business: p.business,
          product: { name: p.product.name },
          execution: x
            ? { state: x.state, result: x.result, fulfilled: x.fulfilled, delivery: x.delivery }
            : null,
          unit: this.unitsView(r).unit,
          headline: this.headline(r),
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
      }),
    };
  }

  /**
   * What the request is now, in one title and sentence (003q1), composed from reservation,
   * execution and settlement without changing any of them. `state`/`label` stay the protocol's.
   */
  private headline(r: RequestRow): { title: string; detail: string } {
    const units = this.unitsView(r).unit;
    if (r.state === "prepared")
      return {
        title: "Ready to review",
        detail: "Check the details and authorize it before the time shown. Nothing is held yet.",
      };
    if (r.state !== "reserved") return { title: LABELS[r.state].label, detail: this.explain(r) };
    // Job 003wf4 (§5, D1): an original that opened too late to run here.
    if (this.settlement(r.id)?.reason === "too_late_to_run" && units === "release_pending")
      return {
        title: "Returning your unit",
        detail: TOO_LATE.returning,
      };
    if (this.settlement(r.id)?.reason === "too_late_to_run" && units === "returned")
      return { title: "Ended, unit returned", detail: TOO_LATE.returned };
    switch (units) {
      case "charged":
        return {
          title: "Completed",
          detail: "This use ran, and the contract shows exactly one unit charged.",
        };
      case "returned":
        return {
          title: "Ended, unit returned",
          detail: "The contract shows your unit back with you; nothing was charged.",
        };
      case "charge_pending":
      case "release_pending":
        return {
          title: "Settling your unit",
          detail: "Waiting for the contract to confirm what happened to your unit.",
        };
      case "conflict":
      case "unknown":
        return {
          title: "Needs checking",
          detail:
            "The contract's records can't yet show what happened to your unit. Nothing is charged or refunded on a guess.",
        };
    }
    const x = this.executionView(this.execution(r.id));
    if (!x) return { title: LABELS.reserved.label, detail: LABELS.reserved.explanation };
    if (x.state === "running")
      return {
        title: "Running",
        detail: "Your document is being processed. It is never run twice.",
      };
    if (x.fulfilled)
      return { title: "Result ready", detail: "Your result is ready; your unit is settled next." };
    if (x.delivery === "pending")
      return { title: "Saving your result", detail: "Your result is being saved privately." };
    return {
      title: "Ended without a result",
      detail: "This run didn't produce a result you can use, so it isn't charged.",
    };
  }

  /**
   * The caller's own request made under an exact idempotency key (003q1), so a page that lost the
   * prepare answer can find it again after a reload. Only the caller's own; anyone else's key
   * finds nothing, and nothing is guessed from the product or title.
   */
  byKey(viewer: Person, key: string) {
    if (!KEY.test(key)) bad(404, "No such request");
    const r = this.db
      .prepare("SELECT id FROM customer_requests WHERE person_id = ? AND idempotency_key = ?")
      .get(viewer.id, key) as { id: string } | undefined;
    if (!r) bad(404, "No such request");
    return this.status(viewer, r.id);
  }

  /** The customer's own view. The salt appears only inside the envelope, only while prepared. */
  /**
   * Job 003r1: whether a new request for these units may start, for a request that ended without
   * being confirmed. While its unit allocation is held and its authorization deadline hasn't
   * passed by this server's clock, the answer is "wait" with that deadline. Otherwise "check": a
   * new request reads the contract first, which decides (the server clock alone never frees it).
   */
  private nextUse(r: RequestRow) {
    if (r.state !== "cancelled" && r.state !== "expired") return null;
    if (r.allocation !== null && this.now() <= Number(r.accept_by_ms))
      return { state: "wait" as const, until_ms: r.accept_by_ms };
    return { state: "check" as const, until_ms: null };
  }

  /** The state's explanation, or the reason's where the state alone would mislead (003wf4). */
  private explain(r: RequestRow) {
    if (r.state === "cancelled" && r.reason === "submit_cutoff") return SUBMIT_CUTOFF;
    return LABELS[r.state].explanation;
  }

  private view(r: RequestRow) {
    const l = LABELS[r.state];
    return {
      headline: this.headline(r),
      next_use: this.nextUse(r),
      id: r.id,
      state: r.state,
      label: l.label,
      explanation: this.explain(r),
      // Public facts about what this request is for (003q); never another customer's data.
      offer: this.productOf(this.offer(r.offer_id) as OfferRow),
      reason: r.reason,
      // Historical (003m1): whether the hold was serving at the evidence block. Never a
      // capability: `ready_now` is always false here, and any dispatch revalidates afresh.
      serving: r.serving === null ? null : r.serving === 1,
      serving_observed_at_ms: r.evidence
        ? ((JSON.parse(r.evidence) as { block: PinnedBlock }).block.timestamp_ms ?? null)
        : null,
      ready_now: false,
      evidence_conflict: r.conflict ? (JSON.parse(r.conflict) as { reason: string }).reason : null,
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
      execution: this.executionView(this.execution(r.id)),
      units: this.unitsView(r),
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

  /**
   * Job 003w-e2 (APPLICATION_COMPOSITION §9.4): a FRESH readback of the caller's own entitlement
   * key slots for an offer, at one final block. The browser's device key is ready only when this
   * shows its slot active with its public key; nothing here is cached or optimistic. Public keys
   * only: the server never holds a customer's private key.
   */
  async deviceKeys(viewer: Person, offerId: string) {
    if (!this.reader) unavailable();
    const o = this.offer(offerId);
    if (!o) bad(404, "No such offer");
    const customer = this.accountOf(viewer.id);
    if (!customer) bad(409, "You have no NEAR account linked here", "no_chain_account");
    const read = await readCustomerViews(
      this.reader,
      o,
      { plan: o.plan_id, entitlement: { customer, plan_id: o.plan_id } },
      this.readTimeoutMs,
    ).catch(readFailed);
    const e = read.entitlement as EntitlementV3 | null;
    // Job 003wec (§11.2): whether this contract has the guarded revocation, read at the SAME
    // block. A missing view (an older contract), an answer from another block or any other shape
    // is "not supported", never an error: keys and uses still work, only revoking is refused.
    // Astra's KeyCapabilityTimeoutReview: bounded by its own deadline (the read timeout), with a
    // cancellation signal for a transport that honours it, and settled as false at the deadline
    // even if the transport never answers; a late answer changes nothing.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, this.readTimeoutMs);
    });
    const answered = this.reader
      .view({
        network: o.network,
        account: o.account,
        method: "get_key_terms",
        args: {},
        block: read.block,
        signal: controller.signal,
      })
      .then((a) => {
        if (a.block.height !== read.block.height || a.block.hash !== read.block.hash) return false;
        if (typeof a.result !== "string" || a.result.length > 256) return false;
        const t = JSON.parse(a.result) as Record<string, unknown> | null;
        return !!t && Object.keys(t).length === 2 && t.version === 1 && t.guarded_revoke === true;
      })
      .catch(() => false);
    const guarded = await Promise.race([answered, deadline]).finally(() => clearTimeout(timer));
    return {
      network: o.network,
      contract: o.account,
      plan_id: o.plan_id,
      customer,
      guarded_revoke: guarded,
      plan_max_hold_units: read.plan ? read.plan.max_hold_units : null,
      block: read.block,
      registered: Boolean(e),
      active: Boolean(e?.active),
      reg_id: e?.reg_id ?? null,
      keys: (e?.keys ?? []).map((k) => ({
        slot: k.slot,
        state: k.state,
        epoch: k.epoch,
        public_key: k.public_key,
        max_hold_units: k.max_hold_units,
        max_units_per_day: k.max_units_per_day,
      })),
    };
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
      // A retry carries the same input (the hash proves it): if protecting it failed or never
      // finished the first time, it is protected now, once (003n).
      await this.protectInput(prior.id, text);
      return { created: false, ...this.status(viewer, prior.id) };
    }
    if (o.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
    if (!this.releaseActive(o)) bad(409, "This release isn't the active one", "release_not_active");
    const customer = this.accountOf(viewer.id);
    if (!customer) bad(409, "You have no NEAR account linked here", "no_chain_account");
    this.binding(o);
    this.writerFits(o);
    const read = await readCustomerViews(
      this.reader,
      o,
      { control: true, plan: o.plan_id, entitlement: { customer, plan_id: o.plan_id } },
      this.readTimeoutMs,
    ).catch(readFailed);
    const control = read.control as NonNullable<typeof read.control>;
    const plan = read.plan;
    const e = read.entitlement as EntitlementV3 | null;
    // Deadlines are computed from this block's time: it must be recent by the local clock (003n1).
    this.fresh(read.block);
    // Job 003wf3 (MANAGED_HANDOVER.md §16.3): a Gated deal Closing arms this business's handover
    // gate from this very read; while it is open, nothing new is prepared (nothing is signed).
    const paused = armHandover(this.db, {
      businessId: o.business_id,
      network: o.network,
      account: o.account,
      block: read.block,
      control,
      source: "customer_prepare",
      now: this.now(),
    });
    if (paused) throw pauseError("none", paused);
    // Unknown or lost authority fails closed (§6); a live deal alone never pauses service.
    // Platform policy (narrower than the contract's owner-or-operator rule): a granted operator.
    if (!platformMeters(control, this.operator))
      bad(
        409,
        "Everstreet can't currently serve this business's customers",
        "operator_not_authorized",
      );
    if (!plan || JSON.stringify(plan) !== o.plan)
      bad(409, "The contract's plan differs from the offer", "plan_changed");
    // Job 003wf4 (§5): the same policy as offer creation, under the current settings.
    if (!this.planUsability(plan).usable)
      bad(409, "This offer can't be served here right now; nothing was held", "plan_unusable");
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
    // The contract's expiry (unchanged; Astra D1): the proof an unknown hold can no longer open.
    const acceptBy = serveUntil - MIN_SERVE_MS;
    const settleUntil = serveUntil + BigInt(plan.settle_grace_ms);
    // Job 003wf4 (§5, D2): the operational cutoffs, absolute from the signed serve_until. An old
    // block already moved serve_until earlier; sign_by also allows for a lagging local clock.
    const cut = cutoffs(this.timing, serveUntil);
    const signBy = Number(cut.signBy);
    const submitBy = Number(cut.submitBy);
    if (signBy - this.now() < MIN_SIGN_MS)
      bad(
        409,
        "This plan's holds are too short to sign and run here; nothing was held",
        "window_too_short",
      );
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
      // Job 003wf3: the handover gate, inside the admission's own write transaction.
      requireCustomerAdmission(this.db, now.business_id, "none");
      // Mappings rechecked after the await: a changed account or binding authorizes nothing.
      if (this.accountOf(viewer.id) !== customer)
        bad(409, "Your linked NEAR account changed; prepare again", "account_changed");
      this.binding(now);
      const counts = this.db
        .prepare(
          // A reserved request whose unit outcome is decided (003o) is no longer open.
          `SELECT COUNT(*) AS total, SUM(CASE WHEN state IN (${OPEN.map(() => "?").join(",")}) AND NOT EXISTS (SELECT 1 FROM customer_settlements s WHERE s.request_id = r.id AND s.state IN ('charged','returned','unresolved')) THEN 1 ELSE 0 END) AS open FROM customer_requests r WHERE person_id = ?`,
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
        // 003r1: say why, and until when, without loosening the barrier. The deadline is the
        // block time after which no block can accept the earlier authorization.
        if (neverSent && !dead && held.person_id === viewer.id)
          bad(
            409,
            "Your earlier request was stopped, but the authorization prepared for it stays valid on the contract until its deadline. To keep your units safe, a new request for them can start only after that, or once the contract shows it can't be used.",
            "previous_window_open",
            { request_id: held.id, until_ms: String(held.accept_by_ms) },
          );
        if (!(neverSent && dead))
          bad(
            409,
            "Another request of yours is still in progress",
            "use_in_progress",
            held.person_id === viewer.id ? { request_id: held.id, until_ms: null } : undefined,
          );
        this.db
          .prepare("UPDATE customer_requests SET allocation = NULL, updated_at = ? WHERE id = ?")
          .run(at, held.id);
        this.event(held.id, "allocation_freed", { block: read.block.height });
      }
      this.db
        .prepare(
          `INSERT INTO customer_requests (id, person_id, customer_account, offer_id, business_id, idempotency_key, request_hash, input_sha, input_chars, network, account, plan_id, reg_id, key_slot, key_epoch, public_key, hold_seq, units, slot, serve_until_ms, settle_until_ms, accept_by_ms, sign_by_ms, submit_by_ms, salt, fingerprint, hold_message, use_message, envelope, envelope_digest, prepared_block, evidence_height, evidence_mark, notice, state, allocation, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
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
          submitBy,
          salt,
          fingerprint,
          envelope.hold.message_hex,
          envelope.use.message_hex,
          JSON.stringify(envelope),
          digest,
          JSON.stringify(read.block),
          // The evidence baseline (003m1): every later readback is fenced against this block.
          read.block.height,
          JSON.stringify(markOf(read.block, e)),
          notice,
          allocation,
          at,
          at,
        );
      this.event(id, "prepared", { block: read.block.height });
      return id;
    });
    // Outside the transaction: the protected copy, then its reference. No plaintext fallback.
    await this.protectInput(created, text);
    return { created: created === id, ...this.status(viewer, created) };
  }

  /**
   * Protects a request's input once (003n). A failure leaves no reference and is retried by the
   * next same-key prepare; two attempts racing keep the first reference and delete the other.
   * Terminal requests, and inputs already deleted, are not protected again.
   * 003v: the context is the persisted request's (its customer person, never the viewer or an
   * owner). Publication is one CAS that is possible only while the input's PUBLICATION WINDOW is
   * open: the request is open, has no input reference and its input was never deleted. Each of
   * those changes only one way, so once the window is closed it stays closed, and the orphan
   * sweep may delete an unreferenced copy (a crash before the CAS, a losing copy whose cleanup
   * failed) without racing a slow writer.
   */
  private async protectInput(id: string, text: string) {
    const p = this.protection;
    const r = this.request(id);
    if (!p || !r || r.input_ref !== null || r.input_deleted_at !== null) return;
    if (!(OPEN as readonly string[]).includes(r.state)) return;
    const ctx = { person_id: r.person_id, request_id: id, kind: "input" as const };
    let ref: string;
    try {
      ref = await p.protect({ ...ctx, bytes: Buffer.from(text, "utf8") });
    } catch {
      this.tx(() => this.event(id, "input_protect_failed", {}));
      return;
    }
    const kept = this.tx(
      () =>
        this.db
          .prepare(
            `UPDATE customer_requests SET input_ref = ?, input_scheme = ?
              WHERE id = ? AND input_ref IS NULL AND input_deleted_at IS NULL
                AND state IN ('prepared','reserve_requested','reserve_unknown','reserved')`,
          )
          .run(ref, p.scheme, id).changes === 1,
    );
    if (!kept) await p.delete?.(ref, ctx).catch(() => {});
  }

  /**
   * Job 003v: whether a stored protected object can still be published, is published, or is an
   * orphan, from the persisted records alone (synchronous: nothing changes between the reads).
   */
  private protectedVerdict(o: ProtectedObjectInfo): "referenced" | "open" | "orphan" | "anomaly" {
    const r = this.request(o.request_id);
    // A request's customer never changes; an object naming another person isn't ours to judge.
    if (r && r.person_id !== o.person_id) return "anomaly";
    // Referenced by ANOTHER request's row (records altered by hand): kept, never swept.
    const elsewhere = this.db
      .prepare(
        `SELECT 1 FROM customer_requests WHERE input_ref = ? AND NOT (id = ? AND ? = 'input')
         UNION ALL SELECT 1 FROM customer_executions WHERE result_ref = ? AND NOT (request_id = ? AND ? = 'result')
         LIMIT 1`,
      )
      .get(o.ref, o.request_id, o.kind, o.ref, o.request_id, o.kind);
    if (elsewhere) return "anomaly";
    if (o.kind === "input") {
      if (r?.input_ref === o.ref) return "referenced";
      const open =
        r !== undefined &&
        r.input_ref === null &&
        r.input_deleted_at === null &&
        (OPEN as readonly string[]).includes(r.state);
      return open ? "open" : "orphan";
    }
    const x = this.execution(o.request_id);
    if (x?.result_ref === o.ref) return "referenced";
    if (x?.result_state !== "pending") return "orphan";
    if (x.delivery === "delivered" || x.delivery === "not_delivered") return "orphan";
    // Still undecided: it closes only when recovery finalizes it (after deliveryTimeoutMs).
    const d = this.tx(() => this.finalizeDelivery(x, this.runtime?.row(x.invocation_id)));
    return d === "pending" ? "open" : "orphan";
  }

  /**
   * Job 003v: the orphan sweep. Examines up to `limit` stored objects after `after` (reference
   * order) and deletes those that are neither referenced nor publishable any more, with their
   * own stored context (checked against the persisted request). An open window, a referenced
   * object or an anomaly is kept. A failed deletion is counted, never reported as deleted.
   */
  async sweepProtected(limit: number = LIMITS.duePerPass, after: string | null = null) {
    const p = this.protection;
    const out = {
      examined: 0,
      deleted: 0,
      kept: 0,
      anomalies: 0,
      failed: 0,
      next: null as string | null,
    };
    if (!p?.list || !p.delete) return out;
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const objects = await p.list(after, n);
    for (const o of objects) {
      out.examined++;
      const v = this.protectedVerdict(o);
      if (v === "anomaly") out.anomalies++;
      if (v !== "orphan") {
        out.kept++;
        continue;
      }
      const ctx = { person_id: o.person_id, request_id: o.request_id, kind: o.kind };
      const ok = await (p.delete as NonNullable<InputProtection["delete"]>)(o.ref, ctx).then(
        () => true,
        () => false,
      );
      if (ok) out.deleted++;
      else out.failed++;
    }
    out.next =
      objects.length === n ? (objects[objects.length - 1] as ProtectedObjectInfo).ref : null;
    return out;
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
    this.writerFits(r);
    const moved = this.tx(() => {
      // What was prepared must still be what is authorized now (003m1): the same account
      // mapping, the offer still active, its release still the active one, the same binding.
      if (this.accountOf(viewer.id) !== r.customer_account)
        bad(409, "Your linked NEAR account changed; prepare again", "account_changed");
      const o = this.offer(r.offer_id) as OfferRow;
      if (o.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
      if (!this.releaseActive(o))
        bad(409, "This release isn't the active one", "release_not_active");
      this.binding(o);
      // Job 003wf3: nothing is reserved while this business is changing hands.
      requireCustomerAdmission(this.db, r.business_id, "none");
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
        "SELECT id FROM customer_requests WHERE state IN ('reserve_requested','reserve_unknown') AND conflict IS NULL AND (lease_until IS NULL OR lease_until <= ?) ORDER BY updated_at, id LIMIT ?",
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

  private async submit(
    r: RequestRow,
    gen: number,
  ): Promise<"sent" | "stale" | "handover_paused" | "submit_cutoff"> {
    const writer = this.writer;
    if (!writer) return "sent";
    // Job 003wf3 (§3 W3/W4): while this business is changing hands nothing is submitted. A request
    // with no writer attempt at all can't land, so it is cancelled (its allocation freed); one
    // already submitted keeps its exact readback and is never resent.
    let paused = false;
    let late = false;
    const ok = this.underLease(r.id, gen, (cur) => {
      if (openHandover(this.db, cur.business_id)) {
        paused = true;
        this.cancelUnsentInTx(cur);
        return;
      }
      // Job 003wf4 (§5, D1): no FIRST submission after submit_by: a request with no writer attempt
      // can't land, so it is cancelled and its allocation freed. A request already submitted is
      // never here for that reason (its resends follow the writer's rules and accept_by).
      if (cur.submissions === 0 && cur.submit_by_ms !== null && this.now() > cur.submit_by_ms) {
        late = this.cancelUnsentInTx(cur, "submit_cutoff");
        if (late) return;
      }
      this.db
        .prepare(
          "UPDATE customer_requests SET state = 'reserve_unknown', submissions = submissions + 1, updated_at = ? WHERE id = ?",
        )
        .run(iso(), cur.id);
      this.event(cur.id, "submit", { code: String(cur.submissions + 1), lease: gen });
    });
    if (!ok) return "stale";
    if (paused) return "handover_paused";
    if (late) return "submit_cutoff";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.writeTimeoutMs);
    let answer: WriterAnswer;
    try {
      answer = await Promise.race([
        writer.openHold({
          operation: r.id,
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
    // A recorded evidence conflict is sticky (003m1): nothing is read, sent or decided until a
    // later reviewed job defines how to resolve it. It never frees the allocation.
    if (r.conflict) {
      finish();
      return "evidence_conflict";
    }
    // The adapters and binding must match this exact request before anything is called.
    const b = this.v3.bindingFor(r.business_id);
    if (!this.adaptersFit(r) || b?.network !== r.network || b.account !== r.account) {
      return this.underLease(id, gen, () => {
        this.db
          .prepare(
            "UPDATE customer_requests SET reason = 'binding_mismatch', lease_until = NULL, updated_at = ? WHERE id = ?",
          )
          .run(iso(), id);
        this.event(id, "binding_mismatch", { lease: gen });
      })
        ? "binding_mismatch"
        : "stale";
    }
    if (r.state === "reserve_requested") {
      if (!this.writer) {
        finish();
        return "writer_unavailable";
      }
      const sent = await this.submit(r, gen);
      if (sent === "stale") return "stale";
      if (sent === "handover_paused") {
        finish();
        return "handover_paused";
      }
      if (sent === "submit_cutoff") return "submit_cutoff"; // cancelled; the lease is cleared
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
    const e = read.entitlement ?? null;
    // Fenced against the last accepted evidence, which starts at the prepared block (003m1).
    const next = markOf(read.block, e);
    const { mark: prev, digestKnown } = this.markFor(r);
    const problem = evidenceProblem(digestKnown ? prev : { ...prev, digest: next.digest }, next);
    // A lower block than our evidence is stale: it never moves the state.
    if (problem === "stale") {
      return this.underLease(id, gen, () => {
        this.event(id, "stale_read", { block: read.block.height, lease: gen });
        this.db.prepare("UPDATE customer_requests SET lease_until = NULL WHERE id = ?").run(id);
      })
        ? "stale_read"
        : "stale";
    }
    const conflict = (reason: string) =>
      this.underLease(id, gen, () => {
        this.db
          .prepare(
            "UPDATE customer_requests SET reason = 'evidence_conflict', conflict = ?, lease_until = NULL, updated_at = ? WHERE id = ?",
          )
          .run(JSON.stringify({ reason, block: read.block, against: prev }), iso(), id);
        this.event(id, "evidence_conflict", { code: reason, block: read.block.height, lease: gen });
      })
        ? "evidence_conflict"
        : "stale";
    if (problem !== null) return conflict(problem);
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
    const d = decideReservation(exp, e, read.block.timestamp_ms);
    // Evidence that can't follow what we allocated from is a conflict, never a decision.
    if (d.kind === "inconsistent") return conflict(`decision_${d.reason.replace(/\W+/g, "_")}`);
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
            `UPDATE customer_requests SET state = ?, reason = ?, serving = ?, evidence = ?, evidence_height = ?, evidence_mark = ?, lease_until = NULL, updated_at = ?${free ? ", allocation = NULL" : ""} WHERE id = ?`,
          )
          .run(
            state,
            reason,
            serving,
            evidence,
            read.block.height,
            JSON.stringify(next),
            iso(),
            id,
          );
      this.event(id, "read", { code: `${d.kind}:${d.row}`, block: read.block.height, lease: gen });
      if (d.kind === "reserved") {
        set("reserved", d.reason, d.serving ? 1 : 0, false);
        // Job 003wf4 (§5, D1): the original hold, reconciled to THIS request, opened too late to
        // run here (a delayed original or a lost reply between submit_by and accept_by). It is
        // returned uncharged through the existing release path; nothing is executed.
        if (
          !this.execution(id) &&
          !this.settlement(id) &&
          this.timeLeft(cur.serve_until_ms, read.block.timestamp_ms) < reserveMs(this.timing)
        )
          this.releaseUnrunInTx(id, "too_late_to_run");
      } else if (d.kind === "refused") set("refused", d.reason, null, true);
      else if (d.kind === "unresolved") set("unresolved", d.reason, null, true);
      else {
        // Still acceptable: resend the identical payload, within the bounded number of attempts.
        // Server clock, as policy only: the proof of expiry is row 7's block timestamp.
        const canSend =
          cur.submissions < this.maxSubmissions && this.now() <= Number(cur.accept_by_ms);
        set("reserve_unknown", d.blocked, null, false);
        // Job 003wf3: never resent while this business is changing hands (readback continues).
        resend =
          canSend &&
          d.blocked === null &&
          this.writer !== null &&
          openHandover(this.db, cur.business_id) === null;
        if (resend)
          this.db
            .prepare("UPDATE customer_requests SET lease_until = ? WHERE id = ?")
            .run(this.now() + this.leaseMs, id);
      }
    });
    if (!applied) return "stale";
    if (!resend) return d.kind;
    const again = await this.submit(this.request(id) as RequestRow, gen);
    if (again === "stale") return "stale";
    finish();
    return again === "handover_paused" || again === "submit_cutoff" ? again : "resent";
  }

  // ---------- execution of a reserved request (job 003n, design §13) ----------

  private execution(id: string) {
    return this.db
      .prepare("SELECT * FROM customer_executions WHERE request_id = ?")
      .get(id) as unknown as ExecutionRow | undefined;
  }

  /**
   * Settlement eligibility (003n1): a completed, validated extraction whose result was durably
   * delivered. Never tokens, cost, a completed row alone, or a result that couldn't be kept.
   */
  private eligible(x: ExecutionRow, inv: InvocationRow | undefined) {
    return (
      x.delivery === "delivered" &&
      x.delivered_at !== null &&
      isFulfilled(x.result_outcome) &&
      inv?.state === "completed" &&
      isFulfilled(inv.outcome)
    );
  }

  /**
   * The delivery decision (003o1): `pending` while the run or the result's protection may still
   * finish; otherwise final. A completed run whose result stays undecided past the delivery
   * timeout counts as not delivered: recovery persists that (`finalizeDelivery`), and a later
   * protection is then discarded, never turned into a delivery.
   */
  private deliveryDecision(
    x: ExecutionRow,
    inv: InvocationRow | undefined,
  ): "pending" | "delivered" | "not_delivered" {
    if (x.delivery === "delivered" || x.delivery === "not_delivered") return x.delivery;
    if (!inv || inv.state === "running") return "pending";
    // Only a completed run's result is ever protected (invocations.ts run/sink).
    if (inv.state !== "completed") return "not_delivered";
    const since =
      x.delivery_started_ms ?? (inv.finished_at ? Date.parse(inv.finished_at) : this.now());
    return this.now() - since >= this.deliveryTimeoutMs ? "not_delivered" : "pending";
  }

  /** Persists a final not-delivered decision, by CAS, in the caller's transaction. */
  private finalizeDelivery(x: ExecutionRow, inv: InvocationRow | undefined) {
    const d = this.deliveryDecision(x, inv);
    if (d === "not_delivered" && x.delivery !== "not_delivered") {
      const c = this.db
        .prepare(
          "UPDATE customer_executions SET delivery = 'not_delivered', result_state = CASE WHEN result_state = 'pending' THEN 'unavailable' ELSE result_state END, updated_at = ? WHERE request_id = ? AND (delivery IS NULL OR delivery = 'protecting')",
        )
        .run(iso(), x.request_id);
      if (c.changes) this.event(x.request_id, "delivery_finalized_not_delivered", {});
    }
    return d;
  }

  /** The customer's view of an execution: outcome and result availability, never cost or text. */
  private executionView(x: ExecutionRow | undefined) {
    if (!x) return null;
    const inv = this.runtime?.row(x.invocation_id);
    const state = inv?.state ?? "unknown";
    const decision = this.deliveryDecision(x, inv);
    // Available strictly before the deadline; at the deadline it is expired (003n1).
    const expired = x.retention_until_ms !== null && this.now() >= x.retention_until_ms;
    const result =
      state === "running"
        ? "pending"
        : x.result_state === "stored"
          ? expired
            ? "expired"
            : "available"
          : x.result_state === "deleted"
            ? "expired"
            : x.result_state === "pending"
              ? state === "completed"
                ? decision === "pending"
                  ? "pending"
                  : "unavailable"
                : "none"
              : x.result_state;
    return {
      state,
      delivery: decision,
      outcome: inv?.outcome ?? null,
      // 003n1: three separate facts. Validated: the model's answer passed the validator as a
      // complete extraction (not a judgement of its quality). Delivered: that result was durably
      // protected for the customer. Fulfilled (and eligible for settlement): both, frozen when
      // it was delivered; later expiry or deletion doesn't undo a delivery.
      validated: state === "completed" && isFulfilled(inv?.outcome),
      delivered: x.delivered_at !== null,
      fulfilled: this.eligible(x, inv),
      settlement_eligible: this.eligible(x, inv),
      failure: inv?.failure_class ? inv.failure_class : null,
      usage_state: inv?.usage_state ?? "unknown",
      result,
      retention_until_ms: x.retention_until_ms === null ? null : String(x.retention_until_ms),
      input_source: x.input_source,
      // The unit's state comes from its settlement record, decided only from contract views.
      unit: this.unitsView(this.request(x.request_id) as RequestRow).unit,
      unit_note:
        "A unit is charged or returned only when the contract's views show it; until then it stays reserved.",
      started_at: x.created_at,
    };
  }

  /**
   * Runs a reserved request once (§13.2). Every check before the dispatch transaction is free:
   * nothing is reserved or sent unless the fresh chain evidence, the release, the input and the
   * runtime's own budget, ceiling and concurrency all allow it.
   */
  async execute(viewer: Person, id: string, input: Record<string, unknown>) {
    const r = this.own(viewer, id);
    if (this.execution(id)) return this.status(viewer, id); // never dispatched twice
    // A unit already being released (003o) can't also be used.
    if (this.settlement(id))
      bad(409, "This request's unit is already being settled or released", "unit_settling");
    const runtime = this.runtime;
    if (!runtime || !this.reader || !this.operator) unavailable();
    // A model product needs its runtime provider; the workflow engine needs none.
    const offered = this.offer(r.offer_id);
    const availability = runtime.availability();
    if (!(offered && runtime.isWorkflowProject(offered.project_id)) && !availability.available)
      bad(503, availability.reason, "runtime_unavailable");
    const p = this.protection;
    if (!p?.load || !p.delete)
      bad(
        503,
        "Results can't be kept privately on this server, so nothing was run.",
        "protection_unavailable",
      );
    if (r.state !== "reserved") bad(409, "Only a reserved request can run", "not_reserved");
    if (r.conflict)
      bad(409, "This request's evidence conflicts; it can't run", "evidence_conflict");
    this.writerFits(r);
    const o = this.offer(r.offer_id) as OfferRow;
    if (o.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
    this.binding(o);
    const rel = runtime.releaseFor(o.project_id, o.release_id, o.artifact_digest);
    if (!rel.ok) bad(409, "The released product can't serve this request now", rel.code);
    // The input: resubmitted, or the protected copy. Never run without it, never another one.
    let text: string;
    let source: "protected" | "resubmitted";
    if (typeof input.input === "string") {
      text = input.input;
      source = "resubmitted";
    } else if (r.input_ref) {
      if (r.input_scheme !== p.scheme)
        bad(
          503,
          "Your saved document was kept under another protection scheme; send it again",
          "protection_scheme_changed",
        );
      // 003v: the context the copy must have, from the persisted request.
      const bytes = await p
        .load(r.input_ref, { person_id: r.person_id, request_id: r.id, kind: "input" })
        .catch(() => null);
      if (!bytes)
        bad(503, "Your saved document couldn't be read; send it again", "input_unavailable");
      text = bytes.toString("utf8");
      source = "protected";
    } else bad(409, "Send the same document again to run it", "input_needed");
    if (sha256Hex(Buffer.from(text, "utf8")) !== r.input_sha || text.length !== r.input_chars)
      bad(409, "That isn't the document this request was prepared for", "input_mismatch");
    if (text.length > inputCeiling(rel.artifact.checked, LIMITS.inputChars))
      bad(409, "This product reads less text than this document", "input_too_long");
    // The local control epoch before the await: a change while reading fences the dispatch.
    const epoch = runtime.ownerEpoch(o.business_id);
    const read = await readCustomerViews(
      this.reader,
      r,
      {
        control: true,
        plan: o.plan_id,
        entitlement: { customer: r.customer_account, plan_id: o.plan_id },
      },
      this.readTimeoutMs,
    ).catch(readFailed);
    const cur = this.own(viewer, id); // the caller, again, after the await
    // The block must be recent by the local clock (003n1), whatever its height or coherence.
    this.fresh(read.block);
    const e = read.entitlement ?? null;
    const next = markOf(read.block, e);
    const { mark: prev, digestKnown } = this.markFor(cur);
    const problem = evidenceProblem(digestKnown ? prev : { ...prev, digest: next.digest }, next);
    if (problem === "stale")
      bad(503, "The contract answered from an older block; nothing was run", "evidence_stale");
    const sticky = (reason: string): never => {
      this.tx(() => {
        const c = this.db
          .prepare(
            "UPDATE customer_requests SET conflict = ?, updated_at = ? WHERE id = ? AND conflict IS NULL",
          )
          .run(JSON.stringify({ reason, block: read.block, against: prev }), iso(), id);
        if (c.changes)
          this.event(id, "evidence_conflict", { code: reason, block: read.block.height });
      });
      bad(409, "This request's evidence conflicts; it can't run", "evidence_conflict");
    };
    if (problem !== null) sticky(problem);
    const control = read.control as NonNullable<typeof read.control>;
    // Job 003wf3 (§16.3, §16.11 D6): arm from this read. While the business changes hands this
    // reserved use can't run: its unit is returned (nothing is charged), and the answer states
    // what the request's own records show about that unit.
    const paused = armHandover(this.db, {
      businessId: o.business_id,
      network: o.network,
      account: o.account,
      block: read.block,
      control,
      source: "customer_execute",
      now: this.now(),
    });
    if (paused) {
      this.releaseForHandover(id);
      throw pauseError(this.pauseUnitOf(id), paused);
    }
    if (!platformMeters(control, this.operator))
      bad(
        409,
        "Everstreet can't currently serve this business's customers",
        "operator_not_authorized",
      );
    if (!read.plan || JSON.stringify(read.plan) !== o.plan)
      bad(409, "The contract's plan differs from the offer", "plan_changed");
    const d = decideReservation(
      {
        reg_id: cur.reg_id,
        key_slot: cur.key_slot,
        key_epoch: cur.key_epoch,
        hold_seq: cur.hold_seq,
        units: cur.units,
        serve_until_ms: cur.serve_until_ms,
        settle_until_ms: cur.settle_until_ms,
        accept_by_ms: cur.accept_by_ms,
      },
      e,
      read.block.timestamp_ms,
    );
    if (d.kind === "inconsistent") sticky(`decision_${d.reason.replace(/\W+/g, "_")}`);
    if (d.kind !== "reserved" || !d.serving)
      bad(
        409,
        "The contract doesn't show your hold serving now; nothing was run",
        `not_serving_${"reason" in d && d.reason ? d.reason : d.kind}`,
      );
    const hold = e as EntitlementV3;
    if ((hold.hold_used & 1) !== 0 || hold.hold_slots[0] !== null)
      bad(409, "Your hold's use was already recorded; nothing was run", "slot_used");
    const needed = runtime.timeoutMs + this.executionMarginMs;
    if (this.timeLeft(hold.serve_until_ms, read.block.timestamp_ms) < needed)
      bad(409, "Too little time is left on your hold to run it safely", "not_enough_time");
    const admission = JSON.stringify({
      block: read.block,
      row: d.row,
      serve_until_ms: hold.serve_until_ms,
      operator: this.operator,
      generation: control.generation,
    });
    const started = runtime.startCustomer({
      business_id: o.business_id,
      project_id: o.project_id,
      release_id: o.release_id,
      artifact_job: rel.artifact.job_id,
      artifact_digest: o.artifact_digest,
      checked: rel.artifact.checked,
      text,
      request_id: id,
      person_id: viewer.id,
      // Inside the dispatch transaction: everything the await could have changed, again.
      inTx: (invocationId) => {
        const now = this.request(id) as RequestRow;
        if (now.state !== "reserved" || now.conflict)
          bad(409, "This request changed while it was being checked", "not_reserved");
        if (this.settlement(id))
          bad(409, "This request's unit is already being settled or released", "unit_settling");
        const offer = this.offer(o.id) as OfferRow;
        if (offer.state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
        if (!this.releaseActive(offer))
          bad(409, "This release isn't the active one", "release_not_active");
        // The runtime identity and artifact, again (003n1): a model or release change during the
        // await must not dispatch the old configuration.
        const again = runtime.releaseFor(o.project_id, o.release_id, o.artifact_digest);
        if (!again.ok || again.artifact.job_id !== rel.artifact.job_id)
          bad(
            409,
            "The released product can't serve this request now",
            again.ok ? "artifact_changed" : again.code,
          );
        this.binding(offer);
        this.writerFits(now);
        // The deadline at the actual dispatch, after every await (003n1).
        if (this.timeLeft(hold.serve_until_ms, read.block.timestamp_ms) < needed)
          bad(409, "Too little time is left on your hold to run it safely", "not_enough_time");
        const ep = runtime.ownerEpoch(o.business_id);
        if (ep.owner_id !== epoch.owner_id || ep.generation !== epoch.generation)
          bad(
            409,
            "Control of this business changed while this was checked; nothing was run",
            "control_changed",
          );
        // Job 003wf3 (Astra 00:48 #2): the gate at the atomic dispatch, after every await.
        requireCustomerAdmission(this.db, o.business_id, this.pauseUnitOf(id));
        const t = iso();
        this.db
          .prepare(
            `INSERT INTO customer_executions (request_id, invocation_id, person_id, admission, input_source, result_state, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(id, invocationId, viewer.id, admission, source, t, t);
        // The fresh read is accepted evidence: later reads are fenced against it.
        this.db
          .prepare(
            "UPDATE customer_requests SET evidence_mark = ?, evidence_height = ? WHERE id = ?",
          )
          .run(JSON.stringify(next), read.block.height, id);
        this.event(id, "execution_dispatched", { block: read.block.height });
      },
      sink: (row, result) => this.keepResult(id, o.retention_days, row, result),
    });
    if (started.created) await started.done;
    return this.status(viewer, id); // checks the caller once more
  }

  /** Protects a finished execution's validated result and records it (§13.2 step 6). */
  private async keepResult(
    id: string,
    retentionDays: number,
    _row: InvocationRow,
    result: RunResult,
  ) {
    const p = this.protection as InputProtection;
    // 003o1: the decision is "protecting" before the await; only that same decision may become
    // "delivered" afterwards. If recovery finalized it as not delivered meanwhile, the late copy
    // is deleted and nothing is delivered or made chargeable.
    const started = this.tx(
      () =>
        this.db
          .prepare(
            "UPDATE customer_executions SET delivery = 'protecting', delivery_started_ms = ?, updated_at = ? WHERE request_id = ? AND delivery IS NULL AND result_state = 'pending'",
          )
          .run(this.now(), iso(), id).changes === 1,
    );
    if (!started) return;
    // 003v: the customer of the persisted request (stable across a sale), not the caller.
    const ctx = {
      person_id: (this.request(id) as RequestRow).person_id,
      request_id: id,
      kind: "result" as const,
    };
    let ref: string;
    try {
      ref = await p.protect({ ...ctx, bytes: Buffer.from(JSON.stringify(result), "utf8") });
    } catch {
      this.tx(() => {
        const c = this.db
          .prepare(
            "UPDATE customer_executions SET delivery = 'not_delivered', result_state = 'unavailable', updated_at = ? WHERE request_id = ? AND delivery = 'protecting'",
          )
          .run(iso(), id);
        if (c.changes) this.event(id, "result_protect_failed", {});
      });
      return;
    }
    const kept = this.tx(() => {
      const c = this.db
        .prepare(
          "UPDATE customer_executions SET result_state = 'stored', result_ref = ?, result_scheme = ?, result_outcome = ?, retention_until_ms = ?, delivered_at = ?, delivery = 'delivered', updated_at = ? WHERE request_id = ? AND delivery = 'protecting' AND result_state = 'pending'",
        )
        .run(
          ref,
          p.scheme,
          result.outcome,
          this.now() + retentionDays * 86_400_000,
          iso(),
          iso(),
          id,
        );
      if (!c.changes) this.event(id, "late_result_discarded", {});
      // Workflow engine: an accepted, delivered request opens its case in THIS transaction, so
      // a delivered request always has exactly one case (WORKFLOW_ENGINE.md §5).
      if (c.changes === 1 && result.outcome === "accepted") {
        const r = this.request(id) as RequestRow;
        const o = this.offer(r.offer_id) as OfferRow;
        openCase(
          this.db,
          {
            id,
            business_id: r.business_id,
            offer_id: r.offer_id,
            project_id: o.project_id,
            release_id: o.release_id,
          },
          result.stage,
        );
      }
      return c.changes === 1;
    });
    // A late copy is never kept: deleted through the seam. If that fails, the orphan sweep
    // deletes it later: the decision is final, so the copy can never be published (003v).
    if (!kept) await p.delete?.(ref, ctx).catch(() => {});
  }

  /**
   * Workflow engine: an accepted request's submitted fields, for the case view of the business's
   * CURRENT owner only (the caller authorizes; WorkflowCases.one). A support request is written
   * TO the business, so its staff read it; an extraction result is never read this way. The input
   * copy is deleted once a request has run, so the fields come from the kept result (the engine's
   * accepted fields, verbatim) while it is retained, or the input copy before that. Null when
   * neither can be read (e.g. past retention).
   */
  async submissionFields(requestId: string): Promise<Record<string, string> | null> {
    const r = this.request(requestId);
    const p = this.protection;
    if (!r || !p?.load) return null;
    // Only for a request that opened a workflow case (an accepted workflow request).
    if (!this.db.prepare("SELECT 1 FROM workflow_cases WHERE request_id = ?").get(r.id))
      return null;
    const asFields = (v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? (Object.fromEntries(
            Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string"),
          ) as Record<string, string>)
        : null;
    const parse = (bytes: Buffer | null) => {
      if (!bytes) return null;
      try {
        return JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        return null;
      }
    };
    const x = this.execution(r.id);
    if (
      x?.result_state === "stored" &&
      x.result_ref &&
      x.result_scheme === p.scheme &&
      (x.retention_until_ms === null || this.now() < x.retention_until_ms)
    ) {
      const kept = parse(
        await p
          .load(x.result_ref, { person_id: r.person_id, request_id: r.id, kind: "result" })
          .catch(() => null),
      ) as { outcome?: string; fields?: { key: string; value: unknown }[] } | null;
      if (kept?.outcome === "accepted" && Array.isArray(kept.fields))
        return asFields(Object.fromEntries(kept.fields.map((f) => [f.key, f.value])));
    }
    if (!r.input_ref || r.input_scheme !== p.scheme) return null;
    return asFields(
      parse(
        await p
          .load(r.input_ref, { person_id: r.person_id, request_id: r.id, kind: "input" })
          .catch(() => null),
      ),
    );
  }

  /** The customer's own result, through the protection seam, while it is retained. */
  async result(viewer: Person, id: string) {
    this.own(viewer, id);
    const x = this.execution(id);
    if (!x) bad(404, "Nothing has run for this request", "no_result");
    const readable = (e: ExecutionRow) => {
      if (
        e.result_state === "deleted" ||
        (e.retention_until_ms !== null && this.now() >= e.retention_until_ms)
      )
        bad(409, "This result is past its retention and is no longer kept", "result_expired");
      if (e.result_state !== "stored" || !e.result_ref)
        bad(409, "There is no kept result for this request", "no_result");
    };
    readable(x);
    const p = this.protection;
    if (!p?.load) bad(503, "Results can't be read on this server", "protection_unavailable");
    if (x.result_scheme !== p.scheme)
      bad(503, "This result was kept under another protection scheme", "protection_scheme_changed");
    const req = this.request(id) as RequestRow;
    const bytes = await p
      .load(x.result_ref as string, { person_id: req.person_id, request_id: id, kind: "result" })
      .catch(() => null);
    if (!bytes) bad(503, "The result couldn't be read just now", "result_unavailable");
    // After the await, everything again (003n1): the caller, and that this exact result is still
    // the kept one and still within its retention. Loaded bytes are never returned otherwise.
    this.own(viewer, id);
    const after = this.execution(id) as ExecutionRow;
    readable(after);
    if (after.result_ref !== x.result_ref)
      bad(409, "This result changed while it was being read", "result_changed");
    return {
      result: JSON.parse(bytes.toString("utf8")) as RunResult,
      outcome: x.result_outcome,
      retention_until_ms: String(x.retention_until_ms),
    };
  }

  cancelExecution(viewer: Person, id: string) {
    this.own(viewer, id);
    const x = this.execution(id);
    if (!x) bad(404, "Nothing is running for this request", "no_execution");
    this.runtime?.cancelCustomer(x.invocation_id);
    return this.status(viewer, id);
  }

  /**
   * Deletes results at or past their retention through the seam, a bounded number at a time.
   * A failed deletion keeps its reference and is counted as failed, never as deleted; a result
   * under another scheme is skipped, never handed to this seam.
   */
  async expireResults(limit: number = LIMITS.duePerPass) {
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const p = this.protection;
    if (!p?.delete) return { deleted: 0, failed: 0 };
    // 003v: each object's expected context comes from its persisted request (the customer).
    const due = this.db
      .prepare(
        `SELECT x.request_id, x.result_ref, r.person_id FROM customer_executions x
           JOIN customer_requests r ON r.id = x.request_id
          WHERE x.result_state = 'stored' AND x.retention_until_ms <= ? AND x.result_scheme = ?
          ORDER BY x.retention_until_ms LIMIT ?`,
      )
      .all(this.now(), p.scheme, n) as {
      request_id: string;
      result_ref: string;
      person_id: string;
    }[];
    let deleted = 0;
    let failed = 0;
    for (const d of due) {
      const ctx = { person_id: d.person_id, request_id: d.request_id, kind: "result" as const };
      const ok = await (p.delete as NonNullable<InputProtection["delete"]>)(d.result_ref, ctx).then(
        () => true,
        () => false,
      );
      if (!ok) {
        failed++;
        continue;
      }
      this.tx(() => {
        const c = this.db
          .prepare(
            "UPDATE customer_executions SET result_state = 'deleted', result_ref = NULL, updated_at = ? WHERE request_id = ? AND result_state = 'stored' AND result_ref = ?",
          )
          .run(iso(), d.request_id, d.result_ref);
        if (c.changes) this.event(d.request_id, "result_deleted", {});
      });
      deleted++;
    }
    return { deleted, failed };
  }

  /**
   * Deletes protected inputs that can never be needed again (003n1), a bounded number at a
   * time: the request ended without running (cancelled, expired, refused, unresolved), or its
   * execution has finished (nothing is ever re-run), or its hold's serving time has passed (it
   * can no longer run). A request that may still run keeps its input. Failures keep the
   * reference; another scheme's references are skipped.
   */
  async expireInputs(limit: number = LIMITS.duePerPass) {
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const p = this.protection;
    if (!p?.delete) return { deleted: 0, failed: 0 };
    const candidates = this.db
      .prepare(
        `SELECT r.id, r.person_id, r.input_ref, r.state, r.serve_until_ms, x.invocation_id
           FROM customer_requests r LEFT JOIN customer_executions x ON x.request_id = r.id
          WHERE r.input_ref IS NOT NULL AND r.input_scheme = ? ORDER BY r.created_at LIMIT ?`,
      )
      .all(p.scheme, LIMITS.keptPerPerson) as {
      id: string;
      person_id: string;
      input_ref: string;
      state: State;
      serve_until_ms: string;
      invocation_id: string | null;
    }[];
    const now = this.now();
    const done = (c: (typeof candidates)[number]) => {
      if (["cancelled", "expired", "refused", "unresolved"].includes(c.state)) return true;
      if (now >= Number(c.serve_until_ms)) return true;
      if (c.invocation_id) return this.runtime?.row(c.invocation_id)?.state !== "running";
      return false;
    };
    let deleted = 0;
    let failed = 0;
    for (const c of candidates.filter(done).slice(0, n)) {
      const ctx = { person_id: c.person_id, request_id: c.id, kind: "input" as const };
      const ok = await (p.delete as NonNullable<InputProtection["delete"]>)(c.input_ref, ctx).then(
        () => true,
        () => false,
      );
      if (!ok) {
        failed++;
        continue;
      }
      this.tx(() => {
        const r = this.db
          .prepare(
            "UPDATE customer_requests SET input_ref = NULL, input_deleted_at = ?, updated_at = ? WHERE id = ? AND input_ref = ?",
          )
          .run(iso(), iso(), c.id, c.input_ref);
        if (r.changes) this.event(c.id, "input_deleted", {});
      });
      deleted++;
    }
    return { deleted, failed };
  }

  // ---------- single-item maintenance operations (job 002d) ----------
  // A supervisor selects work fairly (maintenance.ts); these re-check every rule themselves and
  // change state only through the same fenced transitions as the explicit paths above.

  /** Expires one prepared request past its signing time (local; nothing was ever sent). */
  expirePrepared(id: string): "expired" | "not_due" {
    const before = this.request(id)?.state;
    this.expireIfDue(id);
    return before === "prepared" && this.request(id)?.state === "expired" ? "expired" : "not_due";
  }

  /** Freezes the unit's intent when decidable, then one leased unit step. */
  async settleOne(id: string): Promise<string> {
    if (!this.ensureIntent(id)) return "not_decidable";
    return this.unitStep(id);
  }

  /** Deletes one result at or past its retention, under this storage's scheme. */
  async deleteResult(requestId: string): Promise<"deleted" | "failed" | "not_due"> {
    const p = this.protection;
    if (!p?.delete) return "not_due";
    const x = this.db
      .prepare(
        `SELECT x.result_ref, r.person_id FROM customer_executions x
           JOIN customer_requests r ON r.id = x.request_id
          WHERE x.request_id = ? AND x.result_state = 'stored' AND x.retention_until_ms <= ? AND x.result_scheme = ?`,
      )
      .get(requestId, this.now(), p.scheme) as
      | { result_ref: string; person_id: string }
      | undefined;
    if (!x) return "not_due";
    const ctx = { person_id: x.person_id, request_id: requestId, kind: "result" as const };
    const ok = await p.delete(x.result_ref, ctx).then(
      () => true,
      () => false,
    );
    if (!ok) return "failed";
    this.tx(() => {
      const c = this.db
        .prepare(
          "UPDATE customer_executions SET result_state = 'deleted', result_ref = NULL, updated_at = ? WHERE request_id = ? AND result_state = 'stored' AND result_ref = ?",
        )
        .run(iso(), requestId, x.result_ref);
      if (c.changes) this.event(requestId, "result_deleted", {});
    });
    return "deleted";
  }

  /** Deletes one protected input that can never be needed again (the 003n1 rules). */
  async deleteInput(id: string): Promise<"deleted" | "failed" | "not_due"> {
    const p = this.protection;
    if (!p?.delete) return "not_due";
    const c = this.db
      .prepare(
        `SELECT r.person_id, r.input_ref, r.state, r.serve_until_ms, x.invocation_id
           FROM customer_requests r LEFT JOIN customer_executions x ON x.request_id = r.id
          WHERE r.id = ? AND r.input_ref IS NOT NULL AND r.input_scheme = ?`,
      )
      .get(id, p.scheme) as
      | {
          person_id: string;
          input_ref: string;
          state: State;
          serve_until_ms: string;
          invocation_id: string | null;
        }
      | undefined;
    if (!c) return "not_due";
    const done =
      ["cancelled", "expired", "refused", "unresolved"].includes(c.state) ||
      this.now() >= Number(c.serve_until_ms) ||
      (c.invocation_id !== null && this.runtime?.row(c.invocation_id)?.state !== "running");
    if (!done) return "not_due";
    const ok = await p
      .delete(c.input_ref, { person_id: c.person_id, request_id: id, kind: "input" })
      .then(
        () => true,
        () => false,
      );
    if (!ok) return "failed";
    this.tx(() => {
      const r = this.db
        .prepare(
          "UPDATE customer_requests SET input_ref = NULL, input_deleted_at = ?, updated_at = ? WHERE id = ? AND input_ref = ?",
        )
        .run(iso(), iso(), id, c.input_ref);
      if (r.changes) this.event(id, "input_deleted", {});
    });
    return "deleted";
  }

  /** The storage scheme this server deletes under, or null without a deletion capability. */
  deletionScheme(): string | null {
    return this.protection?.delete ? this.protection.scheme : null;
  }

  // ---------- unit settlement and release (job 003o, design §14) ----------

  private settlement(id: string) {
    return this.db
      .prepare("SELECT * FROM customer_settlements WHERE request_id = ?")
      .get(id) as unknown as SettlementRow | undefined;
  }

  /**
   * The unit's outcome for a request, as the customer sees it. Balances come only from the
   * contract's views at the recorded block, never from local arithmetic.
   */
  private unitsView(r: RequestRow) {
    const s = this.settlement(r.id);
    // 003q1: with no settlement record, the request's own state says what is held. A prepared,
    // cancelled, expired or refused request holds nothing; an authorization not yet confirmed by
    // the contract is pending; only an exactly matched reservation is "reserved".
    if (!s) {
      const held =
        r.state === "reserved"
          ? "reserved_awaiting_settlement"
          : r.state === "reserve_requested" || r.state === "reserve_unknown"
            ? "reservation_pending"
            : r.state === "unresolved"
              ? "unknown"
              : "not_held";
      return { unit: held, reason: null, source: null, retryable: false };
    }
    const unit =
      s.state === "charged"
        ? "charged"
        : s.state === "returned"
          ? "returned"
          : s.state === "conflict"
            ? "conflict"
            : s.state === "unresolved"
              ? "unknown"
              : s.kind === "charge"
                ? "charge_pending"
                : "release_pending";
    const ev = s.evidence
      ? (JSON.parse(s.evidence) as { block: PinnedBlock; free: string; consumed: string })
      : null;
    return {
      unit,
      kind: s.kind,
      reason: s.reason,
      source: ev ? { block: ev.block, observed: { free: ev.free, consumed: ev.consumed } } : null,
      retryable: ["requested", "unknown"].includes(s.state) && s.submissions < this.maxSubmissions,
      submissions: s.submissions,
    };
  }

  /**
   * Records the unit's intent, once, when its outcome is decidable (§14.1). A charge needs the
   * frozen eligibility of a delivered, validated extraction; anything else releases the unused
   * unit. Nothing is decided while the execution is running, or while an unexecuted request can
   * still run, unless the customer abandons it explicitly.
   */
  private ensureIntent(id: string, abandon = false): SettlementRow | undefined {
    return this.tx(() => {
      const existing = this.settlement(id);
      if (existing) return existing;
      const r = this.request(id);
      if (r?.state !== "reserved" || r.conflict) return undefined;
      const x = this.execution(id);
      let kind: "charge" | "release";
      let eligibility: Record<string, unknown>;
      if (x) {
        const inv = this.runtime?.row(x.invocation_id);
        // 003o1: the intent is frozen only on a final delivery decision, persisted here first.
        // While the result may still be protected, nothing (worker or customer) decides.
        if (!inv || this.finalizeDelivery(x, inv) === "pending") return undefined;
        x.delivery = (this.execution(id) as ExecutionRow).delivery;
        if (this.eligible(x, inv)) {
          kind = "charge";
          eligibility = {
            invocation_id: inv.id,
            outcome: inv.outcome,
            delivered_at: x.delivered_at,
            result_outcome: x.result_outcome,
          };
        } else {
          kind = "release";
          eligibility = {
            invocation_id: inv.id,
            state: inv.state,
            outcome: inv.outcome,
            delivery: x.delivery ?? "not_delivered",
          };
        }
      } else if (abandon || this.now() >= Number(r.serve_until_ms)) {
        kind = "release";
        eligibility = { executed: false, abandoned: abandon };
      } else return undefined;
      const t = iso();
      this.db
        .prepare(
          "INSERT INTO customer_settlements (request_id, kind, state, reason, eligibility, created_at, updated_at) VALUES (?, ?, 'requested', ?, ?, ?, ?)",
        )
        .run(
          id,
          kind,
          kind === "charge"
            ? "delivered"
            : x
              ? "not_eligible"
              : abandon
                ? "abandoned"
                : "not_executed",
          JSON.stringify(eligibility),
          t,
          t,
        );
      this.event(id, `unit_${kind}_intent`, {});
      return this.settlement(id);
    });
  }

  // ---------- job 003wf3: the business handover (MANAGED_HANDOVER.md §3, §16.11) ----------

  /**
   * Whether this business's customers are ELIGIBLE to be served now (MANAGED_HANDOVER.md §16.8 D4,
   * Astra 01:12): each reason from the existing checks, never from a gate or a meter alone. Each
   * active offer's release must still resolve exactly (releaseFor: its artifact, provider
   * configuration and policy), the runtime must be available, its budget must cover one request's
   * worst case, and the platform must meter at the current generation. Eligibility is configured
   * state; only a next use actually served proves service.
   */
  serviceReadiness(businessId: string, control: ControlV3) {
    const reasons: string[] = [];
    if (openHandover(this.db, businessId)) reasons.push("handover_in_progress");
    const offers = this.db
      .prepare("SELECT * FROM customer_offers WHERE business_id = ? AND state = 'active'")
      .all(businessId) as unknown as OfferRow[];
    if (offers.length === 0) reasons.push("no_active_offer");
    const runtime = this.runtime;
    for (const o of offers) {
      if (!this.releaseActive(o)) {
        reasons.push("release_not_active");
        continue;
      }
      const rel = runtime?.releaseFor(o.project_id, o.release_id, o.artifact_digest);
      if (rel && !rel.ok) reasons.push(`release_${rel.code}`);
      // Job 003wf4 (§5): the offer's plan, under the current settings (a reconfiguration counts).
      if (!this.planUsability(JSON.parse(o.plan) as PlanV3).usable) reasons.push("plan_unusable");
    }
    // The model runtime and its budget matter only when a model product is offered (or none is):
    // the workflow engine runs with neither (WORKFLOW_ENGINE.md).
    const modelOffered =
      offers.length === 0 || offers.some((o) => !runtime?.isWorkflowProject(o.project_id));
    const availability = runtime?.availability();
    if (modelOffered && !availability?.available)
      reasons.push(`runtime_unavailable${availability?.reason ? `: ${availability.reason}` : ""}`);
    const budget = modelOffered ? runtime?.budgetFor(businessId) : null;
    if (budget && budget.available_cents === null) reasons.push("runtime_budget_unset");
    else if (
      budget &&
      budget.available_cents !== null &&
      budget.available_cents < budget.per_request_cents
    )
      reasons.push("runtime_budget_exhausted");
    if (!this.writer) reasons.push("writer_unavailable");
    if (!this.protection?.load) reasons.push("protection_unavailable");
    if (!this.operator || !platformMeters(control, this.operator))
      reasons.push("metering_not_appointed");
    return {
      eligible: reasons.length === 0,
      reasons: [...new Set(reasons)],
      note: "Configured eligibility, from the current checks; a customer's next use is what proves service.",
    };
  }

  /** What this request's own records show about its unit, for a pause answer (D6). */
  pauseUnitOf(id: string): "none" | "returning" | "returned" | "unknown" {
    const r = this.request(id);
    if (r?.state !== "reserved") return "none";
    const s = this.settlement(id);
    if (!s) return "returning";
    if (s.state === "returned") return "returned";
    if (s.state === "unknown" || s.state === "unresolved" || s.state === "conflict")
      return "unknown";
    return s.kind === "release" ? "returning" : "unknown";
  }

  /**
   * In the caller's transaction: a confirmed request that was never submitted (no writer attempt
   * exists for it, so no hold can land) is cancelled and its allocation freed (§3 W3).
   */
  private cancelUnsentInTx(
    r: RequestRow,
    reason: "handover_pause" | "submit_cutoff" = "handover_pause",
  ) {
    if (r.state !== "reserve_requested" || r.submissions !== 0) return false;
    const attempt = this.db
      .prepare("SELECT 1 FROM chain_tx_attempts WHERE operation LIKE ? LIMIT 1")
      .get(`${r.id}|%`);
    if (attempt) return false;
    const c = this.db
      .prepare(
        "UPDATE customer_requests SET state = 'cancelled', reason = ?, allocation = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND state = 'reserve_requested' AND submissions = 0",
      )
      .run(reason, iso(), r.id);
    if (c.changes)
      this.event(
        r.id,
        reason === "handover_pause" ? "cancelled_for_handover" : "cancelled_submit_cutoff",
        {},
      );
    return c.changes === 1;
  }

  /**
   * A reserved request that hasn't run gets a release intent (its unit goes back; §3 W5). A request
   * already executed or with an intent is left to its own settlement.
   */
  releaseForHandover(id: string) {
    return this.tx(() => this.releaseUnrunInTx(id, "handover_pause"));
  }

  /** In the caller's transaction: a release intent for a reserved request that never ran. */
  private releaseUnrunInTx(id: string, reason: "handover_pause" | "too_late_to_run") {
    const r = this.request(id);
    if (r?.state !== "reserved" || r.conflict || this.settlement(id) || this.execution(id))
      return false;
    const t = iso();
    const eligibility =
      reason === "handover_pause"
        ? { executed: false, handover: true }
        : { executed: false, too_late: true, reserve_ms: reserveMs(this.timing) };
    this.db
      .prepare(
        "INSERT INTO customer_settlements (request_id, kind, state, reason, eligibility, created_at, updated_at) VALUES (?, 'release', 'requested', ?, ?, ?, ?)",
      )
      .run(id, reason, JSON.stringify(eligibility), t, t);
    this.event(id, "unit_release_intent", { code: reason });
    return true;
  }

  /**
   * One bounded drain pass for a business with an open handover, through the existing leased
   * operations only: never-sent confirmations cancelled, unexecuted reserved units released,
   * pending reservations read back (never resent), decidable settlements stepped.
   */
  async drainForHandover(businessId: string, limit: number = LIMITS.duePerPass) {
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const out: Record<string, string> = {};
    const rows = this.db
      .prepare(
        `SELECT r.id, r.state FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
          WHERE r.business_id = ? AND r.conflict IS NULL
            AND (r.state IN ('reserve_requested','reserve_unknown')
              OR (r.state = 'reserved' AND (s.request_id IS NULL OR s.state IN ('requested','unknown'))))
          ORDER BY r.updated_at, r.id LIMIT ?`,
      )
      .all(businessId, n) as { id: string; state: string }[];
    for (const row of rows) {
      if (row.state === "reserved") {
        this.releaseForHandover(row.id);
        if (!this.ensureIntent(row.id)) {
          out[row.id] = "not_decidable";
          continue;
        }
        out[row.id] = await this.unitStep(row.id);
      } else out[row.id] = await this.step(row.id);
    }
    return out;
  }

  /**
   * What is still in flight for a business, by category, from durable rows only (§4.2
   * readiness): counts, never customer content. Final states are not counted.
   */
  handoverInventory(businessId: string) {
    const one = (sql: string) => (this.db.prepare(sql).get(businessId) as { n: number }).n;
    return {
      reservations_pending: one(
        "SELECT COUNT(*) AS n FROM customer_requests WHERE business_id = ? AND state IN ('reserve_requested','reserve_unknown')",
      ),
      reserved_unexecuted: one(
        "SELECT COUNT(*) AS n FROM customer_requests r WHERE r.business_id = ? AND r.state = 'reserved' AND NOT EXISTS (SELECT 1 FROM customer_executions x WHERE x.request_id = r.id) AND NOT EXISTS (SELECT 1 FROM customer_settlements s WHERE s.request_id = r.id AND s.state IN ('charged','returned'))",
      ),
      executions_running: one(
        "SELECT COUNT(*) AS n FROM customer_executions x JOIN customer_requests r ON r.id = x.request_id JOIN runtime_invocations i ON i.id = x.invocation_id WHERE r.business_id = ? AND i.state = 'running'",
      ),
      deliveries_pending: one(
        "SELECT COUNT(*) AS n FROM customer_executions x JOIN customer_requests r ON r.id = x.request_id WHERE r.business_id = ? AND (x.delivery IS NULL OR x.delivery = 'protecting')",
      ),
      settlements_pending: one(
        "SELECT COUNT(*) AS n FROM customer_settlements s JOIN customer_requests r ON r.id = s.request_id WHERE r.business_id = ? AND s.state IN ('requested','unknown')",
      ),
      settlements_unsettled: one(
        "SELECT COUNT(*) AS n FROM customer_requests r WHERE r.business_id = ? AND r.state = 'reserved' AND NOT EXISTS (SELECT 1 FROM customer_settlements s WHERE s.request_id = r.id AND s.state IN ('charged','returned'))",
      ),
      unresolved: one(
        "SELECT COUNT(*) AS n FROM customer_requests r WHERE r.business_id = ? AND (r.conflict IS NOT NULL OR r.state = 'unresolved' OR EXISTS (SELECT 1 FROM customer_settlements s WHERE s.request_id = r.id AND s.state IN ('conflict','unresolved')))",
      ),
    };
  }

  /** The customer abandons a reserved request that hasn't run (or ran ineligibly): release it. */
  async releaseUnit(viewer: Person, id: string) {
    const r = this.own(viewer, id);
    const x = this.execution(id);
    if (x && this.eligible(x, this.runtime?.row(x.invocation_id)))
      bad(409, "This use was delivered; its unit is settled, not released", "delivered");
    if (r.state !== "reserved")
      bad(409, "Only a reserved request has a unit to release", "not_reserved");
    if (!this.ensureIntent(id, true)) {
      const inv = x ? this.runtime?.row(x.invocation_id) : undefined;
      if (inv?.state === "completed")
        bad(409, "Your result is still being saved; try again shortly", "delivery_pending");
      bad(409, "This request is still running; try again when it ends", "execution_running");
    }
    await this.unitStep(id);
    return this.status(viewer, id);
  }

  /** One bounded unit step for the customer's own request (recovery after a lost reply). */
  async reconcileUnit(viewer: Person, id: string) {
    this.own(viewer, id);
    this.ensureIntent(id);
    await this.unitStep(id);
    return this.status(viewer, id);
  }

  /** One bounded pass for a later worker: decidable intents, then due unit steps. */
  async settleDue(limit: number = LIMITS.duePerPass) {
    const n = Math.max(1, Math.min(LIMITS.duePerPass, Math.floor(limit)));
    const candidates = this.db
      .prepare(
        `SELECT r.id FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
          WHERE r.state = 'reserved' AND r.conflict IS NULL
            AND (s.request_id IS NULL OR (s.state IN ('requested','unknown') AND (s.lease_until IS NULL OR s.lease_until <= ?)))
          ORDER BY r.updated_at, r.id LIMIT ?`,
      )
      .all(this.now(), n) as { id: string }[];
    const results: Record<string, string> = {};
    for (const c of candidates) {
      if (!this.ensureIntent(c.id)) {
        results[c.id] = "not_decidable";
        continue;
      }
      results[c.id] = await this.unitStep(c.id);
    }
    return results;
  }

  private claimUnit(id: string): number | null {
    return this.tx(() => {
      const now = this.now();
      const c = this.db
        .prepare(
          "UPDATE customer_settlements SET lease_gen = lease_gen + 1, lease_until = ? WHERE request_id = ? AND state IN ('requested','unknown') AND (lease_until IS NULL OR lease_until <= ?)",
        )
        .run(now + this.leaseMs, id, now);
      if (!c.changes) return null;
      return (this.settlement(id) as SettlementRow).lease_gen;
    });
  }

  private underUnitLease(id: string, gen: number, f: (s: SettlementRow) => void): boolean {
    return this.tx(() => {
      const s = this.settlement(id) as SettlementRow;
      if (s.lease_gen !== gen || !["requested", "unknown"].includes(s.state)) return false;
      f(s);
      return true;
    });
  }

  /**
   * One leased step (§14.2): read the hold at one pinned block (entitlement and check_use),
   * fenced against the request's evidence; decide only from that; then, if an action is still
   * due and allowed, submit the exact stored payload once. The writer's answer is an event.
   */
  async unitStep(id: string): Promise<string> {
    const gen = this.claimUnit(id);
    if (gen === null) return "not_due";
    /** Ends this step's lease, recording `extra` (fixed column names only) under the CAS. */
    const endLease = (extra: { reason?: string } = {}) =>
      this.underUnitLease(id, gen, () => {
        const sets = Object.keys(extra).map((k) => `${k} = ?`);
        this.db
          .prepare(
            `UPDATE customer_settlements SET ${[...sets, "lease_until = NULL", "updated_at = ?"].join(", ")} WHERE request_id = ?`,
          )
          .run(...(Object.values(extra) as (string | number | null)[]), iso(), id);
      });
    const r = this.request(id) as RequestRow;
    if (r.conflict) {
      endLease({ reason: "evidence_conflict" });
      return "evidence_conflict";
    }
    const b = this.v3.bindingFor(r.business_id);
    if (!this.adaptersFit(r) || b?.network !== r.network || b.account !== r.account) {
      endLease({ reason: "binding_mismatch" });
      return "binding_mismatch";
    }
    if (!this.reader) {
      endLease();
      return "reader_unavailable";
    }
    let read: Awaited<ReturnType<typeof readCustomerViews>>;
    try {
      read = await readCustomerViews(
        this.reader,
        r,
        {
          control: true,
          entitlement: { customer: r.customer_account, plan_id: r.plan_id },
          checkUse: {
            customer: r.customer_account,
            plan_id: r.plan_id,
            reg_id: r.reg_id,
            hold_seq: r.hold_seq,
            slot: 0,
            fingerprint: r.fingerprint,
          },
        },
        this.readTimeoutMs,
      );
    } catch (e) {
      const code = e instanceof V3ReadError ? e.code : "unavailable";
      // Every write, error paths included, only under this step's lease (003o1).
      const ok = this.underUnitLease(id, gen, () => {
        this.event(id, "unit_read_failed", { code, lease: gen });
        this.db
          .prepare("UPDATE customer_settlements SET lease_until = NULL WHERE request_id = ?")
          .run(id);
      });
      return ok ? "read_failed" : "stale";
    }
    const cur = this.request(id) as RequestRow;
    const e = read.entitlement ?? null;
    const next = markOf(read.block, e);
    const { mark: prev, digestKnown } = this.markFor(cur);
    const problem = evidenceProblem(digestKnown ? prev : { ...prev, digest: next.digest }, next);
    if (problem === "stale") {
      const ok = this.underUnitLease(id, gen, () => {
        this.event(id, "unit_stale_read", { block: read.block.height, lease: gen });
        this.db
          .prepare("UPDATE customer_settlements SET lease_until = NULL WHERE request_id = ?")
          .run(id);
      });
      return ok ? "stale_read" : "stale";
    }
    if (problem !== null) {
      // The request's evidence conflict is sticky (003m1): nothing more is decided or sent.
      // Recorded only while this step still holds the lease (003o1): a stale worker whose read
      // is overtaken by a newer worker's decision records nothing.
      const ok = this.underUnitLease(id, gen, () => {
        this.db
          .prepare(
            "UPDATE customer_requests SET conflict = ?, updated_at = ? WHERE id = ? AND conflict IS NULL",
          )
          .run(JSON.stringify({ reason: problem, block: read.block, against: prev }), iso(), id);
        this.event(id, "evidence_conflict", { code: problem, block: read.block.height });
        this.db
          .prepare(
            "UPDATE customer_settlements SET reason = 'evidence_conflict', lease_until = NULL, updated_at = ? WHERE request_id = ?",
          )
          .run(iso(), id);
      });
      return ok ? "evidence_conflict" : "stale";
    }
    const fact = decideSettlement(
      {
        reg_id: cur.reg_id,
        key_slot: cur.key_slot,
        key_epoch: cur.key_epoch,
        hold_seq: cur.hold_seq,
        units: cur.units,
        serve_until_ms: cur.serve_until_ms,
        settle_until_ms: cur.settle_until_ms,
        accept_by_ms: cur.accept_by_ms,
        fingerprint: cur.fingerprint,
      },
      e,
      read.checkUse as NonNullable<typeof read.checkUse>,
      read.block.timestamp_ms,
    );
    const evidence = JSON.stringify({
      block: read.block,
      fact,
      free: e?.free ?? null,
      consumed: e?.consumed ?? null,
      hold_seq: e?.hold_seq ?? null,
      last_hold_seq: e?.last_hold_seq ?? null,
    });
    // Set inside the transaction below (a holder, so the type isn't narrowed away).
    const todo: { action: "settle" | "release" | null } = { action: null };
    const decided = this.underUnitLease(id, gen, (s) => {
      this.db
        .prepare("UPDATE customer_requests SET evidence_mark = ?, evidence_height = ? WHERE id = ?")
        .run(JSON.stringify(next), read.block.height, id);
      this.event(id, "unit_read", {
        code: `${fact.kind}${"reason" in fact ? `:${fact.reason}` : ""}`,
        block: read.block.height,
        lease: gen,
      });
      const end = (state: SettlementRow["state"], reason: string | null, free: boolean) => {
        this.db
          .prepare(
            "UPDATE customer_settlements SET state = ?, reason = ?, evidence = ?, lease_until = NULL, updated_at = ? WHERE request_id = ?",
          )
          .run(state, reason, evidence, iso(), id);
        // Only a closed or moved-on hold frees the allocation: the customer may prepare again.
        if (free)
          this.db
            .prepare("UPDATE customer_requests SET allocation = NULL, updated_at = ? WHERE id = ?")
            .run(iso(), id);
      };
      const keep = (reason: string | null) =>
        this.db
          .prepare(
            "UPDATE customer_settlements SET reason = ?, evidence = ?, updated_at = ? WHERE request_id = ?",
          )
          .run(reason, evidence, iso(), id);
      switch (fact.kind) {
        case "charged":
          if (fact.closed)
            end("charged", s.kind === "charge" ? "charged" : "charged_by_signed_use", true);
          else {
            keep("charged_open");
            todo.action = "release"; // close the hold; nothing more is charged (its one unit is used)
          }
          break;
        case "returned":
          end("returned", s.kind === "charge" ? "closed_unused" : "released", true);
          break;
        case "conflict":
          end("conflict", fact.reason, false);
          break;
        case "unknown":
          end("unresolved", fact.reason, fact.reason !== "not_our_hold");
          break;
        case "unused_open":
          if (s.kind === "charge" && !fact.settleable) {
            // settle_hold can never apply now: the unit is released instead, not charged.
            this.db
              .prepare(
                "UPDATE customer_settlements SET kind = 'release', reason = 'settle_deadline_passed', evidence = ?, updated_at = ? WHERE request_id = ?",
              )
              .run(evidence, iso(), id);
            this.event(id, "unit_settle_deadline_passed", { block: read.block.height });
            todo.action = "release";
          } else {
            keep(s.kind === "charge" ? "charge_due" : "release_due");
            todo.action = s.kind === "charge" ? "settle" : "release";
          }
          break;
      }
    });
    if (!decided) return "stale";
    const action = todo.action;
    if (!action) return fact.kind;
    const s = this.settlement(id) as SettlementRow;
    if (s.submissions >= this.maxSubmissions) {
      endLease({ reason: "attempts_exhausted" });
      return "attempts_exhausted";
    }
    // Authority, from the same read: the platform's granted METERING now, or (a release) the
    // deadline after which the contract lets anyone release. The configured actor only.
    const control = read.control as NonNullable<typeof read.control>;
    const anyone =
      action === "release" && BigInt(read.block.timestamp_ms) > BigInt(cur.settle_until_ms);
    if (!anyone && !platformMeters(control, this.operator as string)) {
      endLease({ reason: "operator_not_authorized" });
      return "operator_not_authorized";
    }
    const t = Number(read.block.timestamp_ms);
    if (this.now() - t > this.maxBlockAgeMs || t - this.now() > this.maxFutureSkewMs) {
      endLease({ reason: "evidence_too_old" });
      return "evidence_too_old";
    }
    const writer = this.writer;
    // Only the registration-guarded release exists here (003o1): no unguarded fallback.
    const op = action === "settle" ? writer?.settleHold : writer?.releaseHoldFor;
    if (!writer || !op) {
      endLease({ reason: "writer_unavailable" });
      return "writer_unavailable";
    }
    const sent = this.underUnitLease(id, gen, (row) => {
      this.db
        .prepare(
          "UPDATE customer_settlements SET state = 'unknown', submissions = submissions + 1, updated_at = ? WHERE request_id = ?",
        )
        .run(iso(), id);
      this.event(id, `unit_submit_${action}`, { code: String(row.submissions + 1), lease: gen });
    });
    if (!sent) return "stale";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.writeTimeoutMs);
    const base = {
      operation: id,
      network: cur.network,
      account: cur.account,
      customer: cur.customer_account,
      plan_id: cur.plan_id,
      hold_seq: cur.hold_seq,
      signal: controller.signal,
    };
    let answer: WriterAnswer;
    try {
      answer = await Promise.race([
        action === "settle"
          ? (writer.settleHold as NonNullable<CustomerChainWriter["settleHold"]>).call(writer, {
              ...base,
              uses: [{ slot: 0, fingerprint: cur.fingerprint, sig: cur.use_sig as string }],
              close: true,
            })
          : (writer.releaseHoldFor as NonNullable<CustomerChainWriter["releaseHoldFor"]>).call(
              writer,
              // The exact registration this request was prepared under, from its stored payload.
              { ...base, reg_id: cur.reg_id },
            ),
        new Promise<WriterAnswer>((resolve) =>
          controller.signal.addEventListener(
            "abort",
            () => resolve({ status: "unknown", detail: "timeout" }),
            { once: true },
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
    if (
      !this.underUnitLease(id, gen, () =>
        this.event(id, "unit_writer_answer", { code, lease: gen }),
      )
    )
      return "stale";
    endLease();
    return `submitted_${action}`;
  }
}

interface SettlementRow {
  request_id: string;
  kind: "charge" | "release";
  state: "requested" | "unknown" | "charged" | "returned" | "conflict" | "unresolved";
  reason: string | null;
  eligibility: string;
  submissions: number;
  lease_gen: number;
  lease_until: number | null;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  request_id: string;
  invocation_id: string;
  person_id: string;
  admission: string;
  input_source: "protected" | "resubmitted";
  result_state: "pending" | "stored" | "none" | "unavailable" | "deleted";
  result_ref: string | null;
  result_scheme: string | null;
  result_outcome: string | null;
  retention_until_ms: number | null;
  delivered_at: string | null;
  delivery: "protecting" | "delivered" | "not_delivered" | null;
  delivery_started_ms: number | null;
  created_at: string;
  updated_at: string;
}
