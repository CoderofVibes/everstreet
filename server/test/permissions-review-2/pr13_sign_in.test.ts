// Promise 7: signing in proves control of the account; no replayed, forged, cross-site or reused
// sign-in; a session belongs to one account.
import { describe, expect, it } from "vitest";
import { AccountSignIn, nep413Digest } from "../../src/identity.ts";
import type { Json } from "../customer-world.ts";
import { customerWorld } from "../customer-world.ts";
import { nearKey } from "./world.ts";

const RECIPIENT = "everstreet.local";
const CALLBACK = "http://127.0.0.1:1/signin/return";

async function verifiedApp() {
  const w = await customerWorld();
  const keys = new Map<string, string>();
  const clock = { now: Date.now() };
  const signIn = new AccountSignIn(w.state.store, {
    recipient: RECIPIENT,
    network: "testnet",
    reader: { isFullAccessKey: async (a, k) => keys.get(a) === k },
    callbackUrl: CALLBACK,
    now: () => clock.now,
  });
  const app = w.make(w.state.store, undefined, {
    localPreview: false,
    identity: { mode: "verified", signIn },
  });
  const cookieOf = (res: Response, name: string) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] as string)
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null;
  const call = async (
    path: string,
    init: { method?: string; body?: unknown; cookies?: string[] } = {},
  ) => {
    const res = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.cookies?.length ? { cookie: init.cookies.join("; ") } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Json,
      session: cookieOf(res, "es_session"),
      binding: cookieOf(res, "es_sign_in"),
    };
  };
  const challenge = async () => {
    const r = await call("/api/session/challenge", { method: "POST" });
    expect(r.status).toBe(200);
    return { ...r.body.challenge, binding: r.binding as string };
  };
  const answer = (
    key: ReturnType<typeof nearKey>,
    c: { message: string; nonce: string; recipient: string },
    callbackUrl: string | null = null,
  ) =>
    key.sign(
      nep413Digest({
        message: c.message,
        nonce: Buffer.from(c.nonce, "base64"),
        recipient: c.recipient,
        callbackUrl,
      }),
    );
  const verify = (body: Json, binding: string | null, cookies: string[] = []) =>
    call("/api/session/verify", {
      method: "POST",
      body,
      cookies: [...(binding ? [`es_sign_in=${binding}`] : []), ...cookies],
    });
  const me = (session: string | null) =>
    call("/api/me", { cookies: session ? [`es_session=${session}`] : [] });
  return { w, app, keys, clock, call, challenge, answer, verify, me };
}

describe("pr13: verified sign-in", () => {
  it("a proven key signs in; the same proof again does not", async () => {
    const t = await verifiedApp();
    const key = nearKey();
    t.keys.set("ava.near", key.publicKey);
    const c = await t.challenge();
    const body = {
      account_id: "ava.near",
      public_key: key.publicKey,
      signature: t.answer(key, c, CALLBACK),
      nonce: c.nonce,
    };
    const ok = await t.verify(body, c.binding);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await t.me(ok.session)).body.account).toBe("ava.near");
    // Replay: the same nonce and signature.
    const again = await t.verify(body, c.binding);
    expect(again.status).toBe(401);
    expect(again.session).toBeNull();
    // A fresh challenge with the old signature: the nonce differs, so the signature doesn't fit.
    const c2 = await t.challenge();
    const reuse = await t.verify({ ...body, nonce: c2.nonce }, c2.binding);
    expect(reuse.status).toBe(401);
  });

  it("another browser can't finish a proof it didn't start", async () => {
    const t = await verifiedApp();
    const key = nearKey();
    t.keys.set("ava.near", key.publicKey);
    const c = await t.challenge();
    const other = await t.challenge();
    const body = {
      account_id: "ava.near",
      public_key: key.publicKey,
      signature: t.answer(key, c, CALLBACK),
      nonce: c.nonce,
    };
    expect((await t.verify(body, null)).status).toBe(401);
    expect((await t.verify(body, other.binding)).status).toBe(401);
    expect((await t.verify(body, "A".repeat(43))).status).toBe(401);
    // The right browser still can: a wrong binding doesn't spend the challenge.
    const ok = await t.verify(body, c.binding);
    expect(ok.status).toBe(201);
  });

  it("a signature that isn't over this challenge, or by a key the account doesn't hold", async () => {
    const t = await verifiedApp();
    const key = nearKey();
    const thief = nearKey();
    t.keys.set("ava.near", key.publicKey);
    t.keys.set("thief.near", thief.publicKey);
    // The thief's own valid key, claiming Ava's account.
    let c = await t.challenge();
    const claim = await t.verify(
      {
        account_id: "ava.near",
        public_key: thief.publicKey,
        signature: t.answer(thief, c),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(claim.status).toBe(401);
    expect(claim.session).toBeNull();
    // Ava's key, but a signature for another recipient or another callback.
    c = await t.challenge();
    const wrongRecipient = await t.verify(
      {
        account_id: "ava.near",
        public_key: key.publicKey,
        signature: t.answer(key, { ...c, recipient: "other.app" }),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(wrongRecipient.status).toBe(401);
    c = await t.challenge();
    const wrongCallback = await t.verify(
      {
        account_id: "ava.near",
        public_key: key.publicKey,
        signature: t.answer(key, c, "http://evil.example/signin/return"),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(wrongCallback.status).toBe(401);
    // Ava's key, but not a full-access key of the account any more.
    t.keys.delete("ava.near");
    c = await t.challenge();
    const noKey = await t.verify(
      {
        account_id: "ava.near",
        public_key: key.publicKey,
        signature: t.answer(key, c),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(noKey.status).toBe(401);
    expect(noKey.body.code).toBe("sign_in_key");
  });

  it("no name-only, preview or expired session authenticates", async () => {
    const t = await verifiedApp();
    expect(
      (await t.call("/api/session", { method: "POST", body: { name: "Anyone" } })).status,
    ).toBe(403);
    expect((await t.call("/api/people")).status).toBe(404);
    expect((await t.call(`/api/session/as/${t.w.f.ava.id}`, { method: "POST" })).status).toBe(404);
    // A preview session row (what the local preview mints) is nobody here.
    t.w.state.store.db
      .prepare("INSERT INTO sessions (token, person_id, created_at) VALUES ('preview-token', ?, ?)")
      .run(t.w.f.ava.id, new Date().toISOString());
    expect((await t.me("preview-token")).body.person).toBeNull();
    // A verified session ends at its expiry by the server's clock.
    const key = nearKey();
    t.keys.set("ava.near", key.publicKey);
    const c = await t.challenge();
    const ok = await t.verify(
      {
        account_id: "ava.near",
        public_key: key.publicKey,
        signature: t.answer(key, c),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(ok.status).toBe(201);
    expect((await t.me(ok.session)).body.person).not.toBeNull();
    t.clock.now += 12 * 3_600_000 + 1;
    expect((await t.me(ok.session)).body.person).toBeNull();
  });

  it("signing in as another account replaces the session; it never merges two accounts", async () => {
    const t = await verifiedApp();
    const a = nearKey();
    const b = nearKey();
    t.keys.set("ava.near", a.publicKey);
    t.keys.set("ben.near", b.publicKey);
    let c = await t.challenge();
    const first = await t.verify(
      {
        account_id: "ava.near",
        public_key: a.publicKey,
        signature: t.answer(a, c),
        nonce: c.nonce,
      },
      c.binding,
    );
    expect(first.status).toBe(201);
    c = await t.challenge();
    const second = await t.verify(
      {
        account_id: "ben.near",
        public_key: b.publicKey,
        signature: t.answer(b, c),
        nonce: c.nonce,
      },
      c.binding,
      [`es_session=${first.session}`],
    );
    expect(second.status).toBe(201);
    expect((await t.me(second.session)).body.account).toBe("ben.near");
    expect(first.body.person.id).not.toBe(second.body.person.id);
    // The replaced session is gone on the server.
    expect((await t.me(first.session)).body.person).toBeNull();
    // Signing out ends the session; the cookie is worthless afterwards.
    const out = await t.call("/api/session", {
      method: "DELETE",
      cookies: [`es_session=${second.session}`],
    });
    expect(out.status).toBe(200);
    expect((await t.me(second.session)).body.person).toBeNull();
  });

  it("an account already linked to another person here can't be claimed by signing in", async () => {
    const t = await verifiedApp();
    // Cara's account was linked to Cara in the preview world (chain_accounts). A wallet holding a
    // full-access key for it signs in: refused, not silently merged with Cara's records.
    const key = nearKey();
    t.keys.set("cara.near", key.publicKey);
    const c = await t.challenge();
    const r = await t.verify(
      {
        account_id: "cara.near",
        public_key: key.publicKey,
        signature: t.answer(key, c),
        nonce: c.nonce,
      },
      c.binding,
    );
    // Finding 8 (fixed): the same 401 as any other refused sign-in, so the key holder learns
    // nothing about whether the account has records here.
    expect(r.status).toBe(401);
    expect(r.session).toBeNull();
  });
});
