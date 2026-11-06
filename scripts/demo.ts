// Step 7 (docs/design/DEMO_ACCOUNT.md): the demo. One process: it runs Delphine Marsh's 30-day
// simulated history through the real routes on a simulated clock that ends at the present, then
// serves the result with wallet sign-in through the SYNTHETIC review wallet (no real wallet, chain,
// model or network; fictional people, businesses and test tokens). Local only.
//
//   npm run web:build && npx tsx scripts/demo.ts [--minutes 120]
//   Sign in as Delphine: open http://127.0.0.1:8820/portfolio and choose the synthetic wallet.
//   Switch who the wallet signs as: POST http://127.0.0.1:8821/account/<account>.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { base58Encode } from "../server/src/customerWriter.ts";
import { AccountSignIn } from "../server/src/identity.ts";
import { forkSuccessorRunner } from "../server/src/successorRunner.ts";
import type { Json } from "../server/test/customer-world.ts";
import { labelScript } from "./lib/customerPreview.ts";
import { simulatedClock } from "./lib/demo/clock.ts";
import { simulateHistory } from "./lib/demo/history.ts";
import { ACCOUNTS, BUYER, CUSTOMERS, demoWorld, FOUNDER } from "./lib/demo/world.ts";
import { HARNESS_CSP, WALLET_SCRIPT } from "./lib/walletHarness.ts";

const HOST = "127.0.0.1";
const PORT = 8820;
const at = process.argv.indexOf("--minutes");
const minutes = at > 0 ? Number(process.argv[at + 1]) : 120;
const DAY = 86_400_000;
const DIR = "data/runtime/demo";

// 1. A fresh directory, and the simulated month ending yesterday.
if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const today = Math.floor(simulatedClock.realNow() / DAY) * DAY;
const start = today - 30 * DAY;
simulatedClock.install();
simulatedClock.begin(start);
console.log("Running 30 simulated days (fictional, synthetic chain)…");
const w = await demoWorld({ dbPath: join(DIR, "demo.db") });
const log = await simulateHistory(w, { start });
simulatedClock.realTime();
console.log(
  `  ${log.uses.length} customer requests; events: ${log.events.map((e) => `day ${e.day + 1}: ${e.what}`).join("; ")}`,
);

// 2. Sign-in through the synthetic wallet, for the demo's fictional accounts only.
const people: Record<string, string> = {
  [FOUNDER.account]: w.founderId,
  [BUYER.account]: w.noah.id,
};
for (const [i, c] of CUSTOMERS.entries()) people[c.account] = (w.customers[i] as { id: string }).id;
// A newcomer with nothing yet (fictional), for first-day walkthroughs.
const NEWCOMER = { id: "person-rosa-lind", name: "Rosa Lind", account: "rosa.near" };
w.db
  .prepare(
    "INSERT INTO people (id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
  )
  .run(NEWCOMER.id, NEWCOMER.name, new Date().toISOString());
people[NEWCOMER.account] = NEWCOMER.id;
for (const [account, person] of Object.entries(people))
  w.db
    .prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
    )
    .run(account, person, new Date().toISOString());
w.db
  .prepare("UPDATE businesses SET published_at = COALESCE(published_at, ?) WHERE owner_id = ?")
  .run(new Date().toISOString(), w.founderId);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const accountKey = `ed25519:${base58Encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32))}`;
const signIn = new AccountSignIn(w.store, {
  recipient: "everstreet.local",
  network: "testnet",
  reader: { isFullAccessKey: async (a, k) => a in people && k === accountKey },
  callbackUrl: `http://${HOST}:${PORT}/signin/return`,
});
w.state.app = w.make({
  localPreview: false,
  environment: "Demo: simulated history (fictional)",
  identity: { mode: "verified", signIn },
  wallet: { network: "testnet", available: true, harness: "Synthetic demo wallet" },
  successorRunner: forkSuccessorRunner(),
});

const controls = { account: FOUNDER.account as string | null };
const site = new Hono();
site.get("/__harness/wallet.js", (c) =>
  c.body(WALLET_SCRIPT, 200, { "content-type": "text/javascript" }),
);
site.get("/__harness/label.js", (c) =>
  c.body(
    labelScript({
      label: "Demo · simulated history",
      detail: "Fictional people and test tokens · synthetic wallet and chain",
    }),
    200,
    { "content-type": "text/javascript" },
  ),
);
site.post("/__harness/account", (c) => c.json({ accountId: controls.account }));
site.post("/__harness/disconnect", (c) => {
  controls.account = null;
  return c.json({ ok: true });
});
site.post("/__harness/sign-message", async (c) => {
  const p = (await c.req.json()) as Json;
  if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
  const { serializeNep413 } = await import("@near-wallet-selector/core");
  const bytes = serializeNep413({
    message: String(p.message),
    recipient: String(p.recipient),
    nonce: Buffer.from(String(p.nonce), "base64"),
    callbackUrl: p.callbackUrl ?? undefined,
  });
  return c.json({
    accountId: controls.account,
    publicKey: accountKey,
    signature: sign(null, createHash("sha256").update(bytes).digest(), privateKey).toString(
      "base64",
    ),
    state: p.state ?? undefined,
  });
});
site.post("/__harness/tx", async (c) => {
  const p = (await c.req.json()) as Json;
  if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
  const businesses = Object.values(ACCOUNTS) as string[];
  if (!businesses.includes(String(p.receiverId)) && p.receiverId !== "tusd.near")
    return c.json(
      { error: "The synthetic wallet only calls the demo's businesses and token." },
      400,
    );
  if (!Array.isArray(p.actions) || p.actions.length !== 1)
    return c.json({ error: "The synthetic wallet sends one action at a time." }, 400);
  const a = p.actions[0] as Json;
  try {
    const call = {
      receiverId: String(p.receiverId),
      methodName: String(a.methodName),
      args: JSON.parse(String(a.args)) as Json,
      deposit: String(a.deposit),
      gas: String(a.gas),
    };
    return c.json(w.chains.walletCall(controls.account, call));
  } catch (e) {
    return c.json({ error: `The synthetic chain refused it: ${(e as Error).message}` }, 400);
  }
});
site.all("/api/*", (c) => w.state.app.fetch(c.req.raw));
site.get("/a/*", (c) => w.state.app.fetch(c.req.raw));
site.get("/p/*", (c) => w.state.app.fetch(c.req.raw));
const dist = "web/dist";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
site.get("*", (c) => {
  if (!existsSync(dist)) return c.text("Run `npm run web:build` first.", 503);
  const path = normalize(c.req.path).replace(/^([/\\])+/, "");
  const file = join(dist, path);
  if (path && !path.includes("..") && existsSync(file) && extname(file))
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
  const html = readFileSync(join(dist, "index.html"), "utf8").replace(
    "<head>",
    '<head><script src="/__harness/label.js"></script><script src="/__harness/wallet.js"></script>',
  );
  return c.html(html, 200, { "content-security-policy": HARNESS_CSP });
});

const ctl = new Hono();
ctl.get("/", (c) => c.json({ account: controls.account, accounts: Object.keys(people), log }));
ctl.post("/account/:id", (c) => {
  const id = c.req.param("id");
  if (!(id in people)) return c.json({ error: "Not a demo account" }, 404);
  controls.account = id;
  return c.json({ account: id });
});

const app = serve({ fetch: site.fetch, port: PORT, hostname: HOST });
const control = serve({ fetch: ctl.fetch, port: PORT + 1, hostname: HOST });
console.log(`Demo (simulated history, fictional): http://${HOST}:${PORT}/portfolio`);
console.log(
  `  Signs in as ${FOUNDER.name} (${FOUNDER.account}). Controls: http://${HOST}:${PORT + 1}/`,
);
const end = () => {
  app.close();
  control.close();
  process.exit(0);
};
setTimeout(end, minutes * 60_000).unref();
process.on("SIGINT", end);
process.on("SIGTERM", end);
