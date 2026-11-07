// The supplier allowance on the owner's desk (design/sale-proof/allowance): the grant and its
// caps, this period's spending against its cap, invoices waiting for the owner's approval, and
// recent payments. Read from the allowance companion contract; the owner's own wallet grants and
// approves. Labels and values only.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "../router.tsx";
import { type CompanionView, companionHttp, SaleError } from "../saleApi.ts";
import { tokenAmount } from "../saleCalls.ts";
import { useSession } from "../session.tsx";
import { when } from "../when.ts";
import { CompanionRequest } from "./CompanionRequest.tsx";

type Allowance = NonNullable<CompanionView["allowance"]>;

function Rows({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl className="proof-rows" aria-label={label}>
      {children}
    </dl>
  );
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

const STATE: Record<Allowance["recent"][number]["state"], { word: string; cls: string }> = {
  AwaitingApproval: { word: "Awaiting your approval", cls: "pill caution proof-pending" },
  Sending: { word: "Sending", cls: "pill caution proof-pending" },
  Paid: { word: "Paid", cls: "pill success" },
  Claim: { word: "Supplier's claim", cls: "pill caution" },
  Refused: { word: "Refused", cls: "pill" },
};

const periodWords = (ms: string) => {
  const d = Number(ms) / 86_400_000;
  return d === 7 ? "week" : d === 1 ? "day" : `${d} days`;
};

export function AllowanceDesk({
  v,
  businessId,
  reload,
}: {
  v: CompanionView;
  businessId: string;
  reload: () => void;
}) {
  const a = v.allowance as Allowance;
  const t = v.token ?? null;
  const amt = (base: string) =>
    t ? `${tokenAmount(base, t.decimals)} ${t.symbol}` : <span className="mono">{base}</span>;
  const g = a.grant;
  const spent = BigInt(a.spent_in_period);
  const cap = g ? BigInt(g.per_period) : 0n;
  const pct = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;
  return (
    <div className="page handover sale-room allowance-desk">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link to={`/desk/${businessId}`} className="muted">
          Business desk
        </Link>
      </div>
      <header className="sale-head">
        <div className="eyebrow">Operate · supplier allowance</div>
        <h1 className="display sale-title">Supplier allowance</h1>
      </header>
      <div className="sale-grid proof-grid">
        <div className="sale-main">
          <section className="card" aria-labelledby="al-grant">
            <div className="ledger-head">
              <h2 id="al-grant" className="ledger-h">
                {g ? g.suppliers.join(", ") : "No grant"}
              </h2>
              {a.active ? (
                <span className="pill success">Active · generation {g?.generation}</span>
              ) : (
                <span className="pill caution proof-pending">
                  {g ? `Ended · granted at generation ${g.generation}` : "Not granted"}
                </span>
              )}
            </div>
            {g && (
              <Rows label="Grant">
                <Row label="Funding">Separate operating budget</Row>
                <Row label="Agent">
                  <span className="mono wrap">{g.agent}</span>
                </Row>
                <Row label="Per payment">{amt(g.per_payment)} hard cap</Row>
                <Row label={`Per ${periodWords(g.period_ms)}`}>{amt(g.per_period)}</Row>
                <Row label="Owner review">Above {amt(g.review_above)} · exact invoice</Row>
                <Row label="How it works">
                  Up to {amt(g.per_payment)} the agent pays alone; above {amt(g.review_above)} it
                  waits for your approval of that exact invoice; anything between the two is
                  refused.
                </Row>
                <Row label="Sale">Ends unless the buyer grants it again</Row>
              </Rows>
            )}
          </section>
          {a.awaiting.map((p) => (
            <section
              key={p.invoice}
              className="card"
              aria-label={`Invoice ${p.invoice.slice(0, 8)}`}
            >
              <h2 className="ledger-h">
                Invoice <span className="mono">{p.invoice.slice(0, 8)}…</span>
              </h2>
              <Rows label="Invoice">
                <Row label="Supplier">
                  <span className="mono wrap">{p.supplier}</span>
                </Row>
                <Row label="Amount">{amt(p.amount)}</Row>
                <Row label="Status">
                  <span className={STATE[p.state].cls}>{STATE[p.state].word}</span>
                </Row>
                <Row label="Grant">
                  Generation {p.generation}
                  {p.generation !== v.control.generation ? " · ended" : ""}
                </Row>
                <Row label="Submitted">{when(Number(p.at_ms))}</Row>
              </Rows>
              {v.you_own_it && a.active && p.generation === v.control.generation && (
                <p className="row">
                  <CompanionRequest
                    businessId={businessId}
                    view={v}
                    kind="allowance_approve"
                    input={{ invoice: p.invoice }}
                    label="Approve this invoice"
                    onDone={reload}
                  />
                </p>
              )}
            </section>
          ))}
          <section className="card quiet" aria-labelledby="al-recent">
            <h2 id="al-recent" className="sale-h3">
              Recent payments
            </h2>
            {a.recent.length === 0 ? (
              <p className="muted">None yet</p>
            ) : (
              <table className="bb-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Supplier</th>
                    <th>Amount</th>
                    <th>State</th>
                    <th>Generation</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent.map((p) => (
                    <tr key={p.invoice}>
                      <td>{when(Number(p.at_ms))}</td>
                      <td className="mono">{p.supplier}</td>
                      <td>{amt(p.amount)}</td>
                      <td>
                        <span className={STATE[p.state].cls}>{STATE[p.state].word}</span>
                      </td>
                      <td>{p.generation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <div className="sale-main">
          <section className="card" aria-labelledby="al-period">
            <h2 id="al-period" className="ledger-h">
              This {g ? periodWords(g.period_ms) : "period"}
            </h2>
            <p className="allowance-figure">
              <strong>{t ? tokenAmount(a.spent_in_period, t.decimals) : a.spent_in_period}</strong>
              {g && <span className="muted"> / {amt(g.per_period)}</span>}
            </p>
            {g && (
              <>
                <meter
                  className="sr-only"
                  min={0}
                  max={100}
                  value={pct}
                  aria-label="Spent of this period's cap"
                />
                <div className="allowance-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </>
            )}
            <Rows label="Budget">
              <Row label="Budget">{amt(a.balance)}</Row>
              <Row label="Reserved">{amt(a.reserved)}</Row>
              <Row label="Available">{amt(a.available)}</Row>
              <Row label="Customer money">Excluded</Row>
            </Rows>
            {v.you_own_it && !a.active && g && (
              <p className="row">
                <CompanionRequest
                  businessId={businessId}
                  view={v}
                  kind="allowance_grant"
                  label="Grant it again"
                  onDone={reload}
                />
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function AllowanceDeskPage({ id }: { id: string }) {
  const { account, person } = useSession();
  const [v, setV] = useState<CompanionView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: n reloads on request
  useEffect(() => {
    if (!account) return;
    let live = true;
    companionHttp
      .view(id)
      .then((x) => live && setV(x))
      .catch((e) => live && setErr(e instanceof SaleError ? e.message : "It couldn't be read."));
    return () => {
      live = false;
    };
  }, [id, account, n]);
  if (!person || !account)
    return (
      <div className="page empty">
        <h2>Sign in to see this business's allowance.</h2>
      </div>
    );
  if (err)
    return (
      <div className="page empty" role="alert">
        <h2>The allowance couldn't be shown</h2>
        <p>{err}</p>
      </div>
    );
  if (!v)
    return (
      <div className="page muted" role="status">
        Reading the contract…
      </div>
    );
  if (!v.allowance)
    return (
      <div className="page empty">
        <h2>No supplier allowance for this business</h2>
      </div>
    );
  return <AllowanceDesk v={v} businessId={id} reload={() => setN((x) => x + 1)} />;
}
