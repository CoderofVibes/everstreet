// Per-use economics a buyer can check (design/sale-proof/use-economics, owner and buyer view): one
// delivered use's revenue, supplier cost and margin; the books on separate lines, never summed
// across currencies; and a buyer's own scenario that never changes the seller's books. Customer
// input and results are not shown: they are the customer's.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "../router.tsx";
import { SaleError } from "../saleApi.ts";
import { tokenAmount } from "../saleCalls.ts";
import { useSession } from "../session.tsx";
import { when } from "../when.ts";
import { SourceTag } from "./HandoffProof.tsx";

export interface UseEconomicsView {
  block: { height: string; hash: string };
  token: { symbol: string; decimals: number } | null;
  plan_id: number;
  last_use: { id: string; settled_at: string; charge: string | null } | null;
  per_use: {
    revenue: string | null;
    supplier_cost: string | null;
    margin: string | null;
    matched_uses: number;
  };
  books: {
    earned_revenue: string | null;
    earned_uses: number;
    customer_funds_owed: string;
    supplier_cost: string | null;
    founder_costs_usd_cents: number | null;
  };
  scenario: { uses_last_30_days: number; independent_uses_last_30_days?: number };
  revenue_sources?: RevenueSources;
}

type LinkReason =
  | "owner_account"
  | "operator"
  | "owner_here"
  | "team_here"
  | "registration_paid_by_seller";
interface Bucket {
  customers: number;
  uses: number;
  revenue: string | null;
}
export interface RevenueSources {
  independent: Bucket;
  linked: Bucket & { accounts: { account: string; uses: number; reasons: LinkReason[] }[] };
  unchecked: Bucket;
  checked: LinkReason[];
  not_checked: string[];
}

const REASON: Record<LinkReason, string> = {
  owner_account: "the owner on the contract",
  operator: "an operator on the contract",
  owner_here: "the owner in Everstreet",
  team_here: "a team member in Everstreet",
  registration_paid_by_seller: "registration paid by the owner's side",
};
const NOT_CHECKED: Record<string, string> = {
  funding_through_other_accounts: "money routed through other accounts",
  recruited_third_parties: "third parties the seller recruited",
};

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

/** Earned revenue split by who paid it: independent customers and the seller's own side. */
export function RevenueBySource({
  r,
  amt,
}: {
  r: RevenueSources;
  amt: (base: string | null) => ReactNode;
}) {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const line = (b: Bucket) => (
    <>
      {amt(b.revenue)}
      <span className="muted">
        {" "}
        · {plural(b.customers, "customer")} · {plural(b.uses, "use")}
      </span>
    </>
  );
  return (
    <section className="card revenue-sources" aria-labelledby="ue-sources">
      <h2 id="ue-sources" className="ledger-h">
        Earned revenue by source
      </h2>
      <dl className="proof-rows">
        <Row label="Independent customers">{line(r.independent)}</Row>
        <Row label="Linked to the owner's side">
          {r.linked.customers === 0 ? <span className="muted">None found</span> : line(r.linked)}
        </Row>
        {r.unchecked.customers > 0 && <Row label="Registration not read">{line(r.unchecked)}</Row>}
      </dl>
      {r.linked.accounts.length > 0 && (
        <ul className="linked-list">
          {r.linked.accounts.map((x) => (
            <li key={x.account}>
              <span className="mono" title={x.account}>
                {x.account}
              </span>{" "}
              <span className="muted">· {plural(x.uses, "use")} · </span>
              {x.reasons.map((k) => REASON[k]).join("; ")}
            </li>
          ))}
        </ul>
      )}
      <details className="ledger-terms">
        <summary>What's checked</summary>
        <dl className="proof-rows">
          <Row label="Checked">{r.checked.map((k) => REASON[k]).join("; ")}</Row>
          <Row label="Not checked">{r.not_checked.map((k) => NOT_CHECKED[k] ?? k).join("; ")}</Row>
        </dl>
      </details>
    </section>
  );
}

export function UseEconomics({ e, businessId }: { e: UseEconomicsView; businessId: string }) {
  const t = e.token;
  const amt = (base: string | null): ReactNode =>
    base === null ? (
      <span className="unknown">Not recorded</span>
    ) : t ? (
      `${tokenAmount(base, t.decimals)} ${t.symbol}`
    ) : (
      <span className="mono">{base}</span>
    );
  // Independent customers' uses only (revenue linked to the seller isn't projected).
  const startUses = e.scenario.independent_uses_last_30_days ?? e.scenario.uses_last_30_days;
  const [uses, setUses] = useState(String(startUses));
  const [multiple, setMultiple] = useState("2");
  const margin = e.per_use.margin !== null ? BigInt(e.per_use.margin) : null;
  const n = /^\d{1,6}$/.test(uses) ? BigInt(uses) : null;
  const m = /^\d{1,2}(\.\d)?$/.test(multiple) ? Number(multiple) : null;
  const monthly = margin !== null && n !== null ? margin * n : null;
  const value =
    monthly !== null && m !== null ? (monthly * 12n * BigInt(Math.round(m * 10))) / 10n : null;
  return (
    <div className="page handover sale-room">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/sales/${businessId}`} className="muted">
          Sale
        </Link>
      </div>
      <header className="sale-head">
        <div className="eyebrow">Owner and buyer view · per-use economics</div>
        <h1 className="display sale-title">Economics</h1>
        <p className="muted proof-small">
          Read at block <span className="mono">{e.block.height}</span>
        </p>
      </header>
      <div className="sale-grid proof-grid">
        <div className="sale-main">
          <section className="card" aria-labelledby="ue-use">
            <h2 id="ue-use" className="ledger-h">
              Last delivered use
            </h2>
            {e.last_use ? (
              <dl className="proof-rows">
                <Row label="Use">
                  <span className="mono">{e.last_use.id.slice(0, 8)}</span>
                </Row>
                <Row label="Settled">{when(e.last_use.settled_at)}</Row>
                <Row label="Charge">
                  {amt(e.last_use.charge)} · settled once <SourceTag source="everstreet" />
                </Row>
              </dl>
            ) : (
              <p className="muted">No delivered use yet</p>
            )}
          </section>
          <section className="card" aria-labelledby="ue-per">
            <h2 id="ue-per" className="ledger-h">
              Per-use economics
            </h2>
            <dl className="proof-rows">
              <Row label="Earned revenue">{amt(e.per_use.revenue)}</Row>
              <Row label="Supplier cost">
                {amt(e.per_use.supplier_cost)}
                {e.per_use.matched_uses > 0 && (
                  <span className="muted"> · average of {e.per_use.matched_uses} paid</span>
                )}
              </Row>
              <Row label="Contribution margin">{amt(e.per_use.margin)}</Row>
            </dl>
          </section>
        </div>
        <div className="sale-main">
          <section className="card" aria-labelledby="ue-books">
            <h2 id="ue-books" className="ledger-h">
              Books · {t?.symbol ?? "token"}
            </h2>
            <dl className="proof-rows">
              <Row label="Earned revenue">
                {amt(e.books.earned_revenue)}
                <span className="muted"> · {e.books.earned_uses} uses</span>
              </Row>
              <Row label="Customer funds owed">{amt(e.books.customer_funds_owed)}</Row>
              <Row label="Supplier cost">{amt(e.books.supplier_cost)}</Row>
            </dl>
            <details className="ledger-terms">
              <summary>Books · USD</summary>
              <dl className="proof-rows">
                <Row label="Founder-entered costs">
                  {e.books.founder_costs_usd_cents === null ? (
                    <span className="unknown">Unknown</span>
                  ) : (
                    `$${(e.books.founder_costs_usd_cents / 100).toFixed(2)} this month`
                  )}
                </Row>
              </dl>
            </details>
          </section>
          {e.revenue_sources && <RevenueBySource r={e.revenue_sources} amt={amt} />}
          <section className="card" aria-labelledby="ue-scenario">
            <h2 id="ue-scenario" className="ledger-h">
              Buyer scenario · {t?.symbol ?? "token"}
            </h2>
            <label className="field">
              <span>Monthly uses</span>
              <input
                className="input"
                inputMode="numeric"
                value={uses}
                onChange={(x) => setUses(x.target.value.trim())}
              />
              <span className="muted proof-small">
                Independent customers, last 30 days: {startUses}
              </span>
            </label>
            <label className="field">
              <span>Contribution multiple</span>
              <input
                className="input"
                inputMode="decimal"
                value={multiple}
                onChange={(x) => setMultiple(x.target.value.trim())}
              />
            </label>
            <dl className="proof-rows">
              <Row label="Projected monthly contribution">
                {monthly === null ? <span className="unknown">—</span> : amt(monthly.toString())}
              </Row>
              <Row label="Illustrative value">
                {value === null ? <span className="unknown">—</span> : amt(value.toString())}
              </Row>
              <Row label="Seller's books">Read-only</Row>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

export function UseEconomicsPage({ id }: { id: string }) {
  const { account, person } = useSession();
  const [e, setE] = useState<UseEconomicsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    let live = true;
    fetch(`/api/sales/${encodeURIComponent(id)}/economics`, { credentials: "same-origin" })
      .then(async (r) => {
        const body = (await r.json()) as UseEconomicsView & { error?: string };
        if (!r.ok) throw new SaleError(body.error ?? "Not available", r.status, undefined, null);
        if (live) setE(body);
      })
      .catch((x) => live && setErr(x instanceof Error ? x.message : "Not available"));
    return () => {
      live = false;
    };
  }, [id, account]);
  if (!person || !account)
    return (
      <div className="page empty">
        <h2>Sign in to see this business's economics.</h2>
      </div>
    );
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>The economics couldn't be shown</h2>
        <p>{err}</p>
      </div>
    );
  if (!e)
    return (
      <div className="page muted" role="status">
        Reading the contract…
      </div>
    );
  return <UseEconomics e={e} businessId={id} />;
}
