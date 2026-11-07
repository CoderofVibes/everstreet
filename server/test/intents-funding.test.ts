// Escrow funding from another token through the intents verifier, through the app's routes over
// the synthetic doubles (server/test/intents-chain.ts follows NEAR's verifier; the same steps run
// against the real verifier on a local node in contracts/intents-funding). The buyer's wallet
// registers its key, deposits, signs its side and withdraws; Everstreet only quotes and fills as
// the solver; escrow is funded only when the business contract shows it.

import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nep413Digest } from "../src/identity.ts";
import { intentMessage, versionedNonce } from "../src/intentsFunding.ts";
import { toB58 } from "../src/lightClient.ts";
import type { Json } from "./customer-world.ts";
import { ALT_TOKEN, attachIntents, VERIFIER } from "./intents-chain.ts";
import { BUYER, PRICE, proposal, SELLER, saleWorld } from "./sale-world.ts";

async function world() {
  const s = await saleWorld();
  const chain = s.w.chain as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
  };
  const x = attachIntents(
    s.w.chain,
    { token: s.TOKEN, ledger: { balances: chain.balances, registered: chain.tokenRegistered } },
    1_000_000_000n,
  );
  // The buyer pays in tALT and holds no tUSD.
  chain.balances.set(BUYER, 0n);
  x.alt.ledger.balances.set(BUYER, 400_000_000n);
  x.alt.ledger.registered.add(BUYER);
  s.w.state.app = s.w.make(s.w.state.store, undefined, {
    customer: s.w.options(),
    intents: {
      bindings: [
        {
          business_id: s.biz,
          network: "testnet",
          account: s.BUSINESS,
          asset: s.TOKEN,
          verifier: VERIFIER,
          offers: [{ token: ALT_TOKEN, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" }],
        },
      ],
      solver: x.solver,
    },
  });
  // The buyer's wallet key.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pk = `ed25519:${toB58(Uint8Array.from(publicKey.export({ format: "der", type: "spki" }).subarray(-32)))}`;
  /** The wallet's signMessage answer for what the quote asks it to sign. */
  const signWith = (q: Json, callbackUrl: string | null = "http://localhost/sales/x") => ({
    public_key: pk,
    callback_url: callbackUrl,
    signature: sign(
      null,
      nep413Digest({
        message: q.sign.message,
        nonce: Buffer.from(q.sign.nonce, "base64"),
        recipient: q.sign.recipient,
        callbackUrl,
      }),
      privateKey,
    ).toString("base64"),
  });
  const call = (receiverId: string, methodName: string, args: Json, deposit = "1") =>
    s.wallet(BUYER, { receiverId, methodName, args, gas: "100000000000000", deposit });
  return { s, x, pk, signWith, call };
}

const give = (BigInt(PRICE) * 5n) / 4n; // 312.5 tALT for 250 tUSD

describe("escrow funding through the intents verifier", () => {
  it("quote → deposited → swapped → delivered → funded, only when the business contract shows it", async () => {
    const { s, x, pk, signWith, call } = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");

    // The seller can't quote: only the deal's buyer funds it (one answer for anyone else).
    expect(
      (await s.ava(`/api/sales/${s.biz}/intents/quote`, "POST", { token: ALT_TOKEN })).body.code,
    ).toBe("no_deal");
    const q = await s.noah(`/api/sales/${s.biz}/intents/quote`, "POST", { token: ALT_TOKEN });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({
      stage: "quoted",
      give: { token: ALT_TOKEN, amount: String(give) },
      get: { amount: PRICE },
      solver: { source: "synthetic" },
    });

    // Signing before the key is registered, or before the deposit: refused, nothing moved.
    let r = await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body));
    expect(r.body.code).toBe("key_not_registered");
    call(VERIFIER, "add_public_key", { public_key: pk });
    r = await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body));
    expect(r.body.code).toBe("underpaid");

    call(ALT_TOKEN, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(give), msg: "" });
    expect((await s.noah(`/api/intents/${q.body.id}`)).body.stage).toBe("deposited");

    // A signature over something else is refused.
    const wrong = signWith({
      ...q.body,
      sign: { ...q.body.sign, message: `${q.body.sign.message} ` },
    });
    expect((await s.noah(`/api/intents/${q.body.id}/sign`, "POST", wrong)).body.code).toBe(
      "bad_signature",
    );

    r = await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body));
    expect(r.status).toBe(200);
    expect(r.body.stage).toBe("swapped");
    expect(
      x.verifier.view("mt_balance_of", { account_id: BUYER, token_id: `nep141:${s.TOKEN}` }),
    ).toBe(JSON.stringify(PRICE));

    // Delivered: in the buyer's own account; the escrow still isn't funded.
    call(VERIFIER, "ft_withdraw", { token: s.TOKEN, receiver_id: BUYER, amount: PRICE });
    expect((await s.noah(`/api/intents/${q.body.id}`)).body.stage).toBe("delivered");
    expect((await s.noah(`/api/sales/${s.biz}`)).body.control.live_deal.escrow).toBe("0");

    // Funded: by the existing fund request, confirmed by the business contract.
    await s.act(s.noah, BUYER, "fund");
    const done = await s.noah(`/api/sales/${s.biz}/intents`);
    expect(done.body.funding.stage).toBe("funded");
  });

  it("a lost response resolves from the verifier's nonce record; replay is refused", async () => {
    const { s, x, pk, signWith, call } = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    call(VERIFIER, "add_public_key", { public_key: pk });
    const q = await s.noah(`/api/sales/${s.biz}/intents/quote`, "POST", { token: ALT_TOKEN });
    call(ALT_TOKEN, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(give), msg: "" });
    x.solver.loseNext = true;
    const r = await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body));
    // The nonce is spent, so the status read already knows it swapped.
    expect(r.body.stage).toBe("swapped");
    const again = await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body));
    expect(again.body.stage).toBe("swapped");
    expect(
      x.verifier.view("mt_balance_of", { account_id: BUYER, token_id: `nep141:${s.TOKEN}` }),
    ).toBe(JSON.stringify(PRICE));
  });

  it("an expired quote is refused and the unswapped deposit is refunded to the buyer", async () => {
    const { s, x, pk, signWith, call } = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    call(VERIFIER, "add_public_key", { public_key: pk });
    const q = await s.noah(`/api/sales/${s.biz}/intents/quote`, "POST", { token: ALT_TOKEN });
    call(ALT_TOKEN, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(give), msg: "" });
    expect((await s.noah(`/api/intents/${q.body.id}`)).body.stage).toBe("deposited");
    const late = Date.now() + 10 * 60_000;
    const realNow = Date.now;
    Date.now = () => late;
    x.verifier.now = () => late;
    try {
      expect(
        (await s.noah(`/api/intents/${q.body.id}/sign`, "POST", signWith(q.body))).body.code,
      ).toBe("expired");
      expect((await s.noah(`/api/intents/${q.body.id}`)).body.stage).toBe("expired");
      call(VERIFIER, "ft_withdraw", { token: ALT_TOKEN, receiver_id: BUYER, amount: String(give) });
      expect((await s.noah(`/api/intents/${q.body.id}`)).body.stage).toBe("refunded");
    } finally {
      Date.now = realNow;
    }
    expect(x.alt.ledger.balances.get(BUYER)).toBe(400_000_000n);
  });

  it("the verifier double refuses what the real one refuses", async () => {
    const { s, x, pk, call } = await world();
    call(VERIFIER, "add_public_key", { public_key: pk });
    call(ALT_TOKEN, "ft_transfer_call", { receiver_id: VERIFIER, amount: "100", msg: "" });
    const deadline = Date.now() + 60_000;
    const side = (signer: string, giveAmt: string, getAmt: string, recipient = VERIFIER) => {
      const nonce = versionedNonce(x.verifier.salt, deadline);
      const message = intentMessage({
        signer,
        deadlineMs: deadline,
        give: { token: signer === BUYER ? ALT_TOKEN : s.TOKEN, amount: giveAmt },
        get: { token: signer === BUYER ? s.TOKEN : ALT_TOKEN, amount: getAmt },
      });
      const digest = nep413Digest({ message, nonce, recipient });
      return {
        standard: "nep413",
        payload: { message, nonce: nonce.toString("base64"), recipient },
        public_key: signer === BUYER ? pk : x.solver.publicKey,
        signature: `ed25519:${toB58(Uint8Array.from(signer === BUYER ? Buffer.alloc(64) : x.solver.sign(digest)))}`,
      };
    };
    // A forged buyer side (no valid signature) and the solver withdrawing the buyer's deposit.
    const refusal = (out: Json) => JSON.stringify(out.status);
    expect(
      refusal(
        call(
          VERIFIER,
          "execute_intents",
          { signed: [side(BUYER, "100", "80"), side("solver.synthetic.near", "80", "100")] },
          "0",
        ),
      ),
    ).toContain("invalid signature");
    expect(
      refusal(
        s.wallet("solver.synthetic.near", {
          receiverId: VERIFIER,
          methodName: "ft_withdraw",
          args: { token: ALT_TOKEN, receiver_id: "solver.synthetic.near", amount: "100" },
          gas: "1",
          deposit: "1",
        }),
      ),
    ).toContain("insufficient balance");
    expect(
      x.verifier.view("mt_balance_of", { account_id: BUYER, token_id: `nep141:${ALT_TOKEN}` }),
    ).toBe('"100"');
  });
});

describe("the bytes the verifier checks", () => {
  // The same vector as contracts/intents-funding/tests/sandbox.rs (NEAR's own NEP-413 hashing).
  it("builds the same nonce and NEP-413 hash as NEAR's Rust tooling", () => {
    const message = intentMessage({
      signer: "noah",
      deadlineMs: 1_794_000_000_123,
      give: { token: "talt", amount: "200000000" },
      get: { token: "tusd", amount: "200000000" },
    });
    const nonce = versionedNonce("a1b2c3d4", 1_794_000_000_123, Buffer.alloc(15, 7));
    expect(nonce.toString("hex")).toBe(
      "5628f6c600a1b2c3d4c0d461be7e91e518070707070707070707070707070707",
    );
    expect(nep413Digest({ message, nonce, recipient: "verifier" }).toString("hex")).toBe(
      "cbc20abc4d73b60d276e52b50ced5f17b4fa27cf58e42b9ba7773a2451028532",
    );
    expect(
      nep413Digest({
        message,
        nonce,
        recipient: "verifier",
        callbackUrl: "http://localhost/sales/x",
      }).toString("hex"),
    ).toBe("c77270fa16d21ec2b56b9986bfb4a16c4ddaf3d9e46e5fb4fc2b2e5f7a1cd856");
  });
});
