// Job 003wf1 (APPLICATION_COMPOSITION §12): the configured composition's maintenance and
// lifecycle, in process: explicit validated config, capability separate from observed health,
// idempotent start/stop, admission ending first, and the shutdown fence holding back a late
// network answer so nothing continues into the closed database. Synthetic RPC (labelled), ephemeral
// keys and fictional accounts only; no network. The actual child processes are in
// lifecycle-process.test.ts.

import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AppConfig, validateConfig } from "../src/appConfig.ts";
import { type Composed, composeApplication } from "../src/compose.ts";
import { openDb } from "../src/db.ts";
import { nep413Digest } from "../src/identity.ts";
import type { FetchLike } from "../src/v3rpc.ts";
import type { Json } from "./customer-world.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "lifecycle-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return d;
};

const ENDPOINT = "https://synthetic-testnet-rpc.example";
const MAINT = {
  enabled: true,
  interval_ms: 1_000,
  batch: 5,
  pass_budget_ms: 500,
  op_deadline_ms: 200,
  stop_timeout_ms: 1_000,
};

function base(dir: string, extra: Record<string, unknown> = {}) {
  const keysFile = join(dir, "protected-keys.json");
  writeFileSync(keysFile, JSON.stringify({ k1: randomBytes(32).toString("base64") }));
  const root = join(dir, "protected");
  mkdirSync(root, { recursive: true });
  return {
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
  };
}

/**
 * A SYNTHETIC testnet RPC for the configured endpoint ONLY: any other destination is refused
 * (never a real fetch). `hold` keeps access-key reads waiting until released.
 */
function syntheticRpc(keys: Map<string, string>) {
  const held: (() => void)[] = [];
  let holding = false;
  const fetch: FetchLike = async (url, init) => {
    if (url !== ENDPOINT) throw new Error(`synthetic RPC: refused destination ${url}`);
    const req = JSON.parse(init.body) as { id: string; method: string; params: Json };
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { status: 200 });
    if (req.method === "block")
      return ok({
        header: {
          height: 1000,
          hash: "9".repeat(43),
          timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n),
        },
      });
    if (req.params.request_type === "view_access_key") {
      if (holding) await new Promise<void>((r) => held.push(r));
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
  return {
    fetch,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const r of held.splice(0)) r();
    },
    waiting: () => held.length,
  };
}

const compose = (cfg: AppConfig, fetch: FetchLike) => {
  const c = composeApplication(cfg, { fetch, fetchLabel: "synthetic RPC (test)" });
  cleanups.push(() => c.stop());
  return c;
};
const caps = async (c: Composed) =>
  (await (await c.app.request("/api/system/capabilities")).json()) as Json;
const until = async (cond: () => Promise<boolean>, what: string, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe("003wf1 maintenance configuration: explicit, bounded, off by default", () => {
  it("accepts a complete section and refuses anything partial, unknown, out of range or without customer use", () => {
    const dir = tempDir();
    expect(validateConfig(base(dir, { maintenance: MAINT })).maintenance).toEqual({
      interval_ms: 1_000,
      batch: 5,
      pass_budget_ms: 500,
      op_deadline_ms: 200,
      stop_timeout_ms: 1_000,
    });
    expect(
      validateConfig(base(dir, { maintenance: { ...MAINT, enabled: false } })).maintenance,
    ).toBeUndefined();
    expect(validateConfig(base(dir)).maintenance).toBeUndefined();
    const refuse = (m: unknown, why: RegExp) =>
      expect(() => validateConfig(base(dir, { maintenance: m }))).toThrow(why);
    const { stop_timeout_ms: _s, ...partial } = MAINT;
    refuse(partial, /maintenance.stop_timeout_ms/);
    refuse({ ...MAINT, extra: 1 }, /unknown field maintenance.extra/);
    refuse({ ...MAINT, batch: 26 }, /maintenance.batch/);
    refuse({ ...MAINT, interval_ms: 10 }, /maintenance.interval_ms/);
    refuse({ ...MAINT, op_deadline_ms: 600 }, /can't exceed/);
    refuse({ ...MAINT, enabled: "yes" }, /maintenance.enabled/);
    refuse([], /must be an object/);
    const { customer: _c, ...noCustomer } = base(dir, { maintenance: MAINT });
    expect(() => validateConfig(noCustomer)).toThrow(/maintenance needs customer use/);
  });
});

describe("003wf1 configured capability vs observed health", () => {
  it("unconfigured: unavailable, nothing scheduled, no observed state", async () => {
    const c = compose(validateConfig(base(tempDir())), syntheticRpc(new Map()).fetch);
    c.start();
    const body = await caps(c);
    expect(body.capabilities.find((x: Json) => x.key === "maintenance")).toMatchObject({
      state: "unavailable",
      detail: /Not configured/,
    });
    expect(body.maintenance_observed).toBeNull();
  });

  it("configured without a writer: says which tasks can progress; observed only after a holder's pass; stopped after stop", async () => {
    const dir = tempDir();
    const cfg = validateConfig(base(dir, { maintenance: MAINT }));
    const c = compose(cfg, syntheticRpc(new Map()).fetch);
    const before = await caps(c);
    expect(before.capabilities.find((x: Json) => x.key === "maintenance")).toMatchObject({
      state: "on",
      detail: /Without the writer only expiry and cleanup can progress/,
    });
    // Configured is not observed: nothing has run yet.
    expect(before.maintenance_observed).toMatchObject({ state: "not_started", last_pass_at: null });
    c.start();
    await until(async () => (await caps(c)).maintenance_observed.state === "running", "a pass");
    const seen = (await caps(c)).maintenance_observed;
    expect(seen.last_pass_at).not.toBeNull();
    expect(JSON.stringify(seen)).not.toMatch(/proc-|holder|business/); // no holder or business
    await c.stop();
    // A later process reads what the stopped holder recorded.
    const db = openDb(cfg.database);
    const st = db.prepare("SELECT state, scheduled FROM maintenance_status").get() as Json;
    db.close();
    expect(st).toEqual({ state: "stopped", scheduled: 0 });
  });
});

describe("003wf1 start and stop", () => {
  it("stop before start, twice; start after stop does nothing; admission is refused at once", async () => {
    const c = compose(
      validateConfig(base(tempDir(), { maintenance: MAINT })),
      syntheticRpc(new Map()).fetch,
    );
    const s1 = c.stop();
    const s2 = c.stop();
    expect(s1).toBe(s2);
    // Admission ended synchronously with stop(): no request reaches a service.
    const r = await c.app.request("/api/system/capabilities");
    expect(r.status).toBe(503);
    expect(r.headers.get("connection")).toBe("close");
    expect(((await r.json()) as Json).code).toBe("stopping");
    await s1;
    c.start(); // after stop: a no-op, and it doesn't touch the closed database
    await c.stop();
  });

  it("a late network answer after stop: the admitted request ends 503 stopping, the closed database is never touched, no session appears", async () => {
    const dir = tempDir();
    const cfg = validateConfig(base(dir, { maintenance: MAINT }));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = BigInt(`0x${Buffer.from(raw).toString("hex")}`);
    let b58 = "";
    while (n > 0n) {
      b58 = B58[Number(n % 58n)] + b58;
      n /= 58n;
    }
    const keyId = `ed25519:${b58}`;
    const rpc = syntheticRpc(new Map([[`ava-synthetic.testnet|${keyId}`, "full"]]));
    const c = compose(cfg, rpc.fetch);
    c.start();
    // A sign-in whose access-key read is held at the network boundary.
    const ch = await c.app.request("/api/session/challenge", { method: "POST" });
    const cookie = (ch.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const challenge = ((await ch.json()) as Json).challenge;
    const digest = nep413Digest({
      message: challenge.message,
      nonce: Buffer.from(challenge.nonce, "base64"),
      recipient: challenge.recipient,
    });
    rpc.hold();
    let settled = false;
    const verifying = Promise.resolve(
      c.app.request("/api/session/verify", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          account_id: "ava-synthetic.testnet",
          public_key: keyId,
          signature: sign(null, digest, privateKey).toString("base64"),
          nonce: challenge.nonce,
        }),
      }),
    ).finally(() => {
      settled = true;
    });
    await until(async () => rpc.waiting() === 1, "the held access-key read");
    const t0 = Date.now();
    await c.stop(); // admission, drain (bounded), fence, close
    expect(Date.now() - t0).toBeLessThan(MAINT.stop_timeout_ms + 1_000);
    rpc.release(); // the answer arrives only now
    // The admitted request ends within the bound, answered 503 "stopping": its continuation was
    // refused at the fence and the database gate, never reaching the closed database.
    const res = await verifying;
    expect(settled).toBe(true);
    expect(res.status).toBe(503);
    // Sign-in reports the refused read as its own unavailability (503); nothing was recorded.
    expect(["stopping", "sign_in_unavailable"]).toContain(((await res.json()) as Json).code);
    expect(c.fence.held).toBeGreaterThanOrEqual(1);
    const db = openDb(cfg.database);
    const sessions = db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as Json;
    db.close();
    expect(sessions.n).toBe(0);
  });
});

describe("003wf1 the provider timeout on the production adapters (adapter-level evidence)", () => {
  it("the runtime's generation that never answers ends as a timeout through httpsTransport's own limit", async () => {
    const { parseAiConfig } = await import("../src/ai-config.ts");
    const { httpsTransport } = await import("../src/anthropic.ts");
    const { AnthropicRuntime } = await import("../src/runtime.ts");
    const { INVOICE_SPEC } = await import("./runtime-world.ts");
    const ai = parseAiConfig(
      JSON.stringify({
        config_version: "lifecycle-test-1",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        pricing_version: "2026-11-02",
        operator_ceiling_cents: 100,
        runtime_operator_ceiling_cents: 100,
      }),
      "synthetic-test-key-not-a-credential-0001",
    );
    if (!ai.ok) throw new Error(ai.reason);
    const seen: string[] = [];
    // The count answers; the generation never does. Like real fetch, it honours its abort
    // signal (a transport that ignores it is the shutdown fence's case, tested elsewhere).
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/count_tokens")) return new Response(JSON.stringify({ input_tokens: 900 }));
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    }) as typeof fetch;
    const rt = new AnthropicRuntime(
      ai.config,
      httpsTransport(ai.apiKey, { fetchImpl, timeoutMs: 100 }),
    );
    const err = await rt
      .extract(
        {
          invocationId: "lifecycle-timeout",
          spec: INVOICE_SPEC,
          document: "Fictional invoice SH-1042",
          limits: { maxInputTokens: 30_000, maxOutputTokens: 2_000 },
        },
        new AbortController().signal,
      )
      .catch((e: unknown) => e as { failureClass?: string; usage?: unknown });
    expect(err).toMatchObject({ failureClass: "timeout", usage: null }); // sent: its cost unknown
    expect(seen).toEqual([
      "https://api.anthropic.com/v1/messages/count_tokens",
      "https://api.anthropic.com/v1/messages",
    ]);
  });
});
