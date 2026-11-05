// The workflow engine's case board (docs/design/WORKFLOW_ENGINE.md §5), on the business desk:
// one column per stage, each accepted customer request a case. The business's current owner opens
// a case (its fields come from the request's protected copy, for them only) and moves it to the
// next stage; the final stage closes it. Every move is recorded and the customer sees it. After a
// sale the buyer works the cases and the seller no longer sees them. Cases opened under an earlier
// release keep that release's stages and are shown in their own board (Relaydesk correction).

import { useEffect, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { useSession } from "../session.tsx";
import { ago } from "../via.ts";
import { type CaseDetail, type CaseView, workflowApi } from "../workflowApi.ts";

const WHO: Record<CaseView["history"][number]["actor_kind"], string> = {
  customer: "Customer",
  staff: "Your team",
  system: "Received",
};

/** Cases grouped by the stages of the release each was opened under (newest group first). */
export function groupByStages(cases: CaseView[]) {
  const groups: { key: string; stages: CaseView["stages"]; cases: CaseView[] }[] = [];
  for (const c of cases) {
    const key = c.stages.map((s) => `${s.key}=${s.label}`).join("|");
    const g = groups.find((x) => x.key === key);
    if (g) g.cases.push(c);
    else groups.push({ key, stages: c.stages, cases: [c] });
  }
  // The current release's stages first; earlier ones after, in the order the server listed them.
  const current = (g: (typeof groups)[number]) => g.cases.some((c) => c.on_current_release);
  return [...groups.filter(current), ...groups.filter((g) => !current(g))];
}

export function WorkflowCaseBoard({ businessId }: { businessId: string }) {
  const { person, sessionEpoch } = useSession();
  // Relaydesk correction: bound to the session AND the business. An in-place change of either
  // drops what was shown (and any open case's private details) at once; a late answer for the
  // earlier scope changes nothing. The read takes its business from the scope it reads for.
  const scope = person ? `${person.id}#${sessionEpoch}|${businessId}` : null;
  const read = useActorRead(scope, (w) => workflowApi.board(w.slice(w.lastIndexOf("|") + 1)));
  const [open, setOpen] = useState<{ scope: string; id: string } | null>(null);
  const board = read.state.data;
  const shownOpen = open && open.scope === scope ? open.id : null;

  if (!scope || !board?.has_workflow) return null; // the board is optional on the desk
  const openCount = board.cases.filter((c) => !c.closed_at).length;
  // Each case keeps the stages of the release it was opened under; a workflow that changed
  // stages has its earlier cases in their own board, never hidden.
  const groups = groupByStages(board.cases);

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
        groups.map((g) => (
          <div key={g.key} className="wf-group">
            {groups.length > 1 && (
              <h3 className="wf-group-head">
                {g.cases.some((c) => c.on_current_release)
                  ? "The released version of this workflow"
                  : "On an earlier version of this workflow (its own stages)"}
              </h3>
            )}
            <div
              className="wf-board"
              style={{ gridTemplateColumns: `repeat(${g.stages.length}, 1fr)` }}
            >
              {g.stages.map((st) => {
                const here = g.cases.filter((c) => c.stage.key === st.key);
                return (
                  <div className="wf-col" key={st.key}>
                    <div className="wf-col-head">
                      {st.label} <span className="muted">{here.length}</span>
                    </div>
                    {here.map((c) => (
                      <button
                        type="button"
                        key={c.request_id}
                        className={`wf-card${shownOpen === c.request_id ? " is-open" : ""}`}
                        aria-expanded={shownOpen === c.request_id}
                        onClick={() =>
                          setOpen(shownOpen === c.request_id ? null : { scope, id: c.request_id })
                        }
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
          </div>
        ))
      )}
      {shownOpen && (
        <CaseDetailPanel
          key={`${scope}:${shownOpen}`}
          businessId={businessId}
          requestId={shownOpen}
          onMoved={read.retry}
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
