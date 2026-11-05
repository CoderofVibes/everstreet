// Job 003wf slice 3 (docs/design/WRITER_HISTORY.md): the operators' view of unresolved writer
// attempts. One action only: read an attempt's own FINAL status by its hash. Nothing here signs,
// sends, retries, or marks an outcome; uncertainty that evidence can't settle stays visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../session.tsx";
import {
  type WriterAttempt,
  type WriterCheck,
  type WriterHistoryList,
  type WriterOperation,
  writerHistoryApi,
} from "../writerHistoryApi.ts";

const STATE_LABEL: Record<string, string> = {
  signed: "Outcome unknown",
  success: "Succeeded (final)",
  failure: "Refused (final)",
  invalid: "Invalid",
};

function short(v: string, n = 10) {
  return v.length > n * 2 ? `${v.slice(0, n)}…${v.slice(-6)}` : v;
}

function Attempt({
  op,
  a,
  onChecked,
}: {
  op: WriterOperation;
  a: WriterAttempt;
  onChecked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriterCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await writerHistoryApi.check(op.table, op.operation, a.attempt);
      setResult(r);
      onChecked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => resultRef.current?.focus(), 0);
    }
  };
  return (
    <li className="wh-attempt">
      <div className="wh-attempt-head">
        <strong>Attempt {a.attempt}</strong> · <span className="mono">{a.method}</span> ·{" "}
        <span className={a.unresolved ? "pill pill-caution" : "pill"}>
          {a.reconcile === "legacy_invalid"
            ? "Earlier 'invalid' (not proof)"
            : STATE_LABEL[a.state]}
        </span>
        {a.code && <span className="mono"> {a.code}</span>}
      </div>
      {a.reasons.map((r) => (
        <p key={r.key} className="muted small">
          {r.text}
        </p>
      ))}
      <dl className="wh-ids">
        <dt>Transaction</dt>
        <dd className="mono" title={a.tx_hash}>
          {a.tx_hash}
        </dd>
        <dt>Signed by</dt>
        <dd className="mono">
          {a.signer} · {short(a.public_key)}
        </dd>
        <dt>Nonce · block</dt>
        <dd className="mono">
          {a.nonce} · {a.block_height}
        </dd>
        <dt>Sends claimed</dt>
        <dd>
          {a.sends_claimed} (
          {a.history === "counted"
            ? "counted since signing"
            : "from before counting began: not proof of a sole sender"}
          )
        </dd>
        <dt>Recorded</dt>
        <dd>
          {new Date(a.created_at).toLocaleString()} · last change{" "}
          {new Date(a.updated_at).toLocaleString()}
        </dd>
      </dl>
      {a.unresolved && (
        <div className="wh-actions">
          <button type="button" className="btn" disabled={busy} onClick={check}>
            {busy ? "Reading its status…" : "Read its own final status"}
          </button>
          <span className="muted small">Reads by this exact hash. Sends nothing.</span>
        </div>
      )}
      {(result || error) && (
        <p ref={resultRef} tabIndex={-1} className={error ? "error" : "wh-result"} role="status">
          {error ?? result?.explanation}
        </p>
      )}
      {a.checks.length > 0 && (
        <details>
          <summary>Earlier checks ({a.checks.length})</summary>
          <ul className="wh-checks">
            {a.checks.map((c) => (
              <li key={c.id}>
                {new Date(c.checked_at).toLocaleString()} · {c.checked_by_account} · saw{" "}
                <span className="mono">{c.observed}</span>
                {c.observed_code ? ` (${c.observed_code})` : ""} ·{" "}
                {c.recorded ? `recorded ${c.state_after}` : `unchanged (${c.state_after})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function WriterHistoryPage() {
  const { person } = useSession();
  const [list, setList] = useState<WriterHistoryList | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "failed">("loading");
  const load = useCallback(() => {
    writerHistoryApi
      .list()
      .then((l) => {
        setList(l);
        setState("ready");
      })
      .catch((e: Error & { status?: number }) =>
        setState(e.status === 404 ? "not_found" : "failed"),
      );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the signed-in person changes
  useEffect(load, [person?.id]);
  if (state === "loading") return <div className="page muted">Loading…</div>;
  if (state === "not_found")
    return (
      <div className="page narrow empty">
        <h1>Page not found</h1>
        <p className="muted">There's nothing here for this account.</p>
      </div>
    );
  if (state === "failed" || !list)
    return (
      <div className="page narrow">
        <h1>Writer history</h1>
        <p className="error" role="alert">
          The history couldn't be read. Nothing was changed.
        </p>
        <button type="button" className="btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="page narrow wh-page">
      <p className="eyebrow">Operators</p>
      <h1>Unresolved writer history</h1>
      <p className="lead">{list.policy}</p>
      <p className="muted small">
        A customer's use and a sale's close are decided by the contract's own readback, never by one
        attempt alone. A missing status, an expired block or a used nonce doesn't prove an attempt
        didn't execute.
      </p>
      {list.operations.length === 0 ? (
        <section className="card">
          <h2>Nothing unresolved</h2>
          <p className="muted">Every recorded attempt has a final outcome.</p>
        </section>
      ) : (
        list.operations.map((op) => (
          <section className="card wh-op" key={`${op.table}:${op.operation}`}>
            <h2>
              {op.subject.kind === "customer_request"
                ? `Customer use at ${String(op.subject.business_name)}`
                : op.subject.kind === "close_order"
                  ? "Sale close"
                  : "Unmatched operation"}
            </h2>
            <p className="muted small">
              <span className="mono">{op.operation}</span>
              {op.subject.kind === "customer_request" &&
                ` · request ${String(op.subject.request_state)} · plan ${String(op.subject.plan_id)}`}
            </p>
            <p className="small">{op.subject.note}</p>
            {op.unresolved_behind_terminal > 0 && (
              <p className="notice small">
                The newest attempt is {op.newest_state}, but {op.unresolved_behind_terminal} earlier
                attempt{op.unresolved_behind_terminal === 1 ? " is" : "s are"} still unresolved and
                keep{op.unresolved_behind_terminal === 1 ? "s" : ""} blocking fresh attempts.
              </p>
            )}
            <ul className="wh-attempts">
              {op.attempts.map((a) => (
                <Attempt key={a.attempt} op={op} a={a} onChecked={load} />
              ))}
            </ul>
          </section>
        ))
      )}
      {list.truncated && <p className="muted small">Showing the newest 200 operations.</p>}
    </div>
  );
}
