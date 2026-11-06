// Permissions review, promise 7: signing in proves control of the account. No replayed, forged,
// cross-browser or reused sign-in; a preview session never authenticates in verified mode.
import { sign } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../../src/db.ts";
import { nep413Digest } from "../../src/identity.ts";
import { BUYER, handoverWorld } from "../handoverWorld.ts";
import { appBrowser, FOUNDER, nearKey } from "../lifecycleWorld.ts";

describe("pr11: verified sign-in", () => {
  const worldP = handoverWorld();
  afterAll(async () => (await worldP).cleanup());

  it("a signed challenge can't be replayed, moved to another browser, or signed by a foreign key", async () => {
    const w = await worldP;
    const app = w.composed.app;
    const browser = appBrowser(app);
    const ch = (await browser("/api/session/challenge", "POST")).body.challenge as {
      message: string;
      nonce: string;
      recipient: string;
    };
    const digest = nep413Digest({
      message: ch.message,
      nonce: Buffer.from(ch.nonce, "base64"),
      recipient: ch.recipient,
    });
    const body = {
      account_id: FOUNDER,
      public_key: w.b.ava.id,
      signature: sign(null, digest, w.b.ava.privateKey).toString("base64"),
      nonce: ch.nonce,
    };
    // Another browser (no binding cookie) presents the same proof first: refused, challenge kept.
    const other = appBrowser(app);
    expect((await other("/api/session/verify", "POST", body)).status).toBe(401);
    expect((await other("/api/me")).body.person).toBeNull();
    // The initiating browser signs in.
    expect((await browser("/api/session/verify", "POST", body)).status).toBe(201);
    expect((await browser("/api/me")).body.person).toBeTruthy();
    // Replay of the same proof by the same browser: refused.
    expect((await browser("/api/session/verify", "POST", body)).status).toBe(401);
    // A fresh challenge signed by a key that isn't a full-access key of the account: refused.
    const b3 = appBrowser(app);
    const ch3 = (await b3("/api/session/challenge", "POST")).body.challenge as typeof ch;
    const rogue = nearKey();
    const d3 = nep413Digest({
      message: ch3.message,
      nonce: Buffer.from(ch3.nonce, "base64"),
      recipient: ch3.recipient,
    });
    expect(
      (
        await b3("/api/session/verify", "POST", {
          account_id: BUYER,
          public_key: rogue.id,
          signature: sign(null, d3, rogue.privateKey).toString("base64"),
          nonce: ch3.nonce,
        })
      ).status,
    ).toBe(401);
    // A valid signature by the buyer's key but naming the seller's account: refused.
    const b4 = appBrowser(app);
    const ch4 = (await b4("/api/session/challenge", "POST")).body.challenge as typeof ch;
    const d4 = nep413Digest({
      message: ch4.message,
      nonce: Buffer.from(ch4.nonce, "base64"),
      recipient: ch4.recipient,
    });
    expect(
      (
        await b4("/api/session/verify", "POST", {
          account_id: FOUNDER,
          public_key: w.noah.id,
          signature: sign(null, d4, w.noah.privateKey).toString("base64"),
          nonce: ch4.nonce,
        })
      ).status,
    ).toBe(401);
  });

  it("a preview session token and a name-only join never authenticate in verified mode", async () => {
    const w = await worldP;
    const app = w.composed.app;
    // A preview-mode session row planted in the database (as the local preview would mint).
    const db = openDb(w.b.db);
    try {
      db.prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)").run(
        "planted-preview-token",
        w.b.w.f.ava.id,
        new Date().toISOString(),
      );
    } finally {
      db.close();
    }
    const res = await app.request("/api/me", {
      headers: { cookie: "es_session=planted-preview-token" },
    });
    expect(((await res.json()) as { person: unknown }).person).toBeNull();
    const join = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nobody" }),
    });
    expect(join.status).toBe(403);
    // Actor switching is absent.
    expect((await app.request("/api/people")).status).toBe(404);
    expect(
      (await app.request(`/api/session/as/${w.b.w.f.ava.id}`, { method: "POST" })).status,
    ).toBe(404);
  });

  it("a logout ends the session on the server, not only the cookie", async () => {
    const w = await worldP;
    const app = w.composed.app;
    const chRes = await app.request("/api/session/challenge", { method: "POST" });
    const binding = /es_sign_in=([^;]+)/.exec(chRes.headers.get("set-cookie") ?? "")?.[1] as string;
    const ch = (
      (await chRes.json()) as { challenge: { message: string; nonce: string; recipient: string } }
    ).challenge;
    const digest = nep413Digest({
      message: ch.message,
      nonce: Buffer.from(ch.nonce, "base64"),
      recipient: ch.recipient,
    });
    const verify = await app.request("/api/session/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `es_sign_in=${binding}` },
      body: JSON.stringify({
        account_id: FOUNDER,
        public_key: w.b.ava.id,
        signature: sign(null, digest, w.b.ava.privateKey).toString("base64"),
        nonce: ch.nonce,
      }),
    });
    expect(verify.status).toBe(201);
    const token = /es_session=([^;]+)/.exec(verify.headers.get("set-cookie") ?? "")?.[1] as string;
    const me = async () =>
      (
        (await (
          await app.request("/api/me", { headers: { cookie: `es_session=${token}` } })
        ).json()) as {
          person: unknown;
        }
      ).person;
    expect(await me()).toBeTruthy();
    await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `es_session=${token}` },
    });
    // The old cookie value, kept by an attacker, is dead.
    expect(await me()).toBeNull();
  });
});
