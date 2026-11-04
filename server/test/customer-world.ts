// Job 003m test world. A TEST DOUBLE of one business-v3 entitlement, seeded from the contract's own
// JSON (server/test/fixtures/v3/customer-readback.json and direct-accepting.json, produced by the
// contract's unit tests). It models only the open_hold rules the reservation relies on
// (lib.rs open_hold, revoke_key, skip_hold_seq, release_hold); it is not the contract, executes no
// transaction and proves no live authorization. Every synthetic change to fixture state is a named
// method here. The customer's key is the contract tests' synthetic seed 1, never a wallet key.
// Every producer has its own finite ceiling.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { everstreetApi } from "../src/app.ts";
import type { CustomerViewTransport, PinnedBlock } from "../src/customerRead.ts";
import {
  closedRootPreimage,
  type Envelope,
  envelopeDigest,
  fingerprintPreimage,
  preimageOfHold,
  preimageOfUse,
  sha256,
  sha256Hex,
} from "../src/customerSigning.ts";
import {
  type CustomerChainWriter,
  type CustomerUseOptions,
  CustomerUses,
  type InputProtection,
  type WriterAnswer,
} from "../src/customerUse.ts";
import { ManagedRuntime, type RuntimeOptions } from "../src/invocations.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import type { Store } from "../src/store.ts";
import { V3Observations } from "../src/v3observe.ts";
import type { BlockRef, ViewTransport } from "../src/v3read.ts";
import { type Answer, correct, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON is read field by field
export type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
export const READBACK = fixture("customer-readback");
export const ACCEPTING = fixture("direct-accepting");
export const SIGNING = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-signing.json"), "utf8"),
) as Json;
export const view = (k: string) => JSON.parse(READBACK[k] as string) as Json;

export const BUSINESS = "studio.biz.near";
export const CUSTOMER = "cara.near";
export const OPERATOR = "meter.near";
export const T0 = 1_793_577_600_000n; // the contract tests' T0: 2026-11-02T00:00:00Z

/** A synthetic ed25519 signer from a 32-byte seed (the contract tests use seed 1). */
export function keyFromSeed(seed: number) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seed),
  ]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return (messageHex: string) => sign(null, Buffer.from(messageHex, "hex"), key).toString("hex");
}

const HASH_CHARS = "ABCDEFGHJK"; // base58 has no 0: map each digit to a letter
const hashOf = (h: number) =>
  `Bkh${String(h)
    .padStart(29, "0")
    .replace(/[0-9]/g, (d) => HASH_CHARS[Number(d)] as string)}`;

class ChainRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** The test double of the chain: one plan, one entitlement per customer. */
export class FixtureChain {
  height = 1_000;
  ts = T0;
  plan = view("plan_1");
  control: Json = JSON.parse(ACCEPTING.get_control as string);
  treasury: Json = JSON.parse(ACCEPTING.get_treasury as string);
  ents = new Map<string, Json>();
  private holdPk = new Map<string, string>();
  opened = 0;
  /** Units the double charged, and holds released through release_hold (job 003o). */
  charged = 0;
  released = 0;
  calls = 0;
  readonly ceiling = 400;

  constructor() {
    // Funded 100, key slot 0 active at epoch 1, nothing held (the contract's own JSON).
    this.ents.set(CUSTOMER, view("funded_100.entitlement"));
    this.noDeal();
  }

  private bump() {
    if (++this.calls > this.ceiling) throw new Error("fixture chain ceiling reached");
  }

  /** Synthetic: the accepting fixture's control with its live deal removed. */
  noDeal() {
    this.control = { ...this.control, live_deal: null };
  }

  /** The contract-produced control with a live Direct deal in accepting (grants exclude meter). */
  accepting() {
    this.control = JSON.parse(ACCEPTING.get_control as string);
  }

  /** The contract-produced control after an actual sale: owner buyer.near, meter2 at gen 2. */
  afterSale() {
    this.control = view("after_sale.control");
  }

  /** Synthetic: the new owner appointed the platform's account again (appoint_operator). */
  reappointPlatform() {
    this.control = { ...this.control, operators: [[OPERATOR, 1, this.control.generation]] };
  }

  tick(ms: bigint) {
    this.ts += ms;
    this.height += 1;
  }

  /** A change lands in a new block one second later (block time rises: assumption A1). */
  private nextBlock() {
    this.height += 1;
    this.ts += 1_000n;
  }

  block(): PinnedBlock {
    return {
      height: String(this.height),
      hash: hashOf(this.height),
      timestamp_ms: String(this.ts),
    };
  }

  ent(customer = CUSTOMER) {
    return this.ents.get(customer) ?? null;
  }

  answer(method: string, args: Record<string, unknown>): string {
    this.bump();
    if (method === "get_control") return JSON.stringify(this.control);
    if (method === "get_treasury") return JSON.stringify(this.treasury);
    if (method === "get_plan") return JSON.stringify(args.plan_id === 1 ? this.plan : null);
    if (method === "get_entitlement")
      return JSON.stringify(args.plan_id === 1 ? this.ent(String(args.customer)) : null);
    if (method === "check_use") return JSON.stringify(this.checkUse(args));
    throw new Error(`no view ${method}`);
  }

  /** check_use (lib.rs `check_use`), over the double's state. */
  private checkUse(args: Record<string, unknown>) {
    const answer = (status: string, slot_used: boolean | null, closed_root: string | null) => ({
      status,
      slot_used,
      closed_root,
    });
    const e = this.ent(String(args.customer));
    if (!e || args.plan_id !== 1) return answer("no_entitlement", null, null);
    if (e.reg_id !== args.reg_id) return answer("other_registration", null, null);
    const fpHex = String(args.fingerprint);
    if (!/^[0-9a-f]{64}$/.test(fpHex)) return answer("invalid", null, null);
    const slot = Number(args.slot);
    const bit = slot < 10 ? 1 << slot : 0;
    if (e.hold_active && e.hold_seq === args.hold_seq) {
      if (slot >= e.hold_units) return answer("invalid", null, null);
      if ((e.hold_used & bit) === 0) return answer("unused", false, null);
      return e.hold_slots[slot] === fpHex
        ? answer("charged", true, null)
        : answer("conflict", true, null);
    }
    if (e.last_hold_seq === args.hold_seq && args.hold_seq !== 0)
      return answer("closed", bit !== 0 && (e.last_hold_used & bit) !== 0, e.last_hold_root);
    return answer("unknown_hold", null, null);
  }

  /** settle_hold (lib.rs): the whole batch is checked first; close returns the rest. */
  settleHold(
    signer: string,
    customer: string,
    holdSeq: number,
    uses: { slot: number; fingerprint: string; sig: string }[],
    close: boolean,
    verify: (pk: string, message: string, sig: string) => boolean,
  ): string[] {
    this.bump();
    if (!this.meters(signer)) throw new ChainRefusal("E_NOT_OPERATOR");
    const e = this.ent(customer) as Json;
    if (!e?.hold_active || e.hold_seq !== holdSeq) throw new ChainRefusal("E_HOLD_CLOSED");
    if (this.ts > BigInt(e.settle_until_ms)) throw new ChainRefusal("E_EXPIRED");
    if (uses.length > e.hold_units) throw new ChainRefusal("E_BATCH");
    let used = e.hold_used as number;
    const slots = [...(e.hold_slots as (string | null)[])];
    const out: string[] = [];
    let newly = 0;
    for (const u of uses) {
      if (u.slot >= e.hold_units) throw new ChainRefusal("E_SLOT");
      const ref = {
        business: BUSINESS,
        plan_id: 1,
        customer,
        reg_id: e.reg_id as string,
        key_slot: e.hold_key_slot as number,
        key_epoch: e.hold_key_epoch as number,
      };
      const message = sha256(
        preimageOfUse(ref, { hold_seq: holdSeq, slot: u.slot, fingerprint: u.fingerprint }),
      ).toString("hex");
      if (!verify(this.holdPk.get(customer) as string, message, u.sig))
        throw new ChainRefusal("E_SIG");
      const bit = 1 << u.slot;
      if (used & bit) {
        if (slots[u.slot] === u.fingerprint) out.push("already");
        else throw new ChainRefusal("E_CONFLICT");
      } else {
        used |= bit;
        slots[u.slot] = u.fingerprint;
        newly++;
        out.push("charged");
      }
    }
    Object.assign(e, {
      hold_used: used,
      hold_slots: slots,
      hold_charged: e.hold_charged + newly,
      consumed: String(BigInt(e.consumed) + BigInt(newly)),
    });
    if (close) this.release(customer);
    else this.nextBlock();
    if (newly > 0) this.charged += newly;
    return out;
  }

  /** release_hold (lib.rs): an operator any time; anyone once the settle deadline has passed. */
  releaseHold(signer: string, customer: string, holdSeq: number) {
    this.bump();
    const e = this.ent(customer) as Json;
    if (!e?.hold_active || e.hold_seq !== holdSeq) throw new ChainRefusal("E_HOLD_CLOSED");
    if (this.ts <= BigInt(e.settle_until_ms) && !this.meters(signer))
      throw new ChainRefusal("E_NOT_OPERATOR");
    this.release(customer);
    this.released++;
  }

  /** release_hold_for (lib.rs, 003o1): the registration is checked in the same call. */
  releaseHoldFor(signer: string, customer: string, regId: string, holdSeq: number) {
    const e = this.ent(customer);
    if (!e) throw new ChainRefusal("E_ARGS");
    if (e.reg_id !== regId) throw new ChainRefusal("E_REGISTRATION");
    this.releaseHold(signer, customer, holdSeq);
  }

  private meters(signer: string) {
    if (signer === this.control.owner) return true;
    return (this.control.operators as [string, number, number][]).some(
      ([a, caps, g]) => a === signer && (caps & 1) !== 0 && g === this.control.generation,
    );
  }

  /** open_hold's rules, in the contract's order (lib.rs open_hold). */
  openHold(
    signer: string,
    customer: string,
    auth: {
      hold_seq: number;
      units: number;
      serve_until_ms: string;
      key_slot: number;
      key_epoch: number;
    },
    sig: string,
    verify: (pk: string, message: string, sig: string) => boolean,
  ): "opened" | "already" {
    this.bump();
    if (!this.meters(signer)) throw new ChainRefusal("E_NOT_OPERATOR");
    const e = this.ent(customer);
    if (!e) throw new ChainRefusal("E_STATE");
    const ref = {
      business: BUSINESS,
      plan_id: 1,
      customer,
      reg_id: e.reg_id as string,
      key_slot: auth.key_slot,
      key_epoch: auth.key_epoch,
    };
    const message = sha256(preimageOfHold(ref, auth)).toString("hex");
    if (
      e.hold_active &&
      e.hold_seq === auth.hold_seq &&
      e.hold_units === auth.units &&
      e.serve_until_ms === auth.serve_until_ms &&
      e.hold_key_slot === auth.key_slot &&
      e.hold_key_epoch === auth.key_epoch
    ) {
      if (!verify(this.holdPk.get(customer) as string, message, sig))
        throw new ChainRefusal("E_SIG");
      return "already";
    }
    if (!(auth.hold_seq > e.hold_seq)) throw new ChainRefusal("E_HOLD_SEQ_USED");
    if (e.paused) throw new ChainRefusal("E_PAUSED");
    if (e.hold_active) throw new ChainRefusal("E_HOLD_ACTIVE");
    if (auth.hold_seq !== e.hold_seq + 1) throw new ChainRefusal("E_HOLD_SEQ");
    const k = e.keys[auth.key_slot];
    if (k?.state !== "active" || k.epoch !== auth.key_epoch) throw new ChainRefusal("E_KEY");
    if (!verify(k.public_key, message, sig)) throw new ChainRefusal("E_SIG");
    if (auth.units < 1 || BigInt(auth.units) > BigInt(e.free)) throw new ChainRefusal("E_UNITS");
    const serve = BigInt(auth.serve_until_ms);
    if (serve < this.ts + 60_000n) throw new ChainRefusal("E_EXPIRED");
    if (serve > this.ts + BigInt(this.plan.hold_ttl_ms)) throw new ChainRefusal("E_TTL");
    const day = Number(this.ts / 86_400_000n);
    const today = k.day === day ? k.held_today : 0;
    if (today + auth.units > k.max_units_per_day) throw new ChainRefusal("E_DAILY_CAP");
    k.day = day;
    k.held_today = today + auth.units;
    Object.assign(e, {
      hold_seq: auth.hold_seq,
      hold_active: true,
      hold_key_slot: auth.key_slot,
      hold_key_epoch: auth.key_epoch,
      hold_units: auth.units,
      hold_charged: 0,
      hold_used: 0,
      hold_slots: Array(auth.units).fill(null),
      hold_opened_at_ms: String(this.ts),
      serve_until_ms: auth.serve_until_ms,
      settle_until_ms: String(serve + BigInt(this.plan.settle_grace_ms)),
      free: String(BigInt(e.free) - BigInt(auth.units)),
    });
    this.holdPk.set(customer, k.public_key);
    this.opened++;
    this.nextBlock();
    return "opened";
  }

  /** release_hold (lib.rs close_hold): uncharged units return; last_hold keeps seq/bitmap/root. */
  release(customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    const used = (e.hold_slots as (string | null)[])
      .map((f, i) => [i, f] as const)
      .filter((x): x is readonly [number, string] => x[1] !== null);
    Object.assign(e, {
      free: String(BigInt(e.free) + BigInt(e.hold_units - e.hold_charged)),
      last_hold_seq: e.hold_seq,
      last_hold_used: e.hold_used,
      last_hold_charged: e.hold_charged,
      last_hold_root: sha256Hex(closedRootPreimage(used)),
      hold_active: false,
      hold_key_slot: 0,
      hold_key_epoch: 0,
      hold_units: 0,
      hold_charged: 0,
      hold_used: 0,
      hold_slots: [],
      hold_opened_at_ms: "0",
      serve_until_ms: "0",
      settle_until_ms: "0",
    });
    this.nextBlock();
  }

  /** revoke_key: the epoch rises; an active hold under that key stops serving now. */
  revoke(slot: number, customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    const k = e.keys[slot];
    k.epoch += 1;
    k.state = "revoked";
    e.key_states[slot] = 2;
    e.key_epochs[slot] = k.epoch;
    if (e.hold_active && e.hold_key_slot === slot && BigInt(e.serve_until_ms) > this.ts)
      e.serve_until_ms = String(this.ts);
    this.nextBlock();
  }

  /** skip_hold_seq: burns the next sequence (only with no hold open). */
  skip(customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    if (e.hold_active) throw new Error("E_HOLD_ACTIVE");
    e.hold_seq += 1;
    this.nextBlock();
  }

  /** set_paused. */
  pause(paused: boolean, customer = CUSTOMER) {
    (this.ent(customer) as Json).paused = paused;
    this.nextBlock();
  }
}

/** The read transport over the test double, with injected faults. Ceiling: the chain's. */
export class FixtureReader implements CustomerViewTransport {
  readonly network = "testnet";
  /** Answers this many reads with an older block (a lagging endpoint). */
  lagging = 0;
  failNext = 0;
  mixNext = false;
  malformedNext = false;
  /**
   * Labelled synthetic history (job 003m1): while set, every read answers at this block with
   * these views (decoded contract JSON), as an endpoint serving an older or forked state would.
   */
  scripted: { block: PinnedBlock; views: Record<string, Json | null> } | null = null;
  private reads = 0;
  constructor(private readonly chain: FixtureChain) {}
  private readGate: { release: Promise<void>; arrive: () => void } | null = null;
  /** The next read waits at its final block until opened (job 003o1); then answers as set then. */
  holdNextRead() {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    this.readGate = { release, arrive };
    return { open, entered };
  }
  async finalBlock(): Promise<PinnedBlock> {
    if (++this.reads > 300) throw new Error("fixture reader ceiling reached");
    const gate = this.readGate;
    if (gate) {
      this.readGate = null;
      gate.arrive();
      await gate.release;
    }
    if (this.scripted) return this.scripted.block;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("endpoint unavailable");
    }
    const b = this.chain.block();
    if (this.lagging > 0) {
      this.lagging--;
      const h = Number(b.height) - 5;
      return { height: String(h), hash: hashOf(h), timestamp_ms: b.timestamp_ms };
    }
    return b;
  }
  /** Runs once before the next view answers (job 003n: something lands during the read). */
  duringRead: (() => void) | null = null;
  async view(input: { method: string; args: Record<string, unknown>; block: BlockRef }) {
    const during = this.duringRead;
    this.duringRead = null;
    during?.();
    const s = this.scripted;
    if (s && input.method in s.views)
      return { result: JSON.stringify(s.views[input.method]), block: input.block };
    let result = this.chain.answer(input.method, input.args);
    if (this.malformedNext && input.method !== "get_control") {
      this.malformedNext = false;
      // Synthetic mutation: an extra field the contract never sends.
      result = JSON.stringify({ ...(JSON.parse(result) as Json), surprise: 1 });
    }
    if (this.mixNext) {
      this.mixNext = false;
      const h = Number(input.block.height) + 1;
      return { result, block: { height: String(h), hash: hashOf(h) } };
    }
    return { result, block: input.block };
  }
}

interface Gate {
  /** Resolves once a submission is waiting at this gate. */
  entered: Promise<void>;
  /** Lets it through (idempotent). */
  open: () => void;
}
type Mode =
  | "ok"
  | "lose_reply"
  | "drop"
  | { gate: Gate; release: Promise<void>; arrive: () => void };

/** The hold writer over the test double. Ceiling: 50 submissions. */
export class FixtureWriter implements CustomerChainWriter {
  readonly network = "testnet";
  readonly signer = OPERATOR;
  modes: Mode[] = [];
  calls = 0;
  answers: WriterAnswer[] = [];
  /** The latest gate (`holdNext`), for tests holding one submission. */
  gateOpen: () => void = () => {};
  entered: Promise<void> = Promise.resolve();
  constructor(
    private readonly chain: FixtureChain,
    private readonly verify: (pk: string, m: string, s: string) => boolean,
  ) {}
  /** The next queued submission waits inside the writer until its gate opens. */
  holdNext(): Gate {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    const gate = { entered, open };
    this.modes.push({ gate, release, arrive });
    this.gateOpen = open;
    this.entered = entered;
    return gate;
  }
  /** Settle and release submissions, counted apart (job 003o). */
  settleCalls = 0;
  releaseCalls = 0;
  /** Faults for settle/release only, so reservation faults stay independent. */
  unitModes: Mode[] = [];

  /** One submission: its fault mode, then the double's rule; the shared ceiling is 200. */
  private async submit(modes: Mode[], apply: () => WriterAnswer["status"]): Promise<WriterAnswer> {
    if (++this.calls > 200) throw new Error("fixture writer ceiling reached");
    const mode = modes.shift() ?? "ok";
    if (mode === "drop") throw new Error("network: the request never arrived");
    if (typeof mode === "object") {
      mode.arrive();
      await mode.release;
    }
    let answer: WriterAnswer;
    try {
      answer = { status: apply() } as WriterAnswer;
    } catch (e) {
      if (e instanceof ChainRefusal) answer = { status: "refused", code: e.code };
      else throw e;
    }
    this.answers.push(answer);
    if (mode === "lose_reply") throw new Error("network: the response was lost");
    return answer;
  }

  openHold(input: Parameters<CustomerChainWriter["openHold"]>[0]): Promise<WriterAnswer> {
    return this.submit(this.modes, () =>
      this.chain.openHold(this.signer, input.customer, input.auth, input.sig, this.verify),
    );
  }

  /** A unit-step gate (job 003o): the next settle or release waits until it opens. */
  holdNextUnit(): Gate {
    const g = this.holdNext();
    this.unitModes.push(this.modes.pop() as Mode);
    return g;
  }

  settleHold(input: Parameters<NonNullable<CustomerChainWriter["settleHold"]>>[0]) {
    this.settleCalls++;
    return this.submit(this.unitModes, () => {
      this.chain.settleHold(
        this.signer,
        input.customer,
        input.hold_seq,
        input.uses,
        input.close,
        this.verify,
      );
      return "applied";
    });
  }

  releaseHoldFor(input: Parameters<NonNullable<CustomerChainWriter["releaseHoldFor"]>>[0]) {
    this.releaseCalls++;
    return this.submit(this.unitModes, () => {
      this.chain.releaseHoldFor(this.signer, input.customer, input.reg_id, input.hold_seq);
      return "applied";
    });
  }
}

/** A labelled synthetic protection double: it keeps inputs in memory, never on disk. */
export class SyntheticProtection implements InputProtection {
  readonly scheme = "synthetic-test-only";
  kept = new Map<string, Buffer>();
  kinds = new Map<string, string>();
  calls = 0;
  /** The next this-many protect calls fail (job 003n). */
  failProtect = 0;
  deleted: string[] = [];
  /** The next this-many delete calls fail (job 003n1). */
  failDelete = 0;
  /** While set, protecting a result waits here (job 003n1: a crash before it is recorded). */
  resultGate: { release: Promise<void>; arrive: () => void } | null = null;
  private n = 0;
  holdResults() {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    this.resultGate = { release, arrive };
    return { open, entered };
  }
  async protect(input: { request_id: string; kind?: string; bytes: Buffer }) {
    if (++this.calls > 100) throw new Error("synthetic protection ceiling reached");
    // The gate first, so a protection can also fail after it waited (job 003o1).
    if (input.kind === "result" && this.resultGate) {
      this.resultGate.arrive();
      await this.resultGate.release;
    }
    if (this.failProtect > 0) {
      this.failProtect--;
      throw new Error("synthetic protection failure");
    }
    const ref = `ref-${++this.n}`;
    this.kept.set(ref, input.bytes);
    this.kinds.set(ref, input.kind ?? "input");
    return ref;
  }
  async load(ref: string) {
    const b = this.kept.get(ref);
    if (!b) throw new Error("no such reference");
    return b;
  }
  async delete(ref: string) {
    if (this.failDelete > 0) {
      this.failDelete--;
      throw new Error("synthetic delete failure");
    }
    this.kept.delete(ref);
    this.deleted.push(ref);
  }
}

/**
 * A provider script held at a gate until opened (job 003n). `abortable` rejects on the abort
 * signal like a real transport; otherwise it answers late, ignoring a cancellation.
 */
export function heldScript(answer: () => Promise<Answer>, abortable = false) {
  let open: () => void = () => {};
  let arrive: () => void = () => {};
  const release = new Promise<void>((r) => {
    open = r;
  });
  const entered = new Promise<void>((r) => {
    arrive = r;
  });
  const script = async (_req: unknown, signal: AbortSignal): Promise<Answer> => {
    arrive();
    if (abortable)
      await Promise.race([
        release,
        new Promise<never>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new RuntimeFailure("Stopped", "cancelled", null)),
            { once: true },
          ),
        ),
      ]);
    else await release;
    return answer();
  };
  return { script, open, entered };
}

/**
 * What a customer's client does before signing (§3): recompute every preimage and the digest
 * from the envelope's plain fields, then sign the two digests with its own key.
 */
export function clientCheck(env: Envelope & { envelope_digest: string }) {
  const ref = {
    business: env.business_account,
    plan_id: env.plan_id,
    customer: env.customer_account,
    reg_id: env.reg_id,
    key_slot: env.key_slot,
    key_epoch: env.key_epoch,
  };
  const fp = sha256Hex(
    fingerprintPreimage({
      ...ref,
      network: env.network,
      hold_seq: env.hold.hold_seq,
      slot: env.use.slot,
      request_id: env.request_id,
      offer_id: env.offer_id,
      release_id: env.release_id,
      artifact_digest: env.artifact_digest,
      input_sha256: env.commitment.input_sha256,
      salt: env.commitment.salt_hex,
    }),
  );
  const hold = preimageOfHold(ref, env.hold);
  const use = preimageOfUse(ref, {
    hold_seq: env.hold.hold_seq,
    slot: env.use.slot,
    fingerprint: fp,
  });
  const { envelope_digest, ...rest } = env;
  return (
    fp === env.use.fingerprint_hex &&
    hold.toString("hex") === env.hold.preimage_hex &&
    sha256(hold).toString("hex") === env.hold.message_hex &&
    use.toString("hex") === env.use.preimage_hex &&
    sha256(use).toString("hex") === env.use.message_hex &&
    envelopeDigest(rest as Envelope) === envelope_digest
  );
}

/**
 * A founder with an active release, bound to the fixture business account, and a customer linked
 * to the fixture's customer account. `make` rebuilds the app on a store (a restart).
 */
export async function customerWorld(
  opts: {
    dbPath?: string;
    customer?: Partial<CustomerUseOptions>;
    noReader?: boolean;
    noWriter?: boolean;
    /** The runtime's options (job 003n), e.g. a short time limit. */
    runtime?: RuntimeOptions;
    /** No runtime provider in the customer app (job 003n). */
    noProvider?: boolean;
    /** A v3 view transport for owner observations and sale reconciliation (job 003o). */
    v3Transport?: ViewTransport | null;
  } = {},
) {
  // The scripted extractor that passes the release check (fictional documents only).
  const provider = new ScriptedRuntime(correct);
  const rw = runtimeWorld(provider, opts.runtime ?? {}, { dbPath: opts.dbPath });
  const f = await rw.founder("Ava Chen");
  await rw.release(f);
  const release = rw.store.db
    .prepare("SELECT id FROM runtime_releases WHERE project_id = ? AND state = 'active'")
    .get(f.project) as { id: string };
  const chain = new FixtureChain();
  const { verifiesEd25519 } = await import("../src/customerSigning.ts");
  const reader = new FixtureReader(chain);
  const writer = new FixtureWriter(chain, verifiesEd25519);
  const clock = { now: Number(T0) };
  const options = (): CustomerUseOptions => ({
    reader: opts.noReader ? null : reader,
    writer: opts.noWriter ? null : writer,
    operatorAccount: OPERATOR,
    now: () => clock.now,
    ...opts.customer,
  });
  const v3 = {
    transport: opts.v3Transport ?? null,
    bindings: [{ business_id: f.business, network: "testnet", account: BUSINESS }],
  };
  /** The managed runtime for a store: the founder's own, or (a restart) a new one, recovered. */
  const runtimeFor = (store: Store) => {
    if (store === rw.store && !opts.noProvider) return rw.runtime;
    const r = new ManagedRuntime(store.db, store, opts.noProvider ? null : provider, {
      ceilingCents: 1_000,
      ...opts.runtime,
    });
    r.recover();
    return r;
  };
  const make = (store: Store, runtime = runtimeFor(store)) => {
    state.runtime = runtime;
    return everstreetApi(store, {
      localPreview: true,
      environment: "test",
      v3,
      customer: options(),
      runtime,
    });
  };
  /** A CustomerUses over the same store and runtime, for the worker-only methods (job 003n). */
  const service = () =>
    new CustomerUses(
      state.store.db,
      state.store,
      new V3Observations(state.store.db, state.store, v3),
      options(),
      state.runtime,
    );
  const state = {
    store: rw.store,
    runtime: rw.runtime,
    app: null as unknown as ReturnType<typeof everstreetApi>,
  };
  state.app = make(rw.store);
  let tokens = 0;
  const sessionFor = (personId: string) => {
    const token = `test-session-${++tokens}-${personId}`;
    state.store.db
      .prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)")
      .run(token, personId, new Date().toISOString());
    return token;
  };
  const caller = (personId: string) => {
    const token = sessionFor(personId);
    const call = async (path: string, method = "GET", body?: unknown) => {
      const res = await state.app.request(path, {
        method,
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
    return Object.assign(call, { id: personId });
  };
  const person = (name: string) => {
    const id = `person-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    state.store.db
      .prepare(
        "INSERT INTO people (id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, name, new Date().toISOString());
    return caller(id);
  };
  const link = (personId: string, account: string) =>
    state.store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
      )
      .run(personId, account, new Date().toISOString());
  const owner = caller(f.ava.id);
  const cara = person("Cara Okafor");
  link(cara.id, CUSTOMER);
  /** Job 003r: inspect a plan as the owner and return the digest a create must present. */
  const reviewed = async (
    terms: { plan_id?: number; retention_days?: number; release_id?: string } = {},
    by = owner,
  ) => {
    const r = await by(`/api/businesses/${f.business}/customer-offer-inspections`, "POST", {
      release_id: release.id,
      plan_id: 1,
      retention_days: 30,
      ...terms,
    });
    if (r.status !== 200) throw new Error(`inspect: ${r.body.error}`);
    return r.body.inspection.terms_digest as string;
  };
  let firstReview: string | null = null; // offer() is the same idempotent request every time
  const offer = async () => {
    firstReview ??= await reviewed();
    const r = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
      idempotency_key: "offer-key-0001",
      release_id: release.id,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: firstReview,
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`offer: ${r.body.error}`);
    return r.body.offer.id as string;
  };
  const sign1 = keyFromSeed(1);
  /** Prepare, check as the client would, and sign with the synthetic seed-1 key. */
  const signed = (env: Envelope & { envelope_digest: string }, signer = sign1) => ({
    envelope_digest: env.envelope_digest,
    hold_signature: signer(env.hold.message_hex),
    use_signature: signer(env.use.message_hex),
  });
  return {
    rw,
    f,
    release: release.id,
    chain,
    reader,
    writer,
    clock,
    state,
    make,
    owner,
    cara,
    person,
    link,
    caller,
    offer,
    reviewed,
    v3,
    signed,
    sign1,
    provider,
    service,
    runtimeFor,
  };
}

export type CustomerWorld = Awaited<ReturnType<typeof customerWorld>>;
