// Promise 5: signing in proves control of the account, and every refusal is the same 401, including
// for an account already linked to someone else here. A wallet holding a key for "stranger.near"
// (linked to Sam by the fixture, not through sign-in) signs a valid challenge; another wallet sends
// a signature that doesn't verify. The two refusals are compared byte for byte.

import { sign as edSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountSignIn, nep413Digest } from "../../src/identity.ts";
import { toB58 } from "../../src/lightClient.ts";
import type { Json } from "../customer-world.ts";
import { reviewWorld } from "./world.ts";

const key = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { priv: privateKey, pub: `ed25519:${toB58(Uint8Array.from(raw))}` };
};

async function verifiedWorld() {
  const r = await reviewWorld();
  const signIn = new AccountSignIn(r.w.state.store, {
    recipient: "everstreet.local",
    network: "testnet",
    // Every key is a full-access key of its account (the chain says yes to all of them).
    reader: { isFullAccessKey: async () => true },
    callbackUrl: "http://localhost:4999/signin/return",
  });
  r.w.state.app = r.w.make(r.w.state.store, undefined, {
    localPreview: false,
    identity: { mode: "verified", signIn },
  });
  const raw = async (path: string, method: string, cookie: string, body?: unknown) => {
    const res = await r.w.state.app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Json,
      setCookie: res.headers.get("set-cookie") ?? "",
    };
  };
  /** A sign-in attempt by a wallet for `account`: challenge, sign (or not), verify. */
  const attempt = async (account: string, o: { badSignature?: boolean } = {}) => {
    const ch = await raw("/api/session/challenge", "POST", "", {});
    const binding = /es_sign_in=([^;]+)/.exec(ch.setCookie)?.[1] as string;
    const k = key();
    const digest = nep413Digest({
      message: ch.body.challenge.message,
      nonce: Buffer.from(ch.body.challenge.nonce, "base64"),
      recipient: ch.body.challenge.recipient,
      callbackUrl: ch.body.challenge.callback_url,
    });
    const sig = edSign(null, digest, k.priv);
    if (o.badSignature) sig[0] = (sig[0] as number) ^ 0xff;
    return raw("/api/session/verify", "POST", `es_sign_in=${binding}`, {
      account_id: account,
      public_key: k.pub,
      signature: sig.toString("base64"),
      nonce: ch.body.challenge.nonce,
    });
  };
  return { ...r, raw, attempt };
}

describe("pr11 a wallet holding a key for an account linked to another person here", () => {
  it("is refused exactly like a signature that doesn't verify", async () => {
    const v = await verifiedWorld();
    // Control proven: a fresh account signs in.
    const ok = await v.attempt("fresh-wallet.near");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.person.display_name).toBe("fresh-wallet.near");

    const bad = await v.attempt("another-wallet.near", { badSignature: true });
    expect(bad.status).toBe(401);
    // "stranger.near" is Sam's chain account here (a fixture link, never a sign-in).
    const linked = await v.attempt("stranger.near");
    expect(linked.status).toBe(401);
    expect(linked.body, "the refusal body must not differ").toEqual(bad.body);
  });

  it("a key the chain does not list as full-access, and a replayed challenge, are refused", async () => {
    const r = await reviewWorld();
    const signIn = new AccountSignIn(r.w.state.store, {
      recipient: "everstreet.local",
      network: "testnet",
      reader: { isFullAccessKey: async () => false },
    });
    r.w.state.app = r.w.make(r.w.state.store, undefined, {
      localPreview: false,
      identity: { mode: "verified", signIn },
    });
    const res = await r.w.state.app.request("/api/session/challenge", { method: "POST" });
    const ch = (await res.json()) as Json;
    const binding = /es_sign_in=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    const k = key();
    const sig = edSign(
      null,
      nep413Digest({
        message: ch.challenge.message,
        nonce: Buffer.from(ch.challenge.nonce, "base64"),
        recipient: ch.challenge.recipient,
      }),
      k.priv,
    ).toString("base64");
    const body = JSON.stringify({
      account_id: "fresh-wallet.near",
      public_key: k.pub,
      signature: sig,
      nonce: ch.challenge.nonce,
    });
    const first = await r.w.state.app.request("/api/session/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `es_sign_in=${binding}` },
      body,
    });
    expect(first.status).toBe(401);
    // Replay of the same challenge (now spent), even with the same cookie.
    const again = await r.w.state.app.request("/api/session/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `es_sign_in=${binding}` },
      body,
    });
    expect(again.status).toBe(401);
    // A preview session never authenticates in verified mode.
    expect((await r.ava("/api/me")).body.person).toBeNull();
  });
});
