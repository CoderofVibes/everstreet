// Job 003k1: the effects of a reconciled v3 sale on what already exists, through real routes:
// a listing with granted and pending evidence access (and an evidence read in flight), a saved
// import with its immutable report, and a customer's own record. Plus an unrelated business that
// must not change. The v3 evidence is the contract's own fixtures (direct-accepting then
// direct-closed); the evidence room runs on the FakeChain test double. Fictional people; local,
// in-memory data only. This shows the app's records follow the sale; it doesn't show customer
// runtime continuity or NEAR credits live.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import type { BlockRef, ViewTransport } from "../src/v3read.ts";
import { gate, type Json, world } from "./deal-world.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
const ACCEPTING = fixture("direct-accepting"); // contract fixture
const CLOSED = fixture("direct-closed"); // contract fixture
const DIGEST = "aa53a9ad33a13ba3e609344b36591db8339482e852a6044a52d1cbda5b68dda4";
const hashAt = (h: number) => `A${String(h).replace(/0/g, "z")}`.padEnd(44, "x");

class Transport implements ViewTransport {
  readonly network = "testnet";
  at: BlockRef = { height: "1000", hash: hashAt(1000) };
  views: Record<string, string> = ACCEPTING;
  async finalBlock() {
    return this.at;
  }
  async view(input: Parameters<ViewTransport["view"]>[0]) {
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    return { result: this.views[key] as string, block: input.block };
  }
  next(views: Record<string, string>) {
    const h = Number(this.at.height) + 1;
    this.at = { height: String(h), hash: hashAt(h) };
    this.views = views;
  }
}

const MANIFEST = {
  file_name: "package.json",
  content: JSON.stringify({
    name: "juniper-api",
    version: "1.0.0",
    dependencies: { hono: "4.0.0" },
  }),
};

async function scene() {
  const store = new Store(openDb(":memory:"));
  const { person: mara, token: maraToken } = store.createPerson("Mara Solis");
  const sold = store.startProject(mara, "started", "Juniper Print Studio");
  const other = store.startProject(mara, "started", "Alder Tools");
  const transport = new Transport();
  const w = world({
    store,
    v3: {
      transport,
      bindings: [
        { business_id: sold.business.id, network: "testnet", account: "juniper.biz.testnet" },
      ],
      timeoutMs: 1_000,
    },
  });
  const m = w.as(`es_session=${maraToken}`);
  // Two published businesses with payments on, each listed privately to a buying team.
  const publish = async (p: typeof sold) => {
    await m(`/api/projects/${p.id}/answers`, "PATCH", {
      audience: "Adults new to printmaking",
      outcome: "Three linocut prints",
      deliverable: "90 minutes",
      price: "$35",
      when: "Saturdays",
      where: "14 Alder Lane",
      capacity: "6",
      confirmed: true,
    });
    await m(`/api/businesses/${p.business.id}`, "PATCH", { family: "class" });
    expect((await m(`/api/businesses/${p.business.id}/publish`, "POST")).status).toBe(200);
    await m(`/api/businesses/${p.business.id}/payments/activate`, "POST", {
      refund_hours: 24,
      reserve_cents: 0,
    });
  };
  await publish(sold);
  await publish(other);
  const noah = await w.join("Noah Fenn"); // the buyer's representative
  const ana = await w.join("Ana Ruiz"); // another team, whose request is still pending
  const lena = await w.join("Lena Park"); // a customer
  const team = async (who: typeof noah, name: string) =>
    (await who("/api/acquire/buyers", "POST", { name, kind: "individual", intent: "operate" })).body
      .buyer.id as string;
  const noahTeam = await team(noah, "Fenn Holdings");
  const anaTeam = await team(ana, "Ruiz Ventures");
  const listingOf = async (p: typeof sold, invites: string[]) => {
    await m(`/api/businesses/${p.business.id}/listing`, "PATCH", { mode: "private", invites });
    return (
      store.db.prepare("SELECT id FROM listings WHERE business_id = ?").get(p.business.id) as {
        id: string;
      }
    ).id;
  };
  const listing = await listingOf(sold, [noahTeam, anaTeam]);
  const otherListing = await listingOf(other, [noahTeam]);
  const ask = async (who: typeof noah, buyer: string, l: string) =>
    (
      await who(`/api/acquire/listings/${l}/requests`, "POST", {
        buyer_id: buyer,
        categories: ["financials", "costs", "operations"],
        purpose: "Could we keep these classes running?",
        days: 7,
      })
    ).body.request.id as string;
  const granted = await ask(noah, noahTeam, listing);
  expect(
    (await m(`/api/acquire/requests/${granted}/decide`, "POST", { action: "grant" })).status,
  ).toBe(200);
  const pending = await ask(ana, anaTeam, listing);
  const otherGranted = await ask(noah, noahTeam, otherListing);
  await m(`/api/acquire/requests/${otherGranted}/decide`, "POST", { action: "grant" });
  // A saved import with its first inspection and immutable report.
  const imp = (
    await m("/api/imports", "POST", {
      idempotency_key: "import-key-0001",
      business_id: sold.business.id,
      name: "Juniper API",
      description: "Booking API for the studio",
      product_kind: "api",
      manifest: MANIFEST,
    })
  ).body;
  expect(imp.workspace.id).toBeTruthy();
  // A customer's own record with the business.
  const slug = sold.business.slug;
  expect(
    (
      await lena(`/api/public/businesses/${slug}/inquiries`, "POST", {
        kind: "question",
        message: "Is the Saturday class still on?",
      })
    ).status,
  ).toBe(201);
  // Chain accounts: Mara is the seller on the contract, Noah the buyer.
  const link = (pid: string, account: string) =>
    store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?) ON CONFLICT(owner_kind, owner_id) DO UPDATE SET account_id = excluded.account_id",
      )
      .run(pid, account, new Date().toISOString());
  link(mara.id, "founder.near");
  link(noah.id, "buyer.near");
  return {
    ...w,
    store,
    transport,
    m,
    noah,
    ana,
    lena,
    mara,
    sold,
    other,
    listing,
    otherListing,
    granted,
    pending,
    otherGranted,
    imp,
  };
}

const row = (s: Awaited<ReturnType<typeof scene>>, q: string, ...a: string[]) =>
  s.store.db.prepare(q).get(...a) as Json;

describe("003k1 a reconciled v3 sale's effects on existing records (real routes)", () => {
  it("closes the listing, revokes granted and withdraws pending access, denies an in-flight evidence read, and leaves the other business alone", async () => {
    const s = await scene();
    const bid = s.sold.business.id;
    expect((await s.m(`/api/businesses/${bid}/v3/refresh`, "POST")).body.outcome).toBe("accepted");
    const intent = (
      await s.m(`/api/businesses/${bid}/v3/intents`, "POST", {
        idempotency_key: "intent-key-0001",
        deal_seq: "1",
        version: 1,
        digest: DIGEST,
      })
    ).body.intent.id as string;
    const versions = {
      granted: row(s, "SELECT access_version AS v FROM access_requests WHERE id = ?", s.granted).v,
      pending: row(s, "SELECT access_version AS v FROM access_requests WHERE id = ?", s.pending).v,
      other: row(
        s,
        "SELECT access_version AS v, status FROM access_requests WHERE id = ?",
        s.otherGranted,
      ),
    };
    // The buyer's team reads the evidence room; the read is held inside its monthly reads.
    expect((await s.noah(`/api/acquire/rooms/${s.granted}`)).status).toBe(200);
    const held = gate();
    s.chain.periodEntered = gate();
    s.chain.periodGate = held.opened;
    const inFlight = s.noah(`/api/acquire/rooms/${s.granted}`);
    await s.chain.periodEntered.opened;
    // The contract shows the exact sale closed (contract fixture): applied while the read waits.
    s.transport.next(CLOSED);
    const r = await s.noah(`/api/businesses/${bid}/v3/intents/${intent}/reconcile`, "POST");
    expect(r.body.state).toBe("applied");
    s.chain.periodGate = null;
    held.open();
    const late = await inFlight;
    expect(late.status).not.toBe(200);
    expect(["financials", "costs", "operations"].filter((k) => k in late.body)).toEqual([]);
    // Listing closed; granted access revoked, pending withdrawn, each with a new access version.
    expect(row(s, "SELECT mode FROM listings WHERE id = ?", s.listing).mode).toBe("closed");
    expect(
      row(s, "SELECT status, access_version AS v FROM access_requests WHERE id = ?", s.granted),
    ).toEqual({
      status: "revoked",
      v: versions.granted + 1,
    });
    expect(
      row(s, "SELECT status, access_version AS v FROM access_requests WHERE id = ?", s.pending),
    ).toEqual({
      status: "withdrawn",
      v: versions.pending + 1,
    });
    expect((await s.noah(`/api/acquire/rooms/${s.granted}`)).status).not.toBe(200);
    // The other business: listing, grant and its access version unchanged.
    expect(row(s, "SELECT mode FROM listings WHERE id = ?", s.otherListing).mode).toBe("private");
    expect(
      row(
        s,
        "SELECT access_version AS v, status FROM access_requests WHERE id = ?",
        s.otherGranted,
      ),
    ).toEqual(versions.other);
    expect((await s.noah(`/api/acquire/rooms/${s.otherGranted}`)).status).toBe(200);
  });

  it("a saved import and its immutable report move to the buyer; the customer's record is unchanged", async () => {
    const s = await scene();
    const bid = s.sold.business.id;
    const wid = s.imp.workspace.id as string;
    const reportBefore = (await s.m(`/api/imports/${wid}/reports/1`)).body;
    const importBefore = row(
      s,
      "SELECT name, description, version FROM import_workspaces WHERE id = ?",
      wid,
    );
    const inquiryBefore = row(s, "SELECT * FROM inquiries WHERE business_id = ?", bid);
    const lenaSent = (await s.lena("/api/activity")).body.sent;
    expect(lenaSent).toHaveLength(1);
    expect((await s.m("/api/inbox")).body.received.map((i: Json) => i.message)).toContain(
      "Is the Saturday class still on?",
    );
    await s.m(`/api/businesses/${bid}/v3/refresh`, "POST");
    const intent = (
      await s.m(`/api/businesses/${bid}/v3/intents`, "POST", {
        idempotency_key: "intent-key-0001",
        deal_seq: "1",
        version: 1,
        digest: DIGEST,
      })
    ).body.intent.id as string;
    s.transport.next(CLOSED);
    expect(
      (await s.m(`/api/businesses/${bid}/v3/intents/${intent}/reconcile`, "POST")).body.state,
    ).toBe("applied");
    // The seller is refused the import and its report; the buyer reads the same, unchanged.
    expect((await s.m(`/api/imports/${wid}`)).status).toBe(404);
    expect((await s.m(`/api/imports/${wid}/reports/1`)).status).toBe(404);
    expect((await s.noah(`/api/imports/${wid}`)).status).toBe(200);
    expect((await s.noah(`/api/imports/${wid}/reports/1`)).body).toEqual(reportBefore);
    expect(
      row(s, "SELECT name, description, version FROM import_workspaces WHERE id = ?", wid),
    ).toEqual(importBefore);
    // The customer's own record is exactly as before, and still theirs; the owner side moved.
    expect(row(s, "SELECT * FROM inquiries WHERE business_id = ?", bid)).toEqual(inquiryBefore);
    expect((await s.lena("/api/activity")).body.sent).toEqual(lenaSent);
    expect((await s.noah("/api/inbox")).body.received.map((i: Json) => i.message)).toContain(
      "Is the Saturday class still on?",
    );
    expect((await s.m("/api/inbox")).body.received.map((i: Json) => i.message)).not.toContain(
      "Is the Saturday class still on?",
    );
  });
});
