// Step 7 (docs/design/DEMO_ACCOUNT.md §3): the owner's portfolio dashboard, as data. For each
// business the viewer controls now, over the last N days (UTC), from its own records:
// - earned revenue per day, per ASSET (charged units x the request's own offer price; the same
//   definition as economics.ts), and pending charges;
// - known compute cost per day (USD microcents; calls without a known cost are counted, never 0);
// - customer requests delivered (charged) and not charged per day;
// - customer credits remaining, from the latest contract observation (its treasury), with its
//   block and time; unknown when nothing was observed;
// - network fees: not recorded by Everstreet, so unknown (never invented);
// - the active release, ownership, a live sale, and what needs attention.
// Totals across businesses are summed only within the same asset; tokens and USD never mix.

import type { Db } from "./db.ts";
import { rehearsable } from "./digitalDesk.ts";
import { publicPageOutdated } from "./publication.ts";
import type { Person } from "./store.ts";
import { tokenMetaOf } from "./tokenMeta.ts";

const DAY_MS = 86_400_000;
const add = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
const dayOf = (iso: string) => iso.slice(0, 10);

export const DASHBOARD_DEFINITIONS = {
  revenue:
    "Earned: units the contract charged for delivered results, times the price of the offer each request used, in that offer's token. Pending charges aren't counted.",
  compute:
    "Known compute cost of customer requests (USD). Calls whose cost isn't known yet are counted separately, never as zero.",
  credits:
    "Prepaid customer uses not yet used, as the business contract's treasury showed at its latest observation here.",
  network_fees:
    "Not recorded: Everstreet doesn't keep the NEAR fees of its own transactions yet, so none is shown.",
  customers:
    "Active: customers who sent a request in the period. Returning: on two or more days. New: their first request ever was in the period.",
  success_rate: "Delivered (charged) requests out of all requests that finished in the period.",
  runway:
    "How many days the prepaid credits would last at the last 7 days' pace of delivered uses.",
  cases: "A SaaS workflow's cases: open by stage, and the median time from request to resolved.",
  totals:
    "Totals add businesses only within the same token. Tokens and USD are never added together.",
};

const pct = (sorted: number[], q: number) =>
  sorted.length
    ? (sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] as number)
    : null;
const BILLED = new Set(["extracted", "accepted", "analyzed", "granted"]);
const monthOf = (iso: string) => Number(iso.slice(0, 4)) * 100 + Number(iso.slice(5, 7));

/**
 * Compute in detail for one business over the period (USD microcents): by purpose, by outcome of
 * customer use (spend on results that were never charged is "unbilled"), tokens, the model,
 * cost and time per call, this month's spend against the runtime budget, and build spend.
 */
function computeDetail(db: Db, businessId: string, since: string, asOf: string) {
  const rows = db
    .prepare(
      `SELECT purpose, outcome, state, usage_state, provider, provider_config, charged_microcents AS m,
              input_tokens AS i, output_tokens AS o, elapsed_ms AS ms, created_at
         FROM runtime_invocations WHERE business_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .all(businessId, since, asOf) as {
    purpose: string;
    outcome: string | null;
    state: string;
    usage_state: string;
    provider: string;
    provider_config: string;
    m: number;
    i: number;
    o: number;
    ms: number | null;
    created_at: string;
  }[];
  const unknown = (r: (typeof rows)[number]) =>
    r.state === "running" || r.usage_state === "partial" || r.usage_state === "unknown";
  const by = (key: (r: (typeof rows)[number]) => string, list = rows) => {
    const out: Record<string, { calls: number; microcents: string; unknown_calls: number }> = {};
    for (const r of list) {
      const k = key(r);
      out[k] ??= { calls: 0, microcents: "0", unknown_calls: 0 };
      const e = out[k] as { calls: number; microcents: string; unknown_calls: number };
      e.calls += 1;
      e.microcents = add(e.microcents, String(r.m));
      if (unknown(r)) e.unknown_calls += 1;
    }
    return out;
  };
  const use = rows.filter((r) => r.purpose === "customer_use");
  const costs = use
    .filter((r) => !unknown(r))
    .map((r) => r.m)
    .sort((a, b) => a - b);
  const times = use
    .map((r) => r.ms)
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  const unbilled = use
    .filter((r) => r.outcome !== null && !BILLED.has(r.outcome))
    .reduce((s, r) => add(s, String(r.m)), "0");
  const models = [
    ...new Set(
      rows.map((r) => {
        try {
          const c = JSON.parse(r.provider_config) as { model?: string; id?: string };
          return String(c.model ?? r.provider);
        } catch {
          return r.provider;
        }
      }),
    ),
  ];
  const month = monthOf(asOf);
  const monthStart = `${String(month).slice(0, 4)}-${String(month).slice(4)}-01`;
  const spentThisMonth = (
    db
      .prepare(
        "SELECT CAST(COALESCE(SUM(charged_microcents), 0) AS TEXT) AS m FROM runtime_invocations WHERE business_id = ? AND created_at >= ?",
      )
      .get(businessId, monthStart) as { m: string }
  ).m;
  const budget = db
    .prepare("SELECT limit_cents FROM runtime_budgets WHERE business_id = ?")
    .get(businessId) as { limit_cents: number } | undefined;
  const build = db
    .prepare(
      `SELECT COALESCE(SUM(u.cents), 0) AS cents, COUNT(DISTINCT u.job_id) AS jobs,
              SUM(CASE WHEN u.cents IS NULL THEN 1 ELSE 0 END) AS unknown
         FROM build_usage u JOIN build_jobs j ON j.id = u.job_id
        WHERE j.business_id = ? AND u.kind IN ('actual','unknown')`,
    )
    .get(businessId) as { cents: number; jobs: number; unknown: number };
  return {
    calls: rows.length,
    by_purpose: by((r) => r.purpose),
    customer_use_by_outcome: by((r) => r.outcome ?? "unfinished", use),
    unbilled_microcents: unbilled,
    tokens: {
      input: rows.reduce((n, r) => n + r.i, 0),
      output: rows.reduce((n, r) => n + r.o, 0),
    },
    models,
    per_call_microcents: {
      median: pct(costs, 0.5),
      p95: pct(costs, 0.95),
      max: costs.length ? (costs[costs.length - 1] as number) : null,
    },
    per_call_ms: { median: pct(times, 0.5), p95: pct(times, 0.95) },
    budget: {
      limit_cents: budget?.limit_cents ?? null,
      spent_this_month_microcents: spentThisMonth,
      month,
    },
    build: { cents: build.cents, jobs: build.jobs, unknown: build.unknown ?? 0 },
  };
}

/** Operating costs the founder entered (USD cents), per category, for the months in the period. */
function operatingCosts(db: Db, businessId: string, since: string, asOf: string) {
  const from = monthOf(since);
  const to = monthOf(asOf);
  const months: number[] = [];
  for (let m = from; m <= to; m = m % 100 === 12 ? m + 89 : m + 1) months.push(m);
  const rows = db
    .prepare(
      "SELECT category, kind, yyyymm, until_yyyymm, amount_cents, recurring FROM costs WHERE business_id = ?",
    )
    .all(businessId) as {
    category: string;
    kind: string;
    yyyymm: number;
    until_yyyymm: number | null;
    amount_cents: number;
    recurring: number;
  }[];
  const cats: Record<string, { kind: string; by_month: Record<string, number> }> = {};
  for (const r of rows)
    for (const m of months) {
      const active = r.recurring
        ? r.yyyymm <= m && (r.until_yyyymm === null || r.until_yyyymm >= m)
        : r.yyyymm === m;
      if (!active) continue;
      cats[r.category] ??= {
        kind: r.kind,
        by_month: Object.fromEntries(months.map((x) => [x, 0])),
      };
      const c = cats[r.category] as { kind: string; by_month: Record<string, number> };
      c.by_month[m] = (c.by_month[m] ?? 0) + r.amount_cents;
    }
  return {
    months,
    categories: Object.entries(cats)
      .map(([category, v]) => ({
        category,
        kind: v.kind,
        by_month: v.by_month,
        total_cents: Object.values(v.by_month).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total_cents - a.total_cents),
  };
}

/** One business's customers in the period: who, how much, when (by account; names when known). */
function clients(db: Db, businessId: string, since: string, asOf: string) {
  const rows = db
    .prepare(
      `SELECT r.customer_account AS account,
              COALESCE((SELECT p.display_name FROM person_accounts pa JOIN people p ON p.id = pa.person_id WHERE pa.account_id = r.customer_account LIMIT 1), (SELECT p.display_name FROM chain_accounts ca JOIN people p ON p.id = ca.owner_id WHERE ca.owner_kind = 'person' AND ca.account_id = r.customer_account LIMIT 1)) AS name,
              COUNT(*) AS requests,
              SUM(CASE WHEN s.kind = 'charge' AND s.state = 'charged' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN s.kind = 'release' OR s.state = 'returned' THEN 1 ELSE 0 END) AS not_charged,
              MIN(r.created_at) AS first_at, MAX(r.created_at) AS last_at
         FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
        WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
        GROUP BY r.customer_account ORDER BY requests DESC`,
    )
    .all(businessId, since, asOf) as {
    account: string;
    name: string | null;
    requests: number;
    delivered: number;
    not_charged: number;
    first_at: string;
    last_at: string;
  }[];
  const paid = db
    .prepare(
      `SELECT r.customer_account AS account, o.asset AS asset, o.plan AS plan, COUNT(*) AS n
         FROM customer_requests r
         JOIN customer_settlements s ON s.request_id = r.id AND s.kind = 'charge' AND s.state = 'charged'
         JOIN customer_offers o ON o.id = r.offer_id
        WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
        GROUP BY r.customer_account, o.asset, o.plan`,
    )
    .all(businessId, since, asOf) as { account: string; asset: string; plan: string; n: number }[];
  return rows.map((r) => {
    const revenue: Record<string, string> = {};
    for (const x of paid.filter((y) => y.account === r.account)) {
      const price = String((JSON.parse(x.plan) as { unit_price?: string }).unit_price ?? "0");
      revenue[x.asset] = add(revenue[x.asset] ?? "0", (BigInt(price) * BigInt(x.n)).toString());
    }
    return { ...r, revenue };
  });
}

export function dashboard(
  db: Db,
  viewer: Person,
  opts: { days?: number; now?: Date; only?: string } = {},
) {
  const days = Math.min(90, Math.max(7, Math.floor(opts.days ?? 30)));
  const now = opts.now ?? new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  const start = end - days * DAY_MS;
  const since = new Date(start).toISOString();
  const asOf = now.toISOString();
  const dayList = Array.from({ length: days }, (_, i) =>
    dayOf(new Date(start + i * DAY_MS).toISOString()),
  );

  const owned = db
    .prepare(
      "SELECT id, name, slug, tagline, about, created_at FROM businesses WHERE owner_id = ? ORDER BY name LIMIT 50",
    )
    .all(viewer.id)
    .filter((b) => !opts.only || (b as { id: string }).id === opts.only) as {
    id: string;
    name: string;
    slug: string;
    tagline: string;
    about: string;
    created_at: string;
  }[];

  const businesses = owned.map((b) => {
    // Revenue and pending charges, per day and asset.
    const settled = db
      .prepare(
        `SELECT substr(r.created_at, 1, 10) AS day, o.asset AS asset, o.plan AS plan, s.state AS state, COUNT(*) AS n
           FROM customer_requests r
           JOIN customer_settlements s ON s.request_id = r.id AND s.kind = 'charge'
           JOIN customer_offers o ON o.id = r.offer_id
          WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
            AND s.state IN ('charged','requested','unknown')
          GROUP BY day, o.asset, o.plan, s.state`,
      )
      .all(b.id, since, asOf) as {
      day: string;
      asset: string;
      plan: string;
      state: string;
      n: number;
    }[];
    const assets = [...new Set(settled.map((r) => r.asset))].sort();
    const revenue = Object.fromEntries(
      assets.map((a) => [a, Object.fromEntries(dayList.map((d) => [d, "0"]))]),
    ) as Record<string, Record<string, string>>;
    const pending: Record<string, { units: number; value: string }> = {};
    for (const r of settled) {
      const price = String((JSON.parse(r.plan) as { unit_price?: string }).unit_price ?? "0");
      const value = (BigInt(price) * BigInt(r.n)).toString();
      if (r.state === "charged") {
        const col = revenue[r.asset];
        if (col && r.day in col) col[r.day] = add(col[r.day] as string, value);
      } else {
        pending[r.asset] ??= { units: 0, value: "0" };
        const p = pending[r.asset] as { units: number; value: string };
        p.units += r.n;
        p.value = add(p.value, value);
      }
    }
    // Requests: delivered (charged) and not charged, per day.
    const requests = db
      .prepare(
        `SELECT substr(r.created_at, 1, 10) AS day,
                SUM(CASE WHEN s.state = 'charged' AND s.kind = 'charge' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN s.kind = 'release' OR s.state = 'returned' THEN 1 ELSE 0 END) AS not_charged
           FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
          WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
          GROUP BY day`,
      )
      .all(b.id, since, asOf) as { day: string; delivered: number; not_charged: number }[];
    // Compute cost, per day.
    const cost = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, CAST(COALESCE(SUM(charged_microcents), 0) AS TEXT) AS micro,
                COUNT(*) AS calls,
                COALESCE(SUM(CASE WHEN state = 'running' OR usage_state IN ('partial','unknown') THEN 1 ELSE 0 END), 0) AS unknown
           FROM runtime_invocations
          WHERE business_id = ? AND purpose = 'customer_use' AND created_at >= ? AND created_at <= ?
          GROUP BY day`,
      )
      .all(b.id, since, asOf) as { day: string; micro: string; calls: number; unknown: number }[];
    const daily = dayList.map((d) => {
      const q = requests.find((x) => x.day === d);
      const c = cost.find((x) => x.day === d);
      return {
        day: d,
        revenue: Object.fromEntries(assets.map((a) => [a, revenue[a]?.[d] ?? "0"])),
        delivered: q?.delivered ?? 0,
        not_charged: q?.not_charged ?? 0,
        compute_microcents: c?.micro ?? "0",
        compute_unknown_calls: c?.unknown ?? 0,
      };
    });
    const totals = {
      revenue: Object.fromEntries(
        assets.map((a) => [a, Object.values(revenue[a] ?? {}).reduce(add, "0")]),
      ),
      pending,
      delivered: daily.reduce((n, d) => n + d.delivered, 0),
      not_charged: daily.reduce((n, d) => n + d.not_charged, 0),
      compute_microcents: daily.reduce((s, d) => add(s, d.compute_microcents), "0"),
      compute_unknown_calls: daily.reduce((n, d) => n + d.compute_unknown_calls, 0),
    };

    // Customer credits: the contract's treasury at its latest observation here.
    const obs = db
      .prepare(
        `SELECT o.snapshot, o.block_height, o.observed_at, o.owner, o.generation FROM v3_projection p
           JOIN v3_observations o ON o.id = p.observation_id WHERE p.business_id = ?`,
      )
      .get(b.id) as
      | {
          snapshot: string;
          block_height: string;
          observed_at: string;
          owner: string;
          generation: number;
        }
      | undefined;
    const snap = obs
      ? (JSON.parse(obs.snapshot) as {
          treasury?: { asset?: string; ent_free_value?: string };
          control?: {
            live_deal?: {
              seq: string;
              state: string;
              buyer: string;
              price: string;
              escrow: string;
              seller_accepted: boolean;
              buyer_accepted: boolean;
              expires_at_ms: string;
            } | null;
          };
        })
      : null;
    const activeOffer = db
      .prepare(
        "SELECT asset, plan FROM customer_offers WHERE business_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1",
      )
      .get(b.id) as { asset: string; plan: string } | undefined;
    const unitPrice = activeOffer
      ? BigInt(String((JSON.parse(activeOffer.plan) as { unit_price?: string }).unit_price ?? "0"))
      : 0n;
    const free = snap?.treasury?.ent_free_value;
    const credits =
      obs && free !== undefined
        ? {
            value: free,
            asset: snap?.treasury?.asset ?? activeOffer?.asset ?? null,
            units: unitPrice > 0n ? Number(BigInt(free) / unitPrice) : null,
            block_height: obs.block_height,
            observed_at: obs.observed_at,
          }
        : null;

    // The active release, ownership and a live sale.
    const release = db
      .prepare(
        `SELECT r.id, r.activated_at, r.artifact_digest, a.kind, j.revision,
                (SELECT COUNT(*) FROM runtime_releases x WHERE x.project_id = r.project_id AND x.rowid <= r.rowid) AS number
           FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job JOIN build_jobs j ON j.id = r.artifact_job
          WHERE r.business_id = ? AND r.state = 'active' ORDER BY r.activated_at DESC LIMIT 1`,
      )
      .get(b.id) as
      | {
          id: string;
          activated_at: string;
          artifact_digest: string;
          kind: string;
          revision: number;
          number: number;
        }
      | undefined;
    const transfers = db
      .prepare("SELECT COUNT(*) AS n, MAX(at) AS last FROM ownership WHERE business_id = ?")
      .get(b.id) as { n: number; last: string | null };
    const live = snap?.control?.live_deal ?? null;
    const openCases =
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM workflow_cases WHERE business_id = ? AND closed_at IS NULL",
          )
          .get(b.id) as { n: number } | undefined
      )?.n ?? 0;
    const rehearsal = db
      .prepare(
        "SELECT state, finished_at FROM successor_rehearsals WHERE business_id = ? AND state != 'running' ORDER BY started_at DESC LIMIT 1",
      )
      .get(b.id) as { state: string; finished_at: string } | undefined;

    // Customers in the period: active, returning (on two or more days), new (first request ever).
    const cust = db
      .prepare(
        `SELECT customer_account AS a, COUNT(DISTINCT substr(created_at, 1, 10)) AS days,
                (SELECT MIN(x.created_at) FROM customer_requests x WHERE x.business_id = r.business_id AND x.customer_account = r.customer_account) AS first
           FROM customer_requests r WHERE business_id = ? AND created_at >= ? AND created_at <= ?
          GROUP BY customer_account`,
      )
      .all(b.id, since, asOf) as { a: string; days: number; first: string }[];
    const customers = {
      active: cust.length,
      returning: cust.filter((c) => c.days >= 2).length,
      new: cust.filter((c) => c.first >= since).length,
    };
    // Why requests weren't charged (the product's own outcome; "not run" when it never ran).
    const reasons = db
      .prepare(
        `SELECT COALESCE(e.result_outcome, 'not_run') AS outcome, COUNT(*) AS n
           FROM customer_requests r
           LEFT JOIN customer_settlements s ON s.request_id = r.id
           LEFT JOIN customer_executions e ON e.request_id = r.id
          WHERE r.business_id = ? AND r.created_at >= ? AND r.created_at <= ?
            AND (s.kind = 'release' OR s.state = 'returned')
          GROUP BY outcome ORDER BY n DESC`,
      )
      .all(b.id, since, asOf) as { outcome: string; n: number }[];
    const tried = totals.delivered + totals.not_charged;
    // Prepaid credits at the recent pace: how long they'd last (last 7 days' delivered uses).
    const recent = daily.slice(-7).reduce((n, d) => n + d.delivered, 0) / 7;
    // Cases (a SaaS workflow): open by stage, resolved in the period, time to resolve.
    const caseRows = db
      .prepare(
        "SELECT stage, created_at, closed_at, release_id FROM workflow_cases WHERE business_id = ?",
      )
      .all(b.id) as {
      stage: string;
      created_at: string;
      closed_at: string | null;
      release_id: string;
    }[];
    const resolved = caseRows.filter((c) => c.closed_at && c.closed_at >= since);
    const hours = resolved
      .map((c) => (Date.parse(c.closed_at as string) - Date.parse(c.created_at)) / 3_600_000)
      .sort((x, y) => x - y);
    const median = hours.length ? (hours[Math.floor((hours.length - 1) / 2)] as number) : null;
    const openByStage: Record<string, number> = {};
    for (const c of caseRows.filter((x) => !x.closed_at))
      openByStage[c.stage] = (openByStage[c.stage] ?? 0) + 1;
    const cases = caseRows.length
      ? {
          open: caseRows.filter((c) => !c.closed_at).length,
          open_by_stage: openByStage,
          opened_in_period: caseRows.filter((c) => c.created_at >= since).length,
          resolved_in_period: resolved.length,
          median_hours_to_resolve: median === null ? null : Math.round(median * 10) / 10,
        }
      : null;
    // Releases in the period (and the one before it, still serving at its start).
    const releases = (
      db
        .prepare(
          `SELECT r.activated_at, r.retired_at, r.state,
                  (SELECT COUNT(*) FROM runtime_releases x WHERE x.project_id = r.project_id AND x.rowid <= r.rowid) AS number
             FROM runtime_releases r WHERE r.business_id = ? AND (r.activated_at >= ? OR r.retired_at IS NULL OR r.retired_at >= ?)
            ORDER BY r.activated_at`,
        )
        .all(b.id, since, since) as {
        activated_at: string;
        retired_at: string | null;
        state: string;
        number: number;
      }[]
    ).map((r) => ({ ...r }));
    const team = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM business_members WHERE business_id = ? AND state = 'active' AND owner_generation = (SELECT COUNT(*) FROM ownership WHERE business_id = ?)",
        )
        .get(b.id, b.id) as { n: number }
    ).n;

    const attention: { kind: string; text: string; link: string }[] = [];
    for (const [a, p] of Object.entries(pending))
      attention.push({
        kind: "pending_charge",
        text: `${p.units} charge${p.units === 1 ? "" : "s"} awaiting the contract's confirmation (${a})`,
        link: `/desk/${b.id}`,
      });
    if (openCases > 0)
      attention.push({
        kind: "open_cases",
        text: `${openCases} open customer request${openCases === 1 ? "" : "s"}`,
        link: `/desk/${b.id}?view=products#desk-cases`,
      });
    // First-use review (Nov 7, findings 52 and 66): a published page that names a release the
    // product no longer runs sends customers to an offer that refuses every use.
    if (publicPageOutdated(db, b.id))
      attention.push({
        kind: "public_page_outdated",
        text: "The public page names a superseded release: republish it so customers reach the active one",
        link: `/desk/${b.id}/public`,
      });
    if (live)
      attention.push({
        kind: "sale",
        text: (live as { seller_accepted?: boolean }).seller_accepted
          ? "A sale is in progress: you accepted; waiting for the buyer"
          : "A sale is in progress: its terms wait for your acceptance",
        link: `/sales/${b.id}`,
      });
    else if (!rehearsal && rehearsable(db, b.id))
      attention.push({
        kind: "rehearsal",
        text: "No successor rehearsal yet: rehearse the handover",
        link: `/desk/${b.id}/rehearsal`,
      });

    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      tagline: b.tagline,
      role: "owner" as const,
      product:
        release?.kind === "workflow_spec"
          ? "SaaS workflow"
          : release?.kind === "analysis_spec"
            ? "Agent service"
            : release?.kind === "web_app_bundle"
              ? "Web app"
              : release
                ? "AI API"
                : null,
      release: release
        ? {
            number: release.number,
            activated_at: release.activated_at,
            digest: release.artifact_digest,
          }
        : null,
      daily,
      totals,
      credits,
      network_fees: null,
      ownership: {
        generation: obs?.generation ?? null,
        owner_account: obs?.owner ?? null,
        transfers: transfers.n,
        last_transfer_at: transfers.last,
        sale_in_progress: live !== null,
      },
      rehearsal: rehearsal ? { state: rehearsal.state, finished_at: rehearsal.finished_at } : null,
      founded_at: b.created_at,
      customers,
      not_charged_reasons: reasons,
      success_rate: tried > 0 ? Math.round((totals.delivered / tried) * 1000) / 1000 : null,
      cost_per_delivered_microcents:
        totals.delivered > 0 && totals.compute_unknown_calls === 0
          ? (BigInt(totals.compute_microcents) / BigInt(totals.delivered)).toString()
          : null,
      credits_runway_days:
        credits?.units != null && recent > 0 ? Math.floor(credits.units / recent) : null,
      cases,
      releases,
      team_members: team,
      compute: computeDetail(db, b.id, since, asOf),
      operating_costs: operatingCosts(db, b.id, since, asOf),
      ...(opts.only ? { about: b.about, clients: clients(db, b.id, since, asOf) } : {}),
      sale: live
        ? {
            state: live.state,
            buyer: live.buyer,
            price: live.price,
            escrow: live.escrow,
            seller_accepted: live.seller_accepted,
            buyer_accepted: live.buyer_accepted,
            expires_at: new Date(Number(live.expires_at_ms)).toISOString(),
            asset: snap?.treasury?.asset ?? null,
          }
        : null,
      attention,
    };
  });

  // Across businesses: only the same token adds up.
  const revenueTotals: Record<string, string> = {};
  let compute = "0";
  for (const b of businesses) {
    for (const [a, v] of Object.entries(b.totals.revenue))
      revenueTotals[a] = add(revenueTotals[a] ?? "0", v);
    compute = add(compute, b.totals.compute_microcents);
  }
  const allAssets = Object.keys(revenueTotals);
  return {
    as_of: asOf,
    period: { days, from: dayList[0], to: dayList[dayList.length - 1] },
    days: dayList,
    tokens: Object.fromEntries(allAssets.map((a) => [a, tokenMetaOf(db, "testnet", a)])),
    totals: { revenue: revenueTotals, compute_microcents: compute },
    businesses,
    definitions: DASHBOARD_DEFINITIONS,
  };
}
