// Astra review of 003we: a real verification route must not issue a usable session after logout.
// Ephemeral account-proof key only; in-memory SQLite and a deferred synthetic key reader.
// No wallet, existing credential, transaction, network or provider is used.
import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { base58Encode } from "../src/customerWriter.ts";
import { openDb } from "../src/db.ts";
import { AccountSignIn, nep413Digest } from "../src/identity.ts";
import { Store } from "../src/store.ts";

it.each(["pending read", "response not delivered", "newer challenge"] as const)(
  "ending or replacing an attempt fences its old session: %s",
  async (scenario) => {
    const db = openDb(":memory:");
    let finishRead: (full: boolean) => void = () => {};
    let entered: () => void = () => {};
    const reachedRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const read = new Promise<boolean>((resolve) => {
      finishRead = resolve;
    });
    try {
      const store = new Store(db);
      const identity = new AccountSignIn(store, {
        recipient: "everstreet.local",
        network: "testnet",
        reader: {
          async isFullAccessKey() {
            entered();
            return read;
          },
        },
      });
      const app = everstreetApi(store, {
        environment: "Synthetic account lifetime test",
        localPreview: false,
        identity: { mode: "verified", signIn: identity },
      });
      const challengeResponse = await app.request("/api/session/challenge", { method: "POST" });
      const binding = challengeResponse.headers
        .getSetCookie()
        .find((value) => value.startsWith("es_sign_in="))
        ?.split(";")[0];
      expect(binding).toBeTruthy();
      const { challenge } = await challengeResponse.json();
      const key = generateKeyPairSync("ed25519");
      const raw = key.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
      const signature = sign(
        null,
        nep413Digest({
          message: challenge.message,
          nonce: Buffer.from(challenge.nonce, "base64"),
          recipient: challenge.recipient,
        }),
        key.privateKey,
      ).toString("base64");
      const pending = app.request("/api/session/verify", {
        method: "POST",
        headers: { cookie: binding as string, "content-type": "application/json" },
        body: JSON.stringify({
          account_id: "fictional-customer.testnet",
          public_key: `ed25519:${base58Encode(raw)}`,
          signature,
          nonce: challenge.nonce,
        }),
      });
      await reachedRead;
      // In this case the server has committed the proof, but the browser hasn't received its
      // response cookie yet. Logout therefore still carries only the challenge binding.
      let completed: Response | undefined;
      if (scenario === "response not delivered") {
        finishRead(true);
        completed = await pending;
      }
      if (scenario === "newer challenge") {
        const newer = await app.request("/api/session/challenge", {
          method: "POST",
          headers: { cookie: binding as string },
        });
        expect(newer.status).toBe(200);
      } else {
        const logout = await app.request("/api/session", {
          method: "DELETE",
          headers: { cookie: binding as string },
        });
        expect(logout.status).toBe(200);
      }
      finishRead(true);
      const late = completed ?? (await pending);
      const session = late.headers
        .getSetCookie()
        .find((value) => value.startsWith("es_session="))
        ?.split(";")[0];
      const me = await app.request("/api/me", { headers: { cookie: session ?? "" } });
      const result = await me.json();
      expect(
        result.person,
        `old verification returned ${late.status} after ${scenario}`,
      ).toBeNull();
    } finally {
      finishRead(false);
      db.close();
    }
  },
);
