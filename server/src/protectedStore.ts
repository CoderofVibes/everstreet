// Job 003v: durable protected storage for customer inputs and results (docs/design/PROTECTED_STORAGE.md).
// AES-256-GCM from node:crypto over a dedicated SQLite file. Keys are injected by the operator
// at construction and are never stored, printed or generated here. Every load and delete takes
// the caller's expected context, read from the persisted customer request, and an object whose
// stored context differs is refused before any decryption or deletion. This is encryption AT
// REST: the authorized runtime sees the plaintext it runs on, and a compromised platform process
// holding the keys can read everything. It is not end-to-end encryption or a secure wipe.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InputProtection, ProtectedContext, ProtectedObjectInfo } from "./customerUse.ts";

/** The stable scheme and format version; rotating keys never changes it. */
export const PROTECTED_SCHEME = "aes-256-gcm/v1";
const FORMAT = "1";
const IV_BYTES = 12; // the GCM standard nonce size; random per object
const TAG_BYTES = 16; // the full tag, fixed on both sides
const KEY_BYTES = 32;
const KEY_CHECK_LABEL = "everstreet protected-store key check v1";
export const STORE_FILE = "protected-objects.sqlite";

export const STORE_LIMITS = {
  /** One object's plaintext (a 20,000-character input is at most 80,000 UTF-8 bytes). */
  plaintextBytes: 256 * 1024,
  objects: 100_000,
  totalBytes: 512 * 1024 * 1024,
  listMax: 100,
} as const;

const REF = /^ps1_[0-9a-f]{32}$/;
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CONTEXT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export type ProtectedStoreCode =
  | "invalid"
  | "not_found"
  | "context_mismatch"
  | "key_missing"
  | "wrong_key"
  | "authentication_failed"
  | "too_large"
  | "store_full"
  | "unavailable";

/** A fixed code only: never a key, a reference, an identifier or any customer content. */
export class ProtectedStoreError extends Error {
  readonly code: ProtectedStoreCode;
  constructor(code: ProtectedStoreCode) {
    super(`protected storage: ${code}`);
    this.code = code;
    this.name = "ProtectedStoreError";
  }
}

export interface ProtectedKeys {
  /** The key id new objects are written under. */
  active: string;
  /** Every key id that may still be read; removing one makes its objects unreadable. */
  keys: Record<string, Buffer>;
}

export interface ProtectedStoreOptions {
  /** An existing directory the operator chose; the store keeps one SQLite file in it. */
  root: string;
  keys: ProtectedKeys;
  now?: () => number;
  limits?: Partial<Pick<typeof STORE_LIMITS, "plaintextBytes" | "objects" | "totalBytes">>;
  /**
   * TEST INSTRUMENTATION ONLY: called right after the capacity read, before the insert. The
   * concurrency regression uses it to hold one connection there; nothing else sets it.
   */
  afterCapacityRead?: () => void;
}

interface ObjectRow {
  ref: string;
  kind: string;
  person_id: string;
  request_id: string;
  key_id: string;
  iv: Uint8Array;
  tag: Uint8Array;
  ct: Uint8Array;
  created_ms: number;
}

const fail = (code: ProtectedStoreCode): never => {
  throw new ProtectedStoreError(code);
};

function checkContext(ctx: ProtectedContext) {
  if (
    !ctx ||
    (ctx.kind !== "input" && ctx.kind !== "result") ||
    typeof ctx.person_id !== "string" ||
    typeof ctx.request_id !== "string" ||
    !CONTEXT_ID.test(ctx.person_id) ||
    !CONTEXT_ID.test(ctx.request_id)
  )
    fail("invalid");
}

const keyCheck = (key: Buffer) => createHmac("sha256", key).update(KEY_CHECK_LABEL).digest();

/** The authenticated context: every field a swapped or re-labelled object would change. */
function aad(ref: string, keyId: string, ctx: ProtectedContext) {
  return Buffer.from(
    JSON.stringify([
      "everstreet-protected-object",
      PROTECTED_SCHEME,
      keyId,
      ref,
      ctx.kind,
      ctx.person_id,
      ctx.request_id,
    ]),
    "utf8",
  );
}

export class ProtectedStore implements InputProtection {
  readonly scheme = PROTECTED_SCHEME;
  private readonly db: DatabaseSync;
  private readonly keys = new Map<string, Buffer>();
  private readonly active: string;
  /** Configured key ids whose bytes differ from the ones this store's objects were written with. */
  private readonly wrongKeys = new Set<string>();
  private readonly now: () => number;
  private readonly limits: { plaintextBytes: number; objects: number; totalBytes: number };
  private readonly afterCapacityRead: (() => void) | undefined;
  private closed = false;

  constructor(opts: ProtectedStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.limits = { ...STORE_LIMITS, ...(opts.limits ?? {}) };
    this.afterCapacityRead = opts.afterCapacityRead;
    // The keys first: no insecure default, no implicit fresh key, no aliasing.
    const k = opts.keys;
    if (!k || typeof k.active !== "string" || !k.keys || typeof k.keys !== "object")
      throw new Error("protected storage: keys are required (no default key exists)");
    for (const [id, bytes] of Object.entries(k.keys)) {
      if (!KEY_ID.test(id)) throw new Error("protected storage: a key id is invalid");
      if (!Buffer.isBuffer(bytes) || bytes.length !== KEY_BYTES)
        throw new Error("protected storage: every key must be exactly 32 bytes");
      if (bytes.every((b) => b === bytes[0]))
        throw new Error("protected storage: a key is a constant placeholder, not a key");
      for (const other of this.keys.values())
        if (timingSafeEqual(other, bytes))
          throw new Error("protected storage: two key ids name the same key");
      this.keys.set(id, Buffer.from(bytes)); // a private copy
    }
    if (!this.keys.has(k.active))
      throw new Error("protected storage: the active key id is not among the keys");
    this.active = k.active;
    // The root: explicit, existing, absolute, and neither it nor the file a link.
    if (typeof opts.root !== "string" || !isAbsolute(opts.root))
      throw new Error("protected storage: the root must be an absolute path");
    const st = existsSync(opts.root) ? lstatSync(opts.root) : null;
    if (!st || st.isSymbolicLink() || !st.isDirectory())
      throw new Error("protected storage: the root must be an existing directory, not a link");
    const file = join(opts.root, STORE_FILE);
    if (existsSync(file)) {
      const f = lstatSync(file);
      if (f.isSymbolicLink() || !f.isFile())
        throw new Error("protected storage: the store file must be a regular file");
    }
    this.db = new DatabaseSync(file);
    // Rollback journal (not WAL), full sync, and freed pages overwritten in the main file. That
    // is logical deletion, not a secure wipe: see the design's deletion section. The busy timeout
    // comes first (job 003wf3): two processes starting at once both set the journal mode.
    this.db.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS key_checks (
        key_id TEXT PRIMARY KEY, check_mac BLOB NOT NULL, first_seen_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS objects (
        ref TEXT PRIMARY KEY CHECK (length(ref) = 36),
        kind TEXT NOT NULL CHECK (kind IN ('input', 'result')),
        person_id TEXT NOT NULL CHECK (length(person_id) BETWEEN 1 AND 128),
        request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
        key_id TEXT NOT NULL,
        iv BLOB NOT NULL CHECK (length(iv) = ${IV_BYTES}),
        tag BLOB NOT NULL CHECK (length(tag) = ${TAG_BYTES}),
        ct BLOB NOT NULL CHECK (length(ct) <= ${this.limits.plaintextBytes}),
        created_ms INTEGER NOT NULL,
        UNIQUE (key_id, iv)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS objects_request ON objects (request_id, kind);
    `);
    const format = this.db.prepare("SELECT v FROM store_meta WHERE k = 'format'").get() as
      | { v: string }
      | undefined;
    if (!format) this.db.prepare("INSERT INTO store_meta (k, v) VALUES ('format', ?)").run(FORMAT);
    else if (format.v !== FORMAT) {
      this.db.close();
      throw new Error("protected storage: the store file has an unknown format");
    }
    // A key check per key id (an HMAC of a fixed label, not the key): a configured key whose
    // bytes differ from the first ones seen under that id is WRONG, and is never used.
    for (const [id, bytes] of this.keys) {
      const mac = keyCheck(bytes);
      const row = this.db.prepare("SELECT check_mac FROM key_checks WHERE key_id = ?").get(id) as
        | { check_mac: Uint8Array }
        | undefined;
      if (!row)
        this.db
          .prepare("INSERT INTO key_checks (key_id, check_mac, first_seen_ms) VALUES (?, ?, ?)")
          .run(id, mac, this.now());
      else if (!timingSafeEqual(Buffer.from(row.check_mac), mac)) this.wrongKeys.add(id);
    }
  }

  /** Fixed codes for the operator's readiness view; never key ids or bytes. */
  readiness(): { ready: boolean; problems: string[] } {
    if (this.closed) return { ready: false, problems: ["closed"] };
    const problems: string[] = [];
    if (this.wrongKeys.has(this.active)) problems.push("active_key_wrong");
    if ([...this.wrongKeys].some((id) => id !== this.active)) problems.push("older_key_wrong");
    const ids = this.db.prepare("SELECT DISTINCT key_id FROM objects").all() as {
      key_id: string;
    }[];
    if (ids.some((r) => !this.keys.has(r.key_id))) problems.push("key_missing_for_stored_objects");
    return { ready: !this.wrongKeys.has(this.active), problems };
  }

  async protect(input: ProtectedContext & { bytes: Buffer }): Promise<string> {
    this.open();
    checkContext(input);
    if (!Buffer.isBuffer(input.bytes)) fail("invalid");
    if (input.bytes.length > this.limits.plaintextBytes) fail("too_large");
    if (this.wrongKeys.has(this.active)) fail("wrong_key");
    // Encrypt first, outside the write lock.
    const key = this.keys.get(this.active) as Buffer;
    const ref = `ps1_${randomBytes(16).toString("hex")}`;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(ref, this.active, input));
    const ct = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Admission and insertion are ONE transaction that takes SQLite's write lock BEFORE the
    // capacity read (BEGIN IMMEDIATE), so separate connections or processes are serialized: a
    // contender waits (busy_timeout, 5 s) and then sees the winner's object. Astra reproduced
    // two connections both admitted past the ceilings when the read and the insert were apart.
    // A contender still waiting after the timeout fails with "unavailable".
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } catch {
      fail("unavailable");
    }
    try {
      const size = this.db
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(length(ct)), 0) AS bytes FROM objects")
        .get() as { n: number; bytes: number };
      this.afterCapacityRead?.();
      if (size.n >= this.limits.objects || size.bytes + ct.length > this.limits.totalBytes)
        fail("store_full");
      // UNIQUE(key_id, iv) makes a (practically impossible) repeated random IV a failed write,
      // never a reused nonce.
      this.db
        .prepare(
          "INSERT INTO objects (ref, kind, person_id, request_id, key_id, iv, tag, ct, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          ref,
          input.kind,
          input.person_id,
          input.request_id,
          this.active,
          iv,
          tag,
          ct,
          this.now(),
        );
      this.db.exec("COMMIT");
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      if (e instanceof ProtectedStoreError) throw e;
      fail("unavailable");
    }
    return ref;
  }

  async load(ref: string, ctx: ProtectedContext): Promise<Buffer> {
    this.open();
    if (typeof ref !== "string" || !REF.test(ref)) fail("invalid");
    checkContext(ctx);
    const row = this.row(ref);
    if (!row) return fail("not_found");
    // The caller's expectation, from its persisted request, before anything is decrypted: a
    // valid reference moved to another person, request or kind is refused here.
    if (
      row.kind !== ctx.kind ||
      row.person_id !== ctx.person_id ||
      row.request_id !== ctx.request_id
    )
      fail("context_mismatch");
    const key = this.keys.get(row.key_id);
    if (!key) return fail("key_missing");
    if (this.wrongKeys.has(row.key_id)) fail("wrong_key");
    if (row.iv.length !== IV_BYTES || row.tag.length !== TAG_BYTES) fail("authentication_failed");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv), {
      authTagLength: TAG_BYTES,
    });
    // The AAD is rebuilt from the CALLER's context and the reference, not from the row.
    decipher.setAAD(aad(ref, row.key_id, ctx));
    decipher.setAuthTag(Buffer.from(row.tag));
    const partial = decipher.update(Buffer.from(row.ct));
    try {
      const last = decipher.final(); // throws unless the tag authenticates everything
      return Buffer.concat([partial, last]);
    } catch {
      partial.fill(0); // unauthenticated output is never returned
      return fail("authentication_failed");
    }
  }

  /**
   * Removes one object. Idempotent: an object already absent is deleted. An object whose stored
   * context differs from the caller's is never deleted (context_mismatch).
   */
  async delete(ref: string, ctx: ProtectedContext): Promise<void> {
    this.open();
    if (typeof ref !== "string" || !REF.test(ref)) fail("invalid");
    checkContext(ctx);
    const row = this.row(ref);
    if (!row) return;
    if (
      row.kind !== ctx.kind ||
      row.person_id !== ctx.person_id ||
      row.request_id !== ctx.request_id
    )
      fail("context_mismatch");
    this.db
      .prepare(
        "DELETE FROM objects WHERE ref = ? AND kind = ? AND person_id = ? AND request_id = ?",
      )
      .run(ref, ctx.kind, ctx.person_id, ctx.request_id);
    if (this.row(ref)) fail("unavailable"); // not confirmed: never reported as deleted
  }

  /** Stored objects in reference order, for reconciliation; never ciphertext or key bytes. */
  async list(after: string | null, limit: number): Promise<ProtectedObjectInfo[]> {
    this.open();
    if (after !== null && !REF.test(after)) fail("invalid");
    const n = Math.max(1, Math.min(STORE_LIMITS.listMax, Math.floor(limit)));
    return (
      this.db
        .prepare(
          "SELECT ref, kind, person_id, request_id, created_ms FROM objects WHERE ref > ? ORDER BY ref LIMIT ?",
        )
        .all(after ?? "", n) as unknown as ProtectedObjectInfo[]
    ).map((o) => ({ ...o }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    for (const k of this.keys.values()) k.fill(0);
  }

  private open() {
    if (this.closed) fail("unavailable");
  }

  private row(ref: string) {
    return this.db.prepare("SELECT * FROM objects WHERE ref = ?").get(ref) as ObjectRow | undefined;
  }
}

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The one supported configuration path (job 003v): an operator-supplied object, for example
 * parsed from a file the operator owns. Nothing here reads files, the environment or secrets,
 * and nothing calls it in main. Shape (placeholders only):
 *   { "root": "/absolute/dir", "active_key_id": "k2026a",
 *     "keys": { "k2026a": "<32 random bytes, base64>" } }
 */
export function protectedStoreFromConfig(cfg: unknown, now?: () => number): ProtectedStore {
  const c = cfg as { root?: unknown; active_key_id?: unknown; keys?: unknown } | null;
  if (!c || typeof c !== "object")
    throw new Error("protected storage config: an object is required");
  if (typeof c.root !== "string") throw new Error("protected storage config: root is required");
  if (typeof c.active_key_id !== "string")
    throw new Error("protected storage config: active_key_id is required");
  if (!c.keys || typeof c.keys !== "object")
    throw new Error("protected storage config: keys are required");
  const keys: Record<string, Buffer> = {};
  for (const [id, v] of Object.entries(c.keys as Record<string, unknown>)) {
    if (typeof v !== "string" || !B64_32.test(v))
      throw new Error("protected storage config: each key must be 32 bytes in base64");
    keys[id] = Buffer.from(v, "base64");
  }
  return new ProtectedStore({ root: c.root, keys: { active: c.active_key_id, keys }, now });
}
