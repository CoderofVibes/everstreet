// Job 003wf slice 3 (WRITER_HISTORY.md) through the PRODUCTION composition in this process
// (lifecycleWorld composeIn: verified sign-in, the configured writer, the synthetic RPC and model
// transports only). A customer's open_hold is applied and recorded; a crash between its send and its
// record is then reproduced by returning that durable attempt to 'signed'. The configured operator
// sees it and resolves it ONLY by its own hash's FINAL status; nothing is signed or sent.
// Fictional accounts, ephemeral keys, a disposable directory.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { appBrowser, bootstrap, composeIn, nearKey, signInAs } from "./lifecycleWorld.ts";

const OPS = "ops-lead.testnet";
const MAINT = {
  interval_ms: 60_000,
  batch: 5,
  pass_budget_ms: 3_000,
  op_deadline_ms: 2_000,
  stop_timeout_ms: 5_000,
};
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe("003wf slice 3: unresolved writer history in the configured composition", () => {
  it("a crash-lost open_hold record is listed for the operator only and resolved by its own FINAL status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "writer-history-"));
    cleanups.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    );
    const b = await bootstrap(dir, 1, MAINT);
    const opsKey = nearKey();
    b.rpc.keys.set(`${OPS}|${opsKey.id}`, 0n);
    const db = openDb(b.db);
    try {
      const t = new Date().toISOString();
      db.prepare(
        "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES ('person-ops', 'Rosa Ops', '', '', ?)",
      ).run(t);
      db.prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, 'person-ops', 'testnet', ?)",
      ).run(OPS, t);
    } finally {
      db.close();
    }
    const c = composeIn(b, { config: { operators: { accounts: [OPS] } } });
    cleanups.push(() => c.stop());

    // Cara reserves one use: the configured writer signs, sends and records open_hold.
    const cara = appBrowser(c.app);
    await signInAs(cara, CUSTOMER, b.cara);
    const p = await cara(`/api/customer/offers/${b.offer}/prepare`, "POST", {
      idempotency_key: "writer-history-0001",
      input: INVOICE,
    });
    const u = p.body.use as Json;
    const conf = await cara(`/api/customer/uses/${u.id}/confirm`, "POST", b.w.signed(u.envelope));
    expect(conf.body.use?.state, JSON.stringify(conf.body)).toBe("reserved");

    // The crash: the attempt was sent and applied, but its outcome never reached the records.
    const rec = openDb(b.db);
    const row = rec
      .prepare(
        "SELECT operation, attempt, tx_hash, state FROM chain_tx_attempts WHERE method = 'open_hold'",
      )
      .get() as Json;
    expect(row.state).toBe("success");
    rec
      .prepare("UPDATE chain_tx_attempts SET state = 'signed' WHERE operation = ? AND attempt = ?")
      .run(row.operation, row.attempt);
    // And an attempt the network never saw (an unknown hash), for the "proves nothing" answer.
    rec
      .prepare(
        `INSERT INTO chain_tx_attempts (operation, attempt, payload_digest, method, receiver, signer,
           public_key, nonce, block_hash, block_height, tx_hash, signed_tx, broadcasts, history,
           reconcile, state, code, created_ms, updated_ms)
         SELECT ?, 1, payload_digest, 'settle_hold', receiver, signer, public_key, '999999', block_hash,
                block_height, ?, 'BYTES', 1, 'counted', NULL, 'signed', NULL, created_ms, updated_ms
           FROM chain_tx_attempts WHERE operation = ?`,
      )
      .run(`${u.id}|settle_hold`, "11111111111111111111111111111111111111111111", row.operation);
    rec.close();
    const sent = b.rpc.applied.length;

    // Not an operator: 404, the console's existence undisclosed.
    expect((await cara("/api/operator/writer-history")).status).toBe(404);
    expect(
      (
        await cara("/api/operator/writer-history/check", "POST", {
          table: "chain_tx_attempts",
          operation: row.operation,
          attempt: row.attempt,
        })
      ).status,
    ).toBe(404);

    // The operator signs in with their own verified account and sees both, without bytes.
    const ops = appBrowser(c.app);
    await signInAs(ops, OPS, opsKey);
    const list = await ops("/api/operator/writer-history");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const ops2 = (list.body.operations as Json[]).map((o) => o.operation).sort();
    expect(ops2).toEqual([row.operation, `${u.id}|settle_hold`].sort());
    const open = (list.body.operations as Json[]).find(
      (o) => o.operation === row.operation,
    ) as Json;
    expect(open.subject).toMatchObject({ kind: "customer_request", request_id: u.id });
    expect(open.attempts[0].reasons.map((r: Json) => r.key)).toEqual(["outcome_unknown"]);
    expect(JSON.stringify(list.body)).not.toContain("BYTES");

    // Its own FINAL status (the synthetic RPC's record of that exact hash) resolves it.
    const checked = await ops("/api/operator/writer-history/check", "POST", {
      table: "chain_tx_attempts",
      operation: row.operation,
      attempt: row.attempt,
    });
    expect(checked.body).toMatchObject({ observed: "success", recorded: true });
    // The unknown hash: nothing final, nothing concluded, nothing changed.
    const unknown = await ops("/api/operator/writer-history/check", "POST", {
      table: "chain_tx_attempts",
      operation: `${u.id}|settle_hold`,
      attempt: 1,
    });
    expect(unknown.body).toMatchObject({
      observed: "not_found",
      recorded: false,
      attempt: { state: "signed" },
    });
    // Nothing was sent by either check, and only the unknown one remains listed.
    expect(b.rpc.applied.length).toBe(sent);
    const after = await ops("/api/operator/writer-history");
    expect((after.body.operations as Json[]).map((o) => o.operation)).toEqual([
      `${u.id}|settle_hold`,
    ]);
    expect((after.body.operations as Json[])[0]?.attempts[0].checks).toHaveLength(1);
  }, 60_000);
});
