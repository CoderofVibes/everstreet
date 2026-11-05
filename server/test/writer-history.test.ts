// Job 003wf slice 3 (docs/design/WRITER_HISTORY.md): the operators' unresolved writer history.
// In-memory database, fictional accounts, a scripted status reader (no network, nothing sent).

import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/appConfig.ts";
import type { TxOutcome } from "../src/customerWriter.ts";
import { openDb } from "../src/db.ts";
import { WriterHistory } from "../src/writerHistory.ts";

const OPS = "ops-lead.testnet";
const SIGNER = "meter.testnet";
const KEY = "ed25519:CurrentKey111111111111111111111111111111111";
const SECRET_BYTES = "SIGNED-BYTES-MUST-NEVER-BE-SHOWN";

function world(
  answer: (hash: string) => Promise<TxOutcome> | TxOutcome = () => ({ kind: "not_found" }),
) {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES ('p-ops', 'Ops Lead', '', '', '2026-11-05T00:00:00Z')",
  ).run();
  const reads: string[] = [];
  const h = new WriterHistory(db, {
    operators: [OPS],
    rpc: {
      txStatus: async (hash: string) => {
        reads.push(hash);
        return answer(hash);
      },
    },
    currentSigners: { chain_tx_attempts: { signer: SIGNER, public_key: KEY } },
    now: () => Date.parse("2026-11-05T12:00:00Z"),
  });
  let n = 0;
  const attempt = (
    operation: string,
    attempt: number,
    state: string,
    o: { reconcile?: string | null; history?: string; signer?: string; key?: string } = {},
  ) => {
    n++;
    db.prepare(
      `INSERT INTO chain_tx_attempts (operation, attempt, payload_digest, method, receiver, signer,
         public_key, nonce, block_hash, block_height, tx_hash, signed_tx, broadcasts, history,
         reconcile, state, code, created_ms, updated_ms)
       VALUES (?, ?, 'digest', 'settle_hold', 'biz.testnet', ?, ?, ?, 'bh', '1000', ?, ?, 1, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      `${operation}|settle_hold`,
      attempt,
      o.signer ?? SIGNER,
      o.key ?? KEY,
      String(n),
      `hash-${operation}-${attempt}`,
      SECRET_BYTES,
      o.history ?? "counted",
      o.reconcile ?? null,
      state,
      1_000 + n,
      1_000 + n,
    );
  };
  return { db, h, attempt, reads };
}

describe("writer history: who may see it", () => {
  it("answers 404 to anyone but a configured operator, before reading anything", () => {
    const w = world();
    w.attempt("req-1", 1, "signed");
    expect(() => w.h.list(null)).toThrow(/Not found/);
    expect(() => w.h.list("someone-else.testnet")).toThrow(/Not found/);
    expect(w.h.list(OPS).operations).toHaveLength(1);
  });

  it("a check by a non-operator is refused and reads nothing", async () => {
    const w = world(() => ({ kind: "success" }));
    w.attempt("req-1", 1, "signed");
    await expect(
      w.h.check("intruder.testnet", "p-ops", {
        table: "chain_tx_attempts",
        operation: "req-1|settle_hold",
        attempt: 1,
      }),
    ).rejects.toThrow(/Not found/);
    expect(w.reads).toEqual([]);
  });
});

describe("writer history: what is listed", () => {
  it("lists unknown and legacy-invalid attempts only, with identities and never the signed bytes", () => {
    const w = world();
    w.attempt("req-signed", 1, "signed");
    w.attempt("req-legacy", 1, "invalid", { reconcile: "legacy_invalid", history: "uncounted" });
    w.attempt("req-ok", 1, "success");
    w.attempt("req-refused", 1, "failure");
    w.attempt("req-proven-invalid", 1, "invalid"); // counted, sole sender: proven, not listed
    const list = w.h.list(OPS);
    expect(list.operations.map((o) => o.operation).sort()).toEqual([
      "req-legacy|settle_hold",
      "req-signed|settle_hold",
    ]);
    const signed = list.operations.find((o) => o.operation === "req-signed|settle_hold");
    expect(signed?.attempts[0]).toMatchObject({
      attempt: 1,
      state: "signed",
      tx_hash: "hash-req-signed-1",
      unresolved: true,
      reasons: [{ key: "outcome_unknown" }],
    });
    expect(signed?.subject).toMatchObject({ kind: "unknown" });
    expect(JSON.stringify(list)).not.toContain(SECRET_BYTES);
    expect(list.policy).toMatch(/Nothing here signs, sends, retries or marks/);
  });

  it("keeps an earlier unresolved attempt visible behind a later terminal one", () => {
    const w = world();
    w.attempt("req-behind", 1, "invalid", { reconcile: "legacy_invalid", history: "uncounted" });
    w.attempt("req-behind", 2, "success");
    const op = w.h.list(OPS).operations[0];
    expect(op?.newest_state).toBe("success");
    expect(op?.unresolved_behind_terminal).toBe(1);
    expect(op?.attempts.map((a) => [a.attempt, a.unresolved])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it("names an attempt signed under an identity this server no longer signs with", () => {
    const w = world();
    w.attempt("req-old-key", 1, "signed", { key: "ed25519:RetiredKey" });
    const a = w.h.list(OPS).operations[0]?.attempts[0];
    expect(a?.reasons.map((r) => r.key)).toEqual(["outcome_unknown", "other_signer"]);
  });
});

describe("writer history: the only resolution is the attempt's own FINAL status", () => {
  const at = { table: "chain_tx_attempts", operation: "req-1|settle_hold", attempt: 1 };

  it("a FINAL success is recorded over the signed attempt, audited, and never re-checked as open", async () => {
    const w = world(() => ({ kind: "success" }));
    w.attempt("req-1", 1, "signed");
    const r = await w.h.check(OPS, "p-ops", at);
    expect(r).toMatchObject({ observed: "success", recorded: true, attempt: { state: "success" } });
    expect(w.reads).toEqual(["hash-req-1-1"]);
    expect(w.h.list(OPS).operations).toHaveLength(0);
    const again = await w.h.check(OPS, "p-ops", at);
    expect(again).toMatchObject({ observed: "unsupported", recorded: false });
    expect(again.explanation).toMatch(/already success/);
    expect(w.reads).toHaveLength(1); // nothing read for a resolved attempt
    const audit = w.db
      .prepare(
        "SELECT observed, recorded, state_before, state_after FROM writer_history_checks ORDER BY checked_at, rowid",
      )
      .all();
    expect(audit).toEqual([
      { observed: "success", recorded: 1, state_before: "signed", state_after: "success" },
      { observed: "unsupported", recorded: 0, state_before: "success", state_after: "success" },
    ]);
  });

  it("a missing status changes nothing and says it proves nothing", async () => {
    const w = world(() => ({ kind: "not_found" }));
    w.attempt("req-1", 1, "signed");
    const r = await w.h.check(OPS, "p-ops", at);
    expect(r).toMatchObject({
      observed: "not_found",
      recorded: false,
      attempt: { state: "signed" },
    });
    expect(r.explanation).toMatch(/doesn't prove it never executed/);
    expect(w.h.list(OPS).operations[0]?.attempts[0]?.checks).toHaveLength(1);
  });

  it("a failed read changes nothing", async () => {
    const w = world(() => {
      throw new Error("network down");
    });
    w.attempt("req-1", 1, "signed");
    const r = await w.h.check(OPS, "p-ops", at);
    expect(r).toMatchObject({
      observed: "read_failed",
      recorded: false,
      attempt: { state: "signed" },
    });
  });

  it("a legacy-invalid attempt resolves only by its own FINAL failure, clearing the flag", async () => {
    const w = world(() => ({ kind: "failure", code: "E_EXPIRED" }));
    w.attempt("req-1", 1, "invalid", { reconcile: "legacy_invalid", history: "uncounted" });
    const r = await w.h.check(OPS, "p-ops", at);
    expect(r).toMatchObject({
      observed: "failure",
      recorded: true,
      attempt: { state: "failure", code: "E_EXPIRED", reconcile: null },
    });
  });

  it("a status recorded elsewhere first wins: the late check never overwrites it", async () => {
    const w = world();
    w.attempt("req-1", 1, "signed");
    // The writer records success while this check's read is in flight; the read then says failure.
    const h2 = new WriterHistory(w.db, {
      operators: [OPS],
      rpc: {
        txStatus: async () => {
          w.db
            .prepare(
              "UPDATE chain_tx_attempts SET state = 'success' WHERE operation = 'req-1|settle_hold'",
            )
            .run();
          return { kind: "failure", code: "E_LATE" };
        },
      },
      currentSigners: {},
    });
    const r = await h2.check(OPS, "p-ops", at);
    expect(r).toMatchObject({
      observed: "failure",
      recorded: false,
      attempt: { state: "success" },
    });
    expect(r.explanation).toMatch(/already success/);
  });

  it("the audit is append-only", async () => {
    const w = world(() => ({ kind: "not_found" }));
    w.attempt("req-1", 1, "signed");
    await w.h.check(OPS, "p-ops", at);
    expect(() =>
      w.db.prepare("UPDATE writer_history_checks SET observed = 'success'").run(),
    ).toThrow(/append-only/);
    expect(() => w.db.prepare("DELETE FROM writer_history_checks").run()).toThrow(/append-only/);
  });

  it("refuses unknown tables and malformed identities before reading", async () => {
    const w = world(() => ({ kind: "success" }));
    await expect(w.h.check(OPS, "p-ops", { ...at, table: "people" })).rejects.toThrow(
      /table must be/,
    );
    await expect(w.h.check(OPS, "p-ops", { ...at, attempt: "x" })).rejects.toThrow(/required/);
    await expect(w.h.check(OPS, "p-ops", { ...at, attempt: 9 })).rejects.toThrow(/No such attempt/);
    expect(w.reads).toEqual([]);
  });
});

describe("writer history: configuration", () => {
  const base = {
    config_version: 1,
    mode: "configured",
    network: "testnet",
    listen: { host: "127.0.0.1", port: 8899 },
    database: "/tmp/x.db",
    sign_in: { recipient: "everstreet.local" },
    rpc: { endpoint: "https://rpc.invalid" },
  };
  it("accepts a bounded list of operator accounts in configured mode with sign-in", () => {
    expect(validateConfig({ ...base, operators: { accounts: [OPS] } }).operators).toEqual({
      accounts: [OPS],
    });
  });
  it("refuses operators without verified sign-in, in preview, empty, duplicated or malformed", () => {
    const { sign_in: _s, ...noSignIn } = base;
    expect(() => validateConfig({ ...noSignIn, operators: { accounts: [OPS] } })).toThrow();
    expect(() => validateConfig({ ...base, operators: { accounts: [] } })).toThrow(/1 to 16/);
    expect(() => validateConfig({ ...base, operators: { accounts: [OPS, OPS] } })).toThrow(/twice/);
    expect(() => validateConfig({ ...base, operators: { accounts: ["Not An Account"] } })).toThrow(
      /invalid/,
    );
    expect(() => validateConfig({ ...base, operators: { accounts: [OPS], extra: 1 } })).toThrow(
      /unknown field/,
    );
  });
});
