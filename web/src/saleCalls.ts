// Job 003wf2 (docs/design/DIRECT_SALE.md): the browser's own checks before any wallet is asked.
// Every reviewed request is re-derived here from the facts the person reviewed, independently of
// the server: the exact call for its kind, the contract's digest (lib.rs digest_of, recomputed
// with SubtleCrypto) and the immutable terms document's hash. Amounts stay base-unit strings and
// BigInt; the display scale comes only from the token's validated metadata.

import type { SaleAction, SaleKind, SalePreview, SaleSetup } from "./saleApi.ts";
import type { WalletFunctionCall } from "./wallet.ts";

export const DEAL_DOMAIN = "business-deal/v3";
export const GAS = {
  propose: "50000000000000",
  call: "30000000000000",
  fund: "100000000000000",
  claim: "60000000000000",
};
const HEX32 = /^[0-9a-f]{64}$/;
const DEC = /^(0|[1-9][0-9]*)$/;

// ---------- the contract digest, byte for byte ----------

const utf8 = (s: string) => new TextEncoder().encode(s);
function le(v: bigint, bytes: number): Uint8Array {
  if (v < 0n || v >= 1n << BigInt(bytes * 8)) throw new Error("value out of range");
  const b = new Uint8Array(bytes);
  let x = v;
  for (let i = 0; i < bytes; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const str = (s: string) => {
  const u = utf8(s);
  return concat([le(BigInt(u.length), 4), u]);
};
const hex32 = (h: string) => {
  if (!HEX32.test(h)) throw new Error("not a 32-byte hex digest");
  return Uint8Array.from(h.match(/../g) as string[], (x) => Number.parseInt(x, 16));
};
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array) {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export interface DigestInput {
  business: string;
  seq: string;
  version: number;
  seller: string;
  buyer: string;
  asset: string;
  price: string;
  expires_at_ms: string;
  close_window_ms: string;
  available_floor: string;
  grants: { account: string; caps: number }[];
  terms_hash: string;
  expected_generation: number;
  manifest: string;
  manifest_seq: string;
  plan_count: number;
  min_reserve: string;
  /** Job 003wf3: the business's fixed close mode and closer (Direct: "direct", null). */
  close_mode?: "direct" | "gated";
  closer?: string | null;
}

/** lib.rs digest_of: Direct (close mode 0, no closer) or Gated (1, the configured closer). */
export async function dealDigest(d: DigestInput) {
  const gatedMode = d.close_mode === "gated";
  const grants = concat([
    le(BigInt(d.grants.length), 4),
    ...d.grants.map((g) => concat([str(g.account), le(BigInt(g.caps), 1)])),
  ]);
  return sha256Hex(
    concat([
      str(DEAL_DOMAIN),
      str(d.business),
      le(BigInt(d.seq), 8),
      le(BigInt(d.version), 4),
      str(d.seller),
      str(d.buyer),
      str(d.asset),
      le(BigInt(d.price), 16),
      le(BigInt(d.expires_at_ms), 8),
      le(BigInt(d.close_window_ms), 8),
      le(BigInt(d.available_floor), 16),
      grants,
      hex32(d.terms_hash),
      le(BigInt(d.expected_generation), 4),
      hex32(d.manifest),
      le(BigInt(d.manifest_seq), 8),
      le(BigInt(d.plan_count), 4),
      le(BigInt(d.min_reserve), 16),
      le(gatedMode ? 1n : 0n, 1),
      str(gatedMode ? (d.closer ?? "") : ""),
    ]),
  );
}

// ---------- the exact call for each kind, from the reviewed facts ----------

const r = (p: SalePreview) => p.review as Record<string, unknown>;
const s = (v: unknown) => String(v);

/** The call this kind must be, from the preview's reviewed facts; null if they don't determine one. */
export function expectedCall(p: SalePreview): WalletFunctionCall | null {
  const v = r(p);
  const cs = s(v.control_seq);
  switch (p.kind) {
    case "propose":
    case "revise": {
      const terms = {
        buyer: s(v.buyer),
        price: s(v.price),
        expires_at_ms: s(v.expires_at_ms),
        close_window_ms: v.close_window_ms === undefined ? "0" : s(v.close_window_ms),
        available_floor: s(v.available_floor),
        grants: (v.grants as { account: string; caps: number }[]).map((g) => [g.account, g.caps]),
        terms_hash: s(v.terms_hash),
      };
      return p.kind === "propose"
        ? {
            receiverId: p.contract,
            methodName: "propose_sale_guarded",
            args: { terms, expected_control_seq: cs, digest: s(v.digest) },
            gas: GAS.propose,
            deposit: s(v.deposit),
          }
        : {
            receiverId: p.contract,
            methodName: "revise_sale_guarded",
            args: { deal_seq: s(v.deal_seq), expected_control_seq: cs, terms, digest: s(v.digest) },
            gas: GAS.propose,
            deposit: s(v.deposit),
          };
    }
    case "fund":
      return {
        receiverId: p.asset,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: p.contract,
          amount: s(v.price),
          msg: JSON.stringify({
            fund_deal: {
              deal_seq: s(v.deal_seq),
              version: v.version,
              price: s(v.price),
              expected_control_seq: cs,
            },
          }),
        },
        gas: GAS.fund,
        deposit: "1",
      };
    case "accept":
      return {
        receiverId: p.contract,
        methodName: "accept_sale",
        args: { deal_seq: s(v.deal_seq), version: v.version, digest: s(v.digest) },
        gas: GAS.call,
        deposit: "1",
      };
    case "unfund":
    case "cancel":
    case "expire":
      return {
        receiverId: p.contract,
        methodName: `${p.kind === "unfund" ? "unfund_deal" : p.kind === "cancel" ? "cancel_sale" : "expire_sale"}_guarded`,
        args: { deal_seq: s(v.deal_seq), expected_control_seq: cs },
        gas: GAS.call,
        deposit: p.kind === "expire" ? "0" : "1",
      };
    case "claim":
      return {
        receiverId: p.contract,
        methodName: "claim_party_guarded",
        args: {
          category: v.category,
          expected_amount: s(v.amount),
          expected_payout_seq: s(v.payout_seq),
        },
        gas: GAS.claim,
        deposit: "1",
      };
    case "appoint": {
      // Job 003wf4 (OWNER_PLAN_SETUP.md §6): the call REPLACES the slot's mask. The resulting mask
      // is re-derived here from the reviewed current slot and the support choice, never taken
      // from the server's call: metering, plus support only if the slot has it and it is kept.
      const cur = v.current as { caps: number; generation: number } | null | undefined;
      const keep = v.keep_support !== false;
      const caps = 1 | (keep && cur && (cur.caps & 2) !== 0 ? 2 : 0);
      if (v.caps !== undefined && v.caps !== caps) return null;
      return {
        receiverId: p.contract,
        methodName: "appoint_operator_guarded",
        args: { account: s(v.operator), caps, expected_control_seq: cs },
        gas: GAS.call,
        deposit: "1",
      };
    }
    case "create_plan": {
      // Job 003wf4 (§4): the reviewed immutable plan, the reviewed next id and exactly the
      // measured quote (plan bytes times the byte cost), re-derived here.
      const plan = v.plan as Record<string, unknown> | undefined;
      if (!plan || !DEC.test(s(v.plan_bytes)) || !DEC.test(s(v.storage_byte_cost))) return null;
      const quote = (BigInt(s(v.plan_bytes)) * BigInt(s(v.storage_byte_cost))).toString();
      if (s(v.deposit) !== quote) return null;
      return {
        receiverId: p.contract,
        methodName: "create_plan_guarded",
        args: {
          input: {
            unit_price: s(plan.unit_price),
            max_units_per_purchase: plan.max_units_per_purchase,
            max_units_outstanding: plan.max_units_outstanding,
            max_hold_units: plan.max_hold_units,
            hold_ttl_ms: s(plan.hold_ttl_ms),
            settle_grace_ms: s(plan.settle_grace_ms),
          },
          expected_control_seq: cs,
          expected_plan_id: v.plan_id,
        },
        gas: GAS.call,
        deposit: quote,
      };
    }
    case "register":
      return {
        receiverId: p.asset,
        methodName: "storage_deposit",
        args: { account_id: p.account, registration_only: true },
        gas: GAS.call,
        deposit: s(v.deposit),
      };
    case "owner_probe":
      // Always this account appointing itself with METERING: an owner action, nothing more.
      if (s(v.operator) !== p.account || v.caps !== 1) return null;
      return {
        receiverId: p.contract,
        methodName: "appoint_operator_guarded",
        args: { account: p.account, caps: 1, expected_control_seq: cs },
        gas: GAS.call,
        deposit: "1",
      };
    case "abort":
      return {
        receiverId: p.contract,
        methodName: "abort_close",
        args: { deal_seq: s(v.deal_seq) },
        gas: GAS.call,
        deposit: "0",
      };
  }
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The browser's own verification of a preview before it is stored or sent: the account is the
 * signed-in participant's, the business and token are this page's, the call is exactly what its
 * reviewed facts say, and (for terms) the digest and the document hash recompute. Null when it
 * checks out; otherwise the plain reason nothing will be sent.
 */
export async function verifyPreview(
  p: SalePreview,
  setup: SaleSetup,
  account: string,
): Promise<string | null> {
  if (p.account !== account) return "This request names another account than yours.";
  if (p.contract !== setup.contract || p.asset !== setup.token.account)
    return "This request names another business or token.";
  const want = expectedCall(p);
  if (!want || !same(want, p.call))
    return "The request doesn't match its own reviewed terms; nothing was sent.";
  const v = r(p);
  if (!DEC.test(s(v.control_seq))) return "The request doesn't name the reviewed control state.";
  if (p.kind === "propose" || p.kind === "revise") {
    const doc = p.terms_doc;
    if (!doc) return "The terms document is missing.";
    const h = await sha256Hex(doc.text);
    if (h !== doc.hash || h !== s(v.terms_hash))
      return "The terms document doesn't hash to the terms hash; nothing was sent.";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(doc.text) as Record<string, unknown>;
    } catch {
      return "The terms document isn't readable.";
    }
    if (
      parsed.buyer !== v.buyer ||
      parsed.price !== v.price ||
      parsed.expires_at_ms !== v.expires_at_ms ||
      parsed.available_floor !== v.available_floor ||
      !same(parsed.grants, v.grants) ||
      parsed.seller !== account
    )
      return "The terms document says something else than the reviewed terms; nothing was sent.";
    const basis = v.digest_basis as Record<string, unknown>;
    const digest = await dealDigest({
      business: s(basis.business),
      seq: s(v.deal_seq),
      version: Number(v.version),
      seller: account,
      buyer: s(v.buyer),
      asset: s(basis.asset),
      price: s(v.price),
      expires_at_ms: s(v.expires_at_ms),
      close_window_ms: v.close_window_ms === undefined ? "0" : s(v.close_window_ms),
      available_floor: s(v.available_floor),
      grants: v.grants as { account: string; caps: number }[],
      terms_hash: h,
      expected_generation: Number(basis.expected_generation),
      manifest: s(basis.manifest),
      manifest_seq: s(basis.manifest_seq),
      plan_count: Number(basis.plan_count),
      min_reserve: s(basis.min_reserve),
      // Job 003wf3: the close mode and closer come from THIS page's own reading of the
      // contract, never from the preview alone.
      close_mode: setup.control.close_mode,
      closer: setup.control.closer,
    });
    if (
      (basis.close_mode ?? "direct") !== setup.control.close_mode ||
      (basis.closer ?? null) !== setup.control.closer
    )
      return "The request names another close mode or closer than the contract shows; nothing was sent.";
    if (digest !== s(v.digest))
      return "The contract digest doesn't recompute from these terms; nothing was sent.";
    if (s(basis.business) !== setup.contract || s(basis.asset) !== setup.token.account)
      return "The digest names another business or token.";
  }
  return null;
}

/** The stored request must be exactly the one reviewed (consent survives the store only then). */
export const storedIsReviewed = (a: SaleAction, p: SalePreview) =>
  a.kind === p.kind &&
  a.action_digest === p.action_digest &&
  same(a.call, p.call) &&
  a.account === p.account;

// ---------- amounts and words ----------

/** A token amount from base units and VALIDATED decimals, e.g. ("250000000", 6) → "250". */
export function tokenAmount(base: string, decimals: number): string {
  if (!DEC.test(base) || !Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    throw new Error("not a token amount");
  const v = BigInt(base);
  if (decimals === 0) return v.toString();
  const scale = 10n ** BigInt(decimals);
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / scale}.${frac}` : (v / scale).toString();
}

/**
 * A typed token amount ("250", "0.5") in base units at VALIDATED decimals, or null if it isn't
 * a plain non-negative amount with at most that many decimals (never a Number).
 */
export function toBaseUnits(text: string, decimals: number): string | null {
  const t = text.trim();
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(t);
  if (!m || !Number.isInteger(decimals) || decimals < 0 || decimals > 38) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  const v =
    BigInt(m[1] as string) * 10n ** BigInt(decimals) +
    BigInt((frac || "0").padEnd(decimals, "0") || "0");
  return v < 1n << 128n ? v.toString() : null;
}

export const KIND_LABEL: Record<SaleKind, string> = {
  propose: "Propose these terms",
  revise: "Revise the terms",
  fund: "Fund escrow",
  accept: "Accept this version",
  unfund: "Take your escrow back",
  cancel: "Cancel the offer",
  expire: "End the expired offer",
  claim: "Collect",
  appoint: "Appoint metering",
  create_plan: "Create this plan",
  abort: "End the closing",
  register: "Register with the token",
  owner_probe: "Try an owner action",
};

export const STATE_LABEL: Record<SaleAction["state"], string> = {
  prepared: "Reviewed; your wallet hasn't been asked",
  requested: "Your wallet was asked; the outcome isn't known yet",
  unknown: "Not known yet",
  confirmed: "Confirmed by its own transaction",
  refused: "Refused by the contract; nothing changed",
  no_longer_possible: "Can no longer take effect; whether it did is unknown",
  set_aside: "Set aside (your wallet was never asked)",
};

/** Kinds a person may replace with the identical request while unknown (DIRECT_SALE.md §5). */
export const EXCLUSIVE: SaleKind[] = [
  "propose",
  "revise",
  "fund",
  "unfund",
  "cancel",
  "expire",
  "appoint",
  "claim",
  "abort",
  "create_plan",
];
