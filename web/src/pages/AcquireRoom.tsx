// The evidence room (Astra, IntactProfiles §7 C, D and G): only what the seller granted, for as
// long as they granted it. The buyer can reproduce the headline number from the rows shown, try
// the team's own assumptions without touching the owner's estimate, and read a preliminary list
// of what a sale would cover.

import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "../api4.ts";
import { ApiError, api5, type ManifestItem, type Room, when } from "../api5.ts";
import { begin, type EvidenceView, initial, settle } from "../evidenceView.ts";
import { beforeOpening, missingReason, money, partialLabel } from "../finance.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import { CashChart, EarnedCostChart, Scroll } from "./FinanceChart.tsx";

const TABS: [string, string][] = [
  ["financials", "Financials"],
  ["costs", "Costs"],
  ["customers", "Customers"],
  ["operations", "Operations and what transfers"],
];

function Reproduce({
  r,
  expected,
}: {
  r: NonNullable<Room["financials"]>;
  expected: [number | null, number | null];
}) {
  const [shown, setShown] = useState(false);
  const p = r.reproduce;
  if (p.stage === "unavailable")
    return (
      <p className="muted">
        Some months' books couldn't be read right now, so there is no estimate to reproduce. That is
        unknown, not "no history".
      </p>
    );
  if (p.stage === "plan" || p.months.length === 0)
    return (
      <p className="muted">
        No complete month with earnings yet, so there is nothing to reproduce.
      </p>
    );
  // The owner's exact totals (chain amounts summed before rounding), so this check uses the same
  // arithmetic as the estimate; the per-month rows below are shown rounded (003f1).
  const profit = p.revenue_cents - p.costs_cents;
  const labor = p.labor_month_cents * p.months.length;
  const annual = Math.round((profit - labor) * p.annualize_by);
  const round = (c: number) => Math.round(c / 10000) * 10000;
  const low = annual > 0 ? round(annual * p.multiple_low) : null;
  const high = annual > 0 ? round(annual * p.multiple_high) : null;
  const match = low === expected[0] && high === expected[1];
  return (
    <div>
      <button type="button" className="btn btn-secondary" onClick={() => setShown(true)}>
        Reproduce the estimate from these rows
      </button>
      {shown && (
        <>
          <pre className="calc">
            {[
              ...p.months.map(
                (m) =>
                  `${m.label}: ${usd(m.revenue_cents)} − ${usd(m.direct_cents)} − ${usd(m.overhead_cents)} = ${usd(m.revenue_cents - m.direct_cents - m.overhead_cents)}`,
              ),
              `Exact totals: earned ${usd(p.revenue_cents)} − costs ${usd(p.costs_cents)}`,
              `Operating profit, ${p.months.length} months   ${usd(profit)}`,
              `Owner work to replace   −${usd(labor)}`,
              `× ${Number(p.annualize_by.toFixed(2))} to a year   ${usd(annual)}`,
              `× ${p.multiple_low}–${p.multiple_high}, rounded to $100   ${low === null ? "no range" : `${usd(low)}–${usd(high)}`}`,
            ].join("\n")}
          </pre>
          <p style={{ fontWeight: 600, color: match ? "var(--forest)" : "var(--error)" }}>
            {match
              ? "✓ Matches the estimate the owner sees"
              : "✗ Differs from the owner's estimate; ask the owner which input changed"}
          </p>
        </>
      )}
    </div>
  );
}

function OurScenario({
  id,
  r,
  onSaved,
}: {
  id: string;
  r: NonNullable<Room["financials"]>;
  onSaved: () => void;
}) {
  const b = r.base;
  const [f, setF] = useState({
    hours: String(Number(b.founder_hours_week.toFixed(2))),
    rate: String(b.hourly_rate_cents / 100),
    low: String(b.multiple_low),
    high: String(b.multiple_high),
    costs: "",
  });
  const [result, setResult] = useState<{
    low_cents: number | null;
    high_cents: number | null;
  } | null>(null);
  const [name, setName] = useState("");
  const overrides = useCallback(
    () => ({
      founder_hours_week: Number(f.hours),
      hourly_rate_cents: Math.round(Number(f.rate) * 100),
      multiple_low: Number(f.low),
      multiple_high: Number(f.high),
      ...(f.costs ? { extra_monthly_costs_cents: Math.round(Number(f.costs) * 100) } : {}),
    }),
    [f],
  );
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api5
        .tryRoom(id, overrides(), ctl.signal)
        .then((x) => setResult(x.scenario))
        .catch((e) => {
          if (ctl.signal.aborted) return;
          setResult(null);
          // Refused: access ended or changed. Reload the room, which clears it.
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) onSaved();
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [id, overrides, onSaved]);
  const input = (label: string, key: keyof typeof f) => (
    <label className="field" style={{ margin: 0 }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      <input
        className="input"
        inputMode="decimal"
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="card">
      <h2>Your team's assumptions</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        Private to your team. The owner's estimate and what anyone else sees stay as they are.
      </p>
      <div className="filters" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {input("Owner hours a week", "hours")}
        {input("Cost per hour ($)", "rate")}
        {input("Low multiple", "low")}
        {input("High multiple", "high")}
        {input("Extra monthly cost ($)", "costs")}
      </div>
      {result && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              Owner's estimate {usd(r.estimate.low_cents)}–{usd(r.estimate.high_cents)} → with your
              assumptions
            </div>
            <div className="display" style={{ fontSize: 30 }}>
              {result.low_cents === null
                ? "No range"
                : `${usd(result.low_cents)}–${usd(result.high_cents)}`}
            </div>
          </div>
          <span className="spacer" />
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="Name these assumptions"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              // Saved or refused, the room reloads: a refusal clears what was shown.
              await api5.saveRoomScenario(id, name, overrides()).catch(() => null);
              setName("");
              onSaved();
            }}
          >
            Save for the team
          </button>
        </div>
      )}
      {r.scenarios.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 18 }}>Saved by your team</h3>
          {r.scenarios.map((s) => (
            <div
              key={s.id}
              className="row"
              style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}
            >
              <strong>{s.name}</strong>
              <span className="muted">
                {s.by} ·{" "}
                {Object.entries(s.overrides)
                  .map(
                    ([k, v]) =>
                      `${k.replace(/_/g, " ").replace(" cents", "")}: ${k.endsWith("cents") ? usd(v) : v}`,
                  )
                  .join(", ")}
              </span>
              <span className="spacer" />
              <span>
                {s.low_cents === null ? "no range" : `${usd(s.low_cents)}–${usd(s.high_cents)}`}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Items({ title, items }: { title: string; items: ManifestItem[] }) {
  if (items.length === 0) return null;
  const tone = (s: string) => (s === "Ready" ? "lime" : s === "Excluded" ? "" : "caution");
  return (
    <>
      <h3
        style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 18 }}
      >
        {title}
      </h3>
      {items.map((i) => (
        <div
          key={i.name}
          className="row"
          style={{
            padding: "8px 0",
            borderTop: "1px solid var(--border)",
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 15 }}>{i.name}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {i.detail}
              {i.enforced !== "—" ? ` · ${i.enforced}` : ""}
            </div>
          </div>
          <span className={`pill ${tone(i.status)}`}>{i.status}</span>
        </div>
      ))}
    </>
  );
}

export function AcquireRoom({ id }: { id: string }) {
  const { person } = useSession();
  const actor = person?.id ?? null;
  // Job 003p: what's shown belongs to one person, one room and one load (see evidenceView.ts).
  const [view, setView] = useState<EvidenceView<Room>>(() => initial(actor, id));
  const current = useRef(view);
  current.current = view;
  const inFlight = useRef<AbortController | null>(null);
  const [tab, setTab] = useState("financials");
  const load = useCallback(() => {
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    const started = begin(current.current, actor, id);
    current.current = started;
    setView(started);
    api5
      .room(id, ctl.signal)
      .then((r) => {
        setView((v) => settle(v, started.load, actor, id, { ok: true, data: r }));
        setTab((t) =>
          r[t as keyof Room] ? t : (TABS.find(([k]) => r[k as keyof Room])?.[0] ?? t),
        );
      })
      .catch((e) => {
        if (ctl.signal.aborted) return; // a newer load replaced this one
        const status = e instanceof ApiError ? e.status : 0;
        setView((v) =>
          settle(v, started.load, actor, id, { ok: false, status, message: (e as Error).message }),
        );
      });
  }, [actor, id]);
  // Recheck whenever the person or room changes, and on returning to this tab.
  useEffect(() => {
    load();
    const back = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      inFlight.current?.abort();
    };
  }, [load]);
  // Evidence from anyone else's session is never rendered, even for the one frame before the
  // effect above starts a new load.
  const room = view.actor === actor && view.room === id ? view.data : null;
  if (view.state === "refused" || view.state === "unchecked")
    return (
      <div className="page empty">
        <div className="eyebrow">Evidence room</div>
        <h2>{view.message}</h2>
        <p>
          Access is checked on every visit and when you come back to this tab, so nothing here can
          be read once it ends. A copy someone already exported can't be recalled.
        </p>
        {view.state === "unchecked" && (
          <button type="button" className="btn" onClick={load}>
            Check again
          </button>
        )}
        <Link to="/acquire">Back to acquisitions</Link>
      </div>
    );
  if (!room) return <div className="page muted">Opening the room…</div>;
  const r = room.request;
  const fin = room.financials;
  return (
    <div className="page">
      <Link to="/acquire">← Back to acquisitions</Link>
      <div className="preview-banner" style={{ marginTop: 16 }}>
        <span>
          <strong>{r.buyer.name}</strong> · Evidence room · Access: {(r.granted ?? []).join(", ")} ·
          until {when(r.expires_at)} · Fictional example
        </span>
        <a
          href={`/api/acquire/rooms/${id}/export`}
          className="btn btn-secondary"
          style={{ minHeight: 34 }}
          download
        >
          Export a permitted snapshot
        </a>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
        When access ends, this room stops working. A downloaded snapshot can't be recalled, so it
        says when access was due to end.
      </p>
      <div className="eyebrow">{room.business.family_label}</div>
      <h1 className="display" style={{ fontSize: 40, margin: "0 0 4px" }}>
        {room.business.name}
      </h1>
      <p className="muted" style={{ fontSize: 18 }}>
        {room.business.tagline}
      </p>
      <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
        <div className="stat">
          <span className="muted" style={{ fontSize: 13 }}>
            Asking price
          </span>
          <strong>{room.asking ? usd(room.asking.cents) : "None set"}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {room.asking?.source ?? "—"}
          </span>
        </div>
        <div className="stat">
          <span className="muted" style={{ fontSize: 13 }}>
            Everstreet estimate
          </span>
          <strong>
            {fin
              ? fin.estimate.low_cents === null
                ? "No range yet"
                : `${usd(fin.estimate.low_cents)}–${usd(fin.estimate.high_cents)}`
              : "Not in this grant"}
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {fin?.estimate.label ?? ""}
          </span>
        </div>
        <div className="stat">
          <span className="muted" style={{ fontSize: 13 }}>
            Seller opened to you
          </span>
          <strong style={{ fontSize: 18 }}>{when(r.decided_at)}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            For: {r.purpose}
          </span>
        </div>
      </div>
      {room.chain_error && <p className="notice">{room.chain_error}</p>}
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tab${tab === k ? " active" : ""}`}
            disabled={!room[k as keyof Room]}
            title={room[k as keyof Room] ? undefined : "Not in this grant"}
            style={room[k as keyof Room] ? undefined : { opacity: 0.45, cursor: "not-allowed" }}
            onClick={() => setTab(k)}
          >
            {label}
            {!room[k as keyof Room] && " · not granted"}
          </button>
        ))}
      </div>

      {tab === "financials" && fin && (
        <>
          <section className="card fin-card">
            <h2>Month by month</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              The same figures the owner sees, with where each came from. {fin.basis}
            </p>
            <EarnedCostChart
              months={fin.months}
              title="Earned revenue, costs and contribution by month"
            />
            {fin.cash_included ? (
              <CashChart months={fin.months} />
            ) : (
              fin.cash_note && (
                <p className="muted" style={{ fontSize: 13 }}>
                  {fin.cash_note}
                </p>
              )
            )}
            <Scroll className="fin-table-wrap" label="Books by month, scrolls sideways">
              <table className="table fin-table">
                <caption className="sr-only">Books by month</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Earned</th>
                    <th scope="col">Direct costs</th>
                    <th scope="col">Overhead</th>
                    <th scope="col">Contribution</th>
                    <th scope="col">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Every month, zero months included: a real $0 is evidence too (003f1). */}
                  {fin.months.map((m) => (
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
                      </td>
                      <td className="num">{money(m.direct_cents)}</td>
                      <td className="num">{money(m.overhead_cents)}</td>
                      <td className="num">
                        <strong>{money(m.profit_cents)}</strong>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {[...new Set([...m.revenue_sources, ...m.cost_sources])].join(" · ") || "—"}
                        {m.mixed && " · fictional example history kept separate"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          </section>
          <section className="card">
            <h2>The estimate, and checking it yourself</h2>
            <pre className="calc">{fin.estimate.explanation.join("\n")}</pre>
            <Reproduce r={fin} expected={[fin.estimate.low_cents, fin.estimate.high_cents]} />
            {fin.estimate.missing.length > 0 && (
              <>
                <h3 style={{ fontSize: 15, marginTop: 16 }}>What the estimate doesn't know</h3>
                <ul className="missing-list">
                  {fin.estimate.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {fin.balances && (
            <section className="card">
              <h2>Balances on the business's contract</h2>
              <dl className="facts" style={{ gridTemplateColumns: "160px 1fr" }}>
                <dt>Customer money held</dt>
                <dd>{fin.balances.customer_money}</dd>
                <dt>Available to the owner</dt>
                <dd>{fin.balances.available}</dd>
              </dl>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {fin.balances.source}
              </p>
            </section>
          )}
          <OurScenario id={id} r={fin} onSaved={load} />
        </>
      )}

      {tab === "costs" && room.costs && (
        <section className="card">
          <h2>Every cost line</h2>
          {room.costs.length === 0 && <p className="muted">No costs are recorded.</p>}
          {room.costs.map((m) => (
            <div key={m.label} style={{ marginBottom: 12 }}>
              <strong>{m.label}</strong>
              {m.lines.map((l) => (
                <div
                  key={l.label + l.cents}
                  className="row"
                  style={{ fontSize: 14, padding: "4px 0", borderTop: "1px solid var(--border)" }}
                >
                  <span>{l.label}</span>
                  <span className="muted">{l.kind === "direct" ? "direct" : "overhead"}</span>
                  <span className="spacer" />
                  <span>{usd(l.cents)}</span>
                  <span className="pill" style={{ fontSize: 12 }}>
                    {l.source}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {tab === "customers" && room.customers && (
        <section className="card">
          <h2>Customer activity, in aggregate</h2>
          <div className="stat-row">
            {room.customers.rows.map((x) => (
              <div key={x.label} className="stat">
                <span className="muted" style={{ fontSize: 13 }}>
                  {x.label}
                </span>
                <strong>{x.value}</strong>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            {room.customers.source}
          </p>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {room.customers.note}
          </p>
        </section>
      )}

      {tab === "operations" && room.operations && (
        <div className="desk">
          <section className="card">
            <h2>What a sale would cover</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              {room.operations.manifest.note}
            </p>
            <Items title="Control you would receive" items={room.operations.manifest.receive} />
            <Items title="Stays with the business" items={room.operations.manifest.stays} />
            <Items title="Separate transfer items" items={room.operations.manifest.separate} />
            <Items title="Excluded" items={room.operations.manifest.excluded} />
          </section>
          <aside className="studio-side" style={{ position: "static" }}>
            <section className="card" style={{ padding: 18 }}>
              <strong>Running it</strong>
              <dl className="facts" style={{ gridTemplateColumns: "110px 1fr", marginTop: 10 }}>
                <dt>Owner work</dt>
                <dd>
                  {room.operations.founder_hours.text}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {room.operations.founder_hours.source}
                  </div>
                </dd>
                <dt>Helpers</dt>
                <dd>
                  {room.operations.helpers.text}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {room.operations.helpers.source}
                  </div>
                </dd>
                {room.operations.treasury && (
                  <>
                    <dt>Customer money</dt>
                    <dd>
                      {room.operations.treasury.customer_money}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {room.operations.treasury.source}
                      </div>
                    </dd>
                  </>
                )}
              </dl>
              {room.scope_note && (
                <p className="muted" style={{ fontSize: 13 }}>
                  {room.scope_note}
                </p>
              )}
              {!room.operations.treasury && (
                <p className="muted" style={{ fontSize: 13 }}>
                  Balances held by the contract are part of financials access.
                </p>
              )}
              {room.operations.contract ? (
                <a href={room.operations.contract.url} target="_blank" rel="noreferrer">
                  The business's contract on NEAR testnet
                </a>
              ) : (
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  No contract yet: payments are off.
                </p>
              )}
            </section>
            {room.operations.promises.length > 0 && (
              <section className="card" style={{ padding: 18 }}>
                <strong>Promises every owner keeps</strong>
                <ul style={{ paddingLeft: 18, fontSize: 14, marginBottom: 0 }}>
                  {room.operations.promises.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                  Enforced by the contract
                </p>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
