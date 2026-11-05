// Job 003wf2 brief item 8 (Astra's DirectSaleBrowserReview 23:32 / 23:49): the Direct sale review
// harness over the CONFIGURED COMPOSITION. Unlike scripts/lib/saleHarness.ts (saleWorld →
// customerWorld.make → createApp with injected fixtures), the application here is the NORMAL ENTRY
// in its own child process: server/test/entryChild.ts → server/src/serve.ts runServer →
// server/src/compose.ts composeApplication, from a validated `configured` config file, with the
// configured adapters (verified NEP-413 sign-in over RPC access keys, TestnetCustomerRpcTransport,
// v3 observation and reconciliation, the real customer writer signing open/settle/release, the real
// AnthropicRuntime, protected storage, background maintenance with its lease) and its own static
// web serving (`web_dist`). Only its two network transports are injected, both labelled, and both
// are answered HERE over IPC, exactly as the accepted 003wf1 lifecycle tests do:
//   - RPC: SyntheticRpc (server/test/lifecycleWorld.ts) over ONE contract-anchored synthetic
//     customer+sale state (FixtureChain + SaleChain);
//   - model HTTP: SyntheticModel (fictional answers with usage; no provider is ever called).
// The wallet is the synthetic Wallet Selector MODULE (walletHarness.ts WALLET_SCRIPT), shown as
// such through the composition's own `walletHarness` dependency; its transactions are applied to
// the same synthetic state by the contract's encoded rules. The page reaches the composition
// through this harness's front listener, which adds only the module and label scripts and the
// harness CSP to the composition's own HTML, and serves the wallet module's `/__harness/*` calls.
//
// Bootstrap prerequisites (lifecycleWorld.ts `bootstrap`, then the sale half): a disposable
// directory with the SQLite database, protected-store root and ephemeral key, an AI config with a
// fictional key variable, the metering operator's ephemeral key file; the founder (Ava), a release
// evaluated on the real runtime over the synthetic model, Cara's customer offer and her 100
// prepaid uses with a key ALREADY installed by the fixture (no enrollment or revocation happens
// here); the sale double attached with Ava as owner; Noah, the buyer, linked to his account and
// holding fictional test tokens. Customer use, reservations, executions, settlements, sale
// actions, reconciliation and ownership changes then happen in the child, through its routes.
//
// Not connected: no real wallet, account, RPC, model provider, chain or deployment; the isolated
// worker engine stays off (the composition reports "Isolated logic checks" unavailable) and no
// worker host is started. Fictional people and accounts, ephemeral keys. Bounded: one child with a
// heap limit, a hard deadline, and a stop that ends admission, drains, closes, then removes the
// directory.

import { type ChildProcess, fork } from "node:child_process";
import { sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { openDb } from "../../server/src/db.ts";
import { nep413Digest } from "../../server/src/identity.ts";
import { CUSTOMER, type Json, TOKEN } from "../../server/test/customer-world.ts";
import {
  API_KEY_ENV,
  BIZ,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  nearKey,
  signInAs,
} from "../../server/test/lifecycleWorld.ts";
import { labelScript } from "./customerPreview.ts";
import { HARNESS_CSP, HARNESS_LABEL, WALLET_SCRIPT, walletHistory } from "./walletHarness.ts";

export { HARNESS_CSP, HARNESS_LABEL };
/** Fictional accounts: Ava (seller), Noah (buyer), Cara (customer). */
export const CONFIGURED_SELLER = FOUNDER;
export const CONFIGURED_BUYER = "noah-buyer.near";
export const CONFIGURED_CUSTOMER = CUSTOMER;
const ACCOUNTS = [CONFIGURED_SELLER, CONFIGURED_BUYER, CONFIGURED_CUSTOMER] as const;
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

/**
 * The harness's own HTTP, to its loopback child only (captured at load, so a page test that stubs
 * the page's fetch never changes it). Anything but 127.0.0.1 is refused.
 */
const nodeFetch = globalThis.fetch;
const loopback: typeof fetch = (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== "127.0.0.1") throw new Error(`refused: not loopback (${url.origin})`);
  return nodeFetch(url, init);
};

export const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });

export interface ConfiguredSaleOptions {
  sitePort: number;
  controlPort: number;
  /** The built web app (default web/dist). */
  dist?: string;
  /** The child's V8 heap limit, MB (default 384). */
  heapMb?: number;
  /** Background maintenance pass interval (default 15 s). */
  maintenanceIntervalMs?: number;
}

export async function startConfiguredSaleHarness(o: ConfiguredSaleOptions) {
  const HOST = "127.0.0.1";
  const origin = `http://${HOST}:${o.sitePort}`;
  const dir = mkdtempSync(join(tmpdir(), "everstreet-sale-configured-"));
  const removeDir = () =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  let proc: ChildProcess | null = null;
  try {
    const appPort = await freePort();
    // ---- Bootstrap prerequisites (the accepted 003wf1 bootstrap, then the sale half) ----
    const b = await bootstrap(dir, appPort, {
      interval_ms: o.maintenanceIntervalMs ?? 15_000,
      batch: 5,
      pass_budget_ms: 3_000,
      op_deadline_ms: 2_000,
      stop_timeout_ms: 5_000,
    });
    const sale = b.w.chain.attachSale({ owner: FOUNDER });
    b.w.chain.balances.set(CONFIGURED_BUYER, 1_000_000_000n); // Noah's fictional test tokens
    const db = openDb(b.db);
    try {
      const t = new Date().toISOString();
      db.prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
      ).run(b.w.f.ava.id, FOUNDER, t);
      db.prepare(
        "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES ('person-noah', 'Noah Brandt', '', '', ?)",
      ).run(t);
      db.prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, 'person-noah', 'testnet', ?)",
      ).run(CONFIGURED_BUYER, t);
      db.prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', 'person-noah', ?, NULL, 'fixture', ?)",
      ).run(CONFIGURED_BUYER, t);
      db.prepare("UPDATE businesses SET name = ?, slug = ?, published_at = ? WHERE id = ?").run(
        "Ledgerline Invoice Reader",
        "ledgerline",
        t,
        b.w.f.business,
      );
    } finally {
      db.close();
    }
    // Each fictional account's ephemeral full-access key (the synthetic RPC vouches for it).
    const noahKey = nearKey();
    b.rpc.keys.set(`${CONFIGURED_BUYER}|${noahKey.id}`, 0n);
    const keys: Record<string, ReturnType<typeof nearKey>> = {
      [FOUNDER]: b.ava,
      [CONFIGURED_BUYER]: noahKey,
      [CUSTOMER]: b.cara,
    };
    // The configured config, plus the composition's own static serving and the return origin
    // (this harness's site), so wallet sign-in in the browser is available.
    const config = JSON.parse(readFileSync(b.configFile, "utf8")) as Json;
    config.web_dist = resolve(o.dist ?? "web/dist");
    config.sign_in = { ...config.sign_in, return_origin: origin };
    writeFileSync(b.configFile, JSON.stringify(config));

    // ---- The normal entry, in its own bounded child process ----
    const controls = {
      account: FOUNDER as string | null,
      cancelNext: false,
      loseNext: false,
      delayNextMs: 0,
      rpcDown: false,
      sent: [] as Json[],
    };
    const env: NodeJS.ProcessEnv = {
      // Only what node needs to start, plus the two named variables; nothing else is passed.
      ...Object.fromEntries(
        ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]
          .filter((k) => process.env[k] !== undefined)
          .map((k) => [k, process.env[k]]),
      ),
      [API_KEY_ENV]: FICTIONAL_KEY,
      ENTRY_WALLET_HARNESS_LABEL: HARNESS_LABEL,
    };
    const child = fork(join("server", "test", "entryChild.ts"), [b.configFile], {
      execArgv: ["--import", "tsx", `--max-old-space-size=${o.heapMb ?? 384}`],
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    proc = child;
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on(
      "message",
      (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
        if (m?.type !== "fetch") return;
        void (async () => {
          const r =
            m.channel === "rpc"
              ? controls.rpcDown
                ? { status: 503, body: "synthetic: the RPC endpoint is down (harness control)" }
                : { status: 200, body: await b.rpc.answer(String(m.body)) }
              : await b.model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
          if (child.connected) child.send({ type: "reply", id: m.id, ...r });
        })().catch(() => {});
      },
    );
    let exitCode: number | null | undefined;
    const exited = new Promise<number | null>((r) =>
      child.once("exit", (code) => {
        exitCode = code;
        r(code);
      }),
    );
    for (let i = 0; i < 600 && !out.includes("listening on"); i++) {
      if (exitCode !== undefined) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!out.includes("listening on"))
      throw new Error(`the configured application didn't start: ${out.slice(-800)}`);
    const app = `http://${HOST}:${appPort}`;

    // ---- The synthetic wallet module's calls (same origin as the page) ----
    const late = async () => {
      const ms = Math.min(Math.max(controls.delayNextMs, 0), 30_000);
      controls.delayNextMs = 0;
      if (ms) await new Promise((r) => setTimeout(r, ms));
    };
    const site = new Hono();
    site.get("/__harness/wallet.js", (c) =>
      c.body(WALLET_SCRIPT, 200, { "content-type": "text/javascript" }),
    );
    site.get("/__harness/label.js", (c) =>
      c.body(
        labelScript({
          label: `Review harness: ${HARNESS_LABEL}, configured composition over a synthetic chain`,
          detail:
            "The normal entry and configured composition; fictional people, ephemeral keys, a synthetic RPC and wallet. Not a wallet or testnet evidence. The page may connect only to this harness.",
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
      await late();
      if (controls.cancelNext) {
        controls.cancelNext = false;
        return c.json({ error: "User closed the window" }, 400);
      }
      const p = (await c.req.json()) as Json;
      const key = controls.account ? keys[controls.account] : undefined;
      if (!controls.account || !key)
        return c.json({ error: "The synthetic wallet has no account." }, 400);
      const digest = nep413Digest({
        message: String(p.message),
        recipient: String(p.recipient),
        nonce: Buffer.from(String(p.nonce), "base64"),
        callbackUrl: p.callbackUrl ?? null,
      });
      return c.json({
        accountId: controls.account,
        publicKey: key.id,
        signature: sign(null, digest, key.privateKey).toString("base64"),
        state: p.state ?? undefined,
      });
    });
    site.post("/__harness/tx", async (c) => {
      await late();
      if (controls.cancelNext) {
        controls.cancelNext = false;
        return c.json({ error: "User closed the window" }, 400);
      }
      const p = (await c.req.json()) as Json;
      if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
      // Only the fictional business and its token; one action at a time; nothing else is callable.
      if (p.receiverId !== BIZ && p.receiverId !== TOKEN)
        return c.json(
          { error: "The synthetic wallet only calls the fictional business and its token." },
          400,
        );
      if (!Array.isArray(p.actions) || p.actions.length !== 1)
        return c.json({ error: "The synthetic wallet sends one action at a time." }, 400);
      const a = p.actions[0] as Json;
      let args: Json;
      try {
        args = JSON.parse(String(a.args)) as Json;
      } catch {
        return c.json({ error: "The synthetic wallet refused malformed arguments." }, 400);
      }
      const call = {
        receiverId: String(p.receiverId),
        methodName: String(a.methodName),
        args,
        deposit: String(a.deposit),
        gas: String(a.gas),
      };
      const supported =
        (call.receiverId === BIZ &&
          (/_guarded$/.test(call.methodName) || call.methodName === "accept_sale")) ||
        (call.receiverId === TOKEN &&
          (call.methodName === "ft_transfer_call" || call.methodName === "storage_deposit"));
      if (!supported)
        return c.json({ error: "The synthetic wallet only sends the sale's own requests." }, 400);
      controls.sent.push({ signer: controls.account, ...call });
      let outcome: Json;
      try {
        outcome = b.w.chain.walletCall(controls.account, call as never);
      } catch (e) {
        return c.json({ error: `The synthetic chain refused it: ${(e as Error).message}` }, 400);
      }
      if (controls.loseNext) {
        controls.loseNext = false;
        return c.json({ error: "Synthetic: the wallet's answer was lost." }, 502);
      }
      return c.json(outcome);
    });
    // ---- Everything else: the configured composition itself (its API and its static app) ----
    const DROP = ["host", "connection", "content-length", "accept-encoding", "keep-alive"];
    site.all("*", async (c) => {
      const url = new URL(c.req.url);
      const headers = new Headers(c.req.raw.headers);
      for (const h of DROP) headers.delete(h);
      const method = c.req.method;
      const r = await loopback(`${app}${url.pathname}${url.search}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer(),
        redirect: "manual",
      });
      const h = new Headers(r.headers);
      for (const x of ["content-encoding", "content-length", "transfer-encoding", "connection"])
        h.delete(x);
      if ((r.headers.get("content-type") ?? "").startsWith("text/html")) {
        // The composition's own page, with only the harness's label and wallet module added.
        const html = (await r.text()).replace(
          "<head>",
          '<head><script src="/__harness/label.js"></script><script src="/__harness/wallet.js"></script>',
        );
        h.set("content-security-policy", HARNESS_CSP);
        return new Response(html, { status: r.status, headers: h });
      }
      return new Response(r.body, { status: r.status, headers: h });
    });

    // ---- Cara, through the composition's real verified routes (her fixture key; no enrollment) ----
    const caraJar = new Map<string, string>();
    const cara = async (path: string, method = "GET", body?: unknown) => {
      const cookie = [...caraJar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await loopback(`${app}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const set of res.headers.getSetCookie()) {
        const [pair, ...attrs] = set.split(";");
        const [name, ...rest] = (pair as string).split("=");
        if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
          caraJar.delete(name as string);
        else caraJar.set(name as string, rest.join("="));
      }
      return { status: res.status, body: (await res.json().catch(() => null)) as Json };
    };
    let uses = 0;
    /** One customer use by Cara: prepare, confirm (the real writer opens the hold), execute. */
    const customerUse = async () => {
      if (caraJar.size === 0) await signInAs(cara, CUSTOMER, b.cara);
      const prep = await cara(`/api/customer/offers/${b.offer}/prepare`, "POST", {
        idempotency_key: `configured-harness-use-${String(++uses).padStart(4, "0")}`,
        input: INVOICE,
      });
      if (prep.status !== 201)
        return { status: prep.status, code: prep.body?.code ?? null, use: null };
      const id = prep.body.use.id as string;
      const conf = await cara(
        `/api/customer/uses/${id}/confirm`,
        "POST",
        b.w.signed(prep.body.use.envelope),
      );
      const x = await cara(`/api/customer/uses/${id}/execute`, "POST", {});
      return {
        status: 201,
        code: null,
        use: id,
        reserved: conf.body?.use?.state ?? null,
        fulfilled: x.body?.use?.execution?.fulfilled ?? null,
        note: "Settlement is left to the composition's background maintenance (or the use's own reconcile route).",
      };
    };

    // ---- Listeners and the bounded stop ----
    const siteServer = serve({ fetch: site.fetch, port: o.sitePort, hostname: HOST });
    const controlServer = serve({
      fetch: configuredSaleControl({
        b,
        sale,
        controls,
        app,
        customerUse,
        accounts: ACCOUNTS,
      }).fetch,
      port: o.controlPort,
      hostname: HOST,
    });
    let stopping: Promise<{ childExit: number | null; forcedKill: boolean }> | null = null;
    const close = (s: { close: (cb?: () => void) => unknown }) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, 2_000);
        s.close(() => {
          clearTimeout(t);
          r();
        });
        (s as { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    const stop = () =>
      (stopping ??= (async () => {
        await Promise.all([close(siteServer), close(controlServer)]);
        let forcedKill = false;
        if (exitCode === undefined) {
          if (child.connected) child.send({ type: "shutdown" });
          const t = setTimeout(() => {
            forcedKill = true;
            child.kill("SIGKILL");
          }, 15_000);
          await exited;
          clearTimeout(t);
        }
        removeDir();
        return { childExit: exitCode ?? null, forcedKill };
      })());
    return {
      origin,
      control: `http://${HOST}:${o.controlPort}`,
      app,
      dir,
      b,
      sale,
      controls,
      keys,
      business: b.w.f.business as string,
      out: () => out,
      stop,
    };
  } catch (e) {
    if (proc && proc.exitCode === null) proc.kill("SIGKILL");
    removeDir();
    throw e;
  }
}

export type ConfiguredSaleHarness = Awaited<ReturnType<typeof startConfiguredSaleHarness>>;

/** The control listener (a SEPARATE origin; no control route exists in the application). */
function configuredSaleControl(h: {
  b: Awaited<ReturnType<typeof bootstrap>>;
  sale: NonNullable<Awaited<ReturnType<typeof bootstrap>>["w"]["chain"]["sale"]>;
  controls: {
    account: string | null;
    cancelNext: boolean;
    loseNext: boolean;
    delayNextMs: number;
    rpcDown: boolean;
    sent: Json[];
  };
  app: string;
  customerUse: () => Promise<unknown>;
  accounts: readonly string[];
}) {
  const { b, sale, controls } = h;
  const control = new Hono();
  control.get("/", async (c) => {
    const caps = await loopback(`${h.app}/api/system/capabilities`)
      .then((r) => r.json())
      .catch(() => null);
    return c.json({
      composition:
        "normal entry (serve.ts runServer → composeApplication), configured mode, in a child process",
      controls,
      business: b.w.f.business,
      sale_page: `/sales/${b.w.f.business}`,
      contract: sale.controlView(),
      treasury: sale.treasuryView(),
      capabilities: caps,
    });
  });
  control.get("/history", (c) => {
    const account = c.req.query("account");
    const all = walletHistory(b.w.chain.txs as Map<string, Json>);
    return c.json({
      note: "Synthetic wallet activity (fictional): each transaction's ID, signer, receiver, method and its own status. Not whether a sale step succeeded.",
      transactions: account ? all.filter((t) => t.signer === account) : all,
    });
  });
  const flag = (name: "cancelNext" | "loseNext") => (c: { json: (v: unknown) => Response }) => {
    controls[name] = true;
    return c.json({ [name]: true });
  };
  control.post("/cancel-next", flag("cancelNext"));
  control.post("/lose-next", flag("loseNext"));
  control.post("/delay-next/:ms", (c) => {
    const ms = Number(c.req.param("ms"));
    if (!Number.isInteger(ms) || ms < 0 || ms > 30_000)
      return c.json({ error: "0 to 30000 ms" }, 400);
    controls.delayNextMs = ms;
    return c.json({ delay_next_ms: ms });
  });
  control.post("/account/:id", (c) => {
    const id = c.req.param("id");
    if (!h.accounts.includes(id)) return c.json({ error: `one of: ${h.accounts.join(", ")}` }, 400);
    controls.account = id;
    return c.json({ account: id });
  });
  control.post("/older-contract", (c) => {
    sale.saleTerms = false;
    return c.json({ sale_terms: false });
  });
  control.post("/newer-contract", (c) => {
    sale.saleTerms = true;
    return c.json({ sale_terms: true });
  });
  control.post("/fail-next-payout", (c) => {
    sale.failPayouts = 1;
    return c.json({ fail_next_payout: true });
  });
  // The synthetic chain's clock moves forward (e.g. past an offer's expiry); never back. The
  // composition's own clock is this computer's; only the contract's time moves.
  control.post("/advance/:minutes", (c) => {
    const m = Number(c.req.param("minutes"));
    if (!Number.isInteger(m) || m < 1 || m > 60 * 24 * 31)
      return c.json({ error: "1 to 44640 minutes" }, 400);
    b.w.chain.tick(BigInt(m * 60_000));
    return c.json({ chain_now: new Date(Number(b.w.chain.ts)).toISOString() });
  });
  control.post("/customer-use", async (c) => c.json(await h.customerUse()));
  // The whole synthetic RPC endpoint fails (every read and lookup), then works again.
  control.post("/rpc/down", (c) => {
    controls.rpcDown = true;
    return c.json({ rpc: "down" });
  });
  control.post("/rpc/up", (c) => {
    controls.rpcDown = false;
    return c.json({ rpc: "up" });
  });
  return control;
}
