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
  totals:
    "Totals add businesses only within the same token. Tokens and USD are never added together.",
};

export function dashboard(db: Db, viewer: Person, opts: { days?: number; now?: Date } = {}) {
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
      "SELECT id, name, slug, created_at FROM businesses WHERE owner_id = ? ORDER BY name LIMIT 50",
    )
    .all(viewer.id) as { id: string; name: string; slug: string; created_at: string }[];

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
          control?: { live_deal?: { seq: string; price?: string; stage?: string } | null };
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
        link: `/desk/${b.id}`,
      });
    if (live)
      attention.push({
        kind: "sale",
        text: "A sale is in progress: its terms wait for acceptance",
        link: `/sales/${b.id}`,
      });
    else if (!rehearsal)
      attention.push({
        kind: "rehearsal",
        text: "No successor rehearsal yet: rehearse the handover",
        link: `/desk/${b.id}/rehearsal`,
      });

    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
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
