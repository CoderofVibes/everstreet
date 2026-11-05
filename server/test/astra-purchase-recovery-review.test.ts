// Actual purchase routes with the existing fictional chain double. No network or wallet keys.
import { expect, it } from "vitest";
import { customerWorld, FRESH } from "./customer-world.ts";

async function pendingPurchase() {
  const w = await customerWorld();
  const offer = await w.offer();
  const root = `/api/customer/offers/${offer}`;
  const setup = await w.dana(`${root}/purchase-setup`);
  expect(setup.status).toBe(200);
  w.chain.walletCall(FRESH, setup.body.shell.call);
  const quote = await w.dana(`${root}/purchase-setup?units=100`);
  expect(quote.status).toBe(200);
  const created = await w.dana(`${root}/purchases`, "POST", {
    idempotency_key: "astra-pending-original",
    units: 100,
    terms_digest: quote.body.preview.terms_digest,
  });
  expect(created.status).toBe(201);
  const purchase = created.body.purchase;
  const path = `/api/customer/purchases/${purchase.id}`;
  expect((await w.dana(`${path}/requested`, "POST", {})).status).toBe(200);
  // Wallet has been asked; inclusion and the wallet reply are both still unanswered.
  const check = await w.dana(`${path}/check`, "POST", {});
  expect(check.body.purchase.state).toBe("unknown");
  expect(check.body.resolution.purchase_seq_now).toBe(0);
  return { w, root, path, purchase };
}

it("keeps a wallet-requested purchase recoverable after setting it aside and late inclusion", async () => {
  const { w, path, purchase } = await pendingPurchase();
  try {
    await w.dana(`${path}/abandon`, "POST", {});
    // A lower sequence at the earlier read did not cancel this already-requested payment.
    const included = w.chain.walletCall(FRESH, purchase.call);
    const recovered = await w.dana(`${path}/check`, "POST", {
      tx_hash: included.transaction.hash,
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.purchase.state).toBe("confirmed");
    expect(recovered.body.resolution).toMatchObject({ kind: "confirmed", units: 100 });
  } finally {
    w.rw.store.db.close();
  }
});

it("does not expose a replacement payment while the original wallet request is unresolved", async () => {
  const { w, root, path } = await pendingPurchase();
  try {
    await w.dana(`${path}/abandon`, "POST", {});
    const quote = await w.dana(`${root}/purchase-setup?units=100`);
    const replacement = await w.dana(`${root}/purchases`, "POST", {
      idempotency_key: "astra-pending-replacement",
      units: 100,
      terms_digest: quote.body.preview.terms_digest,
    });
    expect(replacement.status).toBe(409);
    expect(replacement.body.purchase?.state).not.toBe("prepared");
  } finally {
    w.rw.store.db.close();
  }
});

it("does not expire a wallet request before the wallet creates its transaction", async () => {
  const { w, path, purchase } = await pendingPurchase();
  try {
    // The approval popup can remain open. This synthetic block advance predates signing;
    // a wallet may subsequently choose a CURRENT reference block for its transaction.
    w.chain.height += 100_000;
    w.chain.ts += 100_000_000n;
    const waiting = await w.dana(`${path}/check`, "POST", {});
    expect(waiting.status).toBe(200);
    // The same reviewed call is still valid under the contract's registration/sequence rules.
    const included = w.chain.walletCall(FRESH, purchase.call);
    expect(w.chain.ent(FRESH)).toMatchObject({ free: "100", purchase_seq: 1 });
    const recovered = await w.dana(`${path}/check`, "POST", {
      tx_hash: included.transaction.hash,
    });
    expect(waiting.body.purchase.state).toBe("unknown");
    expect(recovered.body.purchase.state).toBe("confirmed");
  } finally {
    w.rw.store.db.close();
  }
});

it("can recover a historical accepted purchase after a later missing-registration reading", async () => {
  const { w, path, purchase } = await pendingPurchase();
  try {
    const accepted = w.chain.walletCall(FRESH, purchase.call);
    expect(w.chain.ent(FRESH)).toMatchObject({ free: "100", purchase_seq: 1 });
    // Inject a later null-entitlement observation at the existing read boundary. This does not
    // model consumption/unregister itself; it tests that current absence cannot erase the
    // original transaction's authoritative outcome. Actual Rust lifecycle coverage is separate.
    w.chain.ents.delete(FRESH);
    w.chain.tick(1_000n);
    expect((await w.dana(`${path}/check`, "POST", {})).status).toBe(200);
    const recovered = await w.dana(`${path}/check`, "POST", {
      tx_hash: accepted.transaction.hash,
    });
    expect(recovered.body.purchase.state).toBe("confirmed");
  } finally {
    w.rw.store.db.close();
  }
});
