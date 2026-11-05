// Job 003w-e3 (APPLICATION_COMPOSITION §9.7): the exact transactions a FRESH customer needs before any
// use, prepared for the customer's own wallet and shown field by field. Nothing here sends anything.
// From contracts/business-v3/src/lib.rs:
//   1. sponsor_shell(customer, plan_id): payable; creates the empty entitlement record (anyone may
//      pay for it; paying grants no authority). Its deposit must cover the measured storage growth,
//      which this module does NOT guess: the caller passes a quoted amount (a remaining gate).
//   2. ft_transfer_call on the business's own token (`asset`) to the business account, with
//      msg {"buy": {plan_id, units, purchase_seq, install?}}: the contract's ft_on_transfer accepts
//      it only for exactly units x unit_price, the NEXT purchase_seq, within the plan's caps, and
//      returns the whole amount otherwise. `install` enrolls this device's key in the same call.
// The customer must already hold that token (and be registered with it) to pay; that is checked on
// the token, not here.

import type { DeviceKeyRecord } from "./deviceKey.ts";
import type { WalletFunctionCall } from "./wallet.ts";

const DEC = /^(0|[1-9][0-9]{0,38})$/;

export function sponsorShellCall(input: {
  contract: string;
  customer: string;
  planId: number;
  /** yoctoNEAR, quoted from the contract's storage cost; never guessed here. */
  quotedDeposit: string;
}): WalletFunctionCall {
  if (!DEC.test(input.quotedDeposit) || input.quotedDeposit === "0")
    throw new Error("A quoted storage deposit (yoctoNEAR) is required.");
  return {
    receiverId: input.contract,
    methodName: "sponsor_shell",
    args: { customer: input.customer, plan_id: input.planId },
    gas: "30000000000000",
    deposit: input.quotedDeposit,
  };
}

export function buyCall(input: {
  asset: string;
  contract: string;
  planId: number;
  units: number;
  /** The plan's unit price in the token's base units (decimal string). */
  unitPrice: string;
  maxUnitsPerPurchase: number;
  /** The entitlement's current purchase_seq (the call uses the NEXT one). */
  purchaseSeq: number;
  /** Enroll this device's key in the same purchase (a stored, not yet enrolled key). */
  install?: Pick<DeviceKeyRecord, "slot" | "public_key" | "max_hold_units" | "max_units_per_day">;
}): WalletFunctionCall {
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > input.maxUnitsPerPurchase)
    throw new Error(`Choose 1 to ${input.maxUnitsPerPurchase} units.`);
  if (!DEC.test(input.unitPrice) || input.unitPrice === "0")
    throw new Error("The plan's unit price must be a positive whole number of base units.");
  if (
    !Number.isInteger(input.purchaseSeq) ||
    input.purchaseSeq < 0 ||
    input.purchaseSeq >= 0xffff_ffff
  )
    throw new Error("The purchase sequence is invalid.");
  const amount = (BigInt(input.units) * BigInt(input.unitPrice)).toString();
  const buy = {
    plan_id: input.planId,
    units: input.units,
    purchase_seq: input.purchaseSeq + 1,
    install: input.install
      ? {
          slot: input.install.slot,
          pk: input.install.public_key,
          max_hold_units: input.install.max_hold_units,
          max_units_per_day: input.install.max_units_per_day,
        }
      : null,
  };
  return {
    receiverId: input.asset,
    methodName: "ft_transfer_call",
    args: { receiver_id: input.contract, amount, msg: JSON.stringify({ buy }) },
    gas: "100000000000000",
    deposit: "1",
  };
}
