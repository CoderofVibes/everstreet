// Actual purchase resolver; synthetic RPC envelopes only. No keys, signing or network.
import { expect, it } from "vitest";
import { resolveFromTx } from "../src/customerPurchase.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const call = {
  receiverId: "token.testnet",
  methodName: "ft_transfer_call",
  args: {
    receiver_id: "business.testnet",
    amount: "5000000",
    msg: JSON.stringify({ buy: { plan_id: 1, units: 100, purchase_seq: 1, install: null } }),
  },
  gas: "100000000000000",
  deposit: "1",
};
const purchase: Parameters<typeof resolveFromTx>[0] = {
  id: "fictional-purchase",
  person_id: "fictional-person",
  customer_account: "customer.testnet",
  offer_id: "fictional-offer",
  network: "testnet",
  contract: "business.testnet",
  asset: "token.testnet",
  plan_id: 1,
  reg_id: "1",
  purchase_seq: 1,
  units: 100,
  amount: "5000000",
  install: null,
  call: JSON.stringify(call),
  terms_digest: "a".repeat(64),
  idempotency_key: "fictional-key",
  state: "requested",
  asks: 1,
  tx_hash: "1".repeat(44),
  evidence: null,
  created_at: "2026-11-04T00:00:00.000Z",
  updated_at: "2026-11-04T00:00:00.000Z",
};

function envelope(returned = false) {
  const event = `EVENT_JSON:${JSON.stringify({
    standard: "business_core",
    version: "3.0.0",
    event: returned ? "purchase_returned" : "units_bought",
    data: [
      { customer: purchase.customer_account, plan_id: 1, units: 100, amount: purchase.amount },
    ],
  })}`;
  const value = b64(JSON.stringify(returned ? "0" : purchase.amount));
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: value },
    transaction: {
      hash: purchase.tx_hash,
      signer_id: purchase.customer_account,
      receiver_id: purchase.asset,
      actions: [
        {
          FunctionCall: {
            method_name: call.methodName,
            args: b64(JSON.stringify(call.args)),
            gas: call.gas,
            deposit: call.deposit,
          },
        },
      ],
    },
    transaction_outcome: {
      id: purchase.tx_hash,
      outcome: {
        executor_id: purchase.customer_account,
        receipt_ids: ["transfer"],
        status: { SuccessReceiptId: "transfer" },
        logs: [],
      },
    },
    receipts_outcome: [
      {
        id: "transfer",
        outcome: {
          executor_id: purchase.asset,
          receipt_ids: ["receiver", "resolution"],
          status: { SuccessReceiptId: "resolution" },
          logs: [],
        },
      },
      {
        id: "receiver",
        outcome: {
          executor_id: purchase.contract,
          receipt_ids: [],
          status: { SuccessValue: b64(JSON.stringify(returned ? purchase.amount : "0")) },
          logs: [event],
        },
      },
      {
        id: "resolution",
        outcome: {
          executor_id: purchase.asset,
          receipt_ids: [],
          status: { SuccessValue: value },
          logs: [],
        },
      },
    ],
  };
}

it("recognizes the synthetic successful purchase control", () => {
  expect(resolveFromTx(purchase, envelope())).toMatchObject({ kind: "confirmed", units: 100 });
});

function receipt(answer: ReturnType<typeof envelope>, index: number) {
  const result = answer.receipts_outcome[index];
  if (!result) throw new Error("Missing synthetic receipt");
  return result;
}

it("does not confirm an event before actual finality", () => {
  const answer = envelope();
  answer.final_execution_status = "EXECUTED_OPTIMISTIC";
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("does not confirm a matching event from a failed receiver receipt", () => {
  const answer = envelope();
  Object.assign(receipt(answer, 1).outcome, {
    status: { Failure: { ActionError: "synthetic receiver failure" } },
  });
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("does not report tokens returned from rejection when token resolution failed", () => {
  const answer = envelope(true);
  Object.assign(receipt(answer, 2).outcome, {
    status: { Failure: { ActionError: "synthetic resolution failure" } },
  });
  Object.assign(answer, { status: { Failure: { ActionError: "synthetic resolution failure" } } });
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("does not use an unrelated receiver outcome as purchase evidence", () => {
  const answer = envelope();
  receipt(answer, 1).id = "unrelated-receipt";
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("does not attribute another transaction's receipt graph to the purchase", () => {
  const answer = envelope();
  answer.transaction_outcome.id = "2".repeat(44);
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("requires the transaction's complete call to match the reviewed gas", () => {
  const answer = envelope();
  const action = answer.transaction.actions[0];
  if (!action) throw new Error("Missing synthetic action");
  action.FunctionCall.gas = "300000000000000";
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("does not confirm contradictory top-level transaction failure", () => {
  const answer = envelope();
  Object.assign(answer, { status: { Failure: { ActionError: "synthetic conflicting outcome" } } });
  expect(resolveFromTx(purchase, answer)).toBeNull();
});

it("requires affirmative top-level success instead of merely no Failure field", () => {
  const answer = envelope();
  Object.assign(answer, { status: {} });
  expect(resolveFromTx(purchase, answer)).toBeNull();
});
