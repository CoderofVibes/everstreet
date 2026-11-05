// Hardening (Nov 5): the owner decides, per offer, whether customers may give AI agents access.
// Off until turned on. Turning it off stops new agent uses at once; a use already reserved still
// finishes, and customers' grants stay theirs (they work again if it's turned back on).

import { useCallback, useEffect, useState } from "react";

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/agent-access`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setRows(((await r.json()) as { offers: Row[] }).offers);
      })
      .catch(() => setRows([]));
  }, [businessId]);
  useEffect(load, [load]);
  const flip = (r: Row) => {
    setBusy(r.offer_id);
    setError(null);
    fetch(
      `/api/businesses/${encodeURIComponent(businessId)}/customer-offers/${encodeURIComponent(r.offer_id)}/agent-access`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: r.agents === "off" }),
      },
    )
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const active = (rows ?? []).filter((r) => r.offer_state === "active");
  if (!rows || active.length === 0) return null;
  return (
    <div className="agent-switches">
      <h3 className="offer-sub">Agent use</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        When on, your customers can give an AI agent its own key and a limited token to use this
        offer for them. Off stops new agent uses at once.
      </p>
      <ul className="offer-list">
        {active.map((r) => (
          <li key={r.offer_id} className="offer-row">
            <div className="offer-row-main">
              <strong>{names[r.offer_id] ?? "Offer"}</strong>{" "}
              <span className={`pill ${r.agents === "on" ? "mint" : ""}`}>
                Agents {r.agents === "on" ? "allowed" : "not allowed"}
              </span>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {r.active_grants === 1 ? "1 customer grant" : `${r.active_grants} customer grants`}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy !== null}
              aria-pressed={r.agents === "on"}
              onClick={() => flip(r)}
            >
              {r.agents === "on" ? "Turn agent use off" : "Allow agent use"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
