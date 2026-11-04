// Job 005b: the in-memory scenario behind scripts/preview-helper.ts, kept apart from any listener so
// a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC: the real app over an in-memory database, the FakeChain contract double
// and OpenSeat's test-double authority. Mara owns Juniper Print Studio (payments on the double);
// Sam paid for a session and sent a private message (a fictional canary); Ellis is Mara's helper;
// Bea is unrelated; Ana's co-op has a deal Mara has not yet accepted (accepting it is a real close
// on the double). Controls change authority only through the app's routes or the contract double,
// labelled as such. No wallet, NEAR endpoint, provider, credentials or runtime database.

import { Hono } from "hono";
import { everstreetApi } from "../../server/src/app.ts";
import { openSeatProvider } from "../../server/src/bookings.ts";
import { openDb } from "../../server/src/db.ts";
import { Store } from "../../server/src/store.ts";
import { FakeChain } from "../../server/test/fake-chain.ts";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { labelScript } from "./customerPreview.ts";

// biome-ignore lint/suspicious/noExplicitAny: preview setup reads deep response fields
type Json = Record<string, any>;

export const HELPER_CANARY = "FICTIONAL PRIVATE CANARY: invoice integration question";
export const HELPER_CONTROLS = [
  "revoke",
  "regrant",
  "contract-revoke",
  "support-only",
  "outage",
  "restore",
  "sale",
] as const;
export type HelperControl = (typeof HELPER_CONTROLS)[number];

export async function helperPreview({ maxRequests = 2_000 } = {}) {
  const openseat = new OpenSeat({
    dbPath: ":memory:",
    authority: new TestDoubleAuthority("o.test", "o.test"),
  });
  const http = openSeatApp(openseat);
  const chain = new FakeChain();
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "preview",
    bookingProvider: openSeatProvider((p, i) => Promise.resolve(http.request(p, i))),
    chain,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const call = as((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "");
    return Object.assign(call, { id: ((await res.clone().json()) as Json).person.id as string });
  };
  const ok = (what: string, r: { status: number; body: Json }) => {
    if (r.status >= 300)
      throw new Error(`preview setup: ${what} ${r.status} ${r.body.error ?? ""}`);
    return r;
  };

  const mara = await join("Mara Solis");
  const p = ok(
    "project",
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" }),
  ).body;
  const id = p.business.id as string;
  ok(
    "answers",
    await mara(`/api/projects/${p.id}/answers`, "PATCH", {
      audience: "Adults new to printmaking",
      outcome: "Three linocut prints",
      deliverable: "90 minutes",
      price: "$35",
      when: "Saturdays",
      where: "14 Alder Lane",
      capacity: "6",
      confirmed: true,
    }),
  );
  ok("family", await mara(`/api/businesses/${id}`, "PATCH", { family: "class" }));
  ok("publish", await mara(`/api/businesses/${id}/publish`, "POST"));
  ok(
    "payments",
    await mara(`/api/businesses/${id}/payments/activate`, "POST", {
      refund_hours: 24,
      reserve_cents: 0,
    }),
  );
  ok(
    "session",
    await mara(`/api/businesses/${id}/sessions`, "POST", {
      starts_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      duration_minutes: 90,
      capacity: 6,
    }),
  );
  const slug = (
    store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(id) as {
      slug: string;
    }
  ).slug;
  const sam = await join("Sam Fictional");
  const page = ok("page", await sam(`/api/public/businesses/${slug}`)).body;
  ok(
    "pay",
    await sam(`/api/public/sessions/${page.sessions[0].id}/pay`, "POST", { source: "link" }),
  );
  ok(
    "inquiry",
    await sam(`/api/public/businesses/${slug}/inquiries`, "POST", {
      kind: "question",
      message: HELPER_CANARY,
      share_contact: true,
    }),
  );
  const ellis = await join("Ellis Grant");
  ok("appoint", await mara(`/api/businesses/${id}/team`, "POST", { person_id: ellis.id }));
  const bea = await join("Bea Fictional");

  // A buyer with a deal Mara hasn't accepted yet: the "sale" control closes it on the double.
  const ana = await join("Ana Ruiz");
  const coop = ok(
    "buyer",
    await ana("/api/acquire/buyers", "POST", {
      name: "Alder Lane Makers Co-op",
      kind: "cooperative",
      intent: "team",
    }),
  ).body.buyer.id as string;
  ok(
    "listing",
    await mara(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] }),
  );
  const listing = ok("search", await ana("/api/acquire/search", "POST", { buyer_id: coop })).body
    .results[0].listing_id as string;
  ok(
    "access request",
    await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
      buyer_id: coop,
      categories: ["financials"],
      purpose: "Could our co-op keep these classes running?",
      days: 7,
    }),
  );
  const deal = ok(
    "deal",
    await mara(`/api/businesses/${id}/deals`, "POST", {
      buyer_id: coop,
      price_cents: 300_000,
      days: 7,
      handover: "Two Saturdays teaching alongside the new owner",
    }),
  ).body.deal as { id: string; digest: string };
  ok("test dollars", await ana(`/api/deals/${deal.id}/test-dollars`, "POST"));
  ok("fund", await ana(`/api/deals/${deal.id}/fund`, "POST"));
  ok("buyer accepts", await ana(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest }));

  const realCheck = chain.operatorCheck.bind(chain);
  const ellisAccount = () =>
    (
      store.db
        .prepare(
          "SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?",
        )
        .get(ellis.id) as { account_id: string }
    ).account_id;
  const contract = () =>
    chain.businesses.values().next().value as { operators: Map<string, string[]>; owner: string };
  const owner = () =>
    (
      store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(id) as {
        owner_id: string;
      }
    ).owner_id;
  const asOwner = () => (owner() === ana.id ? ana : mara);

  let outage = false;
  const controls = {
    async run(c: HelperControl) {
      switch (c) {
        case "revoke":
          return asOwner()(`/api/businesses/${id}/team/${ellis.id}`, "DELETE");
        case "regrant":
          return asOwner()(`/api/businesses/${id}/team`, "POST", { person_id: ellis.id });
        case "contract-revoke": // labelled: changes only the contract double, not Everstreet's record
          contract().operators.delete(ellisAccount());
          return { status: 200, body: { contract_only: "revoked on the contract double" } };
        case "support-only":
          contract().operators.set(ellisAccount(), ["support"]);
          return { status: 200, body: { contract_only: "support only on the contract double" } };
        case "outage":
          outage = true;
          chain.operatorCheck = async () => {
            throw new Error("preview: the contract double is unreachable");
          };
          return { status: 200, body: { outage: true } };
        case "restore":
          outage = false;
          chain.operatorCheck = realCheck;
          return { status: 200, body: { outage: false } };
        case "sale":
          return mara(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
      }
    },
    summary() {
      const t = store.db
        .prepare("SELECT revoked_at FROM team WHERE business_id = ? AND person_id = ?")
        .get(id, ellis.id) as { revoked_at: string | null } | undefined;
      return {
        owner: owner() === ana.id ? "Ana (after the sale)" : "Mara",
        ellis_in_everstreet: t ? (t.revoked_at ? "revoked" : "active") : "never",
        ellis_on_contract: contract().operators.get(ellisAccount()) ?? [],
        outage,
        requests,
        max_requests: maxRequests,
      };
    },
  };

  const label = {
    label: "Preview only: synthetic helper access, contract double and sale",
    detail:
      "Fictional people and a fictional private message. Authority is decided by the app's routes and an in-memory contract double; controls revoke, re-grant or change only the double, labelled as such. Not testnet evidence; nothing leaves this computer.",
  };
  let requests = 0;
  const site = new Hono();
  site.get("/__preview/label.js", (c) =>
    c.body(labelScript(label), 200, { "content-type": "text/javascript" }),
  );
  site.all("/api/*", async (c) => {
    if (++requests > maxRequests)
      return c.json({ error: "Preview request ceiling reached; restart the preview" }, 503);
    return app.fetch(c.req.raw);
  });

  return {
    site,
    store,
    chain,
    controls,
    businessId: id,
    people: { mara: mara.id, ellis: ellis.id, bea: bea.id, sam: sam.id, ana: ana.id },
  };
}
