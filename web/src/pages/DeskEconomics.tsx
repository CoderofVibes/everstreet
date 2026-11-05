// Job 005e: operating economics and recovery in Operate. Every figure is in its own unit (an
// offer's token, readable when its metadata was read on the chain, else exact base units;
// compute in USD), with a readable table beside the chart,
// and nothing converted, summed across currencies or turned into profit.

import { useEffect, useId, useState } from "react";
import { parseToken, readable, TokenAmount, type TokenInfo, usableScale } from "../TokenAmount.tsx";

interface AssetMonth {
  earned: string;
  earned_units: number;
  pending_units: number;
  pending_value: string;
  prepaid_in: string;
  prepaid_units: number;
  returned_purchases: string;
}
interface EconomicsView {
  as_of: string;
  /** Each asset's metadata as read on the chain, or null (exact base units are shown). */
  tokens?: Record<string, TokenInfo | null>;
  assets: string[];
  months: {
    yyyymm: number;
    label: string;
    so_far: boolean;
    by_asset: Record<string, AssetMonth>;
    successful_uses: number;
    compute: { known_microcents: string; calls: number; unknown_cost_calls: number };
    cost_per_success_microcents: string | null;
    cost_per_success_reason: string | null;
  }[];
  obligations: {
    asset: string;
    prepaid_in: string;
    prepaid_units: number;
    earned: string;
    earned_units: number;
    outstanding_units: number | null;
    outstanding_value: string | null;
    note: string;
  }[];
  definitions: Record<string, string>;
  recovery: {
    items: {
      kind: string;
      id: string;
      since: string;
      state: string;
      known: string;
      resolves: string;
    }[];
    truncated: boolean;
    note: string;
  };
}

const group = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const usd = (micro: string) => {
  const cents = Number(BigInt(micro)) / 1_000_000;
  return cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents.toFixed(4)}¢`;
};

function EarnedChart({ view, asset }: { view: EconomicsView; asset: string }) {
  const id = useId();
  // Amount provenance: a disputed scale is never applied (to this month or any earlier one).
  const token = usableScale(view.tokens?.[asset]);
  const disputed = parseToken(view.tokens?.[asset])?.disputed ?? null;
  /** A cell: readable in the token when its details were read and agree, else exact base units. */
  const amt = (v: string) => (token ? (readable(v, token.decimals) ?? group(v)) : group(v));
  const rows = view.months.map((m) => ({ label: m.label, so_far: m.so_far, v: m.by_asset[asset] }));
  const max = rows.reduce((x, r) => {
    const a = BigInt(r.v?.earned ?? "0");
    const b = BigInt(r.v?.prepaid_in ?? "0");
    let m = x;
    if (a > m) m = a;
    if (b > m) m = b;
    return m;
  }, 0n);
  const h = (v: string) => (max === 0n ? 0 : Number((BigInt(v) * 1000n) / max) / 10);
  return (
    <figure className="eco-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`}>
        {token ? (
          <>
            Earned and prepaid by month, in {token.symbol} (token{" "}
            <span className="mono">{asset}</span>; exact base units below the table)
          </>
        ) : (
          <>
            Earned and prepaid by month, exact base units of <span className="mono">{asset}</span> (
            {disputed
              ? `${disputed.replace(/\.$/, "")}, so no scale is applied`
              : "this token's details haven't been read yet"}
            )
          </>
        )}
      </figcaption>
      <div className="eco-bars" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.label} className="eco-col">
            <div className="eco-pair">
              <span
                className="eco-bar prepaid"
                style={{ height: `${h(r.v?.prepaid_in ?? "0")}%` }}
              />
              <span className="eco-bar earned" style={{ height: `${h(r.v?.earned ?? "0")}%` }} />
            </div>
            <span className="eco-x">
              {r.label}
              {r.so_far ? " (so far)" : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="eco-legend" aria-hidden="true">
        <span className="eco-key earned" /> Earned (charged uses){" "}
        <span className="eco-key prepaid" /> Prepaid in (an obligation until used)
      </p>
      <table className="table eco-table">
        <caption className="sr-only">Earned, prepaid, pending and returned by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Earned</th>
            <th scope="col">Uses charged</th>
            <th scope="col">Pending</th>
            <th scope="col">Prepaid in</th>
            <th scope="col">Returned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">
                {r.label}
                {r.so_far ? " (so far)" : ""}
              </th>
              <td className="mono">{amt(r.v?.earned ?? "0")}</td>
              <td>{r.v?.earned_units ?? 0}</td>
              <td>
                {r.v?.pending_units ? `${r.v.pending_units} (${amt(r.v.pending_value)})` : "0"}
              </td>
              <td className="mono">{amt(r.v?.prepaid_in ?? "0")}</td>
              <td className="mono">{amt(r.v?.returned_purchases ?? "0")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {token && (
        <details className="eco-exact small">
          <summary>Exact base units</summary>
          <ul className="plain">
            {rows.map((r) => (
              <li key={r.label}>
                {r.label}: earned <span className="mono">{group(r.v?.earned ?? "0")}</span>, prepaid
                in <span className="mono">{group(r.v?.prepaid_in ?? "0")}</span>, returned{" "}
                <span className="mono">{group(r.v?.returned_purchases ?? "0")}</span> base units of{" "}
                <span className="mono">{asset}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </figure>
  );
}

export function DeskEconomics({ businessId }: { businessId: string }) {
  const [view, setView] = useState<EconomicsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/economics?months=6`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`,
          );
        return (await r.json()) as EconomicsView;
      })
      .then((v) => live && setView(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [businessId]);
  if (error)
    return (
      <section className="card">
        <h2 className="ws-h">Economics</h2>
        <p className="error">Economics couldn't be read ({error}). Nothing was changed.</p>
      </section>
    );
  if (!view) return <section className="card muted">Loading economics…</section>;
  return (
    <section className="card eco" aria-labelledby="eco-h">
      <h2 id="eco-h" className="ws-h">
        Economics
      </h2>
      <p className="muted small">{view.definitions.no_profit}</p>
      {view.assets.length === 0 ? (
        <p className="muted">No purchases or charged uses yet in these months.</p>
      ) : (
        view.assets.map((a) => <EarnedChart key={a} view={view} asset={a} />)
      )}
      {view.obligations.length > 0 && (
        <>
          <h3>What customers are still owed</h3>
          <ul className="plain">
            {view.obligations.map((o) => (
              <li key={o.asset}>
                {o.outstanding_units === null ? (
                  <strong>Unknown</strong>
                ) : (
                  <>
                    <strong>{o.outstanding_units}</strong> prepaid uses not yet used
                  </>
                )}
                {o.outstanding_value !== null && (
                  <>
                    {" "}
                    (worth{" "}
                    <TokenAmount
                      base={o.outstanding_value}
                      asset={o.asset}
                      token={view.tokens?.[o.asset]}
                    />
                    )
                  </>
                )}
                . <span className="muted small">{o.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Compute for customer uses (USD)</h3>
      <table className="table">
        <caption className="sr-only">Compute cost and cost per successful use by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Successful uses</th>
            <th scope="col">Model calls</th>
            <th scope="col">Known cost</th>
            <th scope="col">Per successful use</th>
          </tr>
        </thead>
        <tbody>
          {view.months.map((m) => (
            <tr key={m.yyyymm}>
              <th scope="row">{m.label}</th>
              <td>{m.successful_uses}</td>
              <td>
                {m.compute.calls}
                {m.compute.unknown_cost_calls > 0 &&
                  ` (${m.compute.unknown_cost_calls} cost unknown)`}
              </td>
              <td>{usd(m.compute.known_microcents)}</td>
              <td>
                {m.cost_per_success_microcents !== null ? (
                  usd(m.cost_per_success_microcents)
                ) : (
                  <span className="muted">{m.cost_per_success_reason}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Needs recovery</h3>
      {view.recovery.items.length === 0 ? (
        <p className="muted">Nothing unresolved. {view.recovery.note}</p>
      ) : (
        <>
          <p className="muted small">{view.recovery.note}</p>
          <ul className="plain eco-recovery">
            {view.recovery.items.map((i) => (
              <li key={`${i.kind}-${i.id}`}>
                <strong>{i.kind.replace("_", " ")}</strong> · {i.state} · since{" "}
                {new Date(i.since).toLocaleString()}. {i.known}{" "}
                <span className="muted">{i.resolves}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>How these figures are defined</summary>
        <dl className="source-dl">
          {Object.entries(view.definitions).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k.replace("_", " ")}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
