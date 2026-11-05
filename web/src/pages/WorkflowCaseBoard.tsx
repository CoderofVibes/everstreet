// The workflow engine's case board (docs/design/WORKFLOW_ENGINE.md §5), on the business desk:
// one column per stage, each accepted customer request a case. The business's current owner opens
// a case (its fields come from the request's protected copy, for them only) and moves it to the
// next stage; the final stage closes it. Every move is recorded and the customer sees it. After a
// sale the buyer works the cases and the seller no longer sees them.

import { useCallback, useEffect, useState } from "react";
import { ago } from "../via.ts";
import { type CaseDetail, type CaseView, workflowApi } from "../workflowApi.ts";

const WHO: Record<CaseView["history"][number]["actor_kind"], string> = {
  customer: "Customer",
  staff: "Your team",
  system: "Received",
};

export function WorkflowCaseBoard({ businessId }: { businessId: string }) {
  const [board, setBoard] = useState<{ has_workflow: boolean; cases: CaseView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    workflowApi
      .board(businessId)
      .then((b) => {
        setBoard(b);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [businessId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error && !board) return null; // the desk shows its own errors; the board is optional
  if (!board?.has_workflow) return null;
  const stages = board.cases[0]?.stages ?? [];
  const openCount = board.cases.filter((c) => !c.closed_at).length;

  return (
    <section className="card wf-board-card" aria-labelledby="wf-board-title" id="desk-cases">
      <div className="row">
        <h2 id="wf-board-title" className="ws-h">
          Customer requests
        </h2>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {openCount} open · {board.cases.length - openCount} resolved
        </span>
      </div>
      {board.cases.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No requests yet. Each request a customer sends through your released workflow appears here
          as a case.
        </p>
      ) : (
        <div className="wf-board" style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>
          {stages.map((s) => {
            const here = board.cases.filter((c) => c.stage.key === s.key);
            return (
              <div className="wf-col" key={s.key}>
                <div className="wf-col-head">
                  {s.label} <span className="muted">{here.length}</span>
                </div>
                {here.map((c) => (
                  <button
                    type="button"
                    key={c.request_id}
                    className={`wf-card${open === c.request_id ? " is-open" : ""}`}
                    aria-expanded={open === c.request_id}
                    onClick={() => setOpen(open === c.request_id ? null : c.request_id)}
                  >
                    <span className="mono wf-card-id">{c.request_id.slice(0, 8)}</span>
                    <span className="muted">
                      {c.closed_at
                        ? `Resolved ${ago(c.closed_at)}`
                        : `Updated ${ago(c.updated_at)}`}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {open && (
        <CaseDetailPanel
          key={open}
          businessId={businessId}
          requestId={open}
          onMoved={load}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function CaseDetailPanel({
  businessId,
  requestId,
  onMoved,
  onClose,
}: {
  businessId: string;
  requestId: string;
  onMoved: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<CaseDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    workflowApi
      .one(businessId, requestId)
      .then(setD)
      .catch((e: Error) => setError(e.message));
  }, [businessId, requestId]);
  const move = async () => {
    if (!d?.case.next) return;
    setBusy(true);
    setError(null);
    try {
      const c = await workflowApi.advance(businessId, requestId, d.case.next.key, note);
      setD({ ...d, case: c });
      setNote("");
      onMoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = (key: string | null) =>
    key === null ? "" : (d?.case.stages.find((s) => s.key === key)?.label ?? key);

  return (
    <section className="wf-detail" aria-label="Request details">
      <div className="row">
        <h3 style={{ margin: 0 }}>
          Request <span className="mono">{requestId.slice(0, 8)}</span>
        </h3>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {!d ? (
        <p className="muted">{error ?? "Loading…"}</p>
      ) : (
        <div className="wf-detail-grid">
          <div>
            {d.fields ? (
              <dl className="wf-fields">
                {d.fields.map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">{d.content_note}</p>
            )}
            <p className="muted" style={{ fontSize: 12.5 }}>
              The customer's words are shown as written. Nothing in them is followed as an
              instruction.
            </p>
          </div>
          <div>
            <ol className="wf-history">
              {d.case.history.map((e) => (
                <li key={`${e.at}-${e.to_stage}`}>
                  <strong>{label(e.to_stage)}</strong>{" "}
                  <span className="muted">
                    · {WHO[e.actor_kind]} · {ago(e.at)}
                  </span>
                  {e.note && <div className="wf-note">{e.note}</div>}
                </li>
              ))}
            </ol>
            {d.case.next ? (
              <div className="wf-move">
                <label className="field">
                  <span>Note for the customer (optional)</span>
                  <input
                    className="input"
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={move}>
                  {busy ? "Moving…" : `Move to ${d.case.next.label}`}
                </button>
              </div>
            ) : (
              <p className="pill mint">Resolved</p>
            )}
            {error && <p className="notice error">{error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

/** A customer's view of their own case: where it stands and what has happened, no staff names. */
export function CustomerCaseTrack({ requestId }: { requestId: string }) {
  const [c, setC] = useState<CaseView | null | undefined>(undefined);
  useEffect(() => {
    workflowApi
      .mine(requestId)
      .then(setC)
      .catch(() => setC(null));
  }, [requestId]);
  if (!c) return null;
  const at = c.stages.findIndex((s) => s.key === c.stage.key);
  return (
    <section className="wf-track" aria-label="Where your request stands">
      <ol className="wf-steps">
        {c.stages.map((s, i) => (
          <li
            key={s.key}
            className={i < at ? "is-done" : i === at ? "is-current" : ""}
            aria-current={i === at ? "step" : undefined}
          >
            {s.label}
          </li>
        ))}
      </ol>
      <ul className="wf-history">
        {c.history.map((e) => (
          <li key={`${e.at}-${e.to_stage}`}>
            {c.stages.find((s) => s.key === e.to_stage)?.label ?? e.to_stage}{" "}
            <span className="muted">· {new Date(e.at).toLocaleString()}</span>
            {e.note && <div className="wf-note">{e.note}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
