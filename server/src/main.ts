// Runs Everstreet on this computer: the API plus the built web app on one port.
//   npm run app        builds the web app, then serves http://localhost:8800
//   npm run serve      serves without rebuilding
//
// OpenSeat, the booking service class businesses use, runs beside it as its own service with
// its own database at /svc/openseat. Everstreet reaches it only through OpenSeat's HTTP API.
// Its waitlist worker promotes people only after the OpenSeat business contract on NEAR
// testnet says the worker is authorized (docs/AUTHORITY.md); without network or the worker's
// key, promotions wait and the waitlist stays truthful.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { NearRpcAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { PromotionWorker } from "../../services/openseat/src/worker.ts";
import { parseAiConfig } from "./ai-config.ts";
import { AnthropicProvider, httpsTransport } from "./anthropic.ts";
import { everstreetApi } from "./app.ts";
import { openSeatProvider } from "./bookings.ts";
import { Builds, startBuildWorker } from "./builds.ts";
import { NearChain } from "./chain.ts";
import { openDb } from "./db.ts";
import { Evaluations } from "./evaluations.ts";
import { ManagedRuntime } from "./invocations.ts";
import { AnthropicRuntime } from "./runtime.ts";
import { fictionalSourceOptions } from "./sourceConnect.ts";
import { Store } from "./store.ts";
import { forkSuccessorRunner } from "./successorRunner.ts";

const port = Number(process.env.PORT ?? 8800);
mkdirSync("data/runtime", { recursive: true });
const store = new Store(openDb(process.env.EVERSTREET_DB ?? "data/runtime/everstreet.db"));

// ---------- OpenSeat beside Everstreet ----------

const testnet = existsSync("config/testnet.json")
  ? (JSON.parse(readFileSync("config/testnet.json", "utf8")) as {
      business: string;
      rpc: string;
      workerB: string;
    })
  : {
      business: "openseat.everstreet.testnet",
      rpc: "https://test.rpc.fastnear.com",
      workerB: "worker-b.everstreet.testnet",
    };
const authority = new NearRpcAuthority(
  "testnet",
  testnet.business,
  process.env.NEAR_RPC ?? testnet.rpc,
);
const openseat = new OpenSeat({
  dbPath: process.env.OPENSEAT_DB ?? "data/runtime/openseat.db",
  authority,
});
const openseatHttp = openSeatApp(openseat);
const provider = openSeatProvider((path, init) =>
  Promise.resolve(openseatHttp.request(path, init)),
);

function workerKey(accountId: string) {
  for (const dir of [
    ".near-credentials/testnet",
    join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".near-credentials/testnet"),
  ]) {
    const file = join(dir, `${accountId}.json`);
    if (existsSync(file)) {
      const k = JSON.parse(readFileSync(file, "utf8")) as {
        private_key?: string;
        secret_key?: string;
      };
      return k.private_key ?? k.secret_key ?? null;
    }
  }
  return null;
}

const workerAccount = process.env.OPENSEAT_WORKER ?? testnet.workerB;
const secret = workerKey(workerAccount);
const status = {
  business: testnet.business,
  network: "testnet",
  worker: workerAccount,
  worker_key_present: Boolean(secret),
  authorized: false as boolean,
  generation: null as number | null,
  reason: secret ? "not checked yet" : "the worker's key is not on this computer",
  last_checked: null as string | null,
  promotions: 0,
};
const worker = secret
  ? new PromotionWorker(openseat, { accountId: workerAccount, secretKey: secret }, 0)
  : null;

async function tick() {
  if (!worker) return;
  try {
    const check = await authority.operatorCheck(workerAccount, "fulfillment");
    Object.assign(status, {
      authorized: check.authorized,
      generation: check.generation,
      reason: check.reason,
      last_checked: new Date().toISOString(),
    });
    worker.generation = check.generation;
    if (!check.authorized || openseat.pendingJobs().length === 0) return;
    const results = await worker.drain();
    status.promotions += results.filter((r) => r.outcome.accepted).length;
  } catch (error) {
    Object.assign(status, {
      reason: `NEAR testnet not reachable: ${(error as Error).message}`,
      last_checked: new Date().toISOString(),
    });
  }
}
setInterval(tick, 8000);
tick();

// ---------- the app ----------

// Payments: real NEAR testnet accounts and the v2 contract, when this computer has the root key.
const chain = NearChain.fromLocalConfig();

// AI drafting: only with an explicit configuration file and the platform's own key (see
// server/src/ai-config.ts). Nothing else is searched for, and no value is printed.
const aiFile = process.env.EVERSTREET_AI_CONFIG;
let aiText: string | null = null;
if (aiFile) {
  try {
    aiText = readFileSync(aiFile, "utf8");
  } catch {
    aiText = "";
  }
}
const ai = parseAiConfig(aiText, process.env.ANTHROPIC_API_KEY);
const buildProvider = ai.ok ? new AnthropicProvider(ai.config, httpsTransport(ai.apiKey)) : null;
const builds = new Builds(store.db, store, buildProvider, {
  operatorCeilingCents: ai.ok ? ai.config.operatorCeilingCents : null,
});
if (buildProvider) startBuildWorker(builds, buildProvider);
// Running products (job 002c): the same pinned model and transport, a separate ceiling and
// ledger. Anything left running by a previous process is marked unknown, never re-run.
const runtime = new ManagedRuntime(
  store.db,
  store,
  ai.ok ? new AnthropicRuntime(ai.config, httpsTransport(ai.apiKey)) : null,
  { ceilingCents: ai.ok ? ai.config.runtimeCeilingCents : null },
);
runtime.recover();
new Evaluations(store.db, store, runtime).recover();

const app = new Hono();
app.route("/svc/openseat", openseatHttp);
app.get("/api/system", (c) =>
  c.json({
    bookings: { provider: "OpenSeat", runs: "beside Everstreet, own database", waitlist: status },
    payments: chain
      ? {
          network: chain.network,
          token: chain.token,
          note: "Local preview keeps people's testnet keys on this computer",
        }
      : {
          network: null,
          note: "No testnet root key on this computer: priced sessions book without payment",
        },
  }),
);
app.route(
  "/",
  everstreetApi(store, {
    localPreview: true,
    environment: "Local preview",
    bookingProvider: provider,
    chain,
    buildProvider,
    builds,
    runtime,
    // Job 004b: the labelled fictional source fixture (no real account or network).
    importSources: fictionalSourceOptions(),
    // 006c: successor rehearsals in a separate synthetic child (never this database).
    successorRunner: forkSuccessorRunner(),
  }),
);

const dist = "web/dist";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
app.get("*", (c) => {
  if (!existsSync(dist)) return c.text("Run `npm run app` to build the web app first.", 503);
  const path = normalize(c.req.path).replace(/^([/\\])+/, "");
  const file = join(dist, path);
  if (path && !path.includes("..") && existsSync(file) && extname(file)) {
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
  }
  return c.html(readFileSync(join(dist, "index.html"), "utf8"));
});

serve({ fetch: app.fetch, port });
console.log(`Everstreet is running: http://localhost:${port}`);
console.log(
  ai.ok
    ? `AI drafting: ${ai.config.model.model}, config ${ai.config.configVersion}, operator ceiling set`
    : `AI drafting off: ${ai.reason}`,
);
console.log(
  worker
    ? `Waitlist promotions: ${workerAccount}, checked against ${testnet.business} on NEAR testnet`
    : `Waitlist promotions paused: no key for ${workerAccount} on this computer`,
);
