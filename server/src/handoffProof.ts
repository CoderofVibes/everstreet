// The handoff proof (Continuity Receipt): after a sale closes, each fact a participant might doubt,
// tagged with where it came from, and an exportable receipt anyone can check against NEAR.
//
// One source of authority: every fact about control is read from the business contract at a
// pinned final block. A snapshot is recorded at the close (the first final block Everstreet reads
// after the close confirms), so "units at close" is a chain read, never a reconstruction. Two
// RPC providers can be compared at the same block; disagreement is shown as Uncertain and the
// last coherent observation is kept, never promoted.

import { createHash } from "node:crypto";
import { canonicalJson } from "./artifacts.ts";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import { decodeEntitlement } from "./customerRead.ts";
import type { Db } from "./db.ts";
import { decodeParty } from "./saleTerms.ts";
import { tokenMetaOf } from "./tokenMeta.ts";
import {
  type BlockRef,
  type ControlV3,
  decodeControl,
  decodeOutcomes,
  decodePending,
  decodeTreasury,
  type OutcomeV3,
  V3ReadError,
} from "./v3read.ts";

/** Where a fact came from. Each is shown with its own mark and words, never colour alone. */
export type EvidenceSource =
  | "synthetic"
  | "local_node"
  | "testnet_final"
  | "testnet_receipt"
  | "light_client"
  | "everstreet";

export interface ProofConfig {
  /** What the primary reader serves: the synthetic chain, a local NEAR node or public testnet. */
  source: "synthetic" | "local_node" | "testnet";
  /** The primary reader's name, shown in the RPC comparison. */
  primaryName?: string;
  /** A second, independent provider read at the same block (agreement across RPCs). */
  second?: { name: string; reader: CustomerViewTransport } | null;
  readTimeoutMs?: number;
}

export interface Fact {
  key: string;
  label: string;
  value: string | number | null;
  source: EvidenceSource;
  /** Block the fact was read at, when it is a chain read. */
  block?: string | null;
}

interface SnapshotCustomer {
  account: string;
  plan_id: number;
  free: string;
  consumed: string;
  hold_active: boolean;
  hold_units: number;
  settle_until_ms: string;
}

interface CloseSnapshot {
  block: PinnedBlock;
  deal_seq: string;
  control: ControlV3;
  outcome: OutcomeV3;
  treasury: { ent_free_value: string; ent_held_value: string; asset: string };
  account: { code_hash: string; keys: number } | null;
  customers: SnapshotCustomer[];
}

const RECEIPT_FORMAT = "everstreet.handoff-receipt";

export function migrateHandoffProof(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoff_snapshots (
      business_id TEXT NOT NULL REFERENCES businesses(id), deal_seq TEXT NOT NULL,
      network TEXT NOT NULL, account TEXT NOT NULL, block_height TEXT NOT NULL,
      snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (business_id, deal_seq)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS handoff_snapshots_no_update BEFORE UPDATE ON handoff_snapshots
    BEGIN SELECT RAISE(ABORT, 'close snapshots are immutable'); END;
    CREATE TABLE IF NOT EXISTS handoff_agreements (
      business_id TEXT NOT NULL REFERENCES businesses(id), block_height TEXT NOT NULL,
      block_hash TEXT NOT NULL, owner TEXT NOT NULL, generation INTEGER NOT NULL,
      control_seq TEXT NOT NULL, providers TEXT NOT NULL, observed_at TEXT NOT NULL,
      PRIMARY KEY (business_id, block_hash)
    ) STRICT;
  `);
}

/** A decoded view or a refusal; nothing partial is ever returned. */
async function viewAt(
  reader: CustomerViewTransport,
  at: { network: string; account: string },
  block: BlockRef,
  method: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const r = await reader.view({
    network: at.network,
    account: at.account,
    method,
    args,
    block,
    signal,
  });
  if (r.block.hash !== block.hash)
    throw new V3ReadError("mixed_blocks", "answered at another block");
  try {
    return JSON.parse(r.result) as unknown;
  } catch {
    throw new V3ReadError("malformed", "the view isn't JSON");
  }
}

export class HandoffProof {
  constructor(
    private readonly db: Db,
    private readonly reader: CustomerViewTransport | null,
    private readonly config: ProofConfig,
    private readonly now: () => number = Date.now,
  ) {
    migrateHandoffProof(db);
  }

  /** The source tag for a read through the primary reader. */
  get chainSource(): EvidenceSource {
    return this.config.source === "synthetic"
      ? "synthetic"
      : this.config.source === "local_node"
        ? "local_node"
        : "testnet_final";
  }

  private async withDeadline<T>(f: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new V3ReadError("timeout", "the read took too long")),
      this.config.readTimeoutMs ?? 10_000,
    );
    try {
      return await f(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Customers this business has served here (accounts and plans), for the close snapshot. */
  private customersOf(businessId: string) {
    return this.db
      .prepare(
        "SELECT DISTINCT customer_account AS account, plan_id FROM customer_requests WHERE business_id = ? ORDER BY customer_account",
      )
      .all(businessId) as { account: string; plan_id: number }[];
  }

  /**
   * Records the close snapshot for a deal that closed: control, the outcome, customer funds,
   * the account's code hash and key count, and each known customer's entitlement, all at one
   * final block read right after the close confirmed. Idempotent; a failed read records nothing
   * (the proof then says "Not recorded", never zero).
   */
  async recordClose(
    businessId: string,
    binding: { network: string; account: string },
    dealSeq: string,
  ): Promise<boolean> {
    const reader = this.reader;
    if (!reader) return false;
    const exists = this.db
      .prepare("SELECT 1 FROM handoff_snapshots WHERE business_id = ? AND deal_seq = ?")
      .get(businessId, dealSeq);
    if (exists) return true;
    try {
      const snap = await this.withDeadline(async (signal) => {
        const block = await reader.finalBlock(binding.network, signal);
        const v = (m: string, a: Record<string, unknown> = {}) =>
          viewAt(reader, binding, block, m, a, signal);
        const [control, outcomes, treasury] = await Promise.all([
          v("get_control").then(decodeControl),
          v("get_outcomes").then(decodeOutcomes),
          v("get_treasury").then(decodeTreasury),
        ]);
        const outcome = outcomes.find((o) => o.seq === dealSeq && o.status === "closed");
        if (!outcome) return null;
        const account = reader.accountState
          ? await reader.accountState({ ...binding, block, signal })
          : null;
        const customers: SnapshotCustomer[] = [];
        for (const c of this.customersOf(businessId)) {
          const e = decodeEntitlement(
            await v("get_entitlement", { customer: c.account, plan_id: c.plan_id }),
          );
          if (!e) continue;
          customers.push({
            account: c.account,
            plan_id: c.plan_id,
            free: e.free,
            consumed: e.consumed,
            hold_active: e.hold_active,
            hold_units: e.hold_units,
            settle_until_ms: e.settle_until_ms,
          });
        }
        const s: CloseSnapshot = {
          block: block as PinnedBlock,
          deal_seq: dealSeq,
          control,
          outcome,
          treasury: {
            ent_free_value: treasury.ent_free_value,
            ent_held_value: treasury.ent_held_value,
            asset: treasury.asset,
          },
          account,
          customers,
        };
        return s;
      });
      if (!snap) return false;
      this.db
        .prepare(
          "INSERT INTO handoff_snapshots (business_id, deal_seq, network, account, block_height, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .run(
          businessId,
          dealSeq,
          binding.network,
          binding.account,
          snap.block.height,
          JSON.stringify(snap),
          new Date(this.now()).toISOString(),
        );
      return true;
    } catch {
      return false;
    }
  }

  private snapshot(businessId: string, dealSeq: string): CloseSnapshot | null {
    const r = this.db
      .prepare("SELECT snapshot FROM handoff_snapshots WHERE business_id = ? AND deal_seq = ?")
      .get(businessId, dealSeq) as { snapshot: string } | undefined;
    return r ? (JSON.parse(r.snapshot) as CloseSnapshot) : null;
  }

  /** The close transaction as Everstreet recorded it: the closing acceptance, or the closer's. */
  private closeTx(businessId: string, dealSeq: string): { hash: string; signer: string } | null {
    const direct = this.db
      .prepare(
        "SELECT tx_hash AS hash, account AS signer FROM sale_actions WHERE business_id = ? AND deal_seq = ? AND kind = 'accept' AND state = 'confirmed' AND tx_hash IS NOT NULL AND json_extract(evidence, '$.result') = 'closed' LIMIT 1",
      )
      .get(businessId, dealSeq) as { hash: string; signer: string } | undefined;
    if (direct) return direct;
    const gated = this.db
      .prepare(
        "SELECT a.tx_hash AS hash, a.signer AS signer FROM closer_tx_attempts a JOIN business_handovers h ON a.operation LIKE 'close-' || h.id || '-%' WHERE h.business_id = ? AND h.deal_seq = ? AND a.state = 'success' LIMIT 1",
      )
      .get(businessId, dealSeq) as { hash: string; signer: string } | undefined;
    return gated ?? null;
  }

  /** The first charged use after the close (a chain read recorded when it settled). */
  private firstUseAfter(businessId: string, height: string) {
    const r = this.db
      .prepare(
        `SELECT r.customer_account AS account, r.person_id AS person, s.evidence AS evidence
         FROM customer_settlements s JOIN customer_requests r ON r.id = s.request_id
         WHERE r.business_id = ? AND s.state = 'charged'
           AND CAST(json_extract(s.evidence, '$.block.height') AS INTEGER) > CAST(? AS INTEGER)
         ORDER BY CAST(json_extract(s.evidence, '$.block.height') AS INTEGER) LIMIT 1`,
      )
      .get(businessId, height) as { account: string; person: string; evidence: string } | undefined;
    if (!r) return null;
    const e = JSON.parse(r.evidence) as { block: BlockRef; free: string | null };
    const name = (
      this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(r.person) as
        | { display_name: string }
        | undefined
    )?.display_name;
    return { account: r.account, name: name ?? null, block: e.block, free: e.free };
  }

  /**
   * Reads control at the primary's final block from both providers and compares. Agreement is
   * stored; disagreement or a failed second read is Uncertain, with the last coherent record.
   */
  private async agreement(
    businessId: string,
    binding: { network: string; account: string },
    block: BlockRef,
    primary: ControlV3,
  ) {
    const name = this.config.primaryName ?? "Provider A";
    const second = this.config.second;
    const mine = {
      name,
      owner: primary.owner,
      generation: primary.generation,
      control_seq: primary.control_seq,
      block_height: block.height,
      error: null as string | null,
    };
    const last = () =>
      (this.db
        .prepare(
          "SELECT block_height, owner, generation, observed_at FROM handoff_agreements WHERE business_id = ? ORDER BY CAST(block_height AS INTEGER) DESC LIMIT 1",
        )
        .get(businessId) as
        | { block_height: string; owner: string; generation: number; observed_at: string }
        | undefined) ?? null;
    if (!second)
      return { status: "single" as const, block, providers: [mine], last_coherent: null };
    let theirs: typeof mine;
    try {
      const c = await this.withDeadline(async (signal) => {
        const r = await second.reader.view({
          network: binding.network,
          account: binding.account,
          method: "get_control",
          args: {},
          block,
          signal,
        });
        return { block: r.block, control: decodeControl(JSON.parse(r.result)) };
      });
      theirs = {
        name: second.name,
        owner: c.control.owner,
        generation: c.control.generation,
        control_seq: c.control.control_seq,
        block_height: c.block.height,
        error: c.block.hash === block.hash ? null : "answered at another block",
      };
    } catch (e) {
      theirs = {
        name: second.name,
        owner: "",
        generation: 0,
        control_seq: "",
        block_height: "",
        error: e instanceof V3ReadError ? e.code : "unavailable",
      };
    }
    const agree =
      theirs.error === null &&
      theirs.owner === mine.owner &&
      theirs.generation === mine.generation &&
      theirs.control_seq === mine.control_seq;
    if (agree) {
      this.db
        .prepare(
          "INSERT INTO handoff_agreements (business_id, block_height, block_hash, owner, generation, control_seq, providers, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .run(
          businessId,
          block.height,
          block.hash,
          mine.owner,
          mine.generation,
          mine.control_seq,
          JSON.stringify([mine.name, theirs.name]),
          new Date(this.now()).toISOString(),
        );
      return { status: "agree" as const, block, providers: [mine, theirs], last_coherent: last() };
    }
    return {
      status: "uncertain" as const,
      block,
      providers: [mine, theirs],
      last_coherent: last(),
    };
  }

  /**
   * The proof of the newest closed sale this viewer took part in (or, for the current owner,
   * the newest close). `full`: the viewer operates the business now and may see which customer
   * used it; a former seller sees counts only.
   */
  async build(input: {
    businessId: string;
    businessName: string;
    binding: { network: string; account: string };
    viewerAccount: string;
    localOwner: boolean;
  }) {
    const reader = this.reader;
    if (!reader) throw new V3ReadError("unavailable", "no reader");
    const { binding } = input;
    const read = await this.withDeadline(async (signal) => {
      const block = (await reader.finalBlock(binding.network, signal)) as PinnedBlock;
      const v = (m: string, a: Record<string, unknown> = {}) =>
        viewAt(reader, binding, block, m, a, signal);
      const [control, outcomes, treasury, pending] = await Promise.all([
        v("get_control").then(decodeControl),
        v("get_outcomes").then(decodeOutcomes),
        v("get_treasury").then(decodeTreasury),
        v("get_pending").then(decodePending),
      ]);
      const account = reader.accountState
        ? await reader.accountState({ ...binding, block, signal }).catch(() => null)
        : null;
      return { block, control, outcomes, treasury, pending, account, v };
    });
    const closed = read.outcomes.filter((o) => o.status === "closed");
    const mine = closed.filter(
      (o) =>
        o.seller === input.viewerAccount ||
        o.buyer === input.viewerAccount ||
        (input.localOwner && read.control.owner === input.viewerAccount),
    );
    const outcome = mine.at(-1);
    if (!outcome) return null;
    const operatesNow = read.control.owner === input.viewerAccount;
    const src = this.chainSource;
    const h = read.block.height;
    const snap = this.snapshot(input.businessId, outcome.seq);
    const tx = this.closeTx(input.businessId, outcome.seq);
    let txSource: EvidenceSource = "everstreet";
    if (tx && reader.txOutcome) {
      const o = await this.withDeadline((signal) =>
        (reader.txOutcome as NonNullable<typeof reader.txOutcome>)(tx.hash, tx.signer, signal),
      ).catch(() => null);
      if (o) txSource = src === "testnet_final" ? "testnet_receipt" : src;
    }
    const seller = decodeParty(
      await this.withDeadline((signal) =>
        viewAt(reader, binding, read.block, "get_party", { account: outcome.seller }, signal),
      ).catch(() => null),
    );
    const agreement = await this.agreement(input.businessId, binding, read.block, read.control);

    // Continuity: units at the close (the snapshot) and the first settled use after it.
    const units = (snap?.customers ?? []).reduce((n, c) => n + BigInt(c.free), 0n);
    const first = snap ? this.firstUseAfter(input.businessId, snap.block.height) : null;
    const before = first && snap ? snap.customers.find((c) => c.account === first.account) : null;
    const nowMs = BigInt(read.block.timestamp_ms);
    const holds = (snap?.customers ?? []).filter(
      (c) => c.hold_active && BigInt(c.settle_until_ms) > nowMs,
    );

    const facts: Fact[] = [
      { key: "contract", label: "Business contract", value: binding.account, source: "everstreet" },
      { key: "owner", label: "Owner", value: read.control.owner, source: src, block: h },
      {
        key: "generation",
        label: "Generation",
        value: read.control.generation,
        source: src,
        block: h,
      },
      {
        key: "access_keys",
        label: "Access keys",
        value: read.account ? read.account.keys : null,
        source: src,
        block: read.account ? h : null,
      },
      {
        key: "code_hash",
        label: "Code hash",
        value: read.account ? read.account.code_hash : null,
        source: src,
        block: read.account ? h : null,
      },
      { key: "terms_digest", label: "Terms digest", value: outcome.digest, source: src, block: h },
      {
        key: "close_tx",
        label: "Close transaction",
        value: tx?.hash ?? null,
        source: txSource,
      },
      {
        // The units of the customers this business served here, read one by one at the close.
        key: "units_at_close",
        label: snap
          ? `Unused units of the ${snap.customers.length} customer${snap.customers.length === 1 ? "" : "s"} served here, at close`
          : "Unused units of the customers served here, at close",
        value: snap ? units.toString() : null,
        source: src,
        block: snap?.block.height ?? null,
      },
      {
        // First-use review (Nov 7, finding 83): the contract's own total, so this page agrees
        // with the sale page and the portfolio, which show the treasury's prepaid value.
        key: "prepaid_value_at_close",
        label: "All customers' prepaid value at close (the contract's total)",
        value: snap ? snap.treasury.ent_free_value : null,
        source: src,
        block: snap?.block.height ?? null,
      },
      {
        key: "next_settled_use",
        label: "Next settled use",
        value: first?.free ?? null,
        source: src,
        block: first?.block.height ?? null,
      },
    ];

    const generationBefore = outcome.generation_after - 1;
    const endedOps = (snap?.control.operators ?? []).filter(
      (o) => o.generation < outcome.generation_after,
    );
    const keptOps = read.control.operators.filter((o) => o.generation === outcome.generation_after);
    const proceedsPending = read.pending
      .filter((p) => p.to === outcome.seller && p.kind === "sale_proceeds")
      .reduce((n, p) => n + BigInt(p.amount), 0n);
    const rights = {
      ended: [
        { what: "owner_role", account: outcome.seller, generation: generationBefore },
        ...endedOps.map((o) => ({
          what: "operator",
          account: o.account,
          generation: o.generation,
        })),
      ],
      carried_over: {
        operators: keptOps.map((o) => ({ account: o.account, caps: o.caps })),
        customers: snap ? snap.customers.length : null,
        units: snap ? units.toString() : null,
      },
      operates: {
        account: read.control.owner,
        generation: read.control.generation,
        moved: read.control.owner === outcome.buyer,
      },
      seller_claim: {
        account: outcome.seller,
        owed: seller?.sale_proceeds_claim ?? null,
        in_flight: proceedsPending.toString(),
      },
      still_possible: holds.map((c) => ({
        customer: operatesNow ? c.account : null,
        units: c.hold_units,
        until_ms: c.settle_until_ms,
      })),
    };

    const continuity = {
      customer: first
        ? { account: operatesNow ? first.account : null, name: operatesNow ? first.name : null }
        : null,
      at_close: before?.free ?? null,
      after: first?.free ?? null,
      charged: first ? 1 : 0,
      at_close_block: snap?.block.height ?? null,
      after_block: first?.block.height ?? null,
    };

    return {
      business: { id: input.businessId, name: input.businessName },
      network: binding.network,
      contract: binding.account,
      source: src,
      block: read.block,
      deal: {
        seq: outcome.seq,
        version: outcome.version,
        digest: outcome.digest,
        seller: outcome.seller,
        buyer: outcome.buyer,
        price: outcome.price,
        generation_after: outcome.generation_after,
        at_ms: outcome.at_ms,
      },
      asset: read.treasury.asset,
      token: (() => {
        const m = tokenMetaOf(this.db, binding.network, read.treasury.asset);
        return m ? { symbol: m.symbol, decimals: m.decimals } : null;
      })(),
      viewer: { operates: operatesNow },
      close: tx ? { tx: tx.hash, signer: tx.signer } : null,
      continuity,
      facts,
      rights,
      agreement,
      snapshot: snap
        ? {
            block: snap.block,
            code_hash: snap.account?.code_hash ?? null,
            keys: snap.account?.keys ?? null,
          }
        : null,
    };
  }

  /**
   * The exportable receipt: versioned, digest-sealed, with no customer identities (counts and
   * units only). `scripts/verify-receipt.ts` checks the digest offline and, with --live, reads
   * the contract on NEAR testnet.
   */
  receipt(p: NonNullable<Awaited<ReturnType<HandoffProof["build"]>>>) {
    const body = {
      format: RECEIPT_FORMAT,
      version: 1,
      network: p.network,
      contract: p.contract,
      source: p.source,
      read_at: { height: p.block.height, hash: p.block.hash, timestamp_ms: p.block.timestamp_ms },
      deal: p.deal,
      control: {
        owner: p.facts.find((f) => f.key === "owner")?.value ?? null,
        generation: p.facts.find((f) => f.key === "generation")?.value ?? null,
      },
      account: {
        code_hash: p.facts.find((f) => f.key === "code_hash")?.value ?? null,
        access_keys: p.facts.find((f) => f.key === "access_keys")?.value ?? null,
      },
      close_tx: p.close?.tx ?? null,
      close_signer: p.close?.signer ?? null,
      at_close: p.snapshot
        ? {
            height: p.snapshot.block.height,
            hash: p.snapshot.block.hash,
            customers: p.rights.carried_over.customers,
            units: p.rights.carried_over.units,
          }
        : null,
      first_settled_use: p.continuity.after_block
        ? {
            height: p.continuity.after_block,
            units_before: p.continuity.at_close,
            units_after: p.continuity.after,
          }
        : null,
      agreement: {
        status: p.agreement.status,
        providers: p.agreement.providers.map((x) => ({
          name: x.name,
          owner: x.owner || null,
          generation: x.generation || null,
          height: x.block_height || null,
          error: x.error,
        })),
        last_coherent: p.agreement.last_coherent,
      },
      sources: Object.fromEntries(p.facts.map((f) => [f.key, f.source])),
    };
    const digest = createHash("sha256").update(canonicalJson(body)).digest("hex");
    return { ...body, digest };
  }
}

/** Verifies a receipt's digest (offline): the same canonical body hashes to the same digest. */
export function receiptDigestOk(r: Record<string, unknown>): boolean {
  const { digest, ...body } = r;
  if (typeof digest !== "string") return false;
  return createHash("sha256").update(canonicalJson(body)).digest("hex") === digest;
}
