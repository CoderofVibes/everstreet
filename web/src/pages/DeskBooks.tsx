// The desk's books (revenue, costs, profit by month with their sources), cost entry, and the
// team: one helper appointed on the business's contract, revocable there.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Desk } from "../api.ts";
import {
  api4,
  type Balances,
  type BooksView,
  type SpendLedger,
  type TeamMember,
  usd,
} from "../api4.ts";
import {
  beforeOpening,
  categories,
  compare,
  latestPair,
  microUsd,
  missingReason,
  money,
  partialLabel,
} from "../finance.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { CashChart, CategoryBars, EarnedCostChart, Scroll } from "./FinanceChart.tsx";

const thisMonth = () => {
  const d = new Date();
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
};

const monthInput = (yyyymm: number) =>
  `${Math.floor(yyyymm / 100)}-${String(yyyymm % 100).padStart(2, "0")}`;
const fromMonthInput = (v: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 100 + Number(m[2]) : Number.NaN;
};

function Tile({ k, v, s, unknown }: { k: string; v: string; s: string; unknown?: boolean }) {
  return (
    <div className="fin-tile">
      <div className="k">{k}</div>
      <div className={`v${unknown ? " fin-unknown" : ""}`}>{v}</div>
      <div className="s">{s}</div>
    </div>
  );
}

/** Today's balances: a current stock read from the contract, never a monthly figure. */
function BalanceTiles({ now }: { now: Balances }) {
  if (now.state !== "observed")
    return (
      <p className="notice" style={{ fontSize: 13.5 }}>
        Today's balances: {now.reason}. Nothing is shown as $0.
      </p>
    );
  return (
    <div className="fin-tiles">
      <Tile
        k="Owed to customers now"
        v={money(
          now.customer_money_cents === null || now.customer_credit_cents === null
            ? null
            : now.customer_money_cents + now.customer_credit_cents,
        )}
        s="Paid but not yet delivered, plus prepaid credit"
      />
      <Tile k="Available to the business" v={money(now.available_cents)} s="Earned and settled" />
      <Tile k="You can withdraw" v={money(now.withdrawable_cents)} s="Above the reserve" />
      <Tile
        k="Not business money"
        v={money(
          now.buyer_escrow_cents === null || now.seller_proceeds_cents === null
            ? null
            : now.buyer_escrow_cents + now.seller_proceeds_cents,
        )}
        s="Buyer escrow and unclaimed sale proceeds"
      />
    </div>
  );
}

export function DeskBooks({ desk }: { desk: Desk }) {
  const id = desk.business.id;
  const [period, setPeriod] = useState(6);
  const [data, setData] = useState<BooksView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState({
    category: "AI model usage",
    amount: "",
    recurring: false,
    month: monthInput(thisMonth()),
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    return api4
      .books(id, period)
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setLoadError(null);
      })
      .catch((e) => {
        if (n === seq.current) setLoadError((e as Error).message);
      });
  }, [id, period]);
  useEffect(() => {
    load();
  }, [load]);
  if (loadError && !data)
    return (
      <section className="card">
        <h2>Books</h2>
        <p className="error-text">The books couldn't be loaded: {loadError}</p>
        <button type="button" className="btn btn-quiet" onClick={load}>
          Try again
        </button>
      </section>
    );
  if (!data) return null;
  const shown = data.months;
  const [prev, last] = latestPair(shown);
  const costRows = categories(shown);
  const nothing =
    shown.every(
      (m) => (m.revenue_cents ?? 0) === 0 && m.direct_cents + m.overhead_cents === 0 && !m.cash,
    ) && data.now.state === "not_applicable";
  const add = async () => {
    const amount = Math.round(Number(f.amount) * 100);
    if (!amount) return setError("How much was it?");
    const yyyymm = fromMonthInput(f.month);
    try {
      await api4.addCost(id, {
        category: f.category,
        amount_cents: amount,
        recurring: f.recurring,
        yyyymm,
        note: f.note,
      });
      setF({ ...f, amount: "", note: "" });
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const hint = data.categories.find((c) => c.category === f.category)?.hint;
  const spendMonths = (l: SpendLedger) =>
    l.months.filter((r) => shown.some((m) => m.yyyymm === r.yyyymm));
  return (
    <section className="card fin-card">
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Books</h2>
        <span className="spacer" />
        <label className="field" style={{ margin: 0 }}>
          <span className="sr-only">Period</span>
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            {[3, 6, 12].map((n) => (
              <option key={n} value={n}>
                Last {n} months
              </option>
            ))}
          </select>
        </label>
        <Link to={`/desk/${id}/value`} className="btn btn-secondary">
          See what it could be worth
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Earned revenue is what customers' orders and used credit earned, not what was paid in
        advance. {data.basis}
      </p>
      {data.chain_error && (
        <p className="notice">
          {data.chain_error}. Those months show as "couldn't be read", not as zero.
        </p>
      )}

      {nothing ? (
        <div className="notice">
          <strong>No records yet.</strong> Turn on payments so customers' orders are recorded on the
          business's own contract, and add what the business pays for below. Charts appear as soon
          as there is something real to show.
        </div>
      ) : (
        <>
          <BalanceTiles now={data.now} />
          <p style={{ fontSize: 14 }}>
            <strong>Latest whole month:</strong> {compare(prev, last)}
          </p>
          <EarnedCostChart months={shown} title="Earned revenue, costs and contribution by month" />
          <CashChart months={shown} />
          <h3 style={{ fontSize: 15 }}>Where the money goes (costs you entered)</h3>
          <CategoryBars rows={costRows} />
          {costRows.fictional_cents > 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              Fictional example costs of {money(costRows.fictional_cents)} in these months are not
              counted in your categories.
            </p>
          )}
        </>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Every figure, with its source</summary>
        <Scroll className="fin-table-wrap" label="Books by month, scrolls sideways">
          <table className="table fin-table">
            <caption className="sr-only">Books by month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Earned</th>
                <th scope="col">Costs</th>
                <th scope="col">Contribution</th>
                <th scope="col">Cash in</th>
                <th scope="col">Returned</th>
                <th scope="col">Withdrawn</th>
                <th scope="col">Sources</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.yyyymm}>
                  <th scope="row">
                    {m.label}
                    {partialLabel(m) && <span className="muted"> ({partialLabel(m)})</span>}
                    {beforeOpening(m) && <span className="muted"> (before opening)</span>}
                  </th>
                  <td className={`num${m.revenue_cents === null ? " fin-unknown" : ""}`}>
                    {beforeOpening(m)
                      ? "No records"
                      : m.revenue_cents === null
                        ? missingReason(m)
                        : money(m.revenue_cents)}
                    {m.revenue_basis === "seeded" && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Fictional example history
                      </div>
                    )}
                    {m.mixed && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Fictional history {money(m.seeded_cents)} kept separate
                      </div>
                    )}
                  </td>
                  <td className="num">{money(m.direct_cents + m.overhead_cents)}</td>
                  <td className="num">
                    <strong>{money(m.profit_cents)}</strong>
                  </td>
                  <td className="num">{money(m.cash?.cash_in_cents)}</td>
                  <td className="num">{money(m.cash?.returned_cents)}</td>
                  <td className="num">{money(m.cash?.owner_withdrawals_cents)}</td>
                  <td style={{ fontSize: 12 }}>
                    {[...new Set([...m.revenue_sources, ...m.cost_sources])].join(" · ") ||
                      (m.chain === "not_applicable" ? "No records" : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </details>

      <h3 style={{ fontSize: 15, marginTop: 18 }}>AI spend from Everstreet's own records</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        {data.spend.basis}
      </p>
      <ul style={{ fontSize: 14, paddingLeft: 18 }}>
        {[
          ["Running the product", data.spend.runtime] as const,
          ["Building the product", data.spend.build] as const,
        ].map(([name, l]) => (
          <li key={name}>
            <strong>{name}:</strong>{" "}
            {spendMonths(l).length === 0
              ? `nothing recorded in the last ${data.period_months} months`
              : `${microUsd(l.period_microcents)} in the last ${data.period_months} months over ${spendMonths(l).reduce((a, r) => a + r.requests, 0)} requests`}
            {l.period_unknown_cost_requests > 0 &&
              ` · ${l.period_unknown_cost_requests} of them with unknown cost (reservation held, not counted as zero)`}
            {l.total_microcents !== l.period_microcents &&
              ` · all time: ${microUsd(l.total_microcents)}`}
            {l.unknown_cost_requests > l.period_unknown_cost_requests &&
              ` (${l.unknown_cost_requests} unknown-cost requests all time)`}
            <div className="muted" style={{ fontSize: 12.5 }}>
              {l.note}
            </div>
          </li>
        ))}
      </ul>

      <h3 style={{ fontSize: 15, marginTop: 18 }}>Add a cost</h3>
      <div className="filters">
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 14 }}>What for</span>
          <select
            className="input"
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
          >
            {data.categories.map((c) => (
              <option key={c.category}>{c.category}</option>
            ))}
          </select>
          {hint && <small>{hint}</small>}
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 14 }}>Amount ($)</span>
          <input
            className="input"
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 14 }}>Month</span>
          <input
            className="input"
            type="month"
            max={monthInput(thisMonth())}
            value={f.month}
            onChange={(e) => setF({ ...f, month: e.target.value })}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: 14 }}>Note (optional)</span>
          <input
            className="input"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={f.recurring}
            onChange={(e) => setF({ ...f, recurring: e.target.checked })}
          />
          <span>Every month from then on</span>
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          Add cost
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data.costs.filter((c) => c.origin === "founder").length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Costs you entered</summary>
          {data.costs
            .filter((c) => c.origin === "founder")
            .map((c) => (
              <div
                key={c.id}
                className="row"
                style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}
              >
                <span className={c.voided_at ? "muted" : ""}>
                  {c.category}
                  {c.note ? `: ${c.note}` : ""} · {usd(c.amount_cents)}
                  {c.recurring
                    ? ` every month from ${monthInput(c.yyyymm)}${c.until_yyyymm ? ` through ${monthInput(c.until_yyyymm)}` : " (ongoing)"}`
                    : ` once, in ${monthInput(c.yyyymm)}`}
                  {c.voided_at &&
                    ` · corrected ${new Date(c.voided_at).toLocaleDateString()}: ${c.void_note} (kept in the record, not counted)`}
                </span>
                <span className="spacer" />
                {!c.voided_at && (!c.until_yyyymm || !c.recurring) && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={async () => {
                      if (
                        !c.recurring &&
                        c.yyyymm < thisMonth() &&
                        !window.confirm(
                          "That month is closed. The cost stays in the record, marked as a correction, and is no longer counted. Continue?",
                        )
                      )
                        return;
                      await api4.endCost(id, c.id);
                      load();
                    }}
                  >
                    {c.recurring
                      ? c.yyyymm >= thisMonth()
                        ? "Remove"
                        : "Stop from this month"
                      : c.yyyymm >= thisMonth()
                        ? "Remove"
                        : "Mark as a correction"}
                  </button>
                )}
              </div>
            ))}
        </details>
      )}
    </section>
  );
}

export function DeskTeam({ desk, paymentsOn }: { desk: Desk; paymentsOn: boolean }) {
  const id = desk.business.id;
  const { person } = useSession();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!paymentsOn) return;
    api4
      .team(id)
      .then((r) => setTeam(r.team))
      .catch(() => setTeam([]));
    api
      .people()
      .then((r) => setPeople(r.people))
      .catch(() => {});
  }, [id, paymentsOn]);
  if (!paymentsOn || !team) return null;
  const active = new Set(team.filter((t) => t.active).map((t) => t.person_id));
  const candidates = people.filter((p) => p.id !== person?.id && !active.has(p.id));
  const run = async (fn: () => Promise<{ team: TeamMember[] }>) => {
    setBusy(true);
    setError(null);
    try {
      setTeam((await fn()).team);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="card" style={{ padding: 18 }}>
      <strong>Hand off a task</strong>
      <p className="muted" style={{ fontSize: 14, margin: "6px 0 10px" }}>
        Let someone answer customers and mark orders delivered. They're appointed on the business's
        contract with their own account and never get your key. Revoke any time; the contract stops
        them at once.
      </p>
      {team.map((t) => (
        <div
          key={t.person_id}
          className="row"
          style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}
        >
          <span>
            <strong>{t.name}</strong> ·{" "}
            {t.active ? "answers customers, marks orders delivered" : "revoked"}
          </span>
          <span className="spacer" />
          {t.appointed_url && (
            <a href={t.appointed_url} target="_blank" rel="noreferrer">
              appointed
            </a>
          )}
          {t.revoked_url && (
            <a href={t.revoked_url} target="_blank" rel="noreferrer">
              revoked
            </a>
          )}
          {t.active && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => run(() => api4.removeHelper(id, t.person_id))}
            >
              Revoke
            </button>
          )}
        </div>
      ))}
      {candidates.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <select
            className="input"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            style={{ flex: 1 }}
            aria-label="Who"
          >
            <option value="">Choose someone…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!pick || busy}
            onClick={() => run(() => api4.addHelper(id, pick))}
          >
            {busy ? "On NEAR testnet…" : "Appoint"}
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
