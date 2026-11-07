// Agent purchases on the owner's desk (design/sale-proof/agent-purchases): each HTTP 402 the
// business answered with an exact offer, and whether the contract's own receipt confirmed a
// purchase for it. Agents pay from their own accounts and their own gas. Labels and values only.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "../router.tsx";
import { tokenAmount } from "../saleCalls.ts";
import { useSession } from "../session.tsx";
import { when } from "../when.ts";

interface OfferRow {
  id: string;
  offer_id: string;
  account: string;
  reason: string;
  units: number | null;
  amount: string | null;
  at: string;
  token: { symbol: string; decimals: number } | null;
  purchase: { state: string; units_granted: number; tx_hash: string | null } | null;
  repeat: boolean;
}
export interface AgentPurchasesView {
  offers: OfferRow[];
  totals: { offers: number; units_granted: number; pending: number; unpaid: number };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="proof-row">
      <dt>{label}</dt>
      <dd>
        <span className="proof-value">{children}</span>
      </dd>
    </div>
  );
}

const STATE: Record<string, { word: string; cls: string }> = {
  confirmed: { word: "Confirmed", cls: "pill success" },
  returned: { word: "Returned", cls: "pill" },
  prepared: { word: "Recorded · not sent", cls: "pill caution proof-pending" },
  requested: { word: "Sent · checking", cls: "pill caution proof-pending" },
  unknown: { word: "Not shown yet", cls: "pill caution proof-pending" },
};
const REASON: Record<string, string> = {
  no_entitlement: "No units yet",
  no_free_unit: "Units used up",
};

export function AgentPurchases({ v, businessId }: { v: AgentPurchasesView; businessId: string }) {
  const amt = (o: OfferRow) =>
    o.amount === null
      ? "—"
      : o.token
        ? `${tokenAmount(o.amount, o.token.decimals)} ${o.token.symbol}`
        : o.amount;
  return (
    <div className="page handover sale-room">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/desk/${businessId}`} className="muted">
          Business desk
        </Link>
      </div>
      <header className="sale-head">
        <div className="eyebrow">Operate · paid per use</div>
        <h1 className="display sale-title">Agent purchases</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Nothing to do here: agents pay from their own accounts. This page records what each was
          offered and what the contract confirmed.
        </p>
      </header>
      <div className="sale-grid proof-grid">
        <div className="sale-main">
          {v.offers.length === 0 && (
            <section className="card">
              <p className="muted">No agent has asked to pay yet.</p>
            </section>
          )}
          {v.offers.map((o) => {
            const st = o.purchase ? (STATE[o.purchase.state] ?? STATE.unknown) : null;
            return (
              <section key={o.id} className="card" aria-label={`Offer to ${o.account}`}>
                <div className="ledger-head">
                  <h2 className="ledger-h mono wrap">{o.account}</h2>
                  {st ? (
                    <span className={st.cls}>{st.word}</span>
                  ) : (
                    <span className="pill caution proof-pending">
                      {o.units === null
                        ? "Registration step"
                        : o.repeat
                          ? "Same terms again"
                          : "Not paid"}
                    </span>
                  )}
                </div>
                <dl className="proof-rows">
                  <Row label="What happened">
                    The agent asked to use the product without units and was sent the exact purchase
                    (HTTP 402 Payment Required)
                  </Row>
                  <Row label="Reason">{REASON[o.reason] ?? o.reason}</Row>
                  <Row label="Offered">
                    {o.units === null ? "Registration first" : `${o.units} units · ${amt(o)}`}
                  </Row>
                  <Row label="Paid from">The agent's own account</Row>
                  {o.purchase && (
                    <Row label="Contract receipt">
                      {o.purchase.state === "confirmed"
                        ? `${o.purchase.units_granted} units granted`
                        : "0 units granted"}
                    </Row>
                  )}
                  <Row label="At">{when(o.at)}</Row>
                </dl>
                {o.purchase?.tx_hash && (
                  <details className="ledger-terms">
                    <summary>Purchase transaction</summary>
                    <p className="mono wrap proof-small">{o.purchase.tx_hash}</p>
                  </details>
                )}
              </section>
            );
          })}
        </div>
        <div className="sale-main">
          <section className="card" aria-labelledby="ap-totals">
            <h2 id="ap-totals" className="ledger-h">
              Totals
            </h2>
            <dl className="proof-rows">
              <Row label="Units granted">{v.totals.units_granted}</Row>
              <Row label="Purchases pending">{v.totals.pending}</Row>
              <Row label="Offers sent to agents">{v.totals.offers}</Row>
              <Row label="Not paid">{v.totals.unpaid}</Row>
            </dl>
          </section>
          <section className="card" aria-labelledby="ap-route">
            <h2 id="ap-route" className="ledger-h">
              Payment route
            </h2>
            <dl className="proof-rows">
              <Row label="Payer">Each agent's own NEAR account</Row>
              <Row label="Gas">Paid by the agent</Row>
              <Row label="Units credited">Contract-confirmed purchases only</Row>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

export function AgentPurchasesPage({ id }: { id: string }) {
  const { person } = useSession();
  const [v, setV] = useState<AgentPurchasesView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!person) return;
    let live = true;
    fetch(`/api/businesses/${encodeURIComponent(id)}/agent-purchases`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        const body = (await r.json()) as AgentPurchasesView & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "Not available");
        if (live) setV(body);
      })
      .catch((x) => live && setErr(x instanceof Error ? x.message : "Not available"));
    return () => {
      live = false;
    };
  }, [id, person]);
  if (!person)
    return (
      <div className="page empty">
        <h2>Sign in to see this business's agent purchases.</h2>
      </div>
    );
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>Agent purchases couldn't be shown</h2>
        <p>{err}</p>
      </div>
    );
  if (!v)
    return (
      <div className="page muted" role="status">
        Loading…
      </div>
    );
  return <AgentPurchases v={v} businessId={id} />;
}
