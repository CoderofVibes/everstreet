// The desk's books (revenue, costs, profit by month with their sources), cost entry, and the
// team: one helper appointed on the business's contract, revocable there.

import { useCallback, useEffect, useState } from "react";
import { api, type Desk } from "../api.ts";
import { api4, type CostRow, type Month, type TeamMember, usd } from "../api4.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

const thisMonth = () => {
  const d = new Date();
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
};

export function DeskBooks({ desk }: { desk: Desk }) {
  const id = desk.business.id;
  const [data, setData] = useState<{
    months: Month[];
    costs: CostRow[];
    categories: { category: string; kind: string; hint: string }[];
    chain_error: string | null;
  } | null>(null);
  const [f, setF] = useState({
    category: "Materials",
    amount: "",
    recurring: false,
    month: "this",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api4
        .books(id)
        .then(setData)
        .catch(() => {}),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return null;
  const shown = data.months.filter((m) => m.complete || m.yyyymm === thisMonth()).slice(-6);
  const add = async () => {
    const amount = Math.round(Number(f.amount) * 100);
    if (!amount) return setError("How much was it?");
    const m = thisMonth();
    const yyyymm =
      f.month === "this" ? m : f.month === "last" ? (m % 100 === 1 ? m - 89 : m - 1) : m;
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
  return (
    <section className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Books</h2>
        <span className="spacer" />
        <Link to={`/desk/${id}/value`} className="btn btn-secondary">
          See what it could be worth
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        Revenue is what was earned (delivered), not what was paid in advance. Costs are what you
        enter. Each number says where it came from.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Revenue</th>
            <th>Direct costs</th>
            <th>Overhead</th>
            <th>Profit</th>
            <th>Sources</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.yyyymm}>
              <td>
                {m.label}
                {!m.complete && <span className="muted"> (so far)</span>}
              </td>
              <td>{usd(m.revenue_cents)}</td>
              <td>{usd(m.direct_cents)}</td>
              <td>{usd(m.overhead_cents)}</td>
              <td>
                <strong>{usd(m.profit_cents)}</strong>
              </td>
              <td style={{ fontSize: 12 }}>
                {[...new Set([...m.revenue_sources, ...m.cost_sources])].join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.chain_error && <p className="notice">{data.chain_error}</p>}

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
          <span style={{ fontSize: 14 }}>When</span>
          <select
            className="input"
            value={f.month}
            onChange={(e) => setF({ ...f, month: e.target.value })}
          >
            <option value="this">This month</option>
            <option value="last">Last month</option>
          </select>
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
                <span>
                  {c.category}
                  {c.note ? `: ${c.note}` : ""} · {usd(c.amount_cents)}
                  {c.recurring
                    ? ` monthly from ${c.yyyymm}${c.until_yyyymm ? ` to ${c.until_yyyymm}` : ""}`
                    : ` in ${c.yyyymm}`}
                </span>
                <span className="spacer" />
                {(!c.until_yyyymm || !c.recurring) && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={async () => setData({ ...data, ...(await api4.endCost(id, c.id)) })}
                  >
                    {c.recurring ? "Stop" : "Remove"}
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
