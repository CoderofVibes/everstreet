// Step 7 (docs/design/DEMO_ACCOUNT.md §2): 30 simulated days of Delphine's businesses, run through
// the real routes on the simulated clock. Each day customers use the products (some requests are
// refused and never charged) and the owner (later with a teammate) works Relaydesk's cases. Along
// the way: a checked Ledgerline update with a new offer, a Relaydesk teammate, a successor
// rehearsal, and a Direct sale of Signalwatch proposed and funded (not yet accepted). Every figure
// the dashboard shows is read back from what these flows recorded. Deterministic (seeded).

import type { Json } from "../../../server/test/customer-world.ts";
import { INVOICE_SPEC } from "../../../server/test/runtime-world.ts";
import { runSuccessorRehearsal } from "../successor/run.ts";
import { simulatedClock } from "./clock.ts";
import { BUYER, checkAndRelease, type DemoWorld, FOUNDER, offer } from "./world.ts";

const DAY = 86_400_000;

/** A small deterministic generator (mulberry32), so every run makes the same history. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INVOICES = [
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD",
  "Fictional invoice NA-4410 from Northwind AI Ops, 2026-10-01, total 48.00 USD",
  "Fictional invoice QA-88 from Quillmark API Services, total 140.00 EUR",
  "Fictional invoice MA-2026-07 from Marten Automation Co, 2026-08-19, total 300.00 USD",
];
const NOT_AN_INVOICE = "FICTIONAL. Team lunch on Friday: sandwiches and soup.";
const SUBJECTS = [
  ["Export button does nothing", "Export on the Reports page spins, then nothing.", "high"],
  ["Password reset email late", "The reset email arrives after twenty minutes.", "normal"],
  ["Invoice shows the old address", "Our new billing address isn't on the invoice.", "low"],
  ["Dashboard chart is empty", "The usage chart shows no bars for this week.", "normal"],
] as const;
const NOTES = [
  "FICTIONAL. Northbeam API v4.2\n- Added dark mode.\n- Removed the Ledger Export API endpoint /v1/export on 2026-12-01.",
  "FICTIONAL. Parcelpath SDK v3.1 release notes\n- Webhook signatures: the SHA-1 option is deprecated; verify webhooks with SHA-256.\n- Faster label printing.",
  "FICTIONAL. Quillmark v2.0 changelog\n- The /v1/convert endpoint is being removed; use /v2/convert.\n- New pricing for large files.",
];
const RELIES = "We call the Ledger Export API every night, verify webhooks and use /v1/convert.";

export interface HistoryLog {
  days: number;
  uses: { business: string; day: number; outcome: string | null; unit: string | null }[];
  events: { day: number; what: string }[];
}

export async function simulateHistory(w: DemoWorld, opts: { days?: number; start: number }) {
  const days = opts.days ?? 30;
  const rnd = random(20261105);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
  const log: HistoryLog = { days, uses: [], events: [] };
  const [cara, ines, theo, priya] = w.customers;
  if (!cara || !ines || !theo || !priya) throw new Error("customers");
  // Successor rehearsals run in-process here (the history runs in its own process already).
  w.state.app = w.make({ successorRunner: (input) => runSuccessorRehearsal(input) });
  const offers = { ...w.offers };
  let caseWorker = w.delphine;
  let teamMember: string | null = null;

  for (let day = 0; day < days; day++) {
    simulatedClock.set(opts.start + day * DAY + 9 * 3_600_000); // 09:00 each simulated day
    const tick = () => simulatedClock.advance(7 * 60_000 + Math.floor(rnd() * 40 * 60_000));

    // Customers use the products: a little more as the month goes on.
    const busy = 1 + day / days;
    const ledger = Math.round((1 + rnd() * 2) * busy);
    for (let i = 0; i < ledger; i++) {
      tick();
      const who = pick([cara, ines, theo]);
      const text = rnd() < 0.12 ? NOT_AN_INVOICE : pick(INVOICES);
      const r = await w.use(who, offers.ledgerline, text);
      log.uses.push({
        business: "ledgerline",
        day,
        outcome: r.outcome ?? r.code,
        unit: r.unit ?? null,
      });
    }
    const desk = Math.round(rnd() * 2 * busy);
    for (let i = 0; i < desk; i++) {
      tick();
      const [subject, details, urgency] = pick(SUBJECTS);
      const r = await w.use(
        pick([cara, ines, theo, priya]),
        offers.relaydesk,
        w.submission({ subject, details: `FICTIONAL. ${details}`, urgency }),
      );
      log.uses.push({
        business: "relaydesk",
        day,
        outcome: r.outcome ?? r.code,
        unit: r.unit ?? null,
      });
    }
    if (rnd() < 0.55) {
      tick();
      const r = await w.use(
        pick([cara, theo]),
        offers.signalwatch,
        w.submission({ notes: pick(NOTES), relies: RELIES }),
      );
      log.uses.push({
        business: "signalwatch",
        day,
        outcome: r.outcome ?? r.code,
        unit: r.unit ?? null,
      });
    }

    // The desk works its open cases: one step on most of them, oldest first.
    tick();
    const board = (await caseWorker(`/api/businesses/${w.business.relaydesk.id}/workflow-cases`))
      .body;
    for (const c of ((board.cases ?? []) as Json[]).filter((x) => !x.closed_at).reverse()) {
      if (rnd() < 0.35 || !c.next) continue;
      await caseWorker(
        `/api/businesses/${w.business.relaydesk.id}/workflow-cases/${c.request_id}/advance`,
        "POST",
        {
          to_stage: c.next.key,
          note: c.next.key === "resolved" ? "Fixed in today's release." : "",
        },
      );
    }

    // The month's events.
    if (day === 0) {
      // Operating costs Delphine records (USD cents; fictional): monthly ones recur.
      const costs: [keyof typeof w.business, string, number, boolean, string][] = [
        ["ledgerline", "Hosting and compute", 1200, true, "Storage for invoices"],
        ["ledgerline", "Software and tools", 900, true, "Error tracking"],
        ["relaydesk", "Software and tools", 1500, true, "Email inbox"],
        ["relaydesk", "Hosting and compute", 800, true, "Database"],
        ["signalwatch", "Online services and APIs", 1100, true, "Release-note feeds"],
        ["signalwatch", "Marketing", 2500, false, "Launch listing"],
      ];
      for (const [k, category, amount_cents, recurring, note] of costs)
        await w.delphine(`/api/businesses/${w.business[k].id}/costs`, "POST", {
          category,
          amount_cents,
          recurring,
          note,
        });
    }
    if (day === 14) {
      await w.delphine(`/api/businesses/${w.business.relaydesk.id}/costs`, "POST", {
        category: "Paid help",
        amount_cents: 6000,
        recurring: false,
        note: "Weekend cover",
      });
    }
    if (day === 8) {
      tick();
      const job = await w.rw.build(w.builder as never, w.business.ledgerline.project, {
        ...INVOICE_SPEC,
        name: "Invoice reader v2",
        instructions: "Read one invoice. Keep the currency exactly as printed.",
      });
      await checkAndRelease(w.delphine, w.business.ledgerline.project, job);
      offers.ledgerline = await offer(
        w.delphine,
        w.business.ledgerline.id,
        w.business.ledgerline.project,
        "demo-offer-ledgerline-v2",
      );
      log.events.push({ day, what: "Ledgerline v2 checked and released; new offer" });
    }
    if (day === 13) {
      tick();
      await w.delphine(`/api/businesses/${w.business.relaydesk.id}/members`, "POST", {
        account: "priya.near",
        role: "case_worker",
      });
      const inv = ((await priya("/api/me/teams")).body.invites ?? []) as Json[];
      if (inv[0]) {
        await priya(`/api/me/teams/${inv[0].id}/respond`, "POST", { accept: true });
        caseWorker = priya;
        teamMember = priya.id;
        log.events.push({ day, what: "Priya Raman joined Relaydesk's team as a case worker" });
      }
    }
    if (day === 19) {
      tick();
      const r = await w.delphine(
        `/api/businesses/${w.business.relaydesk.id}/rehearsals`,
        "POST",
        {},
      );
      if (r.status === 202) {
        for (let i = 0; i < 600; i++) {
          const l = (await w.delphine(`/api/businesses/${w.business.relaydesk.id}/rehearsals`))
            .body;
          if (l.rehearsals?.[0]?.state !== "running") break;
          await new Promise((ok) => setTimeout(ok, 20));
        }
        log.events.push({ day, what: "Relaydesk successor rehearsal" });
      }
    }
    if (day === 24) {
      tick();
      await saleOfSignalwatch(w);
      log.events.push({ day, what: "Signalwatch: Direct sale proposed to Noah Brandt and funded" });
    }
  }
  // The owner reads each contract once more at the end: credits and control as observed now.
  for (const b of Object.values(w.business))
    await w.delphine(`/api/businesses/${b.id}/v3/refresh`, "POST", {});
  void teamMember;
  return log;
}

/** The Signalwatch sale: proposed by Delphine, registered and funded by Noah; not accepted. */
async function saleOfSignalwatch(w: DemoWorld) {
  const biz = w.business.signalwatch.id;
  const act = async (who: typeof w.delphine, account: string, kind: string, input: Json = {}) => {
    const p = await who(`/api/sales/${biz}/prepare`, "POST", { kind, input });
    if (p.status !== 200) throw new Error(`sale ${kind}: ${p.status} ${JSON.stringify(p.body)}`);
    const c = await who(`/api/sales/${biz}/actions`, "POST", {
      kind,
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: `demo-sale-${kind}`,
    });
    if (c.status !== 201)
      throw new Error(`sale ${kind} action: ${c.status} ${JSON.stringify(c.body)}`);
    const action = c.body.action as Json;
    await who(`/api/sales/actions/${action.id}/requested`, "POST", {});
    const out = w.chains.walletCall(account, action.call) as Json;
    await who(`/api/sales/actions/${action.id}/requested`, "POST", {
      tx_hash: out.transaction.hash,
    });
    return who(`/api/sales/actions/${action.id}/check`, "POST", {});
  };
  await act(w.delphine, FOUNDER.account, "propose", {
    buyer_account: BUYER.account,
    price: "180000000",
    expires_in_days: 21,
    available_floor: "0",
    grants: [{ account: "meter.near", caps: 1 }],
    exclusions: ["The signalwatch.example domain and its DNS account"],
    note: "Fictional terms in a simulated history.",
  });
  // Noah holds fictional test tokens of his own.
  const c = w.chains.chains.get("signalwatch.demo.near");
  c?.balances.set(BUYER.account, 1_000_000_000n);
  await act(w.noah, BUYER.account, "register");
  await act(w.noah, BUYER.account, "fund");
}
