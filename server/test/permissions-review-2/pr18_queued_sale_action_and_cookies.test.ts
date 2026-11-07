// Promise 1 (queued action): an owner action the seller reviewed before the close, sent after it.
// Promise 7: the session cookie's attributes.
import { describe, expect, it } from "vitest";
import { AccountSignIn } from "../../src/identity.ts";
import { customerWorld } from "../customer-world.ts";
import { BUYER, PRICE, reviewWorld, SELLER } from "./world.ts";

describe("pr18: queued owner actions and the session cookie", () => {
  it("the seller's appointment reviewed before the close is refused by the contract after it", async () => {
    const w = await reviewWorld();
    // The business has no operator yet: the seller reviews the appointment of the platform's
    // metering account and stores the request, but the wallet isn't asked until after the sale.
    w.sale.operators.fill(null);
    const p = await w.prepare(w.ava, "appoint", {});
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const c = await w.ava(`/api/sales/${w.biz}/actions`, "POST", {
      kind: "appoint",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "queued-appoint-0001",
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const action = c.body.action;
    expect((await w.ava(`/api/sales/actions/${action.id}/requested`, "POST", {})).body.ask).toBe(
      "granted",
    );
    // The sale happens: propose, register, fund, both accept.
    await w.proposeAndRegister();
    await w.fundAndClose();
    expect(w.control().owner).toBe(BUYER);
    // The former owner's wallet now sends the stored call.
    const out = w.wallet(SELLER, action.call);
    expect(JSON.stringify(out.status)).toMatch(/Failure|E_/);
    await w.ava(`/api/sales/actions/${action.id}/requested`, "POST", {
      tx_hash: out.transaction.hash,
    });
    const check = await w.ava(`/api/sales/actions/${action.id}/check`, "POST", {});
    expect(check.status).toBe(200);
    expect(["refused", "no_longer_possible"]).toContain(check.body.resolution?.kind);
    // The contract's operators didn't change by the seller's hand.
    const control = w.sale.controlView();
    expect(control.generation).toBe(2);
    expect(String(control.live_deal)).toBe("null");
    expect(BigInt(PRICE)).toBeGreaterThan(0n);
  });

  it("the verified session cookie is HttpOnly and SameSite", async () => {
    const w = await customerWorld();
    const signIn = new AccountSignIn(w.state.store, {
      recipient: "everstreet.local",
      network: "testnet",
      reader: { isFullAccessKey: async () => true },
    });
    const app = w.make(w.state.store, undefined, {
      localPreview: false,
      identity: { mode: "verified", signIn },
    });
    const res = await app.request("/api/session/challenge", { method: "POST" });
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/es_sign_in=.*HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\/api\/session/);
    // A preview session route is not even present in verified mode.
    expect((await app.request("/api/session/as/x", { method: "POST" })).status).toBe(404);
  });
});
