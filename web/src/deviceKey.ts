// Job 003w-e2 (docs/design/APPLICATION_COMPOSITION.md §9.4–9.6): the customer's device use key.
//
// - Created in this browser with WebCrypto Ed25519, NON-EXTRACTABLE: no code (ours included) can
//   read the private key's bytes. The CryptoKey object itself is kept in IndexedDB, one record per
//   (network, business account, plan, customer account). Nothing private is ever sent anywhere.
// - Enrolled by the customer's own wallet: `install_key` (1 yoctoNEAR) with this key's public half.
//   The intent is stored BEFORE the wallet is asked; whatever the wallet answers (or if it never
//   does), readiness comes only from a fresh contract readback. A retry re-asks with the SAME key.
// - Revoked by `revoke_key` (1 yoctoNEAR); the local key is deleted only once the readback shows it.
// - Authorizes ONE exact request by signing the contract's 32-byte hold/use digests, after the slot,
//   epoch, account and key are checked again against a fresh readback.
// No universal device guarantee: a browser without WebCrypto Ed25519 or IndexedDB says so.

import type { CustomerAuthorizer } from "./customerAuthorizer.ts";
import { fromHex, toHex } from "./customerEnvelope.ts";
import type { WalletBoundary, WalletFunctionCall } from "./wallet.ts";

export interface KeySlotView {
  slot: number;
  state: "empty" | "active" | "revoked";
  epoch: number;
  public_key: string;
  max_hold_units: number;
  max_units_per_day: number;
}

/** GET /api/customer/offers/:offer/keys: a fresh readback at one final block. */
export interface KeysReadback {
  network: string;
  contract: string;
  plan_id: number;
  customer: string;
  plan_max_hold_units: number | null;
  block: { height: string; timestamp_ms: string };
  registered: boolean;
  active: boolean;
  reg_id: string | null;
  keys: KeySlotView[];
}

/** The browser's real readback: GET /api/customer/offers/:offer/keys (same-origin session). */
export async function readKeys(offerId: string): Promise<KeysReadback> {
  const res = await fetch(`/api/customer/offers/${encodeURIComponent(offerId)}/keys`, {
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as KeysReadback & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Couldn't read your keys (${res.status})`);
  return body;
}

export interface DeviceKeyRecord {
  id: string;
  network: string;
  contract: string;
  plan_id: number;
  account: string;
  slot: number;
  public_key: string;
  /** The non-extractable private key (a structured-cloneable CryptoKey). */
  key: CryptoKey;
  max_hold_units: number;
  max_units_per_day: number;
  /** What was last asked of the wallet for this key (null: nothing yet). */
  intent: "enroll" | "revoke" | null;
  created_ms: number;
}

export interface DeviceKeyStore {
  get(id: string): Promise<DeviceKeyRecord | null>;
  put(r: DeviceKeyRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Astra's DeviceKeyReview: stores `r` only if NO record exists for its id, atomically across
   * tabs (an IndexedDB `add` in one transaction), and returns whichever record is stored: ours,
   * or the one another tab stored first. An outstanding key is never overwritten.
   */
  claim?(r: DeviceKeyRecord): Promise<DeviceKeyRecord>;
  /** Deletes the record only if it still holds this public key (one transaction). */
  deleteIf?(id: string, publicKey: string): Promise<boolean>;
  /** Updates the record only if it still holds this public key (one transaction). */
  putIf?(r: DeviceKeyRecord): Promise<boolean>;
  close?(): void;
}

export class DeviceKeyError extends Error {
  constructor(
    readonly code: "storage_unavailable" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}

const DB_NAME = "everstreet-device-keys";
const STORE = "keys";

const wrap = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** The browser's real store: IndexedDB. Throws `storage_unavailable` when it can't be opened. */
export async function openDeviceKeyStore(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): Promise<DeviceKeyStore> {
  if (!idb)
    throw new DeviceKeyError(
      "storage_unavailable",
      "This browser can't keep a device key (no IndexedDB here, e.g. some private windows).",
    );
  let db: IDBDatabase;
  try {
    const open = idb.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE))
        open.result.createObjectStore(STORE, { keyPath: "id" });
    };
    db = await wrap(open);
  } catch {
    throw new DeviceKeyError(
      "storage_unavailable",
      "This browser refused to keep a device key (storage is blocked or full).",
    );
  }
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  const done = (t: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    get: async (id) =>
      ((await wrap(tx("readonly").get(id))) as DeviceKeyRecord | undefined) ?? null,
    put: async (r) => {
      const s = tx("readwrite");
      s.put(r);
      await done(s.transaction);
    },
    delete: async (id) => {
      const s = tx("readwrite");
      s.delete(id);
      await done(s.transaction);
    },
    claim: async (r) => {
      const s = tx("readwrite");
      const req = s.add(r);
      req.onerror = (e) => e.preventDefault(); // ConstraintError: another tab stored one first
      try {
        await done(s.transaction);
        return r;
      } catch {
        const winner = (await wrap(tx("readonly").get(r.id))) as DeviceKeyRecord | undefined;
        if (!winner) throw new Error("The device key couldn't be stored; try again.");
        return winner;
      }
    },
    deleteIf: async (id, publicKey) => {
      const s = tx("readwrite");
      let deleted = false;
      const g = s.get(id);
      g.onsuccess = () => {
        if ((g.result as DeviceKeyRecord | undefined)?.public_key === publicKey) {
          s.delete(id);
          deleted = true;
        }
      };
      await done(s.transaction);
      return deleted;
    },
    putIf: async (r) => {
      const s = tx("readwrite");
      let written = false;
      const g = s.get(r.id);
      g.onsuccess = () => {
        if ((g.result as DeviceKeyRecord | undefined)?.public_key === r.public_key) {
          s.put(r);
          written = true;
        }
      };
      await done(s.transaction);
      return written;
    },
    close: () => db.close(),
  };
}

/** Atomic where the store supports it; otherwise write, then adopt whatever is stored. */
async function claimRecord(store: DeviceKeyStore, r: DeviceKeyRecord): Promise<DeviceKeyRecord> {
  if (store.claim) return store.claim(r);
  const existing = await store.get(r.id);
  if (existing) return existing;
  await store.put(r);
  return (await store.get(r.id)) ?? r;
}
async function updateRecord(store: DeviceKeyStore, r: DeviceKeyRecord): Promise<boolean> {
  if (store.putIf) return store.putIf(r);
  await store.put(r);
  return true;
}
async function deleteRecord(store: DeviceKeyStore, r: DeviceKeyRecord): Promise<boolean> {
  if (store.deleteIf) return store.deleteIf(r.id, r.public_key);
  await store.delete(r.id);
  return true;
}

export const recordId = (network: string, contract: string, planId: number, account: string) =>
  `${network}|${contract}|${planId}|${account}`;

export type Readiness =
  /** This slot is active with THIS device's key, at this epoch (from the readback). */
  | { kind: "ready"; slot: number; epoch: number; public_key: string }
  /** A stored key whose enrollment isn't (yet) confirmed by the contract. */
  | { kind: "pending"; slot: number; public_key: string }
  /** This device's key was revoked (or its slot now holds another key) after a revoke. */
  | { kind: "revoked"; slot: number }
  /** No key on this device; these slots hold keys it doesn't have (another device, or lost). */
  | { kind: "elsewhere"; slots: number[] }
  | { kind: "none" }
  /** No units for this product yet: the fresh-customer prerequisites come first (§9.7). */
  | { kind: "no_entitlement" };

/** What the contract says about this device's key, from a readback only. */
export function classify(r: DeviceKeyRecord | null, rb: KeysReadback): Readiness {
  if (!rb.registered || !rb.active) return { kind: "no_entitlement" };
  const active = rb.keys.filter((k) => k.state === "active");
  if (r) {
    const k = rb.keys[r.slot];
    if (k?.state === "active" && k.public_key === r.public_key)
      return { kind: "ready", slot: r.slot, epoch: k.epoch, public_key: r.public_key };
    if (r.intent === "revoke") return { kind: "revoked", slot: r.slot };
    return { kind: "pending", slot: r.slot, public_key: r.public_key };
  }
  return active.length ? { kind: "elsewhere", slots: active.map((k) => k.slot) } : { kind: "none" };
}

/** The exact enrollment request (§9.5): every field is shown to the customer before approving. */
export function installCall(r: DeviceKeyRecord): WalletFunctionCall {
  return {
    receiverId: r.contract,
    methodName: "install_key",
    args: {
      plan_id: r.plan_id,
      slot: r.slot,
      pk: r.public_key,
      max_hold_units: r.max_hold_units,
      max_units_per_day: r.max_units_per_day,
    },
    gas: "30000000000000",
    deposit: "1",
  };
}

export function revokeCall(contract: string, planId: number, slot: number): WalletFunctionCall {
  return {
    receiverId: contract,
    methodName: "revoke_key",
    args: { plan_id: planId, slot },
    gas: "30000000000000",
    deposit: "1",
  };
}

export type DeviceAnswer =
  | { kind: "done"; readiness: Readiness }
  /** Asked the wallet; the readback doesn't show it yet (perhaps still processing, or refused). */
  | { kind: "not_confirmed"; readiness: Readiness; message: string }
  | { kind: "cancelled"; readiness: Readiness; message: string }
  /** The exact request differs from the one the customer reviewed: shown again, nothing sent. */
  | {
      kind: "changed";
      call: WalletFunctionCall;
      message: string;
      observed?: RevokeObservation;
      review?: RevokeReview;
    }
  | { kind: "refused"; message: string }
  | { kind: "stale" };

/** The key a revocation was reviewed for (Astra's revoke-review probe). */
export interface RevokeObservation {
  account: string;
  network: string;
  contract: string;
  plan_id: number;
  reg_id: string | null;
  slot: number;
  public_key: string;
  epoch: number;
}

/** A revocation review (from prepareRevoke): immutable, the call bound to the key it was shown for. */
export interface RevokeReview {
  readonly kind: "request";
  readonly call: WalletFunctionCall;
  readonly slot: number;
  readonly thisDevice: boolean;
  readonly account: string;
  readonly observed: RevokeObservation;
}

export interface DeviceKeysDeps {
  store: () => Promise<DeviceKeyStore>;
  read: (offerId: string) => Promise<KeysReadback>;
  wallet: () => Promise<WalletBoundary> | null;
  /** The signed-in account (from the verified session). */
  account: string;
  subtle?: SubtleCrypto;
  now?: () => number;
}

const ED25519 = { name: "Ed25519" } as const;
const sameCall = (a: WalletFunctionCall, b: WalletFunctionCall) =>
  JSON.stringify(a) === JSON.stringify(b);
const CANCEL = /closed the window|cancel|reject/i;

/**
 * One customer's device keys for this page; `retire()` (sign-out, account change) fences it: after
 * every asynchronous step it checks again, and a retired instance never signs, sends or writes.
 */
export class DeviceKeys {
  private alive = true;
  private readonly subtle: SubtleCrypto;
  constructor(private readonly deps: DeviceKeysDeps) {
    this.subtle = deps.subtle ?? globalThis.crypto.subtle;
  }
  retire() {
    this.alive = false;
  }
  get retired() {
    return !this.alive;
  }

  private async view(offerId: string) {
    const rb = await this.deps.read(offerId);
    if (rb.customer !== this.deps.account)
      throw new Error("This readback is for another account; sign in again.");
    const store = await this.deps.store();
    const id = recordId(rb.network, rb.contract, rb.plan_id, this.deps.account);
    const record = await store.get(id);
    return { rb, store, id, record, readiness: classify(record, rb) };
  }

  /** The current readiness, from a fresh readback. */
  async status(offerId: string) {
    const v = await this.view(offerId);
    return { readiness: v.readiness, record: v.record, readback: v.rb };
  }

  private async walletFor(): Promise<WalletBoundary | DeviceAnswer> {
    const w = await this.deps.wallet();
    if (!w) return { kind: "refused", message: "There is no wallet on this server." };
    const acct = (await w.accounts())[0] ?? (await w.connect());
    if (acct !== this.deps.account)
      return {
        kind: "refused",
        message: `Your wallet is using ${acct ?? "no account"}, not ${this.deps.account}. Switch accounts in the wallet first; nothing was sent.`,
      };
    return w;
  }

  /**
   * Step 1 of enrolling: this device's ONE key for this account and plan, made only if none is
   * stored, and claimed atomically across tabs (a losing tab adopts the stored winner). Its slot is
   * re-chosen only if another key took it meanwhile. Returns the exact request to review; nothing
   * is sent.
   */
  async prepareEnrollment(
    offerId: string,
    maxUnitsPerDay: number,
  ): Promise<
    { kind: "request"; call: WalletFunctionCall; record: DeviceKeyRecord } | DeviceAnswer
  > {
    if (!Number.isInteger(maxUnitsPerDay) || maxUnitsPerDay < 1 || maxUnitsPerDay > 65_535)
      return { kind: "refused", message: "Choose a daily limit from 1 to 65535 uses." };
    const v = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    if (v.readiness.kind === "ready") return { kind: "done", readiness: v.readiness };
    if (v.readiness.kind === "no_entitlement")
      return { kind: "refused", message: "You have no units for this product yet." };
    if (!v.rb.plan_max_hold_units)
      return { kind: "refused", message: "The product's plan couldn't be read; try again." };
    // A slot not active on the contract (empty or revoked); a slot another key took is active.
    const free = () => v.rb.keys.find((k) => k.state !== "active")?.slot;
    let record = v.record;
    if (!record) {
      const slot = free();
      if (slot === undefined)
        return { kind: "refused", message: "All four key slots are in use; revoke one first." };
      let pair: CryptoKeyPair;
      try {
        pair = (await this.subtle.generateKey(ED25519, false, ["sign", "verify"])) as CryptoKeyPair;
      } catch {
        throw new DeviceKeyError(
          "unsupported",
          "This browser can't make a device key (it has no WebCrypto Ed25519).",
        );
      }
      const pub = new Uint8Array(await this.subtle.exportKey("raw", pair.publicKey));
      if (!this.alive) return { kind: "stale" };
      record = await claimRecord(v.store, {
        id: v.id,
        network: v.rb.network,
        contract: v.rb.contract,
        plan_id: v.rb.plan_id,
        account: this.deps.account,
        slot,
        public_key: toHex(pub),
        key: pair.privateKey,
        max_hold_units: 1, // envelopes authorize one-use holds
        max_units_per_day: maxUnitsPerDay,
        intent: null,
        created_ms: (this.deps.now ?? Date.now)(),
      });
    }
    const k = v.rb.keys[record.slot];
    if (k?.state === "active" && k.public_key !== record.public_key) {
      const slot = free();
      if (slot === undefined)
        return { kind: "refused", message: "All four key slots are in use; revoke one first." };
      const moved = { ...record, slot };
      if (!this.alive) return { kind: "stale" };
      if (!(await updateRecord(v.store, moved)))
        return { kind: "refused", message: "Another tab changed this device's key; check again." };
      record = moved;
    }
    return { kind: "request", call: installCall(record), record };
  }

  /**
   * Step 2: asks the wallet to enroll exactly `reviewed` (the request the customer saw). If the
   * stored key or its slot changed meanwhile, the new request is returned to review, unsent. The
   * intent is stored BEFORE the wallet is asked; readiness comes only from the readback after.
   * Without `reviewed` (tests, a retry of the same stored request) it uses step 1's request.
   */
  async enroll(
    offerId: string,
    maxUnitsPerDay: number,
    reviewed?: WalletFunctionCall,
  ): Promise<DeviceAnswer> {
    const p = await this.prepareEnrollment(offerId, maxUnitsPerDay);
    if (p.kind !== "request") return p;
    if (reviewed && !sameCall(reviewed, p.call))
      return {
        kind: "changed",
        call: p.call,
        message:
          "The request changed since you reviewed it (another key took its slot). Review it again.",
      };
    const store = await this.deps.store();
    if (!this.alive) return { kind: "stale" };
    if (!(await updateRecord(store, { ...p.record, intent: "enroll" })))
      return { kind: "refused", message: "Another tab changed this device's key; check again." };
    const w = await this.walletFor();
    if (!this.alive) return { kind: "stale" };
    if (!("send" in w)) return w;
    let cancelled = false;
    try {
      await w.send(p.call);
    } catch (e) {
      cancelled = CANCEL.test((e as Error)?.message ?? "");
      // Any other failure: the transaction may or may not have been sent. The readback decides.
    }
    if (!this.alive) return { kind: "stale" };
    const { readiness } = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    if (readiness.kind === "ready") return { kind: "done", readiness };
    if (cancelled)
      return {
        kind: "cancelled",
        readiness,
        message: "You closed the wallet before approving. Nothing changed on the contract.",
      };
    return {
      kind: "not_confirmed",
      readiness,
      message:
        "The contract doesn't show this yet. If you approved it, check again in a moment; nothing is assumed from the wallet's answer.",
    };
  }

  /**
   * Job 003wea: step 1 of revoking. The exact `revoke_key` request for this slot, from a fresh
   * readback, for review: whether it is this device's key, the acting account, and WHICH key
   * (public key and epoch) the customer is looking at. That observation is remembered with the
   * request: `revoke` refuses to send if the slot's key, epoch, registration or account changed
   * since (Astra's revoke-review probe: a replacement key must never be revoked under the old
   * key's review). Nothing is sent here.
   *
   * Limit (stated, not hidden): the contract's revoke_key is slot-based, so this is a client-side
   * comparison against a fresh read, not an atomic on-chain guarantee. Between that read and the
   * transaction's inclusion another device could still replace the key. A guarded contract method
   * (e.g. revoke only if the slot's epoch is the one reviewed) would close that window; it is a
   * contract change, recorded as a follow-up, not made here.
   */
  async prepareRevoke(offerId: string, slot: number): Promise<RevokeReview | DeviceAnswer> {
    const v = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    const k = v.rb.keys[slot];
    if (k?.state !== "active") return { kind: "refused", message: "That key slot isn't active." };
    return this.review(v.rb, slot, v.record?.slot === slot && v.record.public_key === k.public_key);
  }

  /** An immutable review: the exact call AND the key it was shown for, together. */
  private review(rb: KeysReadback, slot: number, thisDevice: boolean): RevokeReview {
    const k = rb.keys[slot] as KeySlotView;
    return Object.freeze({
      kind: "request" as const,
      call: Object.freeze(revokeCall(rb.contract, rb.plan_id, slot)),
      slot,
      thisDevice,
      account: this.deps.account,
      observed: Object.freeze({
        account: this.deps.account,
        network: rb.network,
        contract: rb.contract,
        plan_id: rb.plan_id,
        reg_id: rb.reg_id,
        slot,
        public_key: k.public_key,
        epoch: k.epoch,
      }),
    });
  }

  /**
   * Revokes a slot from the customer's account (this device's key, or a lost one), only under a
   * review from `prepareRevoke`: it is sent only if the exact call AND the key that review was
   * shown for (its own, immutable observation) are unchanged now. Astra's follow-up probe: two
   * reviews of one slot have identical call bytes, so a bare call can't say which key it was
   * reviewed for; it is never enough, and gets a fresh review back, unsent. Without `reviewed` at
   * all, the revocation is unreviewed (tests only; the panel always passes its review).
   */
  async revoke(
    offerId: string,
    slot: number,
    reviewed?: RevokeReview | WalletFunctionCall,
  ): Promise<DeviceAnswer> {
    const v = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    if (v.rb.keys[slot]?.state !== "active")
      return { kind: "refused", message: "That key slot isn't active." };
    const exact = revokeCall(v.rb.contract, v.rb.plan_id, slot);
    if (reviewed) {
      const k = v.rb.keys[slot] as KeySlotView;
      const fresh = this.review(
        v.rb,
        slot,
        v.record?.slot === slot && v.record.public_key === k.public_key,
      );
      const r = "observed" in reviewed ? reviewed : null;
      if (
        !r ||
        !sameCall(r.call, exact) ||
        JSON.stringify(r.observed) !== JSON.stringify(fresh.observed)
      )
        return {
          kind: "changed",
          call: fresh.call,
          observed: fresh.observed,
          review: fresh,
          message: r
            ? "The key in this slot changed since you reviewed it (another device may have replaced it). Review the key now there before revoking."
            : "Review which key this revokes before asking your wallet.",
        };
    }
    const mine = v.record?.slot === slot ? v.record : null;
    if (mine && !(await updateRecord(v.store, { ...mine, intent: "revoke" })))
      return { kind: "refused", message: "Another tab changed this device's key; check again." };
    const w = await this.walletFor();
    if (!this.alive) return { kind: "stale" };
    if (!("send" in w)) return w;
    let cancelled = false;
    try {
      await w.send(exact);
    } catch (e) {
      cancelled = CANCEL.test((e as Error)?.message ?? "");
    }
    if (!this.alive) return { kind: "stale" };
    const after = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    const k = after.rb.keys[slot];
    const gone = k?.state !== "active" || (mine !== null && k.public_key !== mine.public_key);
    if (gone) {
      // Only once the readback shows it, and only if the stored record is still THAT key.
      if (mine) await deleteRecord(after.store, mine);
      return { kind: "done", readiness: (await this.view(offerId)).readiness };
    }
    if (mine) await updateRecord(after.store, { ...mine, intent: null }); // still active
    const readiness = (await this.view(offerId)).readiness;
    return cancelled
      ? {
          kind: "cancelled",
          readiness,
          message: "You closed the wallet before approving. The key stays active.",
        }
      : {
          kind: "not_confirmed",
          readiness,
          message:
            "The contract still shows this key active. If you approved it, check again in a moment.",
        };
  }

  /**
   * Deletes this device's key locally (only the record still holding the key seen). If its slot is
   * active on the contract it STAYS active there until revoked; nobody can sign with it any more.
   */
  async forget(offerId: string) {
    const v = await this.view(offerId);
    if (!this.alive) return v.readiness;
    if (v.record) await deleteRecord(v.store, v.record);
    return (await this.view(offerId)).readiness;
  }

  /**
   * The real authorizer for one offer (§9.6), only while this device is `ready`. Before signing it
   * reads again and refuses if the slot, epoch, key or account changed, and it stops at once if this
   * instance is retired at any point (no signature, and no pair delivered).
   */
  authorizer(offerId: string, ready: Extract<Readiness, { kind: "ready" }>): CustomerAuthorizer {
    const gone = () => new Error("You're no longer signed in as this account.");
    return {
      label: `This device's key for ${this.deps.account} (slot ${ready.slot})`,
      synthetic: false,
      slot: ready.slot,
      publicKey: async () => ready.public_key,
      sign: async ({ hold_message_hex, use_message_hex }) => {
        if (!this.alive) throw gone();
        const v = await this.view(offerId);
        if (!this.alive) throw gone();
        const now = v.readiness;
        if (
          now.kind !== "ready" ||
          now.slot !== ready.slot ||
          now.epoch !== ready.epoch ||
          now.public_key !== ready.public_key ||
          !v.record
        )
          throw new Error(
            "This device's key changed since you checked it; check it again before authorizing.",
          );
        const key = v.record.key;
        const signHex = async (hex: string) => {
          if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("That isn't a 32-byte digest.");
          if (!this.alive) throw gone();
          const sig = await this.subtle.sign(ED25519, key, fromHex(hex) as BufferSource);
          if (!this.alive) throw gone();
          return toHex(new Uint8Array(sig));
        };
        const hold_signature = await signHex(hold_message_hex);
        const use_signature = await signHex(use_message_hex);
        if (!this.alive) throw gone();
        return { hold_signature, use_signature };
      },
    };
  }
}

/**
 * Job 003wea (lifetime): one controller and ONE store connection for one offer view. `dispose()`
 * (offer change, account change, unmount) retires the controller, closes its connection, including
 * one whose open resolves only later, and refuses any further open by the retired controller.
 */
export function deviceView(
  deps: Omit<DeviceKeysDeps, "store"> & { open?: () => Promise<DeviceKeyStore> },
) {
  let opened: Promise<DeviceKeyStore> | null = null;
  let disposed = false;
  const keys = new DeviceKeys({
    ...deps,
    store: () => {
      if (disposed) return Promise.reject(new Error("This view has closed."));
      opened ??= (deps.open ?? openDeviceKeyStore)();
      return opened;
    },
  });
  return {
    keys,
    dispose() {
      if (disposed) return;
      disposed = true;
      keys.retire();
      const o = opened;
      opened = null;
      void o?.then(
        (s) => s.close?.(),
        () => {},
      );
    },
  };
}
