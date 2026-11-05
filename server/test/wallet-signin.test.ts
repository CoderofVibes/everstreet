// Job 003w-e1: wallet sign-in through the REAL controller (web/src/wallet.ts) against the REAL
// composed routes on a loopback listener. The wallet is a synthetic boundary whose signed bytes
// come from the PINNED Wallet Selector's own `serializeNep413` (not our encoder), signed with a
// newly generated ed25519 key; the RPC is synthetic. No real wallet, account, key or network.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serializeNep413, verifySignature } from "@near-wallet-selector/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  SIGN_IN_TEXT,
  SignInController,
  type SignInPort,
  safeDestination,
  type WalletBoundary,
} from "../../web/src/wallet.ts";
import { validateConfig } from "../src/appConfig.ts";
import { composeApplication } from "../src/compose.ts";
import { base58Encode } from "../src/customerWriter.ts";
import { nep413Digest, verifyNep413 } from "../src/identity.ts";
import type { FetchLike } from "../src/v3rpc.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const RETURN = "http://127.0.0.1:8870";
const ACCOUNT = "cara-synthetic.testnet";

function accountKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { id: `ed25519:${base58Encode(raw)}`, privateKey };
}

/** Synthetic RPC: every key in `full` is a FullAccess key; a gate can hold the key read. */
function rpc(full: Set<string>, gate?: { hold: Promise<void>; reached: () => void }) {
  const fetch: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    const reply = (body: object) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }), { status: 200 });
    if (req.method === "block")
      return reply({
        result: {
          header: {
            height: 10,
            hash: "9".repeat(43),
            timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n),
          },
        },
      });
    if (req.params.request_type === "view_access_key") {
      if (gate) {
        gate.reached();
        await gate.hold;
      }
      return full.has(`${req.params.account_id}|${req.params.public_key}`)
        ? reply({ result: { permission: "FullAccess", block_height: 10 } })
        : reply({ error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } });
    }
    return reply({ result: { error: "synthetic: no such view" } });
  };
  return fetch;
}

async function app(opts: { returnOrigin?: string | null; gate?: Parameters<typeof rpc>[1] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wallet-signin-"));
  const keysFile = join(dir, "keys.json");
  writeFileSync(keysFile, JSON.stringify({ k1: randomBytes(32).toString("base64") }));
  mkdirSync(join(dir, "protected"));
  const full = new Set<string>();
  const composed = composeApplication(
    validateConfig({
      config_version: 1,
      mode: "configured",
      network: "testnet",
      listen: { host: "127.0.0.1", port: 1 },
      database: join(dir, "records.db"),
      sign_in: {
        recipient: "everstreet.local",
        session_hours: 1,
        ...(opts.returnOrigin === null ? {} : { return_origin: opts.returnOrigin ?? RETURN }),
      },
      rpc: { endpoint: "https://synthetic-testnet-rpc.example" },
      protected_storage: { root: join(dir, "protected"), active_key_id: "k1", keys_file: keysFile },
    }),
    { fetch: rpc(full, opts.gate), fetchLabel: "synthetic RPC (test)" },
  );
  const server = serve({ fetch: composed.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  cleanups.push(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await composed.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const port = (server.address() as { port: number }).port;
  return { composed, full, browser: () => browser(port) };
}

/** One browser: a cookie jar, the controller's port over the real routes, and its storage. */
function browser(port: number) {
  const jar = new Map<string, string>();
  const calls: string[] = [];
  const call = async (path: string, method = "GET", body?: unknown) => {
    calls.push(`${method} ${path}`);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      if (!rest.join("=") || attrs.some((x) => /^max-age=0$/i.test(x.trim())))
        jar.delete(name as string);
      else jar.set(name as string, rest.join("="));
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new Error(String(json?.error ?? res.status));
    return json as Record<string, unknown>;
  };
  const port_: SignInPort = {
    challenge: async () => (await call("/api/session/challenge", "POST")).challenge as never,
    verify: async (b) => (await call("/api/session/verify", "POST", b)) as never,
    cancelAttempt: async () => {
      await call("/api/session/challenge", "DELETE");
    },
  };
  const items = new Map<string, string>();
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  } as unknown as Storage;
  return { call, calls, port: port_, storage, items, jar };
}

type Mode = "answer" | "no_callback" | "other_callback" | "cancel" | "block" | "redirect";
/** A synthetic wallet boundary: the PINNED serializer makes the bytes, a fresh key signs them. */
function wallet(key: ReturnType<typeof accountKey>, mode: Mode = "answer", hold?: Promise<void>) {
  const signedFor: { state: string; fragment: string }[] = [];
  const w: WalletBoundary = {
    label: "synthetic wallet (test)",
    synthetic: true,
    async signMessage(p) {
      if (hold) await hold;
      if (mode === "cancel") throw new Error("User closed the window");
      if (mode === "block")
        throw new Error("Popup window blocked. Please allow popups for this site.");
      const callbackUrl =
        mode === "no_callback"
          ? undefined
          : mode === "other_callback"
            ? "https://elsewhere.example/signin/return"
            : p.callbackUrl;
      const bytes = serializeNep413({
        message: p.message,
        recipient: p.recipient,
        nonce: Buffer.from(p.nonce),
        callbackUrl,
      });
      const signature = sign(
        null,
        createHash("sha256").update(bytes).digest(),
        key.privateKey,
      ).toString("base64");
      const answer = { accountId: ACCOUNT, publicKey: key.id, signature, state: p.state };
      if (mode === "redirect") {
        signedFor.push({
          state: p.state,
          fragment: `#${new URLSearchParams({ accountId: ACCOUNT, publicKey: key.id, signature, state: p.state })}`,
        });
        return undefined;
      }
      return answer;
    },
    connect: async () => ACCOUNT,
    accounts: async () => [ACCOUNT],
    send: async () => {},
    disconnect: async () => {},
    onChange: () => () => {},
  };
  return { w, signedFor };
}
const ENV = { network: "testnet" as const, available: true, harness: null };

describe("003w-e1 NEP-413 interoperability with the pinned Wallet Selector (10.1.4)", () => {
  it("our digest is SHA-256 of the pinned serializeNep413, with and without a callback; each side verifies the other's", () => {
    const key = accountKey();
    const nonce = randomBytes(32);
    for (const callbackUrl of [undefined, `${RETURN}/signin/return`]) {
      const p = {
        message: "Sign in to Everstreet (everstreet.local)",
        recipient: "everstreet.local",
        nonce,
      };
      const pinned = createHash("sha256")
        .update(serializeNep413({ ...p, callbackUrl }))
        .digest();
      expect(nep413Digest({ ...p, callbackUrl }).equals(pinned)).toBe(true);
      const signature = sign(null, pinned, key.privateKey).toString("base64");
      expect(verifyNep413({ ...p, callbackUrl, publicKey: key.id, signature })).toBe(true);
      expect(verifySignature({ ...p, callbackUrl, publicKey: key.id, signature })).toBe(true);
      // The other variant is a different payload: never accepted in its place.
      expect(
        verifyNep413({
          ...p,
          callbackUrl: callbackUrl ? null : `${RETURN}/signin/return`,
          publicKey: key.id,
          signature,
        }),
      ).toBe(false);
    }
  });
});

describe("003w-e1 the sign-in controller over the real routes", () => {
  const status = async (b: ReturnType<typeof browser>) =>
    (await b.call("/api/me")) as { person: { id: string } | null; account: string | null };
  const variant = (a: Awaited<ReturnType<typeof app>>) =>
    (
      a.composed.store.db
        .prepare("SELECT verified_variant FROM sign_in_challenges WHERE used_ms IS NOT NULL")
        .all() as { verified_variant: string }[]
    ).map((r) => r.verified_variant);

  it("a popup answer signed with the exact issued callback signs in, names the account, and records the variant", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    const ch = (await b.call("/api/session/challenge", "POST")).challenge as {
      callback_url: string;
    };
    expect(ch.callback_url).toBe(`${RETURN}/signin/return`);
    const c = new SignInController(b.port, async () => wallet(key).w, ENV, b.storage);
    const out = await c.start("/use/offer-1");
    expect(out).toMatchObject({ kind: "signed_in", account: ACCOUNT, destination: "/use/offer-1" });
    expect(await status(b)).toMatchObject({ account: ACCOUNT });
    expect(variant(a)).toEqual(["issued"]);
    expect(b.items.size).toBe(0); // the attempt's state is cleared
  });

  it("a wallet that leaves the callback out verifies as 'none'; one that signs ANOTHER callback is refused", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b1 = a.browser();
    expect(
      (
        await new SignInController(
          b1.port,
          async () => wallet(key, "no_callback").w,
          ENV,
          b1.storage,
        ).start("/")
      ).kind,
    ).toBe("signed_in");
    const b2 = a.browser();
    const refused = await new SignInController(
      b2.port,
      async () => wallet(key, "other_callback").w,
      ENV,
      b2.storage,
    ).start("/");
    expect(refused.kind).toBe("refused");
    expect((await status(b2)).person).toBeNull();
    // The refused attempt's challenge is spent too (no replay), with no variant recorded.
    expect(variant(a)).toEqual(["none", null]);
  });

  it("cancellation and a blocked popup change nothing and never post a proof", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    for (const [mode, kind, text] of [
      ["cancel", "cancelled", SIGN_IN_TEXT.cancelled],
      ["block", "blocked", SIGN_IN_TEXT.blocked],
    ] as const) {
      const b = a.browser();
      const out = await new SignInController(
        b.port,
        async () => wallet(key, mode).w,
        ENV,
        b.storage,
      ).start("/");
      expect(out).toEqual({ kind, message: text });
      expect(b.calls.filter((x) => x.includes("verify"))).toEqual([]);
      expect((await status(b)).person).toBeNull();
    }
  });

  it("without a configured return address the wallet is never asked", async () => {
    const a = await app({ returnOrigin: null });
    const b = a.browser();
    let asked = 0;
    const out = await new SignInController(
      b.port,
      async () => {
        asked++;
        return wallet(accountKey()).w;
      },
      { ...ENV, available: false },
      b.storage,
    ).start("/");
    expect(out.kind).toBe("unavailable");
    expect(asked).toBe(0);
    expect(
      ((await b.call("/api/env")) as { wallet: { available: boolean } }).wallet.available,
    ).toBe(false);
  });

  it("a late wallet answer after sign-out is dropped: no proof posted, no session", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    let release = () => {};
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const c = new SignInController(
      b.port,
      async () => wallet(key, "answer", hold).w,
      ENV,
      b.storage,
    );
    const started = c.start("/");
    await new Promise((r) => setTimeout(r, 20));
    c.fence(); // the person signed out (or switched) while the wallet was open
    release();
    expect(await started).toEqual({ kind: "stale" });
    expect(b.calls.filter((x) => x.includes("verify"))).toEqual([]);
    expect((await status(b)).person).toBeNull();
  });

  it("a logout while the server reads the account key cancels that verification: no session (Astra's review)", async () => {
    let reached = () => {};
    let open = () => {};
    const gate = {
      hold: new Promise<void>((r) => {
        open = r;
      }),
      reached: () => reached(),
    };
    const atRead = new Promise<void>((r) => {
      reached = r;
    });
    const a = await app({ gate });
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    const c = new SignInController(b.port, async () => wallet(key).w, ENV, b.storage);
    const started = c.start("/");
    await atRead;
    // The SERVER alone must refuse it: this controller is deliberately not fenced (another tab
    // of the same browser signed out), so only the cancelled challenge stops the session.
    await b.call("/api/session", "DELETE");
    open();
    expect((await started).kind).toBe("refused");
    expect((await status(b)).person).toBeNull();
    expect(
      a.composed.store.db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE mode = 'verified'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("a redirect-style answer completes once on the return page, only in this browser, with this state, before expiry", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    const { w, signedFor } = wallet(key, "redirect");
    const c = new SignInController(b.port, async () => w, ENV, b.storage);
    expect(await c.start("/build/p-1")).toEqual({ kind: "redirecting" });
    const { fragment } = signedFor[0] as { fragment: string };
    // Another browser holding a copy of this one's attempt: the server's binding refuses it.
    const other = a.browser();
    for (const [k, v] of b.items) other.items.set(k, v);
    const there = await new SignInController(
      other.port,
      async () => w,
      ENV,
      other.storage,
    ).completeReturn(fragment);
    expect(there.kind).toBe("refused");
    expect((await status(other)).person).toBeNull();
    // A wrong state is refused before anything is posted.
    const posted = b.calls.length;
    expect((await c.completeReturn(fragment.replace("state=", "state=x"))).kind).toBe("refused");
    expect(b.calls.length).toBe(posted);
  });

  it("the return page signs in with the stored destination; a replay of the same fragment is refused", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    const { w, signedFor } = wallet(key, "redirect");
    const c = new SignInController(b.port, async () => w, ENV, b.storage);
    await c.start("/build/p-1");
    const { fragment } = signedFor[0] as { fragment: string };
    expect(await c.completeReturn(fragment)).toMatchObject({
      kind: "signed_in",
      destination: "/build/p-1",
    });
    expect((await status(b)).account).toBe(ACCOUNT);
    await b.call("/api/session", "DELETE");
    expect((await c.completeReturn(fragment)).kind).toBe("refused"); // attempt cleared, challenge spent
    expect((await status(b)).person).toBeNull();
  });

  it("an expired attempt on the return page is refused", async () => {
    const a = await app();
    const key = accountKey();
    a.full.add(`${ACCOUNT}|${key.id}`);
    const b = a.browser();
    const { w, signedFor } = wallet(key, "redirect");
    let now = Date.now();
    const c = new SignInController(
      b.port,
      async () => w,
      ENV,
      b.storage,
      () => now,
    );
    await c.start("/");
    now += 6 * 60_000; // past the 5-minute challenge
    expect((await c.completeReturn((signedFor[0] as { fragment: string }).fragment)).kind).toBe(
      "refused",
    );
    expect(b.calls.filter((x) => x.includes("verify"))).toEqual([]);
  });

  it("signing in as another account ends the browser's previous session on the server", async () => {
    const a = await app();
    const keyA = accountKey();
    const keyB = accountKey();
    a.full.add(`${ACCOUNT}|${keyA.id}`);
    a.full.add(`dana-synthetic.testnet|${keyB.id}`);
    const b = a.browser();
    await new SignInController(b.port, async () => wallet(keyA).w, ENV, b.storage).start("/");
    const oldToken = b.jar.get("es_session") as string;
    const walletB = wallet(keyB).w;
    const asB: WalletBoundary = {
      ...walletB,
      signMessage: async (p) => ({
        ...((await walletB.signMessage(p)) as { publicKey: string; signature: string }),
        accountId: "dana-synthetic.testnet",
        state: p.state,
      }),
    };
    expect(
      (await new SignInController(b.port, async () => asB, ENV, b.storage).start("/")).kind,
    ).toBe("signed_in");
    expect((await status(b)).account).toBe("dana-synthetic.testnet");
    b.jar.set("es_session", oldToken); // the replaced cookie, presented again
    expect((await status(b)).person).toBeNull();
  });

  it("a destination is only ever a same-origin path, never the return page", () => {
    expect(safeDestination("/use/o-1?x=1")).toBe("/use/o-1?x=1");
    for (const bad of [
      "https://elsewhere.example/",
      "//elsewhere.example",
      "/\\x",
      "/signin/return",
      "/signin/return#a",
      7,
      "/a\nb",
    ])
      expect(safeDestination(bad)).toBe("/");
  });
});
