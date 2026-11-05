// Job 003wf slice 3 (docs/design/WRITER_HISTORY.md): the operator's bounded view of unresolved
// writer history, and the ONE supported way to resolve an attempt: read that attempt's own FINAL
// status by its exact hash, without sending anything, and record it by compare-and-set.
//
// There is deliberately no "mark successful", "mark failed" or "retry fresh". Elapsed time, a
// missing status, a used nonce or an expired block never prove an outcome
// (APPLICATION_COMPOSITION.md §8). Signed bytes, payload contents and customer documents are never
// read or returned here. Every check is audited (writer_history_checks, append-only).

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TxOutcome, TxRpc } from "./customerWriter.ts";
import { VALIDITY_BLOCKS } from "./customerWriter.ts";
import { HttpError } from "./store.ts";

export type AttemptsTable = "chain_tx_attempts" | "closer_tx_attempts";
const TABLES: AttemptsTable[] = ["chain_tx_attempts", "closer_tx_attempts"];
/** Bounds: at most this many operations listed, and attempts shown per operation. */
export const LIST_LIMIT = 200;
export const ATTEMPTS_PER_OPERATION = 20;
const CHECK_TIMEOUT_MS = 10_000;

export interface WriterHistoryOptions {
  /** Verified NEAR accounts allowed to see and check writer history (config `operators`). */
  operators: readonly string[];
  /** Status reads only (never sendTx). Null: checks answer unsupported. */
  rpc: Pick<TxRpc, "txStatus"> | null;
  /** The identities that sign now, per table, so an attempt by another signer is named. */
  currentSigners: Partial<Record<AttemptsTable, { signer: string; public_key: string }>>;
  now?: () => number;
}

interface AttemptRow {
  operation: string;
  attempt: number;
  method: string;
  receiver: string;
  signer: string;
  public_key: string;
  nonce: string;
  block_height: string;
  tx_hash: string;
  broadcasts: number;
  history: "counted" | "uncounted";
  reconcile: "legacy_invalid" | null;
  state: "signed" | "success" | "failure" | "invalid";
  code: string | null;
  created_ms: number;
  updated_ms: number;
}

/** Why an attempt is listed: each reason is about evidence, never about elapsed time alone. */
export type UnresolvedReason =
  | "outcome_unknown" // 'signed': it may have executed; only its own FINAL status decides
  | "legacy_invalid" // an earlier writer's 'invalid', not proof (the upgrade policy)
  | "other_signer"; // signed under an identity this server no longer signs with

function reasonsFor(a: AttemptRow, current?: { signer: string; public_key: string }) {
  const out: UnresolvedReason[] = [];
  if (a.state === "signed") out.push("outcome_unknown");
  if (a.state === "invalid" && a.reconcile === "legacy_invalid") out.push("legacy_invalid");
  if (
    out.length > 0 &&
    current &&
    (a.signer !== current.signer || a.public_key !== current.public_key)
  )
    out.push("other_signer");
  return out;
}

const EXPLAIN: Record<UnresolvedReason, string> = {
  outcome_unknown:
    "Signed and possibly sent; no FINAL status has been recorded. It may have executed. Only its own final status decides it; nothing new is ever signed for this operation.",
  legacy_invalid:
    "An earlier writer called this invalid; that classification isn't proof. Only its own final status resolves it.",
  other_signer:
    "Signed under an identity this server no longer signs with, so the writer never rebroadcasts it. Its own final status is still read by its hash.",
};

export class WriterHistory {
  private readonly now: () => number;
  constructor(
    private readonly db: DatabaseSync,
    private readonly opts: WriterHistoryOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Configured operators only; everyone else gets 404 (the console's existence isn't disclosed). */
  authorize(account: string | null): string {
    if (!account || !this.opts.operators.includes(account)) throw new HttpError(404, "Not found");
    return account;
  }

  private tables(): AttemptsTable[] {
    return TABLES.filter(
      (t) =>
        (
          this.db
            .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(t) as { n: number }
        ).n === 1,
    );
  }

  /** The operator's list: every operation with an unresolved attempt, newest first, bounded. */
  list(account: string | null) {
    this.authorize(account);
    const ops: ReturnType<WriterHistory["operation"]>[] = [];
    let truncated = false;
    for (const table of this.tables()) {
      const rows = this.db
        .prepare(
          `SELECT operation, MAX(updated_ms) AS at FROM ${table}
            WHERE state = 'signed' OR (state = 'invalid' AND reconcile = 'legacy_invalid')
            GROUP BY operation ORDER BY at DESC LIMIT ?`,
        )
        .all(LIST_LIMIT + 1) as { operation: string }[];
      if (rows.length > LIST_LIMIT) truncated = true;
      for (const r of rows.slice(0, LIST_LIMIT)) ops.push(this.operation(table, r.operation));
    }
    return {
      operations: ops.slice(0, LIST_LIMIT),
      truncated: truncated || ops.length > LIST_LIMIT,
      validity_blocks: VALIDITY_BLOCKS.toString(),
      policy:
        "Only an attempt's own FINAL status, read by its exact hash, resolves it. Nothing here signs, sends, retries or marks an outcome.",
    };
  }

  private operation(table: AttemptsTable, operation: string) {
    const current = this.opts.currentSigners[table];
    const attempts = (
      this.db
        .prepare(
          `SELECT operation, attempt, method, receiver, signer, public_key, nonce, block_height,
                  tx_hash, broadcasts, history, reconcile, state, code, created_ms, updated_ms
             FROM ${table} WHERE operation = ? ORDER BY attempt DESC LIMIT ?`,
        )
        .all(operation, ATTEMPTS_PER_OPERATION) as unknown as AttemptRow[]
    ).map((a) => {
      const reasons = reasonsFor(a, current);
      return {
        attempt: a.attempt,
        method: a.method,
        receiver: a.receiver,
        signer: a.signer,
        public_key: a.public_key,
        nonce: a.nonce,
        block_height: a.block_height,
        tx_hash: a.tx_hash,
        sends_claimed: a.broadcasts,
        history: a.history,
        state: a.state,
        code: a.code,
        reconcile: a.reconcile,
        unresolved: reasons.length > 0,
        reasons: reasons.map((k) => ({ key: k, text: EXPLAIN[k] })),
        created_at: new Date(a.created_ms).toISOString(),
        updated_at: new Date(a.updated_ms).toISOString(),
        checks: this.checksFor(table, operation, a.attempt),
      };
    });
    const newest = attempts[0];
    const behind = attempts.slice(1).filter((a) => a.unresolved);
    return {
      table,
      operation,
      subject: this.subject(table, operation),
      newest_state: newest?.state ?? null,
      // An earlier unresolved attempt behind a later terminal one (the upgrade policy): it still
      // blocks fresh attempts and stays here until its own status resolves it.
      unresolved_behind_terminal:
        newest !== undefined && !newest.unresolved && behind.length > 0 ? behind.length : 0,
      attempts,
    };
  }

  /** What the operation is about, without private content: ids, states and the business. */
  private subject(table: AttemptsTable, operation: string) {
    // The writer stores `<operation id>|<method>` (customerWriter.ts); the id names the subject.
    const bar = operation.lastIndexOf("|");
    const id = bar > 0 ? operation.slice(0, bar) : operation;
    if (table === "chain_tx_attempts") {
      const r = this.db
        .prepare(
          `SELECT r.id, r.state, r.business_id, b.name AS business_name, r.plan_id, r.created_at
             FROM customer_requests r JOIN businesses b ON b.id = r.business_id WHERE r.id = ?`,
        )
        .get(id) as Record<string, unknown> | undefined;
      return r
        ? {
            kind: "customer_request",
            request_id: r.id,
            request_state: r.state,
            business_id: r.business_id,
            business_name: r.business_name,
            plan_id: r.plan_id,
            created_at: r.created_at,
            note: "The customer's use is decided by the contract's own readback, not by this attempt alone.",
          }
        : { kind: "unknown", note: "No customer request with this id is recorded here." };
    }
    const c = this.db.prepare("SELECT * FROM close_orders WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return c
      ? {
          kind: "close_order",
          close_order_id: c.id,
          business_id: c.business_id ?? null,
          note: "The close is decided by the contract's control view and the reconciliation, not by this attempt alone.",
        }
      : { kind: "unknown", note: "No close order with this id is recorded here." };
  }

  private checksFor(table: AttemptsTable, operation: string, attempt: number) {
    return this.db
      .prepare(
        `SELECT id, checked_by_account, state_before, reconcile_before, observed, observed_code,
                recorded, state_after, checked_at
           FROM writer_history_checks
          WHERE attempts_table = ? AND operation = ? AND attempt = ? ORDER BY checked_at DESC LIMIT 20`,
      )
      .all(table, operation, attempt) as Record<string, unknown>[];
  }

  /**
   * Reads ONE attempt's own FINAL status by its exact hash and signer. Success or failure is
   * recorded over a still-'signed' attempt, or over a 'legacy_invalid' one (clearing the flag),
   * by compare-and-set. Anything else changes nothing. Never sends.
   */
  async check(
    account: string | null,
    personId: string,
    input: { table?: unknown; operation?: unknown; attempt?: unknown },
  ) {
    const who = this.authorize(account);
    const table = input.table;
    if (table !== "chain_tx_attempts" && table !== "closer_tx_attempts")
      throw new HttpError(400, "table must be chain_tx_attempts or closer_tx_attempts");
    if (!this.tables().includes(table)) throw new HttpError(404, "No such attempt");
    const operation = typeof input.operation === "string" ? input.operation : "";
    const attemptNo = Number(input.attempt);
    if (!operation || operation.length > 200 || !Number.isSafeInteger(attemptNo))
      throw new HttpError(400, "operation and attempt are required");
    const a = this.db
      .prepare(`SELECT * FROM ${table} WHERE operation = ? AND attempt = ?`)
      .get(operation, attemptNo) as AttemptRow | undefined;
    if (!a) throw new HttpError(404, "No such attempt");
    const resolvable =
      a.state === "signed" || (a.state === "invalid" && a.reconcile === "legacy_invalid");
    type Observed = "success" | "failure" | "not_found" | "pending" | "read_failed" | "unsupported";
    let observed: Observed = "unsupported";
    let code: string | null = null;
    let recorded = false;
    if (resolvable && this.opts.rpc) {
      let o: TxOutcome | null = null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), CHECK_TIMEOUT_MS);
      try {
        o = await this.opts.rpc.txStatus(a.tx_hash, a.signer, ctl.signal);
      } catch {
        observed = "read_failed";
      } finally {
        clearTimeout(timer);
      }
      if (o?.kind === "success" || o?.kind === "failure") {
        observed = o.kind;
        code = o.kind === "failure" ? o.code : null;
        const changed =
          a.state === "signed"
            ? this.db
                .prepare(
                  `UPDATE ${table} SET state = ?, code = ?, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'signed'`,
                )
                .run(o.kind, code, this.now(), operation, attemptNo)
            : this.db
                .prepare(
                  `UPDATE ${table} SET state = ?, code = ?, reconcile = NULL, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'invalid' AND reconcile = 'legacy_invalid'`,
                )
                .run(o.kind, code, this.now(), operation, attemptNo);
        recorded = changed.changes === 1;
      } else if (o) observed = o.kind === "not_found" ? "not_found" : "pending";
    }
    const after = this.db
      .prepare(`SELECT state, code, reconcile FROM ${table} WHERE operation = ? AND attempt = ?`)
      .get(operation, attemptNo) as {
      state: string;
      code: string | null;
      reconcile: string | null;
    };
    this.db
      .prepare(
        `INSERT INTO writer_history_checks (id, attempts_table, operation, attempt, tx_hash,
           checked_by_account, checked_by_person, state_before, reconcile_before, observed,
           observed_code, recorded, state_after, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        table,
        operation,
        attemptNo,
        a.tx_hash,
        who,
        personId,
        a.state,
        a.reconcile,
        observed,
        code,
        recorded ? 1 : 0,
        after.state,
        new Date(this.now()).toISOString(),
      );
    return {
      observed,
      recorded,
      attempt: { operation, attempt: attemptNo, tx_hash: a.tx_hash, ...after },
      explanation: explainCheck(observed, recorded, a.state, after.state),
    };
  }
}

function explainCheck(observed: string, recorded: boolean, before: string, after: string) {
  if (observed === "unsupported")
    return before === "signed" || before === "invalid"
      ? "Status reads aren't connected here, so nothing was checked or changed."
      : `This attempt is already ${before}; nothing to resolve.`;
  if (observed === "success" || observed === "failure")
    return recorded
      ? `Its own FINAL status shows ${observed}; recorded.`
      : `Its own FINAL status shows ${observed}, but the attempt was already ${after} (recorded elsewhere first); unchanged.`;
  if (observed === "not_found")
    return "The network has no FINAL status for this hash now. That doesn't prove it never executed; it stays unknown.";
  if (observed === "read_failed")
    return "The status read failed. Nothing is concluded; it stays unknown.";
  return "No FINAL status yet. It stays unknown.";
}
