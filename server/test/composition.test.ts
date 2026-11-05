// Job 003w (a, b, c): the normal composition root and entry. What this proves, with the same
// composition code configured mode uses: invalid, mainnet and mismatched configs are refused
// before anything is opened; the capability inventory is honest and carries no secret or path;
// verified mode refuses name-only join, actor switching and preview sessions, and accepts only a
// NEP-413-signed one-use challenge for a full-access key (replay, wrong key, bad signature and
// expiry refused); state survives a real process restart of the entry. Dependencies: a SYNTHETIC
// RPC fetch (labelled, never a real endpoint), ephemeral ed25519 and storage keys, disposable
// files. No wallet, chain, model or worker is involved.

import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { type AppConfig, validateConfig } from "../src/appConfig.ts";
import { type Composed, composeApplication } from "../src/compose.ts";
import { openDb } from "../src/db.ts";
import { AccountSignIn, nep413Digest, verifyNep413 } from "../src/identity.ts";
import { Store } from "../src/store.ts";
import {
  type FetchLike,
  TestnetAccessKeyReader,
  TestnetCustomerRpcTransport,
} from "../src/v3rpc.ts";
import type { Json } from "./customer-world.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const c of cleanups.splice(0).reverse())
    try {
      await c();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors, "cleanup failed");
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "compose-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return d;
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(b: Buffer) {
  let n = BigInt(`0x${b.toString("hex") || "0"}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = `1${s}`;
  }
  return s;
}
/** An ephemeral synthetic account key: never a real account. */
function accountKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { id: `ed25519:${base58(Buffer.from(raw))}`, privateKey };
}

/** A SYNTHETIC testnet RPC: block headers with timestamps and access keys we say exist. */
function syntheticRpc(keys: Map<string, string>, nowNs = () => BigInt(Date.now()) * 1_000_000n) {
  const fetch: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { status: 200 });
    if (req.method === "block")
      return ok({
        header: { height: 1000, hash: "9".repeat(43), timestamp_nanosec: String(nowNs()) },
      });
    if (req.params.request_type === "view_access_key") {
      const perm = keys.get(`${req.params.account_id}|${req.params.public_key}`);
      if (!perm)
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { cause: { name: "UNKNOWN_ACCESS_KEY" } },
          }),
          { status: 200 },
        );
      return ok({
        permission: perm === "full" ? "FullAccess" : { FunctionCall: {} },
        block_height: 1000,
      });
    }
    return ok({ error: "synthetic: no such view" });
  };
  return fetch;
}

const ENDPOINT = "https://synthetic-testnet-rpc.example";
function configuredFiles(dir: string, extra: Partial<AppConfig> = {}): AppConfig {
  const keysFile = join(dir, "protected-keys.json");
  writeFileSync(keysFile, JSON.stringify({ k1: randomBytes(32).toString("base64") }));
  const root = join(dir, "protected");
  require("node:fs").mkdirSync(root);
  return validateConfig({
    config_version: 1,
    mode: "configured",
    network: "testnet",
    listen: { host: "127.0.0.1", port: 1 },
    database: join(dir, "everstreet.db"),
    sign_in: { recipient: "everstreet.local", session_hours: 1 },
    rpc: { endpoint: ENDPOINT },
    customer: { operator_account: "operator-synthetic.testnet" },
    protected_storage: { root, active_key_id: "k1", keys_file: keysFile },
    ...extra,
  });
}
const compose = (cfg: AppConfig, fetch: FetchLike, now?: () => number) => {
  const c = composeApplication(cfg, { fetch, fetchLabel: "synthetic RPC (test)", now });
  cleanups.push(() => c.stop());
  return c;
};

/** One browser: its own cookie jar (Set-Cookie respected, Max-Age=0 removes). */
function browser(port: number) {
  const jar = new Map<string, string>();
  const call = async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      const value = rest.join("=");
      if (!value || attrs.some((x) => /^max-age=0$/i.test(x.trim()))) jar.delete(name as string);
      else jar.set(name as string, value);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  return {
    call,
    /** Replaces this browser's session cookie ("" removes it). */
    setCookie: (pair: string) => {
      jar.delete("es_session");
      const [k, ...v] = pair.split("=");
      if (k && v.length) jar.set(k, v.join("="));
    },
    cookie: () => (jar.has("es_session") ? `es_session=${jar.get("es_session")}` : ""),
  };
}

/** The real HTTP listener on loopback (port 0), closed by the test's cleanup. */
async function listen(c: Composed) {
  const server = serve({ fetch: c.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  return { ...browser(port), port, browser: () => browser(port) };
}

async function signIn(
  call: ReturnType<typeof browser>["call"],
  account: string,
  key: ReturnType<typeof accountKey>,
  tamper?: (s: { message: string; recipient: string }) => { message: string; recipient: string },
) {
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as {
    message: string;
    nonce: string;
    recipient: string;
  };
  const signed = tamper ? tamper(ch) : ch;
  const digest = nep413Digest({
    message: signed.message,
    nonce: Buffer.from(ch.nonce, "base64"),
    recipient: signed.recipient,
  });
  const signature = sign(null, digest, key.privateKey).toString("base64");
  return {
    ch,
    res: await call("/api/session/verify", "POST", {
      account_id: account,
      public_key: key.id,
      signature,
      nonce: ch.nonce,
    }),
  };
}

describe("003w-a configuration: refused before anything is opened", () => {
  const base = {
    config_version: 1,
    mode: "preview",
    network: "testnet",
    listen: { host: "127.0.0.1", port: 8800 },
    database: ":memory:",
  };
  it("accepts a minimal preview and refuses every unsafe or mismatched setting", () => {
    expect(validateConfig(base).mode).toBe("preview");
    const refused: [unknown, RegExp][] = [
      [{ ...base, network: "mainnet" }, /mainnet is refused/],
      [{ ...base, mode: "live" }, /mode must be/],
      [{ ...base, listen: { host: "0.0.0.0", port: 8800 } }, /loopback only/],
      [{ ...base, database: "relative.db" }, /absolute path/],
      [{ ...base, mode: "configured" }, /durable database file/],
      [
        { ...base, rpc: { endpoint: "https://rpc.mainnet.near.org" } },
        /mainnet endpoint is refused/,
      ],
      [{ ...base, rpc: { endpoint: "http://insecure.example" } }, /https/],
      [
        { ...base, sign_in: { recipient: "everstreet.local" }, rpc: { endpoint: ENDPOINT } },
        /preview uses preview sessions/,
      ],
      [
        { ...base, customer: { operator_account: "op.near" }, rpc: { endpoint: ENDPOINT } },
        /testnet account/,
      ],
      [
        { ...base, customer: { operator_account: "op.testnet" }, rpc: { endpoint: ENDPOINT } },
        /protected_storage/,
      ],
      [
        { ...base, model: { ai_config_file: "/a.json", api_key_env: "sk-ant-not-a-name" } },
        /variable NAME/,
      ],
      [{ ...base, surprise: true }, /unknown field surprise/],
    ];
    for (const [cfg, why] of refused) expect(() => validateConfig(cfg)).toThrow(why);
    expect(() =>
      validateConfig({ ...base, mode: "configured", database: join(tmpdir(), "x.db") }),
    ).toThrow(/needs sign_in/);
  });

  it("a mainnet-looking setup never opens a database (validation runs first)", () => {
    const dir = tempDir();
    const dbPath = join(dir, "never.db");
    expect(() => validateConfig({ ...base, database: dbPath, network: "mainnet" })).toThrow();
    expect(require("node:fs").existsSync(dbPath)).toBe(false);
  });
});

describe("003w-a/b configured composition on a loopback listener", () => {
  it("an honest inventory with no secrets; preview identity routes are absent", async () => {
    const dir = tempDir();
    const cfg = configuredFiles(dir);
    const c = compose(cfg, syntheticRpc(new Map()));
    c.start();
    const { call } = await listen(c);
    const inv = await call("/api/system/capabilities");
    const byKey = Object.fromEntries(
      (inv.body.capabilities as { key: string; state: string; provenance: string }[]).map((x) => [
        x.key,
        x,
      ]),
    );
    expect(inv.body.mode).toBe("configured");
    expect(byKey.records?.state).toBe("on");
    expect(byKey.protection?.state).toBe("on");
    expect(byKey.sign_in).toMatchObject({ state: "on", provenance: "synthetic RPC (test)" });
    expect(byKey.customer_reads).toMatchObject({ state: "on", provenance: "synthetic RPC (test)" });
    for (const k of [
      "customer_writer",
      "customer_authorization",
      "checks",
      "model",
      "legacy_payments",
    ])
      expect(byKey[k]?.state).toBe("unavailable");
    const text = JSON.stringify(inv.body);
    expect(text).not.toContain(dir);
    expect(text).not.toContain(ENDPOINT);
    expect(text).not.toMatch(/[A-Za-z0-9+/]{43}=/); // no key material
    expect((await call("/api/env")).body).toMatchObject({
      localPreview: false,
      identity: "verified",
    });
    expect((await call("/api/session", "POST", { name: "Mallory" })).body.code).toBe(
      "verified_sign_in_required",
    );
    expect((await call("/api/people")).status).toBe(404);
    expect((await call("/api/session/as/anyone", "POST")).status).toBe(404);
  });

  it("verified sign-in: a signed one-use challenge for a full-access key; replay, wrong key, bad signature and expiry refused", async () => {
    const dir = tempDir();
    const cfg = configuredFiles(dir);
    const ava = accountKey();
    const limited = accountKey();
    const keys = new Map([
      [`ava-synthetic.testnet|${ava.id}`, "full"],
      [`ava-synthetic.testnet|${limited.id}`, "function_call"],
    ]);
    let clock = Date.now();
    const c = compose(cfg, syntheticRpc(keys), () => clock);
    c.start();
    const { call, setCookie } = await listen(c);
    // A preview session row (name-only or actor switch) never authenticates here.
    const preview = c.store.createPerson("Preview Ava");
    setCookie(`es_session=${preview.token}`);
    expect((await call("/api/me")).body.person).toBeNull();
    setCookie("");
    // Signed for another recipient: refused (the server rebuilds the exact payload).
    const wrongRecipient = await signIn(call, "ava-synthetic.testnet", ava, (s) => ({
      ...s,
      recipient: "evil.example",
    }));
    expect([wrongRecipient.res.status, wrongRecipient.res.body.code]).toEqual([
      401,
      "sign_in_signature",
    ]);
    // A function-call key proves nothing about the account.
    const weak = await signIn(call, "ava-synthetic.testnet", limited);
    expect([weak.res.status, weak.res.body.code]).toEqual([401, "sign_in_key"]);
    // The real thing.
    const good = await signIn(call, "ava-synthetic.testnet", ava);
    expect(good.res.status).toBe(201);
    expect(good.res.body.person.display_name).toBe("ava-synthetic.testnet");
    expect((await call("/api/me")).body.person.id).toBe(good.res.body.person.id);
    // Replaying the same signed answer: the challenge is spent.
    const digest = nep413Digest({
      message: good.ch.message,
      nonce: Buffer.from(good.ch.nonce, "base64"),
      recipient: good.ch.recipient,
    });
    const replay = await call("/api/session/verify", "POST", {
      account_id: "ava-synthetic.testnet",
      public_key: ava.id,
      signature: sign(null, digest, ava.privateKey).toString("base64"),
      nonce: good.ch.nonce,
    });
    // Refused: the binding cookie was cleared by the successful verify, and the challenge is spent.
    expect(replay.status).toBe(401);
    expect(["sign_in_binding", "sign_in_challenge"]).toContain(replay.body.code);
    // The same account signs in again: the same person, never a second one.
    const again = await signIn(call, "ava-synthetic.testnet", ava);
    expect(again.res.body.person.id).toBe(good.res.body.person.id);
    // Server-side expiry (1 hour here): past it, the session is not a session.
    clock += 3_600_001;
    expect((await call("/api/me")).body.person).toBeNull();
  });

  it("a proof started in one browser never signs in another; one challenge makes at most one session", async () => {
    const dir = tempDir();
    const cfg = configuredFiles(dir);
    const ava = accountKey();
    const c = compose(cfg, syntheticRpc(new Map([[`ava-synthetic.testnet|${ava.id}`, "full"]])));
    c.start();
    const l = await listen(c);
    const A = l.browser();
    const B = l.browser();
    const ch = (await A.call("/api/session/challenge", "POST")).body.challenge as {
      message: string;
      nonce: string;
      recipient: string;
    };
    const proof = {
      account_id: "ava-synthetic.testnet",
      public_key: ava.id,
      signature: sign(
        null,
        nep413Digest({
          message: ch.message,
          nonce: Buffer.from(ch.nonce, "base64"),
          recipient: ch.recipient,
        }),
        ava.privateKey,
      ).toString("base64"),
      nonce: ch.nonce,
    };
    // B holds A's complete, valid proof but not A's binding: refused, and nothing is spent.
    const stolen = await B.call("/api/session/verify", "POST", proof);
    expect([stolen.status, stolen.body.code]).toEqual([401, "sign_in_binding"]);
    expect((await B.call("/api/me")).body.person).toBeNull();
    // B with its OWN challenge cookie but A's nonce: still refused (the binding is per challenge).
    await B.call("/api/session/challenge", "POST");
    expect((await B.call("/api/session/verify", "POST", proof)).body.code).toBe(
      "sign_in_challenge",
    );
    // A verifying twice at once: exactly one session.
    const [x, y] = await Promise.all([
      A.call("/api/session/verify", "POST", proof),
      A.call("/api/session/verify", "POST", proof),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 401]);
    expect((await A.call("/api/me")).body.person.display_name).toBe("ava-synthetic.testnet");
    expect(
      (
        c.store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE mode = 'verified'").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  it("a challenge issued under another configured recipient is never honoured", async () => {
    // The operator changes sign_in.recipient: an outstanding challenge of the old application
    // identity, with a valid signature and the right browser binding, is still refused.
    const store = new Store(openDb(":memory:"));
    cleanups.push(() => store.db.close());
    const ava = accountKey();
    const reader = { isFullAccessKey: async () => true };
    const old = new AccountSignIn(store, {
      recipient: "old-app.local",
      network: "testnet",
      reader,
    });
    const { binding, challenge: ch } = old.challenge();
    const current = new AccountSignIn(store, {
      recipient: "everstreet.local",
      network: "testnet",
      reader,
    });
    const proof = {
      account_id: "ava-synthetic.testnet",
      public_key: ava.id,
      signature: sign(
        null,
        nep413Digest({
          message: ch.message,
          nonce: Buffer.from(ch.nonce, "base64"),
          recipient: ch.recipient,
        }),
        ava.privateKey,
      ).toString("base64"),
      nonce: ch.nonce,
    };
    await expect(current.verify(proof, binding)).rejects.toMatchObject({
      status: 401,
      code: "sign_in_recipient",
    });
    // And it is spent: the old identity can't use it afterwards either.
    await expect(old.verify(proof, binding)).rejects.toMatchObject({ code: "sign_in_challenge" });
  });

  it("restart: a new composition on the same files keeps the verified person and session rules", async () => {
    const dir = tempDir();
    const cfg = configuredFiles(dir);
    const ava = accountKey();
    const keys = new Map([[`ava-synthetic.testnet|${ava.id}`, "full"]]);
    const first = compose(cfg, syntheticRpc(keys)); // its cleanup is registered at once
    first.start();
    const a = await listen(first);
    const signed = await signIn(a.call, "ava-synthetic.testnet", ava);
    expect(signed.res.status).toBe(201);
    const cookie = a.cookie();
    await first.stop(); // every handle closed: the files are free (stop is idempotent)
    const second = compose(cfg, syntheticRpc(keys));
    second.start();
    const b = await listen(second);
    b.setCookie(cookie);
    expect((await b.call("/api/me")).body.person.id).toBe(signed.res.body.person.id);
    expect(
      (await b.call("/api/system/capabilities")).body.capabilities.find(
        (x: { key: string }) => x.key === "protection",
      ).state,
    ).toBe("on");
  });
});

describe("003w-b NEP-413 and the access-key reader", () => {
  it("a signature over the raw message (a generic signer's bytes) is not a NEP-413 signature", () => {
    const k = accountKey();
    const nonce = randomBytes(32);
    const p = {
      message: "Sign in to Everstreet (everstreet.local)",
      nonce,
      recipient: "everstreet.local",
    };
    const good = sign(null, nep413Digest(p), k.privateKey).toString("base64");
    expect(verifyNep413({ ...p, publicKey: k.id, signature: good })).toBe(true);
    const raw = sign(null, Buffer.from(p.message), k.privateKey).toString("base64");
    expect(verifyNep413({ ...p, publicKey: k.id, signature: raw })).toBe(false);
    expect(verifyNep413({ ...p, nonce: randomBytes(32), publicKey: k.id, signature: good })).toBe(
      false,
    );
    expect(verifyNep413({ ...p, publicKey: "ed25519:notbase58!", signature: good })).toBe(false);
  });

  it("only a FullAccess key counts; unknown keys are no; other failures fail closed", async () => {
    const k = accountKey();
    const reader = new TestnetAccessKeyReader(
      { network: "testnet", endpoint: ENDPOINT },
      syntheticRpc(new Map([[`a-synthetic.testnet|${k.id}`, "full"]])),
    );
    expect(await reader.isFullAccessKey("a-synthetic.testnet", k.id)).toBe(true);
    expect(await reader.isFullAccessKey("b-synthetic.testnet", k.id)).toBe(false);
    const down = new TestnetAccessKeyReader(
      { network: "testnet", endpoint: ENDPOINT },
      async () => new Response("", { status: 503 }),
    );
    await expect(down.isFullAccessKey("a-synthetic.testnet", k.id)).rejects.toThrow(/unavailable/);
  });
});

describe("003w-c the customer read transport", () => {
  it("pins a final block with its exact timestamp and sends only the customer views", async () => {
    const t = new TestnetCustomerRpcTransport(
      { network: "testnet", endpoint: ENDPOINT },
      syntheticRpc(new Map(), () => 1_762_300_000_123_456_789n),
    );
    expect(await t.finalBlock("testnet")).toEqual({
      height: "1000",
      hash: "9".repeat(43),
      timestamp_ms: "1762300000123",
    });
    const block = { height: "1000", hash: "9".repeat(43) };
    const view = (method: string, args: Record<string, unknown>) =>
      t.view({ network: "testnet", account: "biz-synthetic.testnet", method, args, block });
    for (const [method, args] of [
      ["get_plan", { plan_id: -1 }],
      ["get_entitlement", { customer: "c-synthetic.testnet" }],
      [
        "check_use",
        {
          customer: "c-synthetic.testnet",
          plan_id: 1,
          reg_id: "1",
          hold_seq: 1,
          slot: 0,
          fingerprint: "xyz",
        },
      ],
      ["open_hold", {}],
      ["get_control", { extra: 1 }],
    ] as const)
      await expect(view(method, args as Record<string, unknown>)).rejects.toThrow(/unsupported/);
    // A well-formed one reaches the (synthetic) endpoint, which says the view failed.
    await expect(view("get_plan", { plan_id: 1 })).rejects.toThrow(/execution_failed/);
  });
});

/** A free loopback port for the spawned entry. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

/**
 * A bounded child process (node + tsx): ready only when it prints `ready` (from its listener's
 * callback), or failed when it exits first; killed at 30 s; cleanup waits for its exit.
 */
async function child(args: string[], ready: string) {
  const proc = spawn(process.execPath, ["--import", "tsx", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 30_000);
  cleanups.push(async () => {
    clearTimeout(deadline);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  const started = await Promise.race([
    new Promise<"ready">((r) => {
      const look = () => (out.includes(ready) ? r("ready") : undefined);
      proc.stdout.on("data", look);
      proc.stderr.on("data", look);
    }),
    exited.then(() => "exited" as const),
  ]);
  if (started !== "ready")
    throw new Error(`child exited before it was ready: ${out.slice(0, 400)}`);
  return { proc, child: proc, exited, out: () => out };
}

describe("003w-a/b configured: a real process restart", () => {
  it("a fresh process on the same files keeps the verified person and session; no in-memory carry-over", async () => {
    const dir = tempDir();
    const cfg = configuredFiles(dir);
    const port = await freePort();
    const cfgFile = join(dir, "configured.json");
    writeFileSync(cfgFile, JSON.stringify({ ...cfg, listen: { host: "127.0.0.1", port } }));
    const ava = accountKey();
    const keysFile = join(dir, "rpc-keys.json");
    writeFileSync(keysFile, JSON.stringify({ [`ava-synthetic.testnet|${ava.id}`]: "full" }));
    const args = ["server/test/composeChild.ts", cfgFile, keysFile, String(port)];
    const first = await child(args, "listening");
    const a = browser(port);
    const signed = await signIn(a.call, "ava-synthetic.testnet", ava);
    expect(signed.res.status).toBe(201);
    const cookie = a.cookie();
    first.proc.kill("SIGTERM");
    await first.exited;
    const second = await child(args, "listening");
    const b = browser(port);
    b.setCookie(cookie);
    expect((await b.call("/api/me")).body.person.id).toBe(signed.res.body.person.id);
    expect((await b.call("/api/session", "POST", { name: "x" })).body.code).toBe(
      "verified_sign_in_required",
    );
    second.proc.kill("SIGTERM");
    await second.exited;
  }, 60_000);
});

describe("003w-a the real entry process, restarted", () => {
  it("serves from one explicit config, stops on signal, and keeps its records across a restart", async () => {
    const dir = tempDir();
    const port = await freePort();
    const cfgFile = join(dir, "preview.json");
    writeFileSync(
      cfgFile,
      JSON.stringify({
        config_version: 1,
        mode: "preview",
        network: "testnet",
        listen: { host: "127.0.0.1", port },
        database: join(dir, "preview.db"),
      }),
    );
    const run = () => child(["server/src/entry.ts", "--config", cfgFile], "listening on http://");
    const base = `http://127.0.0.1:${port}`;
    const first = await run();
    expect(first.out()).toContain("Everstreet (preview, testnet) listening on");
    const caps = (await (await fetch(`${base}/api/system/capabilities`)).json()) as {
      mode: string;
    };
    expect(caps.mode).toBe("preview");
    const joined = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fictional Ava" }),
    });
    expect(joined.status).toBe(201);
    const cookie = (joined.headers.get("set-cookie") ?? "").split(";")[0] as string;
    first.child.kill("SIGTERM");
    await first.exited;
    const second = await run();
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as {
      person: { display_name: string } | null;
    };
    expect(me.person?.display_name).toBe("Fictional Ava");
    second.child.kill("SIGTERM");
    await second.exited;
    expect(second.out()).not.toMatch(/near-credentials|secret/i);
  }, 60_000);
});
