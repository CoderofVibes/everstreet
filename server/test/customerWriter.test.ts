// Job 003w-d: the customer chain writer against a SYNTHETIC testnet (a JSON-RPC fetch that decodes
// and checks every signed transaction itself). Keys are newly generated per test; storage is a
// disposable SQLite file opened through separate connections where the invariant needs them. No
// real endpoint, key file, wallet or transaction exists here.

import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  base58Encode,
  OperatorKey,
  permits,
  TestnetCustomerWriter,
  TestnetTxTransport,
  VALIDITY_BLOCKS,
} from "../src/customerWriter.ts";
import { type Db, openDb } from "../src/db.ts";
import { base58Decode } from "../src/identity.ts";
import type { FetchLike } from "../src/v3rpc.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
});
function dbFile() {
  const dir = mkdtempSync(join(tmpdir(), "writer-"));
  const file = join(dir, "records.db");
  const conns: Db[] = [];
  cleanups.push(() => {
    for (const c of conns) if (c.isOpen) c.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return () => {
    const c = openDb(file);
    conns.push(c);
    return c;
  };
}

/** A newly generated ed25519 operator key in NEAR form (never a real account's). */
function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    secret: `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`,
    public: `ed25519:${base58Encode(pub)}`,
    pub,
  };
}

/** An independent Borsh reader for what the synthetic chain receives. */
function decodeSigned(b64: string) {
  const b = Buffer.from(b64, "base64");
  let i = 0;
  const u32 = () => {
    const v = b.readUInt32LE(i);
    i += 4;
    return v;
  };
  const str = () => {
    const n = u32();
    const s = b.subarray(i, i + n).toString("utf8");
    i += n;
    return s;
  };
  const take = (n: number) => {
    const s = b.subarray(i, i + n);
    i += n;
    return s;
  };
  const start = i;
  const signer = str();
  const keyType = take(1)[0];
  const publicKey = take(32);
  const nonce = b.readBigUInt64LE(i);
  i += 8;
  const receiver = str();
  const blockHash = take(32);
  const actions = u32();
  const actionKind = take(1)[0];
  const method = str();
  const args = JSON.parse(take(u32()).toString("utf8"));
  const gas = b.readBigUInt64LE(i);
  i += 8;
  const deposit = b.readBigUInt64LE(i) + (b.readBigUInt64LE(i + 8) << 64n);
  i += 16;
  const txBytes = b.subarray(start, i);
  const sigType = take(1)[0];
  const signature = take(64);
  return {
    signer,
    keyType,
    publicKey,
    nonce,
    receiver,
    blockHash,
    actions,
    actionKind,
    method,
    args,
    gas,
    deposit,
    txBytes,
    sigType,
    signature,
    rest: b.length - i,
  };
}

type Mode = "land" | "fail" | "drop" | "land_no_answer" | "steal_nonce";
/** The synthetic testnet: access keys, a block height and the transactions it has included. */
function syntheticChain(op: { account: string; key: ReturnType<typeof newKey> }) {
  const chain = {
    height: 5_000,
    keyNonce: 40n,
    permission: "FullAccess" as unknown,
    mode: "land" as Mode,
    failCode: "E_HOLD_CLOSED",
    failRead: false,
    included: new Map<string, { ok: boolean; code?: string }>(),
    sends: [] as { b64: string; tx: ReturnType<typeof decodeSigned> }[],
    methods: [] as string[],
    /** How a reply looks: final for this hash (true), or an optimistic/mismatched one. */
    replyShape: "final" as "final" | "optimistic" | "wrong_hash",
  };
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), op.key.pub]);
  const pubKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  const fetch: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    chain.methods.push(req.method === "query" ? `query:${req.params.request_type}` : req.method);
    const reply = (body: object) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }), { status: 200 });
    const err = (name: string, info?: unknown) =>
      reply({ error: { name: "HANDLER_ERROR", cause: { name, info } } });
    if (chain.failRead) return new Response("", { status: 503 });
    if (req.method === "block")
      return reply({
        result: {
          header: {
            height: chain.height,
            hash: base58Encode(createHash("sha256").update(String(chain.height)).digest()),
          },
        },
      });
    if (req.method === "query") {
      if (req.params.account_id !== op.account || req.params.public_key !== op.key.public)
        return err("UNKNOWN_ACCESS_KEY");
      return reply({
        result: {
          nonce: Number(chain.keyNonce),
          permission: chain.permission,
          block_height: chain.height,
        },
      });
    }
    const outcome = (o: { ok: boolean; code?: string }, hash: string) =>
      reply({
        result: {
          final_execution_status:
            chain.replyShape === "optimistic" ? "EXECUTED_OPTIMISTIC" : "FINAL",
          transaction: { hash: chain.replyShape === "wrong_hash" ? "WRONG_TRANSACTION" : hash },
          ...(o.ok
            ? { status: { SuccessValue: "" }, receipts_outcome: [] }
            : {
                status: {
                  Failure: {
                    ActionError: {
                      kind: {
                        FunctionCallError: {
                          ExecutionError: `Smart contract panicked: ${o.code}: synthetic`,
                        },
                      },
                    },
                  },
                },
              }),
        },
      });
    if (req.method === "tx") {
      const o = chain.included.get(req.params.tx_hash as string);
      return o ? outcome(o, req.params.tx_hash as string) : err("UNKNOWN_TRANSACTION");
    }
    // send_tx: decode, check the signature and nonce like a node would.
    const b64 = req.params.signed_tx_base64 as string;
    const tx = decodeSigned(b64);
    const hash = createHash("sha256").update(tx.txBytes).digest();
    const h = base58Encode(hash);
    chain.sends.push({ b64, tx });
    if (!verify(null, hash, pubKey, tx.signature))
      return err("INVALID_TRANSACTION", { InvalidSignature: {} });
    if (chain.included.has(h)) return outcome(chain.included.get(h) as { ok: boolean }, h);
    if (chain.mode === "steal_nonce") chain.keyNonce = tx.nonce; // another use of the key got there first
    if (tx.nonce <= chain.keyNonce)
      return err("INVALID_TRANSACTION", { InvalidTxError: { InvalidNonce: {} } });
    if (chain.mode === "drop") return err("TIMEOUT_ERROR");
    chain.keyNonce = tx.nonce;
    const o = chain.mode === "fail" ? { ok: false, code: chain.failCode } : { ok: true };
    chain.included.set(h, o);
    if (chain.mode === "land_no_answer") return err("TIMEOUT_ERROR");
    return outcome(o, h);
  };
  return { chain, fetch };
}

const OPERATOR = "metering-synthetic.testnet";
const BUSINESS = "business-synthetic.testnet";
const SIG = "ab".repeat(64);
const open = (operation: string, hold_seq = 7) => ({
  operation,
  network: "testnet",
  account: BUSINESS,
  customer: "cara-synthetic.testnet",
  plan_id: 1,
  auth: { hold_seq, units: 1, serve_until_ms: "1762300000000", key_slot: 0, key_epoch: 1 },
  sig: SIG,
  signal: new AbortController().signal,
});
function setup() {
  const conn = dbFile();
  const key = newKey();
  const { chain, fetch } = syntheticChain({ account: OPERATOR, key });
  const writer = (db: Db = conn(), afterPersist?: () => void) =>
    new TestnetCustomerWriter(db, {
      network: "testnet",
      signer: OPERATOR,
      key: new OperatorKey(key.secret, key.public),
      rpc: new TestnetTxTransport(
        { network: "testnet", endpoint: "https://synthetic-testnet.example" },
        fetch,
      ),
      afterPersist,
    });
  return { conn, key, chain, writer };
}

describe("003w-d exact transactions", () => {
  it("serializes and signs exactly one open_hold FunctionCall as the operator", async () => {
    const { chain, key, writer } = setup();
    const r = await writer().openHold(open("req-1"));
    expect(r.status).toBe("opened");
    expect(chain.sends).toHaveLength(1);
    const tx = (chain.sends[0] as { tx: ReturnType<typeof decodeSigned> }).tx;
    expect(tx).toMatchObject({
      signer: OPERATOR,
      keyType: 0,
      nonce: 41n,
      receiver: BUSINESS,
      actions: 1,
      actionKind: 2,
      method: "open_hold",
      gas: 100_000_000_000_000n,
      deposit: 0n,
      sigType: 0,
      rest: 0,
    });
    expect(tx.publicKey.equals(key.pub)).toBe(true);
    expect(tx.args).toEqual({
      customer: "cara-synthetic.testnet",
      plan_id: 1,
      auth: { hold_seq: 7, units: 1, serve_until_ms: "1762300000000", key_slot: 0, key_epoch: 1 },
      sig: SIG,
    });
    expect((r as { tx: string }).tx).toBe(
      base58Encode(createHash("sha256").update(tx.txBytes).digest()),
    );
    // Only the four allowlisted RPC methods are ever used.
    expect(new Set(chain.methods)).toEqual(new Set(["query:view_access_key", "block", "send_tx"]));
  });

  it("settle_hold and the registration-guarded release carry their exact arguments", async () => {
    const { chain, writer } = setup();
    const w = writer();
    const base = {
      network: "testnet",
      account: BUSINESS,
      customer: "cara-synthetic.testnet",
      plan_id: 1,
      hold_seq: 7,
      signal: new AbortController().signal,
    };
    expect(
      (
        await w.settleHold({
          ...base,
          operation: "req-2",
          uses: [{ slot: 0, fingerprint: "cd".repeat(32), sig: SIG }],
          close: true,
        })
      ).status,
    ).toBe("applied");
    expect((await w.releaseHoldFor({ ...base, operation: "req-3", reg_id: "12" })).status).toBe(
      "applied",
    );
    expect(chain.sends.map((s) => [s.tx.method, s.tx.args])).toEqual([
      [
        "settle_hold",
        {
          customer: "cara-synthetic.testnet",
          plan_id: 1,
          hold_seq: 7,
          uses: [{ slot: 0, fingerprint: "cd".repeat(32), sig: SIG }],
          close: true,
        },
      ],
      [
        "release_hold_for",
        { customer: "cara-synthetic.testnet", plan_id: 1, reg_id: "12", hold_seq: 7 },
      ],
    ]);
  });

  it("refuses bad identities and payloads before reading, signing or sending anything", async () => {
    const { chain, writer } = setup();
    const w = writer();
    for (const [bad, code] of [
      [{ ...open("x1"), network: "mainnet" }, "E_NETWORK"],
      [{ ...open("x2"), account: "business.near" }, "E_ACCOUNT"],
      [{ ...open("x3"), sig: "zz" }, "E_ARGS"],
      [{ ...open("x4"), operation: undefined }, "E_OPERATION"],
    ] as const)
      expect(await w.openHold(bad as never)).toEqual({ status: "refused", code });
    expect(chain.methods).toEqual([]);
    // A key that can't call this contract method is refused before signing.
    chain.permission = { FunctionCall: { receiver_id: "other.testnet", method_names: [] } };
    expect(await w.openHold(open("x5"))).toEqual({ status: "refused", code: "E_SIGNER_KEY" });
    expect(chain.sends).toEqual([]);
    expect(
      permits(
        { FunctionCall: { receiver_id: BUSINESS, method_names: ["settle_hold"] } },
        BUSINESS,
        "open_hold",
      ),
    ).toBe(false);
    expect(
      permits({ FunctionCall: { receiver_id: BUSINESS, method_names: [] } }, BUSINESS, "open_hold"),
    ).toBe(true);
  });

  it("failed reads sign and persist nothing", async () => {
    const { chain, conn, writer } = setup();
    chain.failRead = true;
    const db = conn();
    expect((await writer(db).openHold(open("r1"))).status).toBe("unknown");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM chain_tx_attempts").get() as { n: number }).n,
    ).toBe(0);
  });
});

describe("003w-d durable submission identity", () => {
  it("the same operation again never signs a second transaction; a changed payload is refused", async () => {
    const { chain, writer } = setup();
    const w = writer();
    expect((await w.openHold(open("req-1"))).status).toBe("opened");
    expect((await w.openHold(open("req-1"))).status).toBe("already");
    expect(await w.openHold(open("req-1", 8))).toEqual({
      status: "refused",
      code: "E_PAYLOAD_MISMATCH",
    });
    expect(chain.sends).toHaveLength(1);
  });

  it("negative control: without the durable record the same operation WOULD be sent twice", async () => {
    const { chain, conn, writer } = setup();
    const db = conn();
    await writer(db).openHold(open("req-1"));
    db.exec("DELETE FROM chain_tx_attempts"); // what a writer without durable identity would be
    await writer(db).openHold(open("req-1"));
    expect(chain.sends).toHaveLength(2); // the assertion the real tests rely on detects this
  });

  it("concurrent calls on separate connections: one operation makes one transaction; two make distinct nonces", async () => {
    const { chain, writer } = setup();
    const [a, b] = await Promise.all([
      writer().openHold(open("req-1")),
      writer().openHold(open("req-1")),
    ]);
    expect([a.status, b.status].sort()).toEqual(["opened", "unknown"]);
    expect(chain.sends).toHaveLength(1);
    const [c, d] = await Promise.all([
      writer().openHold(open("req-2")),
      writer().openHold(open("req-3")),
    ]);
    expect([c.status, d.status]).toEqual(["opened", "opened"]);
    const nonces = chain.sends.map((s) => s.tx.nonce);
    expect(new Set(nonces).size).toBe(3);
  });

  it("a contract refusal is final for that operation: refused again with no new transaction", async () => {
    const { chain, writer } = setup();
    chain.mode = "fail";
    const w = writer();
    expect(await w.openHold(open("req-1"))).toMatchObject({
      status: "refused",
      code: "E_HOLD_CLOSED",
    });
    chain.mode = "land";
    expect(await w.openHold(open("req-1"))).toMatchObject({
      status: "refused",
      code: "E_HOLD_CLOSED",
    });
    expect(chain.sends).toHaveLength(1);
  });
});

describe("003w-d crash and unknown boundaries (a new process's connection each time)", () => {
  it("crash after persisting, before broadcast: the restart sends the SAME signed bytes, once", async () => {
    const { chain, conn, writer } = setup();
    const crashed = writer(conn(), () => {
      throw new Error("process died");
    });
    await expect(crashed.openHold(open("req-1"))).rejects.toThrow(/process died/);
    expect(chain.sends).toHaveLength(0);
    const persisted = conn().prepare("SELECT signed_tx, state FROM chain_tx_attempts").get() as {
      signed_tx: string;
      state: string;
    };
    expect(persisted.state).toBe("signed");
    expect((await writer().openHold(open("req-1"))).status).toBe("opened");
    expect(chain.sends.map((s) => s.b64)).toEqual([persisted.signed_tx]);
  });

  it("landed but unanswered: the restart reads its status and sends nothing", async () => {
    const { chain, writer } = setup();
    chain.mode = "land_no_answer";
    expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
    chain.mode = "land";
    expect((await writer().openHold(open("req-1"))).status).toBe("opened");
    expect(chain.sends).toHaveLength(1);
  });

  it("unanswered and not landed: the same hash while valid; after expiry it STAYS unknown, never a fresh transaction", async () => {
    const { chain, conn, writer } = setup();
    chain.mode = "drop";
    expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
    expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
    expect(chain.sends).toHaveLength(2);
    expect(chain.sends[1]?.b64).toBe(chain.sends[0]?.b64); // the identical transaction
    chain.mode = "land";
    // Past its validity a missing status still doesn't prove it never executed (history may be
    // unavailable): no fresh nonce, no new transaction; explicit reconciliation is needed.
    chain.height += Number(VALIDITY_BLOCKS) + 1;
    expect(await writer().openHold(open("req-1"))).toMatchObject({
      status: "unknown",
      detail: "needs_reconciliation",
    });
    expect(chain.sends).toHaveLength(2);
    expect(conn().prepare("SELECT attempt, state FROM chain_tx_attempts").all()).toEqual([
      { attempt: 1, state: "signed" },
    ]);
  });

  it("Astra's counterexample: a used nonce on a REBROADCAST after an unknown is not proof; it stays unknown", async () => {
    const { chain, conn, writer } = setup();
    chain.mode = "drop";
    expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
    chain.keyNonce += 5n; // the nonce is now used (perhaps by this very transaction)
    chain.mode = "land";
    expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
    expect(chain.sends).toHaveLength(2);
    expect(chain.sends[1]?.b64).toBe(chain.sends[0]?.b64);
    expect(conn().prepare("SELECT state FROM chain_tx_attempts").all()).toEqual([
      { state: "signed" },
    ]);
  });

  it("the only fresh-attempt proof: a used nonce on these bytes' FIRST broadcast", async () => {
    const { chain, conn, writer } = setup();
    chain.mode = "steal_nonce";
    expect(await writer().openHold(open("req-1"))).toMatchObject({
      status: "unknown",
      detail: "invalid_nonce",
    });
    chain.mode = "land";
    expect((await writer().openHold(open("req-1"))).status).toBe("opened");
    expect(chain.sends).toHaveLength(2);
    expect(chain.sends[1]?.tx.nonce).toBeGreaterThan(chain.sends[0]?.tx.nonce as bigint);
    expect(
      conn().prepare("SELECT attempt, state, code FROM chain_tx_attempts ORDER BY attempt").all(),
    ).toEqual([
      { attempt: 1, state: "invalid", code: "nonce" },
      { attempt: 2, state: "success", code: null },
    ]);
  });

  it("an optimistic or another transaction's answer is never recorded as final", async () => {
    for (const shape of ["optimistic", "wrong_hash"] as const) {
      const { chain, conn, writer } = setup();
      chain.replyShape = shape;
      expect((await writer().openHold(open("req-1"))).status).toBe("unknown");
      expect(conn().prepare("SELECT state FROM chain_tx_attempts").all()).toEqual([
        { state: "signed" },
      ]);
      chain.replyShape = "final";
      expect((await writer().openHold(open("req-1"))).status).toBe("opened"); // read by hash, no resend
      expect(chain.sends).toHaveLength(1);
    }
  });

  it("an attempt under another operator key is never queried or rebroadcast under the new one", async () => {
    const { chain, conn } = setup();
    const db = conn();
    chain.mode = "drop";
    const keyA = newKey();
    const a = syntheticChain({ account: OPERATOR, key: keyA });
    a.chain.mode = "drop";
    const rpc = (f: FetchLike) =>
      new TestnetTxTransport(
        { network: "testnet", endpoint: "https://synthetic-testnet.example" },
        f,
      );
    const wA = new TestnetCustomerWriter(db, {
      network: "testnet",
      signer: OPERATOR,
      key: new OperatorKey(keyA.secret, keyA.public),
      rpc: rpc(a.fetch),
    });
    expect((await wA.openHold(open("req-1"))).status).toBe("unknown");
    const keyB = newKey();
    const b = syntheticChain({ account: OPERATOR, key: keyB });
    const wB = new TestnetCustomerWriter(db, {
      network: "testnet",
      signer: OPERATOR,
      key: new OperatorKey(keyB.secret, keyB.public),
      rpc: rpc(b.fetch),
    });
    expect(await wB.openHold(open("req-1"))).toEqual({
      status: "refused",
      code: "E_SIGNER_CHANGED",
    });
    expect(b.chain.methods).toEqual([]);
  });
});

describe("003w-d wire compatibility with the pinned SDK (near-api-js 7.3.1)", () => {
  it("the writer's transaction bytes equal the SDK's encoding, and the SDK decodes the signed bytes", async () => {
    const near = await import("near-api-js");
    const { chain, writer } = setup();
    await writer().openHold(open("req-1"));
    const sent = chain.sends[0] as { b64: string; tx: ReturnType<typeof decodeSigned> };
    const t = sent.tx;
    const sdkTx = near.createTransaction(
      t.signer,
      near.PublicKey.fromString(`ed25519:${base58Encode(t.publicKey)}`),
      t.receiver,
      t.nonce,
      [near.actions.functionCall(t.method, Buffer.from(JSON.stringify(t.args)), t.gas, t.deposit)],
      new Uint8Array(t.blockHash),
    );
    expect(Buffer.from(near.encodeTransaction(sdkTx)).equals(t.txBytes)).toBe(true);
    const decoded = near.decodeSignedTransaction(Buffer.from(sent.b64, "base64")) as {
      transaction: Parameters<typeof near.encodeTransaction>[0];
    };
    expect(Buffer.from(near.encodeTransaction(decoded.transaction)).equals(t.txBytes)).toBe(true);
  });
});

describe("003w-d the operator key", () => {
  it("refuses a key that doesn't match its public key, and never exposes the secret", () => {
    const a = newKey();
    const b = newKey();
    expect(() => new OperatorKey(a.secret, b.public)).toThrow(/doesn't match/);
    const k = new OperatorKey(a.secret, a.public);
    expect(JSON.stringify(k)).not.toContain(a.secret.slice(8, 30));
    expect(base58Decode(a.public.slice(8)).equals(k.publicBytes)).toBe(true);
  });
});
