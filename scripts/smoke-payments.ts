// A real testnet run of the payment path, through the same NearChain the app uses: a customer
// account and a business account (v2 shared code, no keys), a paid order, the same order paid
// again (returned), a cancellation refunded, a delivered order, and a withdrawal that the
// reserve limits. Writes data/evidence/payments-testnet.json.
//
//   npm run smoke:payments

import { mkdirSync, writeFileSync } from "node:fs";
import { NearChain } from "../server/src/chain.ts";

const chain = NearChain.fromLocalConfig();
if (!chain) {
  console.error("No testnet config or root key on this computer.");
  process.exit(1);
}
const D = 1_000_000n;
const steps: { step: string; ok: boolean; observed: string; tx?: string; url?: string }[] = [];
const url = (tx: string) => `${chain.explorer}/txns/${tx}`;
function record(step: string, ok: boolean, observed: string, tx?: string) {
  steps.push({ step, ok, observed, ...(tx ? { tx, url: url(tx) } : {}) });
  console.log(`${ok ? "✓" : "✗"} ${step}: ${observed}${tx ? `\n    ${url(tx)}` : ""}`);
  if (!ok) finish(1);
}
function finish(code: number) {
  mkdirSync("data/evidence", { recursive: true });
  writeFileSync(
    "data/evidence/payments-testnet.json",
    `${JSON.stringify({ kind: "payments-evidence/v1", network: "testnet", token: chain?.token, at: new Date().toISOString(), steps }, null, 2)}\n`,
  );
  process.exit(code);
}
const cents = (u: string) => `$${(Number(BigInt(u) / 10_000n) / 100).toFixed(2)}`;

const customer = await chain.createPersonAccount("Smoke Customer");
record(
  "customer account",
  true,
  `${customer.account_id} with ${cents(await chain.tokenBalance(customer.account_id))} test dollars`,
  customer.tx,
);
const founder = await chain.createPersonAccount("Smoke Founder");
record("founder account", true, founder.account_id, founder.tx);
const business = await chain.createBusinessAccount({
  label: "smoke-studio",
  name: "smoke-studio",
  owner: founder.account_id,
  rules: {
    customer_cancel_refund: true,
    credit_refundable: true,
    min_reserve: (5n * D).toString(),
  },
});
record("business account (v2 shared code, no keys)", true, business.account_id, business.tx);

const pay = (orderId: string) =>
  chain.payOrder({
    payer: customer.account_id,
    secret: customer.secret,
    business: business.account_id,
    orderId,
    amount: (35n * D).toString(),
    offer: "smoke",
    cancelBeforeMs: Date.now() + 3_600_000,
  });

let r = await pay("smoke-1");
let o = await chain.getOrder(business.account_id, "smoke-1");
record(
  "pay $35 for order smoke-1",
  r.ok && o?.status === "Paid",
  `order ${o?.status}; customer has ${cents(await chain.tokenBalance(customer.account_id))}`,
  r.hash,
);

r = await pay("smoke-1");
const after = await chain.tokenBalance(customer.account_id);
record(
  "pay the same order again",
  r.ok && after === (165n * D).toString(),
  `returned by the contract; customer still has ${cents(after)}`,
  r.hash,
);

r = await chain.cancelOrder({
  customer: customer.account_id,
  secret: customer.secret,
  business: business.account_id,
  orderId: "smoke-1",
});
o = await chain.getOrder(business.account_id, "smoke-1");
record(
  "customer cancels inside the window",
  r.ok && o?.status === "Refunded",
  `order ${o?.status}; customer has ${cents(await chain.tokenBalance(customer.account_id))}`,
  r.hash,
);

r = await pay("smoke-2");
record("pay $35 for order smoke-2", r.ok, "paid", r.hash);
r = await chain.withdrawProfit({
  owner: founder.account_id,
  secret: founder.secret,
  business: business.account_id,
  amount: (1n * D).toString(),
});
record(
  "founder tries to withdraw customer money",
  !r.ok && /E_RESERVED/.test(r.error ?? ""),
  `refused: ${r.error}`,
  r.hash,
);
r = await chain.deliver({
  owner: founder.account_id,
  secret: founder.secret,
  business: business.account_id,
  orderId: "smoke-2",
});
record("founder marks smoke-2 delivered", r.ok, "revenue earned", r.hash);
r = await chain.withdrawProfit({
  owner: founder.account_id,
  secret: founder.secret,
  business: business.account_id,
  amount: (31n * D).toString(),
});
record(
  "founder withdraws more than earned minus the $5 reserve",
  !r.ok && /E_RESERVED/.test(r.error ?? ""),
  `refused: ${r.error}`,
  r.hash,
);
r = await chain.withdrawProfit({
  owner: founder.account_id,
  secret: founder.secret,
  business: business.account_id,
  amount: (30n * D).toString(),
});
record(
  "founder withdraws $30",
  r.ok,
  `founder has ${cents(await chain.tokenBalance(founder.account_id))} test dollars`,
  r.hash,
);

const t = await chain.treasury(business.account_id);
const held = await chain.tokenBalance(business.account_id);
record(
  "books match the token balance",
  t.held === held,
  `held ${cents(t.held)} = token balance ${cents(held)}; available ${cents(t.available)}, customer money ${cents(t.unearned_orders)}`,
);
const ym = new Date();
const p = await chain.period(business.account_id, ym.getUTCFullYear() * 100 + ym.getUTCMonth() + 1);
record(
  "this month's books on chain",
  true,
  `orders in ${cents(p.orders_in)}, earned ${cents(p.earned)}, refunds ${cents(p.refunds)}, owner withdrawals ${cents(p.owner_withdrawals)}`,
);
finish(0);
