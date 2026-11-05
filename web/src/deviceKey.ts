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
  };
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
  | { kind: "refused"; message: string }
  | { kind: "stale" };

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

/** One customer's device keys for this page; `retire()` (account change) fences it. */
export class DeviceKeys {
  private alive = true;
  private readonly subtle: SubtleCrypto;
  constructor(private readonly deps: DeviceKeysDeps) {
    this.subtle = deps.subtle ?? globalThis.crypto.subtle;
  }
  retire() {
    this.alive = false;
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

  private async ask(
    offerId: string,
    w: WalletBoundary,
    call: WalletFunctionCall,
    want: Readiness["kind"],
  ): Promise<DeviceAnswer> {
    let cancelled = false;
    try {
      await w.send(call);
    } catch (e) {
      cancelled = /closed the window|cancel|reject/i.test((e as Error)?.message ?? "");
      // Any other failure: the transaction may or may not have been sent. The readback decides.
    }
    if (!this.alive) return { kind: "stale" };
    const { readiness } = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    if (readiness.kind === want) return { kind: "done", readiness };
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
   * Enrolls this device: makes ONE key (only if none is stored), stores the intent, then asks the
   * wallet. An interrupted enrollment re-asks with the SAME key (in a free slot if its slot was
   * taken meanwhile), never a silently generated replacement.
   */
  async enroll(offerId: string, maxUnitsPerDay: number): Promise<DeviceAnswer> {
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
    if (record) {
      const k = v.rb.keys[record.slot];
      if (k?.state === "active" && k.public_key !== record.public_key) {
        const slot = free();
        if (slot === undefined)
          return { kind: "refused", message: "All four key slots are in use; revoke one first." };
        record = { ...record, slot };
      }
      record = { ...record, intent: "enroll" };
    } else {
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
      record = {
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
        intent: "enroll",
        created_ms: (this.deps.now ?? Date.now)(),
      };
    }
    if (!this.alive) return { kind: "stale" };
    await v.store.put(record); // BEFORE the wallet is asked
    const w = await this.walletFor();
    if (!this.alive) return { kind: "stale" };
    if (!("send" in w)) return w;
    return this.ask(offerId, w, installCall(record), "ready");
  }

  /** Revokes a slot from the customer's account (this device's key, or a lost one). */
  async revoke(offerId: string, slot: number): Promise<DeviceAnswer> {
    const v = await this.view(offerId);
    if (!this.alive) return { kind: "stale" };
    if (v.rb.keys[slot]?.state !== "active")
      return { kind: "refused", message: "That key slot isn't active." };
    const mine = v.record?.slot === slot ? v.record : null;
    if (mine) await v.store.put({ ...mine, intent: "revoke" });
    const w = await this.walletFor();
    if (!this.alive) return { kind: "stale" };
    if (!("send" in w)) return w;
    let cancelled = false;
    try {
      await w.send(revokeCall(v.rb.contract, v.rb.plan_id, slot));
    } catch (e) {
      cancelled = /closed the window|cancel|reject/i.test((e as Error)?.message ?? "");
    }
    if (!this.alive) return { kind: "stale" };
    const after = await this.view(offerId);
    const k = after.rb.keys[slot];
    const gone = k?.state !== "active" || (mine !== null && k.public_key !== mine.public_key);
    if (gone) {
      if (mine) await after.store.delete(mine.id); // only once the readback shows it
      const latest = await this.view(offerId);
      return { kind: "done", readiness: latest.readiness };
    }
    if (mine) await after.store.put({ ...mine, intent: null }); // still active: not revoked
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
   * Deletes this device's key locally. If its slot is active on the contract it STAYS active
   * there until revoked (nobody can sign with it any more: the private key is gone).
   */
  async forget(offerId: string) {
    const v = await this.view(offerId);
    if (v.record) await v.store.delete(v.record.id);
    return (await this.view(offerId)).readiness;
  }

  /**
   * The real authorizer for one offer (§9.6), only while this device is `ready`. Before signing it
   * reads again and refuses if the slot, epoch, key or account changed.
   */
  authorizer(offerId: string, ready: Extract<Readiness, { kind: "ready" }>): CustomerAuthorizer {
    return {
      label: `This device's key for ${this.deps.account} (slot ${ready.slot})`,
      synthetic: false,
      slot: ready.slot,
      publicKey: async () => ready.public_key,
      sign: async ({ hold_message_hex, use_message_hex }) => {
        if (!this.alive) throw new Error("You're no longer signed in as this account.");
        const v = await this.view(offerId);
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
        const signHex = async (hex: string) => {
          if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("That isn't a 32-byte digest.");
          const sig = await this.subtle.sign(
            ED25519,
            (v.record as DeviceKeyRecord).key,
            fromHex(hex) as BufferSource,
          );
          return toHex(new Uint8Array(sig));
        };
        return {
          hold_signature: await signHex(hold_message_hex),
          use_signature: await signHex(use_message_hex),
        };
      },
    };
  }
}
