// Job 005e (M5): operating economics and recovery for a digital business, from its own records.
//
// Definitions (stated in every answer, never implied):
// - A successful use: a customer request whose unit the contract CHARGED (customer_settlements
//   kind 'charge', state 'charged'). One settlement per request, so retries can't inflate it.
// - Earned revenue: charged units x the offer's plan unit price, in the offer's ASSET (base
//   units, exact decimal strings), by the month the request was made (UTC).
// - Prepaid in: confirmed purchases (amount, base units). Returned purchases are money given back,
//   not revenue. Prepaid is an obligation until earned, not income.
// - Pending: settlements still requested/unknown (not counted as earned).
// - Known compute cost: customer-use invocations' charged cost (USD microcents). Calls whose cost
//   is unknown are counted, never treated as zero.
// - Cost per successful use: only when every customer call that month has a known cost.
// - No profit or margin: revenue is in the offer's token and cost in USD; they aren't converted.

import { addMonths, ym } from "./books.ts";
import type { Db } from "./db.ts";

export const ECONOMICS_MONTHS_MAX = 24;
const MONTH = (col: string) => `CAST(substr(${col}, 1, 4) || substr(${col}, 6, 2) AS INTEGER)`;
const firstInstant = (yyyymm: number) =>
  `${Math.floor(yyyymm / 100)}-${String(yyyymm % 100).padStart(2, "0")}-01T00:00:00.000Z`;
const add = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
const label = (yyyymm: number) =>
  new Date(Date.UTC(Math.floor(yyyymm / 100), (yyyymm % 100) - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export interface AssetMonth {
  earned: string;
  earned_units: number;
  pending_units: number;
  pending_value: string;
  prepaid_in: string;
  prepaid_units: number;
  returned_purchases: string;
}

const ZERO = (): AssetMonth => ({
  earned: "0",
  earned_units: 0,
  pending_units: 0,
  pending_value: "0",
  prepaid_in: "0",
  prepaid_units: 0,
  returned_purchases: "0",
});

export function economics(db: Db, businessId: string, months: number, now = new Date()) {
  const n = Math.min(ECONOMICS_MONTHS_MAX, Math.max(1, Math.floor(months)));
  const current = ym(now);
  const list = Array.from({ length: n }, (_, i) => addMonths(current, i - (n - 1)));
  const since = firstInstant(list[0] as number);
  const asOf = now.toISOString();

  // Charges and pending settlements, priced by each request's own offer (its plan's unit price).
  const settled = db
    .prepare(
      `SELECT ${MONTH("r.created_at")} AS yyyymm, o.asset AS asset, o.plan AS plan, s.state AS state,
              COUNT(*) AS n
         FROM customer_requests r
         JOIN customer_settlements s ON s.request_id = r.id AND s.kind = 'charge'
         JOIN customer_offers o ON o.id = r.offer_id
        WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
          AND s.state IN ('charged','requested','unknown')
        GROUP BY yyyymm, o.asset, o.plan, s.state`,
    )
    .all(businessId, since, asOf) as {
    yyyymm: number;
    asset: string;
    plan: string;
    state: string;
    n: number;
  }[];
  const purchases = db
    .prepare(
      `SELECT ${MONTH("created_at")} AS yyyymm, asset, state, amount, units
         FROM customer_purchases
        WHERE business_id = ? AND created_at >= ? AND created_at <= ? AND state IN ('confirmed','returned')`,
    )
    .all(businessId, since, asOf) as {
    yyyymm: number;
    asset: string;
    state: string;
    amount: string;
    units: number;
  }[];
  const assets = [
    ...new Set([...settled.map((r) => r.asset), ...purchases.map((p) => p.asset)]),
  ].sort();
  const cell = new Map<string, AssetMonth>();
  const at = (m: number, a: string) => {
    const k = `${m}|${a}`;
    let c = cell.get(k);
    if (!c) {
      c = ZERO();
      cell.set(k, c);
    }
    return c;
  };
  for (const r of settled) {
    const price = String(
      (JSON.parse(r.plan) as { unit_price?: string | number }).unit_price ?? "0",
    );
    const value = (BigInt(price) * BigInt(r.n)).toString();
    const c = at(r.yyyymm, r.asset);
    if (r.state === "charged") {
      c.earned = add(c.earned, value);
      c.earned_units += r.n;
    } else {
      c.pending_value = add(c.pending_value, value);
      c.pending_units += r.n;
    }
  }
  for (const p of purchases) {
    const c = at(p.yyyymm, p.asset);
    if (p.state === "confirmed") {
      c.prepaid_in = add(c.prepaid_in, p.amount);
      c.prepaid_units += p.units;
    } else c.returned_purchases = add(c.returned_purchases, p.amount);
  }

  // Customer compute cost and successful uses, by month.
  const cost = db
    .prepare(
      `SELECT ${MONTH("created_at")} AS yyyymm,
              CAST(COALESCE(SUM(charged_microcents), 0) AS TEXT) AS micro, COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN state = 'running' OR usage_state IN ('partial','unknown') THEN 1 ELSE 0 END), 0) AS unknown
         FROM runtime_invocations
        WHERE business_id = ? AND purpose = 'customer_use' AND created_at >= ? AND created_at <= ?
        GROUP BY yyyymm`,
    )
    .all(businessId, since, asOf) as {
    yyyymm: number;
    micro: string;
    calls: number;
    unknown: number;
  }[];
  const success = (m: number) =>
    assets.reduce((s, a) => s + (cell.get(`${m}|${a}`)?.earned_units ?? 0), 0);

  const monthsOut = list.map((m) => {
    const c = cost.find((x) => x.yyyymm === m);
    const successes = success(m);
    const known = c ? c.unknown === 0 : true;
    return {
      yyyymm: m,
      label: label(m),
      so_far: m === current,
      by_asset: Object.fromEntries(assets.map((a) => [a, cell.get(`${m}|${a}`) ?? ZERO()])),
      successful_uses: successes,
      compute: {
        known_microcents: c?.micro ?? "0",
        calls: c?.calls ?? 0,
        unknown_cost_calls: c?.unknown ?? 0,
      },
      cost_per_success_microcents:
        successes > 0 && known && c ? (BigInt(c.micro) / BigInt(successes)).toString() : null,
      cost_per_success_reason:
        successes === 0
          ? "No successful uses this month"
          : !known
            ? `${c?.unknown} customer call(s) have no known cost yet, so a per-use cost would be understated`
            : null,
    };
  });

  // Obligations, as recorded here (all time up to now): prepaid in, minus earned, minus returned.
  const outstanding = assets.map((a) => {
    const t = db
      .prepare(
        `SELECT
           CAST(COALESCE(SUM(CASE WHEN state = 'confirmed' THEN CAST(amount AS INTEGER) ELSE 0 END), 0) AS TEXT) AS prepaid,
           COALESCE(SUM(CASE WHEN state = 'confirmed' THEN units ELSE 0 END), 0) AS units
         FROM customer_purchases WHERE business_id = ? AND asset = ? AND created_at <= ?`,
      )
      .get(businessId, a, asOf) as { prepaid: string; units: number };
    const charged = db
      .prepare(
        `SELECT o.plan AS plan, COUNT(*) AS n FROM customer_requests r
           JOIN customer_settlements s ON s.request_id = r.id AND s.kind = 'charge' AND s.state = 'charged'
           JOIN customer_offers o ON o.id = r.offer_id
          WHERE r.business_id = ? AND o.asset = ? AND r.created_at <= ? GROUP BY o.plan`,
      )
      .all(businessId, a, asOf) as { plan: string; n: number }[];
    let earned = "0";
    let units = 0;
    for (const c of charged) {
      const price = String((JSON.parse(c.plan) as { unit_price?: string }).unit_price ?? "0");
      earned = add(earned, (BigInt(price) * BigInt(c.n)).toString());
      units += c.n;
    }
    const value = BigInt(t.prepaid) - BigInt(earned);
    const left = t.units - units;
    const known = value >= 0n && left >= 0;
    return {
      asset: a,
      prepaid_in: t.prepaid,
      prepaid_units: t.units,
      earned,
      earned_units: units,
      // Prepaid units not yet used: what customers are still owed service for.
      // Unknown (null), never negative: purchases may predate these records.
      outstanding_units: known ? left : null,
      outstanding_value: known ? value.toString() : null,
      note: !known
        ? "More was earned than recorded as prepaid here (e.g. purchases made before these records). Unknown, not negative."
        : "As recorded on this server. The contract's entitlements are the authority.",
    };
  });

  return {
    as_of: asOf,
    period: { from: list[0], to: current, months: n, buckets: "UTC calendar months, by request" },
    assets,
    months: monthsOut,
    obligations: outstanding,
    definitions: {
      successful_use:
        "A customer request whose unit the contract charged. One per request: retries don't count twice.",
      earned:
        "Charged units times the offer's unit price, in that offer's asset (exact base units).",
      prepaid: "Confirmed purchases. An obligation to serve until used, not income.",
      pending: "Charges still settling; not earned yet.",
      compute:
        "Customer-use model calls' known cost in USD microcents; calls without a known cost are counted, not zeroed.",
      no_profit:
        "No profit or margin is shown: revenue is in each offer's token and cost in USD, and they aren't converted here.",
    },
    recovery: recovery(db, businessId, asOf),
  };
}

/**
 * Unresolved operations for this business, read-only and bounded. Each says what is known, what
 * isn't, and who or what resolves it. Nothing here marks anything paid, charged or failed.
 */
export function recovery(db: Db, businessId: string, asOf: string) {
  const LIMIT = 50;
  const requests = db
    .prepare(
      `SELECT r.id, r.state AS request_state, r.conflict, s.state AS settlement, s.updated_at, r.created_at
         FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
        WHERE r.business_id = ? AND r.created_at <= ?
          AND (r.conflict IS NOT NULL OR r.state IN ('unresolved','reserve_unknown')
               OR s.state IN ('requested','unknown','conflict','unresolved'))
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(businessId, asOf, LIMIT + 1) as {
    id: string;
    request_state: string;
    conflict: string | null;
    settlement: string | null;
    updated_at: string | null;
    created_at: string;
  }[];
  const invocations = db
    .prepare(
      `SELECT id, purpose, state, usage_state, created_at FROM runtime_invocations
        WHERE business_id = ? AND created_at <= ?
          AND (state = 'unknown' OR (state <> 'running' AND usage_state IN ('partial','unknown')))
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(businessId, asOf, LIMIT + 1) as {
    id: string;
    purpose: string;
    state: string;
    usage_state: string;
    created_at: string;
  }[];
  const builds = db
    .prepare(
      `SELECT id, state, created_at FROM build_jobs
        WHERE business_id = ? AND state = 'needs_reconciliation' AND created_at <= ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(businessId, asOf, LIMIT + 1) as { id: string; state: string; created_at: string }[];
  const items = [
    ...requests.slice(0, LIMIT).map((r) => ({
      kind: "customer_use" as const,
      id: r.id,
      since: r.created_at,
      state: r.conflict ? "conflict" : (r.settlement ?? r.request_state),
      known:
        r.settlement === "requested"
          ? "A charge was requested; the contract hasn't shown it yet."
          : r.conflict
            ? "The records and the contract disagree."
            : "The outcome isn't known yet.",
      resolves:
        "Background maintenance re-reads the contract; only its readback settles it. The customer can also check their use.",
    })),
    ...invocations.slice(0, LIMIT).map((i) => ({
      kind: "model_call" as const,
      id: i.id,
      since: i.created_at,
      state: i.state === "unknown" ? "outcome unknown" : `usage ${i.usage_state}`,
      known:
        i.state === "unknown"
          ? "A model call was sent and its answer never arrived. It is never re-sent; its cost stays held."
          : "The call's usage wasn't fully reported, so its cost isn't known.",
      resolves: "Only the provider's usage record could settle the cost; it stays unknown here.",
    })),
    ...builds.slice(0, LIMIT).map((b) => ({
      kind: "build" as const,
      id: b.id,
      since: b.created_at,
      state: "needs reconciliation",
      known: "The build was dispatched and its outcome or usage isn't final.",
      resolves: "Retry makes a new build; this one's usage stays as recorded.",
    })),
  ];
  return {
    items,
    truncated: requests.length > LIMIT || invocations.length > LIMIT || builds.length > LIMIT,
    note: "Read-only. Nothing here marks anything paid, charged, failed or successful.",
  };
}
