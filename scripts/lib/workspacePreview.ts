// Job 001h: the in-memory scenario behind scripts/preview-workspace.ts: the operations preview
// (fictional customer uses recorded THIS month by the app's own routes; earlier months are recorded
// zeros for uses) plus, so the operating workspace shows several months and products:
//   - founder costs entered through the app's own cost route in the five earlier months;
//   - fictional example revenue history for those months, stored as seeded history, which every
//     books screen labels "Fictional example history" and never joins to observed months;
//   - a second product of the same business, brief only (never built or released);
//   - the released product's draft brief renamed, so the released name and the draft differ;
//   - a second digital business with no product at all (the empty state).
// No customer use is backdated. FICTIONAL and SYNTHETIC throughout; nothing leaves this computer.

import { Hono } from "hono";
import { addMonths, ym } from "../../server/src/books.ts";
import type { Json } from "../../server/test/customer-world.ts";
import { FIXTURE_START_MS } from "./acquisitionPreview.ts";
import { operationsPreview } from "./operationsPreview.ts";

/** Five earlier months of fictional founder costs (cents) and example history (cents). */
const EARLIER = [
  { ago: 5, hosting: 1_800, tools: 900, history: 4_200 },
  { ago: 4, hosting: 1_800, tools: 900, history: 6_100 },
  { ago: 3, hosting: 2_400, tools: 900, history: 7_350 },
  { ago: 2, hosting: 2_400, tools: 1_200, history: 9_800 },
  { ago: 1, hosting: 2_600, tools: 1_200, history: 11_250 },
] as const;

export async function workspacePreview() {
  const p = await operationsPreview({
    label: {
      label: "Preview only: synthetic customers, runtime, costs, history and sale evidence",
      detail: `Fictional customer uses recorded by the app's own routes this month; earlier months have no customer uses (recorded zeros). Earlier months' revenue is fictional example history (labelled so in the books) and their costs were entered through the app as fictional founder costs. Sale views are the contract tests' fixtures, read on a fixture clock that started at ${new Date(FIXTURE_START_MS).toISOString()}. Not testnet or production evidence; nothing leaves this computer.`,
    },
  });
  const { w } = p;
  const db = w.state.store.db;
  const ok = (what: string, r: { status: number; body: Json }) => {
    if (r.status >= 300)
      throw new Error(`preview setup: ${what} ${r.status} ${r.body.error ?? ""}`);
    return r;
  };
  const biz = `/api/businesses/${p.businessId}`;

  for (const m of EARLIER) {
    const yyyymm = addMonths(ym(), -m.ago);
    for (const [category, amount] of [
      ["Hosting and compute", m.hosting],
      ["Software and tools", m.tools],
    ] as const)
      ok(
        "cost",
        await w.owner(`${biz}/costs`, "POST", {
          category,
          amount_cents: amount,
          recurring: false,
          yyyymm,
          note: "Fictional preview cost",
        }),
      );
    db.prepare(
      "INSERT OR IGNORE INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, ?)",
    ).run(p.businessId, yyyymm, m.history, "Fictional example history (preview)");
  }

  // A second product of the same business: a saved brief only.
  const second = ok(
    "second product",
    await w.owner("/api/product-projects", "POST", {
      idea: "Turn fictional receipts into expense rows",
      foundation: "ai_api",
      name: "Receipt rows",
      business_id: p.businessId,
    }),
  ).body.project as { id: string };

  // The released product's draft brief renamed: the release keeps its own name.
  const v = ok("project", await w.owner(`/api/product-projects/${w.f.project}`)).body;
  ok(
    "rename draft",
    await w.owner(`/api/product-projects/${w.f.project}/revisions`, "POST", {
      base_revision: v.head.number,
      brief: { ...v.head.brief, name: "Ledgerline Rows (draft)" },
      prototype: v.head.prototype,
      note: "Preview: a draft name that differs from the release",
    }),
  );

  // A second digital business with nothing yet (the empty state).
  const empty = ok(
    "empty business",
    await w.owner("/api/projects", "POST", { route: "started", name: "Quiet Ledger Tools" }),
  ).body.business.id as string;
  ok("empty family", await w.owner(`/api/businesses/${empty}`, "PATCH", { family: "software" }));

  // Job 001h1: the next books read (any period) fails once, with a labelled answer; for Astra's
  // browser repeat of a failed refresh. Only that one response changes; nothing else is touched.
  // Bounded: at most `maxRequests` API requests pass, then every further one is refused.
  const maxRequests = 2_000;
  let requests = 0;
  let failNext: 503 | 404 | null = null;
  let failed = 0;
  const site = new Hono();
  site.use("/api/*", async (c, next) => {
    if (++requests > maxRequests)
      return c.json({ error: "Preview request ceiling reached; restart the preview" }, 503);
    if (
      failNext !== null &&
      c.req.method === "GET" &&
      /^\/api\/businesses\/[^/]+\/books$/.test(c.req.path)
    ) {
      const status = failNext;
      failNext = null;
      failed++;
      return c.json(
        { error: `Preview: this books read was made to fail once (${status})` },
        status,
      );
    }
    await next();
  });
  site.route("/", p.site);

  return {
    ...p,
    site,
    controls: {
      ...p.controls,
      /** The next books read fails once (503: unavailable; 404: as if access were gone). */
      failBooks(status: 503 | 404) {
        failNext = status;
        return { fail_next_books: status };
      },
      summary: () => ({
        ...p.controls.summary(),
        books_fail_next: failNext,
        books_failed: failed,
        requests,
        max_requests: maxRequests,
      }),
    },
    projects: { released: w.f.project, briefOnly: second.id },
    businesses: { main: p.businessId, empty },
    earlierMonths: EARLIER.length,
  };
}
