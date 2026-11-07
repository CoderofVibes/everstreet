// Companions of a business contract (contracts/asset-key and contracts/spend-allowance): what
// they hold now, read from NEAR at one final block, and the owner's few wallet requests to them.
//
// One source of authority: both companions ask the business contract who owns it when they act,
// so nothing here moves authority. Everstreet only reads, prepares the exact call for the
// person's own wallet, checks the result by that call's own transaction, and (for the external
// asset) relays the signed transaction to the other chain, where it stays "pending" until final
// there. It never signs anything itself.

import { randomUUID } from "node:crypto";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import type { Db } from "./db.ts";
import {
  type AssetAction,
  addressOf,
  type MpcSignature,
  payloadOf,
  publicKeyFromSigner,
  signedTx,
  signerOf,
  type TxParams,
  txHashOf,
  unsignedTx,
} from "./evm.ts";
import { HttpError } from "./store.ts";
import { readableAmount, tokenMetaOf } from "./tokenMeta.ts";
import { type BlockRef, V3ReadError } from "./v3read.ts";

/** The other chain, as Everstreet reaches it (a synthetic double, or an EVM testnet RPC). */
export interface EvmPort {
  readonly chainName: string;
  readonly source: "synthetic" | "testnet";
  controller(registry: string): Promise<string>;
  nonce(address: string): Promise<number>;
  /** Broadcasts a signed transaction; its hash. */
  broadcast(
    raw: Uint8Array,
    meta: { from: string; nonce: number; action: AssetAction },
  ): Promise<string>;
  status(hash: string): Promise<"unknown" | "pending" | "final" | "failed">;
  /** Fee fields for the next transaction. */
  fees(): Promise<{ max_fee_per_gas: string; max_priority_fee_per_gas: string; gas_limit: string }>;
}

export interface CompanionBinding {
  business_id: string;
  asset?: { account: string };
  allowance?: { account: string };
}

export interface CompanionOptions {
  bindings: CompanionBinding[];
  evm: EvmPort | null;
  readTimeoutMs?: number;
  now?: () => number;
}

export type CompanionKind =
  | "feed_move"
  | "allowance_grant"
  | "allowance_approve"
  | "allowance_reject";

interface ActionRow {
  id: string;
  business_id: string;
  person_id: string;
  account: string;
  kind: CompanionKind;
  call: string;
  review: string;
  state:
    | "prepared"
    | "refused"
    | "confirmed"
    | "external_pending"
    | "external_final"
    | "external_failed"
    | "unknown";
  tx_hash: string | null;
  evm_hash: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export function migrateCompanions(db: Db) {
  // Attack review (Nov 7), finding 4: an invoice can be rejected. A table made before that
  // allowed three kinds; it is rebuilt with the fourth, rows kept.
  const old = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'companion_actions'")
    .get() as { sql: string } | undefined;
  if (old && !old.sql.includes("allowance_reject")) {
    db.exec("ALTER TABLE companion_actions RENAME TO companion_actions_v1");
    db.exec(TABLE);
    db.exec("INSERT INTO companion_actions SELECT * FROM companion_actions_v1");
    db.exec("DROP TABLE companion_actions_v1");
  }
  db.exec(TABLE);
}

const TABLE = `
    CREATE TABLE IF NOT EXISTS companion_actions (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
      person_id TEXT NOT NULL REFERENCES people(id), account TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('feed_move','allowance_grant','allowance_approve','allowance_reject')),
      call TEXT NOT NULL, review TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared','refused','confirmed','external_pending','external_final','external_failed','unknown')),
      tx_hash TEXT, evm_hash TEXT, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
  `;

const bad = (status: 404 | 409 | 503, message: string, code: string): never => {
  throw new HttpError(status, message, code);
};

/** A failed receipt's contract error code, or null. */
function failureOf(outcome: unknown): string | null {
  const t = JSON.stringify(outcome);
  return (
    /Smart contract panicked: (E_[A-Z_]+)/.exec(t)?.[1] ?? (/"Failure"/.test(t) ? "FAILED" : null)
  );
}
/** The transaction's final value (SuccessValue, decoded JSON), or undefined. */
function successValue(outcome: unknown): unknown {
  const s = (outcome as { status?: { SuccessValue?: string } })?.status?.SuccessValue;
  if (typeof s !== "string") return undefined;
  try {
    const text = Buffer.from(s, "base64").toString("utf8");
    return text === "" ? null : JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class Companions {
  constructor(
    private readonly db: Db,
    private readonly reader: CustomerViewTransport | null,
    private readonly opts: CompanionOptions,
  ) {
    migrateCompanions(db);
  }

  binding(businessId: string) {
    return this.opts.bindings.find((b) => b.business_id === businessId) ?? null;
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private async views(
    network: string,
    account: string,
    calls: [string, Record<string, unknown>][],
  ) {
    const reader = this.reader;
    if (!reader) throw new V3ReadError("unavailable", "no reader");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.readTimeoutMs ?? 10_000);
    try {
      const block = (await reader.finalBlock(network, controller.signal)) as PinnedBlock;
      const out = await Promise.all(
        calls.map(async ([method, args]) => {
          const r = await reader.view({
            network,
            account,
            method,
            args,
            block: block as BlockRef,
            signal: controller.signal,
          });
          return JSON.parse(r.result) as unknown;
        }),
      );
      return { block, out };
    } finally {
      clearTimeout(timer);
    }
  }

  /** The EVM address each generation's owner controls the asset from (derived by the signer). */
  private async addressFor(network: string, signer: string, asset: string, generation: number) {
    const { out } = await this.views(network, signer, [
      ["derived_public_key", { path: `gen-${generation}`, predecessor: asset, domain_id: 0 }],
    ]);
    return addressOf(publicKeyFromSigner(String(out[0])));
  }

  /**
   * What the companions hold now, for a participant of this business's sale: the external role
   * (which generation's address controls it, and a move in flight) and the supplier allowance
   * (whether its grant is for the current generation).
   */
  /** The business contract's control now (owner and generation), as the companions will ask it. */
  async control(binding: { network: string; account: string }) {
    const { out } = await this.views(binding.network, binding.account, [["get_control", {}]]);
    const c = out[0] as { owner: string; generation: number };
    return { owner: c.owner, generation: c.generation };
  }

  async view(businessId: string, network: string, control: { owner: string; generation: number }) {
    const b = this.binding(businessId);
    if (!b) return null;
    await this.refreshPending(businessId);
    let asset = null;
    if (b.asset) {
      const { out } = await this.views(network, b.asset.account, [["get_config", {}]]);
      const cfg = out[0] as { registry: string; chain_id: string; signer: string };
      const addresses: { generation: number; address: string }[] = [];
      for (let g = 1; g <= control.generation; g++)
        addresses.push({
          generation: g,
          address: await this.addressFor(network, cfg.signer, b.asset.account, g),
        });
      const controller = this.opts.evm
        ? (await this.opts.evm.controller(cfg.registry)).toLowerCase()
        : null;
      const at = addresses.find((a) => a.address.toLowerCase() === controller)?.generation ?? null;
      const pendingRow = this.db
        .prepare(
          "SELECT id, state, evm_hash, updated_at, call FROM companion_actions WHERE business_id = ? AND kind = 'feed_move' AND state IN ('external_pending','external_final','external_failed') ORDER BY updated_at DESC LIMIT 1",
        )
        .get(businessId) as
        | { id: string; state: string; evm_hash: string; updated_at: string; call: string }
        | undefined;
      const pending = pendingRow
        ? {
            id: pendingRow.id,
            state: pendingRow.state,
            evm_hash: pendingRow.evm_hash,
            updated_at: pendingRow.updated_at,
          }
        : undefined;
      // Permissions review 3, finding 11: a move the other chain has not finalized is still
      // pending here; the role is reported at the generation it is moving from until then.
      let shown = at;
      if (pendingRow?.state === "external_pending") {
        try {
          const from = (
            JSON.parse(pendingRow.call) as { args?: { action?: { from_generation?: number } } }
          ).args?.action?.from_generation;
          if (typeof from === "number") shown = from;
        } catch {
          // an unreadable call: the controller read stands
        }
      }
      asset = {
        account: b.asset.account,
        registry: cfg.registry,
        chain_id: cfg.chain_id,
        chain: this.opts.evm?.chainName ?? null,
        source: this.opts.evm?.source ?? null,
        controller,
        controller_generation: shown,
        addresses,
        move: pending ?? null,
      };
    }
    let allowance = null;
    if (b.allowance) {
      const { out } = await this.views(network, b.allowance.account, [
        ["get_allowance", {}],
        ["get_payments", { from: 0, limit: 50 }],
      ]);
      const a = out[0] as {
        grant: {
          generation: number;
          agent: string;
          suppliers: string[];
          per_payment: string;
          per_period: string;
          period_ms: string;
          review_above: string;
        } | null;
        balance: string;
        reserved: string;
        available: string;
        spent_in_period: string;
        claims_total: string;
        period_start_ms: string;
      };
      const payments = out[1] as {
        supplier: string;
        amount: string;
        invoice: string;
        state: string;
        generation: number;
        at_ms: string;
      }[];
      allowance = {
        account: b.allowance.account,
        ...a,
        active: a.grant !== null && a.grant.generation === control.generation,
        awaiting: payments.filter((p) => p.state === "AwaitingApproval"),
        recent: payments.slice(-10).reverse(),
      };
    }
    const token = allowance
      ? (() => {
          const m = tokenMetaOf(
            this.db,
            network,
            String((allowance as { token?: string }).token ?? ""),
          );
          return m ? { symbol: m.symbol, decimals: m.decimals } : null;
        })()
      : null;
    return { asset, allowance, token };
  }

  /**
   * The exact call for one owner request, built here from what the companions show now. The
   * person's own wallet sends it; nothing is sent from here.
   */
  async prepare(
    who: { person_id: string; account: string },
    businessId: string,
    network: string,
    control: { owner: string; generation: number },
    kind: CompanionKind,
    input: Record<string, unknown>,
  ) {
    // Permissions review 3, finding 7: the owner first, so a non-owner learns nothing about the
    // business's companions from the answer.
    if (control.owner !== who.account)
      bad(409, "Only the business's current owner can ask for this.", "not_owner");
    if (!this.binding(businessId))
      bad(404, "This business has no companions here.", "no_companions");
    const v = await this.view(businessId, network, control);
    let call: {
      receiverId: string;
      methodName: string;
      args: Record<string, unknown>;
      gas: string;
      deposit: string;
    };
    let review: Record<string, unknown>;
    if (kind === "feed_move") {
      const a = v?.asset ?? bad(404, "No external asset here.", "no_asset");
      const evm = this.opts.evm ?? bad(503, "The other chain isn't connected here.", "no_evm");
      if (a.controller_generation === null)
        bad(
          409,
          "The registry's controller isn't any generation's address of this business.",
          "foreign_controller",
        );
      if (a.move?.state === "external_pending")
        bad(409, "A move is already pending.", "move_pending");
      if (a.controller_generation === control.generation)
        bad(409, "The role is already at your address.", "already_moved");
      const from = a.controller_generation as number;
      const fromAddress = a.addresses.find((x) => x.generation === from)?.address as string;
      const to = a.addresses.find((x) => x.generation === control.generation)?.address as string;
      const fees = await evm.fees();
      const tx: TxParams = { nonce: String(await evm.nonce(fromAddress)), ...fees };
      // Attack review (Nov 7), finding 1: the companion derives the destination itself (the
      // current generation's address); the request names only where the role moves from.
      call = {
        receiverId: a.account,
        methodName: "request",
        args: { action: { kind: "set_controller", from_generation: from }, tx },
        gas: "250000000000000",
        deposit: "1",
      };
      review = {
        chain: a.chain,
        chain_id: a.chain_id,
        registry: a.registry,
        from_generation: from,
        from_address: fromAddress,
        to_generation: control.generation,
        to_address: to,
        tx,
        effects: [
          `The ${a.chain} registry's controller moves from generation ${from}'s address to yours (generation ${control.generation}).`,
          "Anything signed earlier for the old address controls nothing once this is final.",
        ],
        conditions: [
          "The companion asks the business contract who owns it now; anyone else is refused.",
          `It is pending until final on ${a.chain}.`,
        ],
      };
    } else if (kind === "allowance_grant") {
      const a = v?.allowance ?? bad(404, "No supplier allowance here.", "no_allowance");
      if (a.active)
        bad(409, "The allowance is already granted for this generation.", "already_granted");
      const last =
        a.grant ?? bad(409, "No earlier grant to repeat; set one up on the desk.", "no_grant");
      const args = {
        agent: last.agent,
        suppliers: last.suppliers,
        per_payment: last.per_payment,
        per_period: last.per_period,
        period_ms: last.period_ms,
        review_above: last.review_above,
      };
      call = {
        receiverId: a.account,
        methodName: "grant",
        args,
        gas: "100000000000000",
        deposit: "0",
      };
      const t = v?.token ?? null;
      const amt = (base: string) =>
        t ? `${readableAmount(base, t.decimals) ?? base} ${t.symbol}` : `${base} base units`;
      const days = Math.round(Number(args.period_ms) / 86_400_000);
      review = {
        ...args,
        effects: [
          `The agent ${args.agent} can pay ${args.suppliers.join(", ")}: up to ${amt(args.per_payment)} a payment on its own, up to ${amt(args.per_period)} every ${days === 7 ? "week" : `${days} days`}; anything above ${amt(args.review_above)} waits for your approval of that exact invoice.`,
          `It holds while you own generation ${control.generation}.`,
        ],
        conditions: ["It ends again if the business is sold."],
      };
    } else {
      const a = v?.allowance ?? bad(404, "No supplier allowance here.", "no_allowance");
      const invoice = String(input.invoice ?? "");
      const p =
        a.awaiting.find((x) => x.invoice === invoice) ??
        bad(409, "That invoice isn't awaiting approval.", "not_awaiting");
      const rejecting = kind === "allowance_reject";
      call = {
        receiverId: a.account,
        methodName: rejecting ? "reject" : "approve",
        args: { invoice },
        gas: "100000000000000",
        deposit: "0",
      };
      review = {
        supplier: p.supplier,
        amount: p.amount,
        invoice,
        effects: rejecting
          ? [
              "Refuses this invoice: nothing is paid, and its reserved amount returns to the budget.",
            ]
          : ["Pays this exact invoice now; it counts toward the period's cap."],
        conditions: ["Refused if the business changed hands since it was submitted."],
      };
    }
    const id = randomUUID();
    const at = new Date(this.now()).toISOString();
    this.db
      .prepare(
        "INSERT INTO companion_actions (id, business_id, person_id, account, kind, call, review, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)",
      )
      .run(
        id,
        businessId,
        who.person_id,
        who.account,
        kind,
        JSON.stringify(call),
        JSON.stringify(review),
        at,
        at,
      );
    return { id, kind, call, review };
  }

  action(personId: string, id: string) {
    const r = this.db
      .prepare("SELECT * FROM companion_actions WHERE id = ? AND person_id = ?")
      .get(id, personId) as ActionRow | undefined;
    return r ?? bad(404, "No such request.", "no_action");
  }

  private set(id: string, fields: Partial<ActionRow>) {
    const keys = Object.keys(fields);
    this.db
      .prepare(
        `UPDATE companion_actions SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      )
      .run(
        ...keys.map((k) => (fields as Record<string, string | null>)[k] ?? null),
        new Date(this.now()).toISOString(),
        id,
      );
  }

  /**
   * The wallet sent it: read that transaction's own final outcome. A refusal is shown as the
   * contract's code; a signed move is relayed to the other chain and stays pending there.
   */
  async sent(personId: string, id: string, txHash: string) {
    const row = this.action(personId, id);
    if (row.state !== "prepared" && row.state !== "unknown") return this.show(row.id, personId);
    const reader = this.reader ?? bad(503, "NEAR isn't connected here.", "unavailable");
    const outcome = reader.txOutcome
      ? await reader.txOutcome(txHash, row.account).catch(() => null)
      : null;
    if (!outcome) {
      this.set(id, { state: "unknown", tx_hash: txHash });
      return this.show(id, personId);
    }
    // The transaction must be exactly the stored call.
    const call = JSON.parse(row.call) as { receiverId: string; methodName: string };
    const t = (
      outcome as {
        transaction?: {
          receiver_id?: string;
          signer_id?: string;
          actions?: { FunctionCall?: { method_name?: string } }[];
        };
      }
    ).transaction;
    if (
      t?.receiver_id !== call.receiverId ||
      t?.signer_id !== row.account ||
      t?.actions?.[0]?.FunctionCall?.method_name !== call.methodName
    )
      bad(409, "That transaction isn't this request.", "not_this_request");
    const failed = failureOf(outcome);
    if (failed) {
      this.set(id, { state: "refused", tx_hash: txHash, result: JSON.stringify({ code: failed }) });
      return this.show(id, personId);
    }
    const value = successValue(outcome) as Record<string, unknown> | string | null;
    if (value && typeof value === "object" && "refused" in value) {
      this.set(id, {
        state: "refused",
        tx_hash: txHash,
        result: JSON.stringify({ code: value.refused }),
      });
      return this.show(id, personId);
    }
    if (typeof value === "string" && value.startsWith("E_")) {
      this.set(id, { state: "refused", tx_hash: txHash, result: JSON.stringify({ code: value }) });
      return this.show(id, personId);
    }
    if (row.kind !== "feed_move") {
      this.set(id, { state: "confirmed", tx_hash: txHash, result: JSON.stringify({ value }) });
      return this.show(id, personId);
    }
    // The move: relay the signed transaction, exactly the one reviewed, to the other chain.
    const evm = this.opts.evm ?? bad(503, "The other chain isn't connected here.", "no_evm");
    const review = JSON.parse(row.review) as {
      registry: string;
      chain_id: string;
      from_address: string;
      to_address: string;
      to_generation: number;
    };
    const answer = value as { payload: string; signature: MpcSignature };
    const args = (
      JSON.parse(row.call) as {
        args: { action: { kind: string; from_generation: number }; tx: TxParams };
      }
    ).args;
    const action: AssetAction = {
      kind: "set_controller",
      to: review.to_address,
      from_generation: args.action.from_generation,
    };
    const chainId = BigInt(review.chain_id);
    const payload = Uint8Array.from(Buffer.from(answer.payload, "hex"));
    // The companion chose the destination; it must be the reviewed one, byte for byte.
    if (
      Buffer.from(payloadOf(unsignedTx(chainId, review.registry, args.tx, action))).toString(
        "hex",
      ) !== answer.payload
    )
      bad(409, "The companion signed a different transaction than reviewed.", "wrong_payload");
    const from = signerOf(payload, answer.signature);
    if (from.toLowerCase() !== review.from_address.toLowerCase())
      bad(409, "The signature isn't from the reviewed address.", "wrong_signer");
    const raw = signedTx(chainId, review.registry, args.tx, action, answer.signature);
    const evmHash = await evm.broadcast(raw, {
      from,
      nonce: Number(args.tx.nonce),
      action,
    });
    this.set(id, {
      state: "external_pending",
      tx_hash: txHash,
      evm_hash: evmHash || txHashOf(raw),
      result: JSON.stringify({ from, to: review.to_address, to_generation: review.to_generation }),
    });
    return this.show(id, personId);
  }

  /** Moves pending external transactions to final or failed when the other chain says so. */
  async refreshPending(businessId: string) {
    const evm = this.opts.evm;
    if (!evm) return;
    const rows = this.db
      .prepare(
        "SELECT id, evm_hash FROM companion_actions WHERE business_id = ? AND state = 'external_pending'",
      )
      .all(businessId) as { id: string; evm_hash: string }[];
    for (const r of rows) {
      const s = await evm.status(r.evm_hash).catch(() => "unknown" as const);
      if (s === "final") this.set(r.id, { state: "external_final" });
      if (s === "failed") this.set(r.id, { state: "external_failed" });
    }
  }

  show(id: string, personId: string) {
    const r = this.action(personId, id);
    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      tx_hash: r.tx_hash,
      evm_hash: r.evm_hash,
      result: r.result ? (JSON.parse(r.result) as unknown) : null,
      review: JSON.parse(r.review) as unknown,
      call: JSON.parse(r.call) as unknown,
    };
  }
}
