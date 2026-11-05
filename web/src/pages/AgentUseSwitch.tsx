// Hardening (Nov 5): the owner decides, per offer, whether customers may give AI agents access.
// Off until turned on. Off refuses new grants, new agent requests and confirming an agent request
// that isn't reserved yet; a request already reserved still runs and settles (its unit is held
// for it). Customers' grants stay theirs and work again if it's turned back on.
//
// 006b1 (Astra, Nov 5): bound to the person and business that asked (a switch drops it at once);
// a failed read stays visible with a retry instead of hiding the control; the button keeps
// keyboard focus while a change is pending (it is never disabled under the user's focus); the
// state shown is the server's readback, announced when it changes.

import { useEffect, useRef, useState } from "react";
import { useActorRead } from "../actorRead.ts";
import { ApiError } from "../api.ts";
import { useSession } from "../session.tsx";

interface Row {
  offer_id: string;
  offer_state: string;
  agents: "on" | "off";
  active_grants: number;
}

export function AgentUseSwitches({
  businessId,
  names,
}: {
  businessId: string;
  names: Record<string, string>;
}) {
  const { person, sessionEpoch } = useSession();
  // 006b2: the session AND the business: an in-place change of either is a new scope. The read
  // takes its business from the scope it reads for, never from a closure of an earlier render.
  const who = person ? `${person.id}#${sessionEpoch}|${businessId}` : null;
  const read = useActorRead(who, async (scope) => {
    const biz = scope.slice(scope.lastIndexOf("|") + 1);
    const r = await fetch(`/api/businesses/${encodeURIComponent(biz)}/agent-access`, {
      credentials: "same-origin",
    });
    const d = (await r.json().catch(() => ({}))) as { offers?: Row[]; error?: string };
    if (!r.ok) throw new ApiError(r.status, d.error ?? `HTTP ${r.status}`);
    return d.offers ?? [];
  });
  const [pending, setPending] = useState<string | null>(null);
  /** The one change in flight, by request: only its own answer frees the controls. */
  const inFlight = useRef<number | null>(null);
  const seq = useRef(0);
  const [message, setMessage] = useState<{
    who: string;
    text: string;
    tone: "ok" | "error";
  } | null>(null);
  const current = useRef(who);
  useEffect(() => {
    current.current = who;
    setMessage(null);
    inFlight.current = null;
    setPending(null);
  }, [who]);
  const rows = read.state.data;
  const flip = (r: Row) => {
    if (inFlight.current !== null || !who) return; // one change at a time; focus stays put
    const asker = who;
    const biz = businessId;
    const n = ++seq.current;
    inFlight.current = n;
    const want = r.agents === "off";
    setPending(r.offer_id);
    setMessage(null);
    let answered = false;
    fetch(
      `/api/businesses/${encodeURIComponent(biz)}/customer-offers/${encodeURIComponent(r.offer_id)}/agent-access`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: want }),
      },
    )
      .then(async (res) => {
        answered = true;
        const d = (await res.json().catch(() => ({}))) as { error?: string; agents?: string };
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
        if (current.current !== asker) return;
        setMessage({
          who: asker,
          tone: "ok",
          text: `Agent use for ${names[r.offer_id] ?? "this offer"} is now ${d.agents === "on" ? "allowed" : "not allowed"}.`,
        });
        read.retry();
      })
      .catch((e: Error) => {
        if (current.current !== asker) return;
        setMessage({
          who: asker,
          tone: "error",
          text: answered
            ? `Not changed: ${e.message}. Agent use is still ${r.agents === "on" ? "allowed" : "not allowed"}.`
            : "We couldn't tell whether it changed (no answer arrived). Checking again; the state shown is the last one read.",
        });
        read.retry();
      })
      .finally(() => {
        if (inFlight.current !== n) return; // a newer change (or scope) owns the controls now
        inFlight.current = null;
        setPending(null);
      });
  };
  const shown = message && message.who === who ? message : null;
  if (!who) return null;
  const active = (rows ?? []).filter((r) => r.offer_state === "active");
  // Loaded, and there's nothing to switch: say nothing.
  if (rows && active.length === 0) return null;
  return (
    <div className="agent-switches">
      <h3 className="offer-sub">Agent use</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        When allowed, your customers can give an AI agent its own key and a limited token to use
        this offer for them. Turning it off refuses new agent requests; one already reserved still
        finishes, because its unit is held for it.
      </p>
      {rows === null ? (
        read.state.status === "loading" ? (
          <p className="muted">Checking agent use…</p>
        ) : (
          <div role="alert">
            <p className="notice error">
              Agent use couldn't be checked just now
              {read.state.error ? ` (${read.state.error})` : ""}. Nothing was changed.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={read.retry}>
              Check again
            </button>
          </div>
        )
      ) : (
        <ul className="offer-list">
          {active.map((r) => (
            <li key={r.offer_id} className="offer-row">
              <div className="offer-row-main">
                <strong>{names[r.offer_id] ?? "Offer"}</strong>{" "}
                <span className={`pill ${r.agents === "on" ? "mint" : ""}`}>
                  Agents {r.agents === "on" ? "allowed" : "not allowed"}
                </span>
                <div className="muted" style={{ fontSize: 13.5 }}>
                  {r.active_grants === 1
                    ? "1 customer grant that can still act"
                    : `${r.active_grants} customer grants that can still act`}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                aria-pressed={r.agents === "on"}
                aria-busy={pending === r.offer_id}
                aria-disabled={pending !== null}
                onClick={() => flip(r)}
              >
                {pending === r.offer_id
                  ? "Saving…"
                  : r.agents === "on"
                    ? "Turn agent use off"
                    : "Allow agent use"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && read.state.status === "failed" && (
        <p className="small muted" role="status">
          This may be out of date: the last check failed.{" "}
          <button type="button" className="btn btn-quiet btn-sm" onClick={read.retry}>
            Check again
          </button>
        </p>
      )}
      <div role="status" aria-live="polite">
        {shown && (
          <p className={`notice ${shown.tone === "error" ? "error" : "ok"}`}>{shown.text}</p>
        )}
      </div>
    </div>
  );
}
