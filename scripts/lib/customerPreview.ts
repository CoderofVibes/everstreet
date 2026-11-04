// Job 003q: the in-memory scenario behind scripts/preview-customer.ts, kept apart from any
// listener so a test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC throughout: an in-memory database; the real app (everstreetApi) with
// the real customer-use routes; the labelled TypeScript chain double, scripted extractor and
// in-memory protection from server/test/customer-world.ts; and a preview-only signer holding the
// contract tests' synthetic seed-1 key. Nothing here is a wallet, a model or a NEAR endpoint, and
// nothing is sent anywhere. The signer and the controls exist only in this preview, never in the
// app's routes or its bundle.

import { Hono } from "hono";
import { RuntimeFailure } from "../../server/src/runtime.ts";
import type { ViewTransport } from "../../server/src/v3read.ts";
import {
  customerWorld,
  type Json,
  keyFromSeed,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";

export const PREVIEW_PUBLIC_KEY =
  "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";
const HEX32 = /^[0-9a-f]{64}$/;

/** The page-side authorizer the preview injects: unmistakably synthetic, signing in the preview. */
export const AUTHORIZER_SCRIPT = `// Preview only: a synthetic test authorizer (not a wallet). Never part of the app bundle.
window.__everstreetAuthorizer = {
  label: "Preview only: synthetic test key, not a wallet",
  synthetic: true,
  publicKey: async () => "${PREVIEW_PUBLIC_KEY}",
  sign: async (m) => {
    const r = await fetch("/__preview/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "The preview authorizer is switched off.");
    return r.json();
  },
};
`;

/** The page-side preview label (job 003s1): data only, no behaviour. JSON-encoded, so it can't break out. */
export const labelScript = (l: { label: string; detail: string }) =>
  `// Preview only: a label for the app shell. Never part of the app bundle.\nwindow.__everstreetPreview = ${JSON.stringify(l).replace(/</g, "\\u003c")};\n`;

export type LoseRoute =
  | "prepare"
  | "confirm"
  | "execute"
  | "units"
  | "offer"
  | "retire"
  | "record"
  | "reconcile";
export const LOSE_ROUTES: LoseRoute[] = [
  "prepare",
  "confirm",
  "execute",
  "units",
  "offer",
  "retire",
  "record",
  "reconcile",
];
const ROUTES: Record<LoseRoute, RegExp> = {
  prepare: /^\/api\/customer\/offers\/[^/]+\/prepare$/,
  confirm: /^\/api\/customer\/uses\/[^/]+\/confirm$/,
  execute: /^\/api\/customer\/uses\/[^/]+\/execute$/,
  units: /^\/api\/customer\/uses\/[^/]+\/units\/reconcile$/,
  // Job 003r: the owner's offer creation and retirement.
  offer: /^\/api\/businesses\/[^/]+\/customer-offers$/,
  retire: /^\/api\/businesses\/[^/]+\/customer-offers\/[^/]+\/retire$/,
  // Job 003s: recording a sale intent and reconciling it.
  record: /^\/api\/businesses\/[^/]+\/v3\/intents$/,
  reconcile: /^\/api\/businesses\/[^/]+\/v3\/intents\/[^/]+\/reconcile$/,
};

/**
 * `withOffer` (003q's quick start) creates the offer as the founder would; without it (003r) the
 * founder sets it up in the studio's Service tab. `v3Transport` (003s) serves the business's v3
 * contract views for the acquisition preview.
 */
export async function customerPreview(
  opts: {
    withOffer?: boolean;
    v3Transport?: ViewTransport;
    /** The v3 observation clock (003s1: the acquisition preview's fixture clock). */
    v3Now?: () => number;
    /** The persistent preview label (003s1), shown by the app shell on every page. */
    label?: { label: string; detail: string };
  } = {},
) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({
    customer: { protection },
    v3Transport: opts.v3Transport,
    v3Now: opts.v3Now,
  });
  const label = opts.label ?? {
    label: "Preview only: synthetic customer chain, runtime and signer",
    detail:
      "In-memory fictional data and a test key; not testnet evidence. Nothing leaves this computer.",
  };
  // The synthetic chain and the server follow this computer's clock (plus any preview offset),
  // so freshness and deadlines behave as they would; the chain only ever moves forward.
  const time = { offset: 0 };
  const sync = () => {
    w.clock.now = Date.now() + time.offset;
    const d = BigInt(w.clock.now) - w.chain.ts;
    if (d > 0n) w.chain.tick(d);
  };
  const finalBlock = w.reader.finalBlock.bind(w.reader);
  w.reader.finalBlock = async () => {
    sync();
    return finalBlock();
  };
  sync();
  // A fictional, published business with one tested release (and, for 003q's quick start, its offer).
  w.state.store.db
    .prepare("UPDATE businesses SET name = ?, slug = ?, published_at = ? WHERE id = ?")
    .run("Ledgerline Invoice Reader", "ledgerline", new Date().toISOString(), w.f.business);
  const offerId = opts.withOffer ? await w.offer() : null;
  const noah = w.person("Noah Fenn");

  const state = {
    authorizer: true,
    lose: new Set<LoseRoute>(),
  };

  /** The preview site: the app, a lost-answer interceptor, and the preview-only signer. */
  const site = new Hono();
  site.post("/__preview/sign", async (c) => {
    if (!state.authorizer)
      return c.json({ error: "The preview authorizer is switched off (a preview control)." }, 503);
    const m = (await c.req.json().catch(() => ({}))) as Json;
    if (!HEX32.test(String(m.hold_message_hex)) || !HEX32.test(String(m.use_message_hex)))
      return c.json({ error: "Two 32-byte digests are needed." }, 400);
    const sign = keyFromSeed(1);
    return c.json({
      hold_signature: sign(m.hold_message_hex),
      use_signature: sign(m.use_message_hex),
    });
  });
  site.get("/__preview/authorizer.js", (c) =>
    c.body(AUTHORIZER_SCRIPT, 200, { "content-type": "text/javascript" }),
  );
  // Job 003s1: the preview declares itself; the shell shows this on every page.
  site.get("/__preview/label.js", (c) =>
    c.body(labelScript(label), 200, { "content-type": "text/javascript" }),
  );
  site.all("/api/*", async (c) => {
    sync();
    const res = await w.state.app.fetch(c.req.raw);
    const hit = (Object.keys(ROUTES) as LoseRoute[]).find(
      (k) => state.lose.has(k) && c.req.method === "POST" && ROUTES[k].test(c.req.path),
    );
    if (hit && res.ok) {
      state.lose.delete(hit);
      // The server acted; only its answer is lost on the way back.
      return c.json({ error: "Preview: the answer was lost on the way back." }, 502);
    }
    return res;
  });

  const controls = {
    lose: (r: LoseRoute) => state.lose.add(r),
    storageFails: () => {
      protection.failProtect = 1;
    },
    expireHold: () => {
      time.offset += 11 * 60_000;
      sync();
    },
    revokeKey: () => w.chain.revoke(0),
    /** The next run fails at the provider (once); the original script returns after it. */
    providerFails: () => {
      const original = w.provider.script;
      w.provider.script = async () => {
        w.provider.script = original;
        throw new RuntimeFailure("Preview: provider failure", "provider_error", null);
      };
    },
    authorizer: (on: boolean) => {
      state.authorizer = on;
    },
    /** Job 003r: the synthetic plan's price changes (a reviewed offer must then be reviewed again). */
    planPrice: (unitPrice: string) => {
      if (!/^[1-9][0-9]{0,20}$/.test(unitPrice)) throw new Error("a base-unit amount");
      w.chain.plan = { ...w.chain.plan, unit_price: unitPrice };
    },
    /** Job 003r: the next contract read fails (an unreachable endpoint), once. */
    readFails: () => {
      w.reader.failNext = 1;
    },
    /** A completed sale: Ava's business moves to Noah; the platform keeps metering (regranted). */
    sale: () => {
      w.rw.transfer(w.f.business, w.f.ava.id, noah.id);
      w.chain.afterSale();
      w.chain.reappointPlatform();
    },
    summary: () => ({
      entitlement: {
        free: w.chain.ent()?.free,
        consumed: w.chain.ent()?.consumed,
        hold_active: w.chain.ent()?.hold_active,
      },
      owner: (
        w.state.store.db
          .prepare("SELECT owner_id FROM businesses WHERE id = ?")
          .get(w.f.business) as {
          owner_id: string;
        }
      ).owner_id,
      provider_calls: w.provider.calls.length,
      settle_calls: w.writer.settleCalls,
      authorizer: state.authorizer,
      lose_next: [...state.lose],
      plan_unit_price: w.chain.plan.unit_price,
      offers: w.state.store.db
        .prepare(
          "SELECT id, state, plan_id, retention_days FROM customer_offers ORDER BY created_at",
        )
        .all(),
    }),
  };

  return {
    site,
    w,
    offerId,
    projectId: w.f.project,
    people: { cara: w.cara.id, ava: w.f.ava.id, noah: noah.id },
    controls,
  };
}
