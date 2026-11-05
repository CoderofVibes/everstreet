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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { openDb } from "../../server/src/db.ts";
import { nep413Digest } from "../../server/src/identity.ts";
import { CUSTOMER, type Json, TOKEN } from "../../server/test/customer-world.ts";
import { CLOSER, prepareHandover } from "../../server/test/handoverWorld.ts";
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
  /**
   * The synthetic producers' explicit finite budget for one review session (Astra's 00:01
   * review): RPC requests the harness answers (default 25 000) and the customer chain double's
   * own call ceiling (default 4 000; the fixture default is 400). The sale double keeps its
   * 2 000. Exhaustion is reported in the control status, never turned into a success.
   */
  budget?: { rpcRequests?: number; chainCalls?: number };
  /**
   * Job 003wf3: a Gated sale with the managed handover configured: the sale double names a
   * fictional closer, the closer's ephemeral function-call key (close_sale on the business only)
   * is in the config, and the composition's coordinator runs every second.
   */
  gated?: boolean;
  /** Tests only: fail the start after the child and both listeners are up (cleanup check). */
  injectStartupFailure?: boolean;
}

/** Closes a listener: no new connections, existing ones cut; bounded to 2 s. */
const closeListener = (s: { close: (cb?: () => void) => unknown }) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, 2_000);
    s.close(() => {
      clearTimeout(t);
      r();
    });
    (s as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
const TAIL = 16_384;

export async function startConfiguredSaleHarness(o: ConfiguredSaleOptions) {
  const HOST = "127.0.0.1";
  const origin = `http://${HOST}:${o.sitePort}`;
  const dir = mkdtempSync(join(tmpdir(), "everstreet-sale-configured-"));
  const removeDir = () =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  let proc: ChildProcess | null = null;
  let procExited: Promise<unknown> | null = null;
  const bound: { close: (cb?: () => void) => unknown }[] = [];
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
    // Gated (job 003wf3): the shared handover prerequisites (sale double with the closer, Noah
    // linked with his tokens and ephemeral key, the closer's key and the `handover` section).
    const gated = o.gated
      ? prepareHandover(b, dir, {
          handover: { interval_ms: 1_000, pass_budget_ms: 3_000, op_deadline_ms: 2_000 },
        })
      : null;
    const sale = gated ? gated.sale : b.w.chain.attachSale({ owner: FOUNDER });
    const budget = {
      rpc_requests: o.budget?.rpcRequests ?? 25_000,
      chain_calls: o.budget?.chainCalls ?? 4_000,
      sale_calls: sale.ceiling,
    };
    b.w.chain.ceiling = budget.chain_calls;
    /** Non-secret counters (control status only): what the synthetic producers answered. */
    const counters = {
      rpc: {} as Record<string, number>,
      rpc_total: 0,
      transport_failed: 0,
      model: 0,
      wallet_tx: 0,
      exhausted: null as null | { reason: string; at: string },
      last_error: null as string | null,
    };
    const exhaust = (reason: string) => {
      counters.exhausted ??= { reason, at: new Date().toISOString() };
    };
    b.w.chain.balances.set(CONFIGURED_BUYER, 1_000_000_000n); // Noah's fictional test tokens
    const db = openDb(b.db);
    try {
      const t = new Date().toISOString();
      if (!gated) {
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
      }
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
    const noahKey = gated ? gated.noah : nearKey();
    if (!gated) b.rpc.keys.set(`${CONFIGURED_BUYER}|${noahKey.id}`, 0n);
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
    if (gated) config.handover = gated.handover;
    writeFileSync(b.configFile, JSON.stringify(config));

    // ---- The normal entry, in its own bounded child process ----
    const controls = {
      account: FOUNDER as string | null,
      cancelNext: false,
      loseNext: false,
      delayNextMs: 0,
      rpcDown: false,
      sent: [] as Json[],
      /** Job 003wf3: the closer's next send is held (before it lands) until released. */
      closeHeld: false,
    };
    let heldClose: { open: () => void } | null = null;
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
    let exitCode: number | null | undefined;
    const exited = new Promise<number | null>((r) =>
      child.once("exit", (code) => {
        exitCode = code;
        r(code);
      }),
    );
    procExited = exited;
    // Only a bounded diagnostic tail of the child's output is kept.
    let out = "";
    let listening = false;
    const take = (d: unknown) => {
      out = (out + String(d)).slice(-TAIL);
      if (out.includes("listening on")) listening = true;
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const methodOf = (body: string) => {
      try {
        const j = JSON.parse(body) as { method?: string; params?: { request_type?: string } };
        return j.method === "query" ? `query:${j.params?.request_type}` : String(j.method);
      } catch {
        return "malformed";
      }
    };
    child.on(
      "message",
      (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
        if (m?.type !== "fetch") return;
        void (async () => {
          let r: { status: number; body: string };
          try {
            if (m.channel === "rpc") {
              const k = methodOf(String(m.body));
              counters.rpc[k] = (counters.rpc[k] ?? 0) + 1;
              if (++counters.rpc_total > budget.rpc_requests) {
                exhaust(`harness RPC budget reached (${budget.rpc_requests} requests)`);
                r = { status: 503, body: "synthetic: the harness RPC budget is exhausted" };
              } else if (controls.rpcDown)
                r = { status: 503, body: "synthetic: the RPC endpoint is down (harness control)" };
              else r = { status: 200, body: await b.rpc.answer(String(m.body)) };
            } else {
              counters.model++;
              r = await b.model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
            }
          } catch (e) {
            // A producer failure is ANSWERED (the composition sees a failed read), never left
            // waiting; a ceiling is recorded as the exhaustion reason.
            const msg = String((e as Error)?.message ?? e).slice(0, 200);
            counters.transport_failed++;
            counters.last_error = msg;
            if (/ceiling reached/.test(msg)) exhaust(msg);
            r = { status: 500, body: `synthetic: ${msg}` };
          }
          if (child.connected) child.send({ type: "reply", id: m.id, ...r });
        })();
      },
    );
    for (let i = 0; i < 600 && !listening; i++) {
      if (exitCode !== undefined) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!listening) throw new Error(`the configured application didn't start: ${out.slice(-800)}`);
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
          (/_guarded$/.test(call.methodName) ||
            call.methodName === "accept_sale" ||
            (gated !== null && call.methodName === "abort_close"))) ||
        (call.receiverId === TOKEN &&
          (call.methodName === "ft_transfer_call" || call.methodName === "storage_deposit"));
      if (!supported)
        return c.json({ error: "The synthetic wallet only sends the sale's own requests." }, 400);
      controls.sent.push({ signer: controls.account, ...call });
      counters.wallet_tx++;
      let outcome: Json;
      try {
        outcome = b.w.chain.walletCall(controls.account, call as never);
      } catch (e) {
        const msg = String((e as Error).message);
        if (/ceiling reached/.test(msg)) exhaust(msg);
        return c.json({ error: `The synthetic chain refused it: ${msg}` }, 400);
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
    /** Listens, or fails the start (e.g. the port is taken); a bound listener is tracked. */
    const listen = (fetch: (r: Request) => Response | Promise<Response>, port: number) =>
      new Promise<ReturnType<typeof serve>>((ok, fail) => {
        const s = serve({ fetch, port, hostname: HOST }, () => {
          bound.push(s);
          ok(s);
        });
        s.once("error", fail);
      });
    const siteServer = await listen(site.fetch, o.sitePort);
    const controlServer = await listen(
      configuredSaleControl({
        b,
        sale,
        controls,
        gated: gated !== null,
        holdClose: () => {
          heldClose = b.rpc.holdNextSend();
          controls.closeHeld = true;
        },
        releaseClose: () => {
          heldClose?.open();
          heldClose = null;
          controls.closeHeld = false;
        },
        app,
        customerUse,
        accounts: ACCOUNTS,
        budget,
        counters,
      }).fetch,
      o.controlPort,
    );
    if (o.injectStartupFailure) throw new Error("injected startup failure (cleanup test)");
    let stopping: Promise<{ childExit: number | null; forcedKill: boolean }> | null = null;
    const stop = () =>
      (stopping ??= (async () => {
        await Promise.all([closeListener(siteServer), closeListener(controlServer)]);
        // A close still held is let through (to nobody) so the child's stop isn't waiting on it.
        (heldClose as { open: () => void } | null)?.open();
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
      gated: gated !== null,
      closer: gated ? CLOSER : null,
      budget,
      counters,
      out: () => out,
      stop,
    };
  } catch (e) {
    // A failed start, at any point: close what is bound, end the child and WAIT (bounded) for it
    // to exit, so its SQLite files are closed before the directory is removed (Windows).
    await Promise.all(bound.map(closeListener));
    const p = proc as ChildProcess | null;
    if (p && p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    if (procExited) await Promise.race([procExited, new Promise((r) => setTimeout(r, 10_000))]);
    removeDir();
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
      harness: { dir, pid: p?.pid ?? null, removed: !existsSync(dir) },
    });
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
    closeHeld: boolean;
  };
  gated: boolean;
  holdClose: () => void;
  releaseClose: () => void;
  app: string;
  customerUse: () => Promise<unknown>;
  accounts: readonly string[];
  budget: Record<string, number>;
  counters: Record<string, unknown>;
}) {
  const { b, sale, controls } = h;
  const control = new Hono();
  /** The session's finite budget and what was used; `exhausted` names the first limit reached. */
  const usage = () => ({
    budget: h.budget,
    counters: {
      ...h.counters,
      chain_calls: b.w.chain.calls,
      sale_calls: sale.calls,
      wallet_transactions_recorded: b.w.chain.txs.size,
    },
  });
  control.get("/usage", (c) => c.json(usage()));
  control.get("/", async (c) => {
    const caps = await loopback(`${h.app}/api/system/capabilities`)
      .then((r) => r.json())
      .catch(() => null);
    return c.json({
      composition:
        "normal entry (serve.ts runServer → composeApplication), configured mode, in a child process",
      usage: usage(),
      controls: { ...controls, sent: controls.sent.length },
      business: b.w.f.business,
      close_mode: h.gated ? "gated" : "direct",
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
  // Job 003wf3 (Gated only): the closer's next send waits before it lands, until released.
  control.post("/hold-close", (c) => {
    if (!h.gated) return c.json({ error: "Gated harness only (--gated)" }, 400);
    h.holdClose();
    return c.json({ close_held: true });
  });
  control.post("/release-close", (c) => {
    h.releaseClose();
    return c.json({ close_held: false });
  });
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
