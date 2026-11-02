// Shared fixtures for the financial tests (jobs 003f and 003f1). Fictional business, in-memory
// database, the FakeChain double (token decimals 6: 1 cent = 10,000 base units).

import { addMonths, type Month, ym } from "../src/books.ts";
import { world } from "./deal-world.ts";

/** Dollars as token base units. */
export const $ = (dollars: number) => String(BigInt(Math.round(dollars * 100)) * 10_000n);
export const NOW = ym();
export const M1 = addMonths(NOW, -1);
export const M2 = addMonths(NOW, -2);
export const M3 = addMonths(NOW, -3);
export const M4 = addMonths(NOW, -4);

/** A published business with payments on NEAR, whose account opened `startedMonthsAgo` ago. */
export async function paidBusiness(startedMonthsAgo = 4, day = 1) {
  const w = world();
  const mara = await w.join("Mara Solis");
  const p = (await mara("/api/projects", "POST", { route: "started", name: "Ledgerline Labs" }))
    .body;
  const id = p.business.id as string;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Small accounting teams",
    outcome: "Clean invoice rows",
    deliverable: "An API call",
    price: "$35",
    when: "Any time",
    where: "Online",
    capacity: "100",
    confirmed: true,
  });
  await mara(`/api/businesses/${id}`, "PATCH", { family: "software" });
  await mara(`/api/businesses/${id}/publish`, "POST");
  await mara(`/api/businesses/${id}/payments/activate`, "POST", {
    refund_hours: 24,
    reserve_cents: 0,
  });
  const account = (
    w.store.db
      .prepare(
        "SELECT account_id FROM chain_accounts WHERE owner_kind = 'business' AND owner_id = ?",
      )
      .get(id) as { account_id: string }
  ).account_id;
  const start = addMonths(NOW, -startedMonthsAgo);
  const opened = new Date(
    Date.UTC(Math.floor(start / 100), (start % 100) - 1, day, 9),
  ).toISOString();
  w.store.db
    .prepare("UPDATE chain_accounts SET created_at = ? WHERE account_id = ?")
    .run(opened, account);
  const books = async (q = "") => (await mara(`/api/businesses/${id}/books${q}`)).body;
  const month = async (m: number) =>
    ((await books()).months as Month[]).find((x) => x.yyyymm === m) as Month;
  /** Moves control to another person (and optionally back), as closed sales record it. */
  const transfer = (from: string, to: string) => {
    const gen = (
      w.store.db.prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?").get(id) as {
        n: number;
      }
    ).n;
    w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, id);
    w.store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, from, to, gen + 2, new Date().toISOString());
  };
  return { ...w, mara, id, slug: p.business.slug as string, account, books, month, transfer };
}
