// The Value screen (Astra, LaunchPad §4 and IntactProfiles §4): what the business could be worth
// as an explainable scenario model, every input with its source, exactly what changed, private
// what-ifs, and a choice to share numbers on the public page (private by default).

import { useCallback, useEffect, useState } from "react";
import { api4, type Estimate, type Overrides, usd, type ValueView } from "../api4.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";

function Range({ e, big }: { e: Estimate; big?: boolean }) {
  return (
    <div>
      <div className="display" style={{ fontSize: big ? 52 : 28, lineHeight: 1.1 }}>
        {e.low_cents === null ? "No range yet" : `${usd(e.low_cents)}–${usd(e.high_cents)}`}
      </div>
      <div className="muted" style={{ fontSize: big ? 15 : 13, marginTop: 4 }}>
        {e.low_cents === null
          ? "It doesn't earn more than it costs yet, once your own work is counted, so there is no earnings-based estimate. Try a change below to see what would."
          : e.label}
      </div>
    </div>
  );
}

function Calculation({ e }: { e: Estimate }) {
  return (
    <pre className="calc">
      {e.explanation.join("\n")}
      {e.low_cents !== null ? `\n= ${usd(e.low_cents)}–${usd(e.high_cents)}` : ""}
    </pre>
  );
}

function Settings({ v, id, onChange }: { v: ValueView; id: string; onChange: () => void }) {
  const s = v.settings;
  const i = v.estimate.inputs;
  const [f, setF] = useState({
    hours: String(s.founder_hours_week ?? i.founder_hours_week),
    rate: String((s.hourly_rate_cents ?? i.hourly_rate_cents) / 100),
    low: String(s.multiple_low ?? i.multiple_low),
    high: String(s.multiple_high ?? i.multiple_high),
    plan: String(s.plan_customers_month ?? i.plan_customers_month ?? ""),
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api4.settings(id, {
        founder_hours_week: Number(f.hours),
        hourly_rate_cents: Math.round(Number(f.rate) * 100),
        multiple_low: Number(f.low),
        multiple_high: Number(f.high),
        ...(i.stage === "plan" && f.plan ? { plan_customers_month: Number(f.plan) } : {}),
      });
      setError(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const field = (label: string, key: keyof typeof f, hint?: string) => (
    <label className="field" style={{ margin: 0 }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      {hint && <small>{hint}</small>}
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
      <h2>Your assumptions</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        These change the estimate everyone sees if you share it. A buyer would make their own.
      </p>
      <div className="filters">
        {field("Your hours a week", "hours", "Work a successor would have to do or pay for")}
        {field("Worth per hour ($)", "rate", "What that work would cost to hire")}
        {field("Low multiple", "low", "× normalized annual earnings")}
        {field("High multiple", "high", "Illustrative, not market data")}
      </div>
      {i.stage === "plan" && (
        <div style={{ maxWidth: 260, marginTop: 12 }}>
          {field("Customers a month in your plan", "plan")}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>
        Save assumptions
      </button>
    </section>
  );
}

function TryChange({ v, id, onSaved }: { v: ValueView; id: string; onSaved: () => void }) {
  const i = v.estimate.inputs;
  const [o, setO] = useState({ customers: "", price: "", hours: "", costs: "" });
  const [result, setResult] = useState<Estimate | null>(null);
  const [name, setName] = useState("");
  const overrides = (): Overrides => ({
    ...(o.customers ? { extra_customers_month: Number(o.customers) } : {}),
    ...(o.price ? { price_cents: Math.round(Number(o.price) * 100) } : {}),
    ...(o.hours ? { founder_hours_week: Number(o.hours) } : {}),
    ...(o.costs ? { extra_monthly_costs_cents: Math.round(Number(o.costs) * 100) } : {}),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: overrides() is derived from o; recompute when the fields change
  useEffect(() => {
    const t = setTimeout(async () => {
      const ov = overrides();
      if (Object.keys(ov).length === 0) return setResult(null);
      setResult((await api4.tryChange(id, ov)).scenario);
    }, 300);
    return () => clearTimeout(t);
  }, [o, id]);
  const input = (label: string, key: keyof typeof o, placeholder: string) => (
    <label className="field" style={{ margin: 0 }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      <input
        className="input"
        inputMode="decimal"
        placeholder={placeholder}
        value={o[key]}
        onChange={(e) => setO({ ...o, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="card">
      <h2>Try a change</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        A private what-if. Nothing here changes the estimate or anything anyone else sees.
      </p>
      <div className="filters">
        {input("More customers a month", "customers", "e.g. 5")}
        {input("A different price ($)", "price", i.price_cents ? String(i.price_cents / 100) : "")}
        {input("Your hours a week", "hours", String(i.founder_hours_week))}
        {input("Extra monthly cost ($)", "costs", "e.g. 50")}
      </div>
      {result && (
        <div className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              Now{" "}
              {v.estimate.low_cents === null
                ? "no range"
                : `${usd(v.estimate.low_cents)}–${usd(v.estimate.high_cents)}`}{" "}
              → with this change
            </div>
            <Range e={result} />
          </div>
          <span className="spacer" />
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="Name this what-if"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              await api4.saveScenario(id, name || "What if", overrides());
              setName("");
              onSaved();
            }}
          >
            Save it
          </button>
        </div>
      )}
      {result && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted">See this calculation</summary>
          <Calculation e={result} />
        </details>
      )}
      {v.scenarios.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 18 }}>Saved what-ifs (only you see these)</h3>
          {v.scenarios.map((s) => (
            <div
              key={s.id}
              className="row"
              style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}
            >
              <strong>{s.name}</strong>
              <span className="muted">
                {Object.entries(s.overrides)
                  .map(([k, val]) => `${k.replace(/_/g, " ")}: ${val}`)
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

export function Value({ id }: { id: string }) {
  const { person } = useSession();
  const [v, setV] = useState<ValueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api4
        .value(id)
        .then(setV)
        .catch((e) => setError((e as Error).message)),
    [id],
  );
  useEffect(() => {
    if (person) load();
  }, [person, load]);
  if (error)
    return (
      <div className="page empty">
        <h2>{error}</h2>
        <Link to="/desk">Your businesses</Link>
      </div>
    );
  if (!v) return <div className="page muted">Working out the numbers…</div>;
  const e = v.estimate;
  return (
    <div className="page">
      <div className="row">
        <Link to={`/desk/${id}`}>← Back to the desk</Link>
      </div>
      <div className="eyebrow" style={{ marginTop: 16 }}>
        Value
      </div>
      <div className="value-hero">
        <div>
          <h1 className="display" style={{ fontSize: 30, margin: "0 0 12px" }}>
            {e.inputs.stage === "plan"
              ? "What this could become"
              : "What this business could be worth"}
          </h1>
          <Range e={e} big />
          <div className="row" style={{ marginTop: 16 }}>
            <label className="check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={v.settings.share_numbers}
                onChange={async (ev) => {
                  await api4.settings(id, { share_numbers: ev.target.checked });
                  load();
                }}
              />
              <span>
                <strong>Share my numbers</strong> on my public page: last month's revenue, costs and
                profit, and this estimate with its labels. Off by default; nobody infers you want to
                sell.
              </span>
            </label>
          </div>
        </div>
        <section className="card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: 17 }}>See the calculation</h2>
          <Calculation e={e} />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Model {e.inputs.model}. An estimate for exploring decisions, not an appraisal, an offer
            or advice.
          </p>
        </section>
      </div>

      {e.missing.length > 0 && (
        <section className="card">
          <h2>What this doesn't know yet</h2>
          <ul className="missing-list">
            {e.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Add costs on your <Link to={`/desk/${id}`}>desk</Link>; set your own work below.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Where every input comes from</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Input</th>
              <th>Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {e.sources.map((s) => (
              <tr key={s.input}>
                <td>{s.input}</td>
                <td>{s.value}</td>
                <td>
                  <span
                    className={`pill ${s.source.includes("NEAR") ? "lime" : s.source.includes("Seeded") ? "caution" : ""}`}
                  >
                    {s.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.chain_error && <p className="notice">{v.chain_error}</p>}
      </section>

      {v.what_changed && v.what_changed.changes.length > 0 && (
        <section className="card">
          <h2>What changed</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Since {new Date(v.what_changed.from).toLocaleString()}: {v.what_changed.range_before} →{" "}
            {v.what_changed.range_after}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {v.what_changed.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <Settings key={JSON.stringify(v.settings)} v={v} id={id} onChange={load} />
      <TryChange v={v} id={id} onSaved={load} />

      {v.history.length > 1 && (
        <section className="card">
          <h2>Every version of this estimate</h2>
          {v.history.map((h) => (
            <div
              key={h.at}
              className="row"
              style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}
            >
              <span className="muted">{new Date(h.at).toLocaleString()}</span>
              <span className="spacer" />
              <span>
                {h.low_cents === null ? "no range" : `${usd(h.low_cents)}–${usd(h.high_cents)}`}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
