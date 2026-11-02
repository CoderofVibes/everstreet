// Accepting a deal and handing over (Astra: LaunchPad and IntactProfiles phase 6, §7 G; the sale
// rules live in contracts/business-v2). The seller proposes exact terms to a buying team that
// asked for access; the terms are frozen as JSON, hashed, and that hash goes on chain with the
// price, parties, expiry and control generation. The contract's digest is what both people
// accept: a revision clears both acceptances. The buyer's accepting account funds the exact
// price first. The second matching acceptance closes the sale on chain, and only then does
// Everstreet follow: the business, its page and its records move to the buyer; old helpers,
// grants and the listing end; the seller's proceeds wait in the contract until claimed.
//
// Everstreet never decides that a sale happened: it reads the deal and the owner back from the
// contract after every step.

import { createHash, randomUUID } from "node:crypto";
import type { Acquisitions } from "./acquire.ts";
import type { Chain, ChainDeal } from "./chain.ts";
import type { Db } from "./db.ts";
import type { Payments } from "./payments.ts";
import { HttpError, type Person, type Store } from "./store.ts";

const now = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

interface DealRow {
  id: string;
  business_id: string;
  buyer_id: string;
  seller_id: string;
  representative_id: string;
  seller_account: string;
  buyer_account: string;
  business_account: string;
  status: "open" | "closed" | "cancelled" | "expired" | "void";
  version: number;
  closed_at: string | null;
  generation_after: number | null;
  close_tx: string | null;
  claim_tx: string | null;
  claim_error: string | null;
  claimed_at: string | null;
  created_at: string;
}

interface VersionRow {
  deal_id: string;
  version: number;
  price_cents: number;
  expires_at: string;
  terms: string;
  terms_hash: string;
  digest: string;
  tx: string;
  created_at: string;
}

export interface Terms {
  format: string;
  business: { name: string; account: string };
  seller: { name: string; account: string };
  buyer: { team: string; kind: string; representative: string; account: string };
  network: string;
  asset: string;
  price_cents: number;
  expires_at: string;
  control: string[];
  stays: string[];
  separate: string[];
  excluded: string[];
  handover: string;
  conditions: string;
  evidence: {
    estimate: string;
    basis: string;
    months: string[];
    revenue_month: string;
    profit_month: string;
    customer_money: string;
    snapshot_at: string;
  };
}

/** The exact terms both people sign, as a stable string; its sha256 goes on chain. */
export const termsHash = (t: Terms) => createHash("sha256").update(JSON.stringify(t)).digest("hex");

/** Plain differences between two versions, for "what changed since you last looked". */
export function changes(a: Terms, b: Terms): string[] {
  const out: string[] = [];
  if (a.price_cents !== b.price_cents)
    out.push(`Price: ${usd(a.price_cents)} → ${usd(b.price_cents)}`);
  if (a.expires_at !== b.expires_at)
    out.push(
      `Expiry: ${a.expires_at.slice(0, 16).replace("T", " ")} → ${b.expires_at.slice(0, 16).replace("T", " ")} UTC`,
    );
  if (a.handover !== b.handover)
    out.push(`Handover: "${a.handover || "none"}" → "${b.handover || "none"}"`);
  if (a.conditions !== b.conditions)
    out.push(`Conditions: "${a.conditions || "none"}" → "${b.conditions || "none"}"`);
  for (const key of ["control", "stays", "separate", "excluded"] as const) {
    const added = b[key].filter((x) => !a[key].includes(x));
    const removed = a[key].filter((x) => !b[key].includes(x));
    for (const x of added) out.push(`Added to ${key}: ${x}`);
    for (const x of removed) out.push(`Removed from ${key}: ${x}`);
  }
  if (a.evidence.estimate !== b.evidence.estimate)
    out.push(`Evidence snapshot: estimate ${a.evidence.estimate} → ${b.evidence.estimate}`);
  return out;
}

const CHAIN_STATUS: Record<ChainDeal["deal"]["status"], DealRow["status"]> = {
  Open: "open",
  Closed: "closed",
  Cancelled: "cancelled",
  Expired: "expired",
  Void: "void",
};

/** Contract errors in words a person can act on. */
function refusal(error: string | undefined) {
  const e = error ?? "";
  if (e.includes("E_TERMS"))
    return "These aren't the current terms any more. Read the latest version and accept that.";
  if (e.includes("E_FUNDS: fund")) return "The buyer has to fund the exact price before accepting.";
  if (e.includes("E_EXPIRED")) return "This offer has expired.";
  if (e.includes("E_GENERATION"))
    return "Control of the business changed since these terms were proposed.";
  if (e.includes("E_STATE")) return "This deal isn't open any more.";
  if (e.includes("E_NOT_OWNER") || e.includes("E_NOT_PARTY") || e.includes("E_NOT_SELLER"))
    return `The contract refused: ${e.replace(/^.*?(E_[A-Z_]+)/, "$1")}`;
  return `Not recorded: ${e || "unknown error"}`;
}

export class Deals {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly payments: Payments,
    private readonly acquire: Acquisitions,
    private readonly chain: Chain | null,
  ) {}

  private need() {
    if (!this.chain) throw new HttpError(409, "NEAR testnet isn't connected on this computer");
    return this.chain;
  }

  private row(id: string) {
    const d = this.db.prepare("SELECT * FROM deals WHERE id = ?").get(id) as DealRow | undefined;
    if (!d) throw new HttpError(404, "No such deal");
    return d;
  }

  private versions(id: string) {
    return this.db
      .prepare("SELECT * FROM deal_versions WHERE deal_id = ? ORDER BY version")
      .all(id) as unknown as VersionRow[];
  }

  private step(
    dealId: string,
    kind: string,
    person: Person | null,
    version: number | null,
    ok: boolean,
    tx: string | null,
    detail = "",
  ) {
    this.db
      .prepare(
        "INSERT INTO deal_steps (deal_id, kind, person_id, version, ok, tx, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(dealId, kind, person?.id ?? null, version, ok ? 1 : 0, tx, detail, now());
  }

  /** Who the viewer is in this deal; anyone else gets a 404. */
  private party(viewer: Person, d: DealRow): "seller" | "representative" | "team" {
    if (viewer.id === d.seller_id) return "seller";
    if (viewer.id === d.representative_id) return "representative";
    this.acquire.role(viewer, d.buyer_id);
    return "team";
  }

  private async buildTerms(
    businessId: string,
    buyerId: string,
    accounts: { seller: string; buyer: string; business: string },
    input: { price_cents: number; expires_at: string; handover: string; conditions: string },
  ): Promise<Terms> {
    const chain = this.need();
    const b = this.db
      .prepare("SELECT name, owner_id FROM businesses WHERE id = ?")
      .get(businessId) as {
      name: string;
      owner_id: string;
    };
    const buyer = this.db
      .prepare("SELECT name, kind, owner_id FROM buyers WHERE id = ?")
      .get(buyerId) as {
      name: string;
      kind: string;
      owner_id: string;
    };
    const f = await this.acquire.facts(businessId);
    const ops = await this.acquire.operations(businessId, f.hours);
    const line = (i: { name: string; detail: string; enforced: string }) =>
      `${i.name}: ${i.detail}${i.enforced && i.enforced !== "—" ? ` (${i.enforced})` : ""}`;
    const e = f.estimate;
    return {
      format: "everstreet-deal/1",
      business: { name: b.name, account: accounts.business },
      seller: { name: this.store.person(b.owner_id).display_name, account: accounts.seller },
      buyer: {
        team: buyer.name,
        kind: buyer.kind,
        representative: this.store.person(buyer.owner_id).display_name,
        account: accounts.buyer,
      },
      network: "NEAR testnet",
      asset: `${chain.token} (test dollars, no value)`,
      price_cents: input.price_cents,
      expires_at: input.expires_at,
      control: ops.manifest.receive.map(line),
      stays: ops.manifest.stays.map(line),
      separate: ops.manifest.separate.map(line),
      excluded: ops.manifest.excluded.map((i) => i.name),
      handover: input.handover,
      conditions: input.conditions,
      evidence: {
        estimate:
          e.low_cents === null ? "no range" : `${usd(e.low_cents)}–${usd(e.high_cents ?? 0)}`,
        basis: e.label,
        months: f.used.map((m) => m.label),
        revenue_month: f.revenue === null ? "unknown" : usd(f.revenue),
        profit_month: f.profit === null ? "unknown" : usd(f.profit),
        customer_money: ops.treasury?.customer_money ?? "unknown",
        snapshot_at: now(),
      },
    };
  }

  private clean(input: {
    price_cents?: number;
    days?: number;
    handover?: string;
    conditions?: string;
  }) {
    const price = Math.round(Number(input.price_cents));
    if (!(price >= 100 && price <= 1_000_000_000)) throw new HttpError(400, "Use a price from $1");
    const days = Math.round(Number(input.days ?? 7));
    if (!(days >= 1 && days <= 30))
      throw new HttpError(400, "The offer can stay open 1 to 30 days");
    return {
      price_cents: price,
      expires_at: new Date(Date.now() + days * DAY).toISOString(),
      handover: String(input.handover ?? "")
        .trim()
        .slice(0, 300),
      conditions: String(input.conditions ?? "")
        .trim()
        .slice(0, 300),
    };
  }

  // ---------- the seller proposes and revises ----------

  async propose(
    seller: Person,
    businessId: string,
    input: {
      buyer_id?: string;
      price_cents?: number;
      days?: number;
      handover?: string;
      conditions?: string;
    },
  ) {
    const chain = this.need();
    this.store.business(seller, businessId);
    const business = this.payments.businessPayments(businessId);
    if (!business)
      throw new HttpError(
        409,
        "Turn on payments first: a sale on NEAR needs the business's own contract",
      );
    const buyerId = String(input.buyer_id ?? "");
    const buyer = this.db.prepare("SELECT owner_id FROM buyers WHERE id = ?").get(buyerId) as
      | { owner_id: string }
      | undefined;
    if (!buyer) throw new HttpError(404, "No such buying team");
    const asked = this.db
      .prepare(
        "SELECT 1 FROM access_requests r JOIN listings l ON l.id = r.listing_id WHERE l.business_id = ? AND r.buyer_id = ? AND r.status NOT IN ('declined','withdrawn')",
      )
      .get(businessId, buyerId);
    if (!asked) throw new HttpError(409, "Propose terms to a team that has asked for access");
    if (
      this.db
        .prepare("SELECT 1 FROM deals WHERE business_id = ? AND buyer_id = ? AND status = 'open'")
        .get(businessId, buyerId)
    )
      throw new HttpError(409, "There is already an open deal with this team; revise it instead");
    if (buyer.owner_id === seller.id) throw new HttpError(409, "You can't sell to yourself");
    const c = this.clean(input);
    const sellerKey = await this.payments.signer(seller);
    const rep = this.store.person(buyer.owner_id);
    const repKey = await this.payments.signer(rep);
    const accounts = {
      seller: sellerKey.account_id,
      buyer: repKey.account_id,
      business: business.account_id,
    };
    const terms = await this.buildTerms(businessId, buyerId, accounts, c);
    const hash = termsHash(terms);
    const id = randomUUID();
    const tx = await chain.proposeSale({
      owner: sellerKey.account_id,
      secret: sellerKey.secret,
      business: business.account_id,
      dealId: id,
      buyer: repKey.account_id,
      amount: this.payments.units(c.price_cents),
      expiresAtMs: Date.parse(c.expires_at),
      termsHash: hash,
    });
    if (!tx.ok) throw new HttpError(409, refusal(tx.error));
    const onChain = await chain.getDeal(business.account_id, id);
    if (!onChain) throw new HttpError(409, "The deal didn't appear on chain; nothing was recorded");
    this.db
      .prepare(
        "INSERT INTO deals (id, business_id, buyer_id, seller_id, representative_id, seller_account, buyer_account, business_account, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)",
      )
      .run(
        id,
        businessId,
        buyerId,
        seller.id,
        rep.id,
        accounts.seller,
        accounts.buyer,
        accounts.business,
        now(),
        now(),
      );
    this.db
      .prepare(
        "INSERT INTO deal_versions (deal_id, version, price_cents, expires_at, terms, terms_hash, digest, tx, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        c.price_cents,
        c.expires_at,
        JSON.stringify(terms),
        hash,
        onChain.digest,
        tx.hash,
        now(),
      );
    for (const [i, item] of terms.separate.entries())
      this.db
        .prepare(
          "INSERT INTO transfer_items (deal_id, key, name, status, detail, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
        )
        .run(
          id,
          item.startsWith("Booking service") ? "booking_service" : `item-${i}`,
          item.split(":")[0] as string,
          item,
          now(),
        );
    this.step(id, "proposed", seller, 1, true, tx.hash);
    return this.view(seller, id);
  }

  async revise(
    seller: Person,
    dealId: string,
    input: { price_cents?: number; days?: number; handover?: string; conditions?: string },
  ) {
    const chain = this.need();
    const d = this.row(dealId);
    if (d.seller_id !== seller.id) throw new HttpError(404, "No such deal");
    if (d.status !== "open") throw new HttpError(409, `This deal is ${d.status}`);
    const keep = !input.days;
    const current = this.versions(dealId).at(-1) as VersionRow;
    const c = {
      ...this.clean({ ...input, days: input.days || 1 }),
      ...(keep ? { expires_at: current.expires_at } : {}),
    };
    const terms = await this.buildTerms(
      d.business_id,
      d.buyer_id,
      { seller: d.seller_account, buyer: d.buyer_account, business: d.business_account },
      c,
    );
    const hash = termsHash(terms);
    const key = await this.payments.signer(seller);
    const tx = await chain.reviseSale({
      owner: key.account_id,
      secret: key.secret,
      business: d.business_account,
      dealId,
      amount: this.payments.units(c.price_cents),
      expiresAtMs: Date.parse(c.expires_at),
      termsHash: hash,
    });
    if (!tx.ok) throw new HttpError(409, refusal(tx.error));
    const onChain = await chain.getDeal(d.business_account, dealId);
    if (!onChain) throw new HttpError(409, "The deal couldn't be read back from the contract");
    const version = onChain.deal.version;
    this.db
      .prepare(
        "INSERT INTO deal_versions (deal_id, version, price_cents, expires_at, terms, terms_hash, digest, tx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        dealId,
        version,
        c.price_cents,
        c.expires_at,
        JSON.stringify(terms),
        hash,
        onChain.digest,
        tx.hash,
        now(),
      );
    this.db
      .prepare("UPDATE deals SET version = ?, updated_at = ? WHERE id = ?")
      .run(version, now(), dealId);
    this.step(dealId, "revised", seller, version, true, tx.hash, "Both acceptances were cleared");
    return this.view(seller, dealId);
  }

  // ---------- the buyer funds; both accept ----------

  async fund(viewer: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    if (viewer.id !== d.representative_id)
      throw new HttpError(403, "Only the team's accepting account funds the deal");
    const onChain = await chain.getDeal(d.business_account, dealId);
    if (onChain?.deal.status !== "Open") throw new HttpError(409, "This deal isn't open");
    const price = onChain.deal.price;
    if (onChain.deal.held === price) throw new HttpError(409, "The deal is already funded");
    if (onChain.deal.held !== "0")
      throw new HttpError(
        409,
        "The price changed since you funded it. Take your hold back, then fund the new price",
      );
    const wallet = await this.payments.wallet(viewer);
    const need = this.payments.cents(price);
    if (wallet.balance_cents !== null && wallet.balance_cents < need)
      throw new HttpError(
        409,
        `Your account has ${usd(wallet.balance_cents)}; the price is ${usd(need)}. Get test dollars first`,
      );
    const key = await this.payments.signer(viewer);
    const tx = await chain.fundDeal({
      buyer: key.account_id,
      secret: key.secret,
      business: d.business_account,
      dealId,
      amount: price,
    });
    const after = await chain.getDeal(d.business_account, dealId);
    const ok = tx.ok && after?.deal.held === price;
    this.step(
      dealId,
      "funded",
      viewer,
      onChain.deal.version,
      ok,
      tx.hash,
      ok ? `${usd(need)} held by the contract` : (tx.error ?? ""),
    );
    if (!ok)
      throw new HttpError(
        409,
        `The contract didn't take the funds; the token returned them. ${tx.error ?? ""}`.trim(),
      );
    return this.view(viewer, dealId);
  }

  /** Test dollars only: the faucet sends the accepting account what the price still needs. */
  async testDollars(viewer: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    if (viewer.id !== d.representative_id)
      throw new HttpError(403, "Only the team's accepting account funds the deal");
    const v = this.versions(dealId).at(-1) as VersionRow;
    const wallet = await this.payments.wallet(viewer);
    const short = v.price_cents - (wallet.balance_cents ?? 0);
    if (short > 0) {
      const r = await chain.faucet(wallet.account_id, this.payments.units(short));
      if (!r.ok) throw new HttpError(409, "The test-dollar faucet could not send right now");
      this.step(
        dealId,
        "test_dollars",
        viewer,
        v.version,
        true,
        r.hash,
        `${usd(short)} test dollars from the faucet`,
      );
    }
    return this.view(viewer, dealId);
  }

  async withdrawHold(viewer: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    if (viewer.id !== d.representative_id)
      throw new HttpError(403, "Only the team's accepting account holds the funds");
    const key = await this.payments.signer(viewer);
    const tx = await chain.withdrawDealHold({
      buyer: key.account_id,
      secret: key.secret,
      business: d.business_account,
      dealId,
    });
    const after = await chain.getDeal(d.business_account, dealId);
    const ok = tx.ok && after?.deal.held === "0" && !tx.error;
    this.step(
      dealId,
      "hold_withdrawn",
      viewer,
      after?.deal.version ?? null,
      ok,
      tx.hash,
      tx.error ?? "",
    );
    if (!ok)
      throw new HttpError(
        409,
        tx.ok
          ? "The transfer back didn't arrive; the contract kept your hold. Try again."
          : refusal(tx.error),
      );
    return this.view(viewer, dealId);
  }

  async accept(viewer: Person, dealId: string, digest: string) {
    const chain = this.need();
    const d = this.row(dealId);
    const who = this.party(viewer, d);
    if (who === "team")
      throw new HttpError(403, "Only the seller or the team's accepting account accepts");
    const key = await this.payments.signer(viewer);
    const tx = await chain.acceptSale({
      party: key.account_id,
      secret: key.secret,
      business: d.business_account,
      dealId,
      digest: String(digest),
    });
    const after = await chain.getDeal(d.business_account, dealId);
    this.step(
      dealId,
      who === "seller" ? "seller_accepted" : "buyer_accepted",
      viewer,
      after?.deal.version ?? null,
      tx.ok,
      tx.hash,
      tx.ok ? "" : (tx.error ?? ""),
    );
    if (!tx.ok) throw new HttpError(409, refusal(tx.error));
    if (after?.deal.status === "Closed") {
      this.step(
        dealId,
        "closed",
        null,
        after.deal.version,
        true,
        tx.hash,
        "Control changed on the business's contract",
      );
      await this.settle(d, tx.hash);
    }
    return this.view(viewer, dealId);
  }

  async cancel(viewer: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    const who = this.party(viewer, d);
    if (who === "team")
      throw new HttpError(403, "Only the seller or the team's accepting account cancels");
    const key = await this.payments.signer(viewer);
    const tx = await chain.cancelSale({
      party: key.account_id,
      secret: key.secret,
      business: d.business_account,
      dealId,
    });
    this.step(dealId, "cancelled", viewer, d.version, tx.ok, tx.hash, tx.error ?? "");
    if (!tx.ok) throw new HttpError(409, refusal(tx.error));
    return this.view(viewer, dealId);
  }

  /** Everstreet follows the contract: run only once the contract shows the buyer as owner. */
  private async settle(d: DealRow, closeTx: string | null) {
    const fresh = this.row(d.id);
    if (fresh.status === "closed") return;
    const control = await this.need().control(d.business_account);
    if (control.owner !== d.buyer_account) return;
    const at = now();
    const listing = this.db
      .prepare("SELECT id FROM listings WHERE business_id = ?")
      .get(d.business_id) as { id: string } | undefined;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE businesses SET owner_id = ?, updated_at = ? WHERE id = ?")
        .run(d.representative_id, at, d.business_id);
      this.db
        .prepare(
          "INSERT INTO ownership (business_id, from_id, to_id, buyer_id, deal_id, generation, tx, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          d.business_id,
          d.seller_id,
          d.representative_id,
          d.buyer_id,
          d.id,
          control.generation,
          closeTx,
          at,
        );
      // The contract voided every operator grant; the team list says so.
      this.db
        .prepare("UPDATE team SET revoked_at = ? WHERE business_id = ? AND revoked_at IS NULL")
        .run(at, d.business_id);
      if (listing) {
        this.db
          .prepare("UPDATE listings SET mode = 'closed', updated_at = ? WHERE id = ?")
          .run(at, listing.id);
        this.db
          .prepare(
            "UPDATE access_requests SET status = 'revoked', revoked_at = ? WHERE listing_id = ? AND status = 'granted'",
          )
          .run(at, listing.id);
        this.db
          .prepare(
            "UPDATE access_requests SET status = 'withdrawn' WHERE listing_id = ? AND status = 'pending'",
          )
          .run(listing.id);
      }
      // The seller's own work and sharing choice were theirs; the new owner sets their own.
      this.db
        .prepare(
          "UPDATE value_settings SET founder_hours_week = NULL, hourly_rate_cents = NULL, share_numbers = 0, updated_at = ? WHERE business_id = ?",
        )
        .run(at, d.business_id);
      this.db
        .prepare(
          "UPDATE deals SET status = 'closed', closed_at = ?, generation_after = ?, close_tx = ?, updated_at = ? WHERE id = ?",
        )
        .run(at, control.generation, closeTx, at, d.id);
      this.db
        .prepare(
          "UPDATE deals SET status = 'void', updated_at = ? WHERE business_id = ? AND id != ? AND status = 'open'",
        )
        .run(at, d.business_id, d.id);
      this.db
        .prepare(
          "UPDATE transfer_items SET status = 'completed', note = 'Moved with the business on Everstreet at close (service-enforced, not on NEAR)', updated_at = ? WHERE deal_id = ? AND key = 'booking_service'",
        )
        .run(at, d.id);
      this.db
        .prepare(
          "INSERT INTO events (type, subject, actor, payload, at) VALUES ('business.sold', ?, ?, ?, ?)",
        )
        .run(
          d.business_id,
          d.seller_id,
          JSON.stringify({ deal: d.id, to: d.representative_id, generation: control.generation }),
          at,
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---------- after the close ----------

  async claim(seller: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    if (d.seller_id !== seller.id) throw new HttpError(404, "No such deal");
    if (d.status !== "closed")
      throw new HttpError(409, "Proceeds exist only after the sale closes");
    const key = await this.payments.signer(seller);
    const tx = await chain.claimProceeds({
      seller: key.account_id,
      secret: key.secret,
      business: d.business_account,
    });
    const left = await chain.proceedsOf(d.business_account, d.seller_account);
    const ok = tx.ok && left === "0";
    this.step(
      dealId,
      "proceeds_claimed",
      seller,
      null,
      ok,
      tx.hash,
      ok ? "" : (tx.error ?? "still held"),
    );
    if (ok)
      this.db
        .prepare(
          "UPDATE deals SET claim_tx = ?, claimed_at = ?, claim_error = NULL, updated_at = ? WHERE id = ?",
        )
        .run(tx.hash, now(), now(), dealId);
    else
      this.db
        .prepare("UPDATE deals SET claim_error = ?, updated_at = ? WHERE id = ?")
        .run(
          tx.ok
            ? "The transfer didn't arrive; the contract kept your proceeds. Try again."
            : refusal(tx.error),
          now(),
          dealId,
        );
    return this.view(seller, dealId);
  }

  /** The former owner tries a real owner action; the refusal is the proof. */
  async formerOwnerCheck(seller: Person, dealId: string) {
    const chain = this.need();
    const d = this.row(dealId);
    if (d.seller_id !== seller.id) throw new HttpError(404, "No such deal");
    if (d.status !== "closed") throw new HttpError(409, "Only after the sale closes");
    const key = await this.payments.signer(seller);
    const tx = await chain.withdrawProfit({
      owner: key.account_id,
      secret: key.secret,
      business: d.business_account,
      amount: this.payments.units(100),
    });
    const check = await chain.operatorCheck(d.business_account, d.seller_account, "fulfillment");
    const refused = !tx.ok;
    this.step(
      dealId,
      "former_owner_check",
      seller,
      null,
      refused,
      tx.hash,
      refused ? (tx.error ?? "") : "The contract allowed it",
    );
    return {
      ...(await this.view(seller, dealId)),
      check: { refused, error: tx.error ?? null, tx: tx.hash, operator_check: check },
    };
  }

  async markItem(viewer: Person, dealId: string, key: string, note: string) {
    const d = this.row(dealId);
    if (viewer.id !== d.representative_id && viewer.id !== d.seller_id)
      throw new HttpError(403, "Only the seller or the buyer's accepting account");
    if (d.status !== "closed")
      throw new HttpError(409, "Transfer items are confirmed after the close");
    const r = this.db
      .prepare(
        "UPDATE transfer_items SET status = 'completed', note = ?, updated_at = ? WHERE deal_id = ? AND key = ?",
      )
      .run(
        `${viewer.display_name}: ${String(note).slice(0, 200) || "received"}`,
        now(),
        dealId,
        key,
      );
    if (r.changes === 0) throw new HttpError(404, "No such item");
    return this.view(viewer, dealId);
  }

  private async firstShift(d: DealRow) {
    const chain = this.need();
    const control = await chain.control(d.business_account).catch(() => null);
    const t = await chain.treasury(d.business_account).catch(() => null);
    const orders = (
      this.db
        .prepare(
          "SELECT p.order_id, p.amount_cents, p.created_at, p.status, s.starts_at, pe.display_name FROM payments p JOIN people pe ON pe.id = p.person_id LEFT JOIN sessions_offered s ON s.id = p.session_id WHERE p.business_id = ? AND p.created_at < ? AND p.status = 'paid' ORDER BY p.created_at",
        )
        .all(d.business_id, d.closed_at ?? now()) as {
        order_id: string;
        amount_cents: number;
        created_at: string;
        status: string;
        starts_at: string | null;
        display_name: string;
      }[]
    ).map((o) => ({
      order_id: o.order_id,
      customer: o.display_name.split(" ")[0],
      amount_cents: o.amount_cents,
      paid_at: o.created_at,
      session_starts_at: o.starts_at,
    }));
    const v1 = this.versions(d.id).at(-1);
    return {
      control: control && {
        owner: control.owner,
        generation: control.generation,
        operators: control.operators.length,
        is_buyer: control.owner === d.buyer_account,
      },
      customer_money: {
        in_terms: v1 ? (JSON.parse(v1.terms) as Terms).evidence.customer_money : "unknown",
        now: t
          ? usd(this.payments.cents(t.unearned_orders) + this.payments.cents(t.customer_credit))
          : "unknown",
        source: t ? "Read from the business's contract just now" : "NEAR testnet could not be read",
      },
      pre_sale_orders: orders,
      business_id: d.business_id,
    };
  }

  async view(viewer: Person, dealId: string) {
    let d = this.row(dealId);
    const who = this.party(viewer, d);
    const chain = this.need();
    const onChain = await chain.getDeal(d.business_account, dealId).catch(() => null);
    if (onChain) {
      const s = CHAIN_STATUS[onChain.deal.status];
      if (s === "closed" && d.status !== "closed") await this.settle(d, null);
      else if (s !== "closed" && s !== d.status)
        this.db
          .prepare("UPDATE deals SET status = ?, updated_at = ? WHERE id = ?")
          .run(s, now(), dealId);
      d = this.row(dealId);
    }
    const versions = this.versions(dealId);
    const current = versions.at(-1) as VersionRow;
    const previous = versions.length > 1 ? versions.at(-2) : undefined;
    const terms = JSON.parse(current.terms) as Terms;
    const expired = d.status === "open" && Date.parse(current.expires_at) <= Date.now();
    const business = this.db
      .prepare("SELECT name, slug FROM businesses WHERE id = ?")
      .get(d.business_id) as { name: string; slug: string };
    const buyer = this.db.prepare("SELECT name FROM buyers WHERE id = ?").get(d.buyer_id) as {
      name: string;
    };
    const steps = (
      this.db
        .prepare(
          "SELECT s.*, p.display_name FROM deal_steps s LEFT JOIN people p ON p.id = s.person_id WHERE s.deal_id = ? ORDER BY s.id",
        )
        .all(dealId) as {
        kind: string;
        display_name: string | null;
        version: number | null;
        ok: number;
        tx: string | null;
        detail: string;
        at: string;
      }[]
    ).map((s) => ({
      kind: s.kind,
      by: s.display_name,
      version: s.version,
      ok: Boolean(s.ok),
      tx_url: s.tx ? `${chain.explorer}/txns/${s.tx}` : null,
      detail: s.detail,
      at: s.at,
    }));
    const mine = who === "seller" || who === "representative";
    const wallet = mine ? await this.payments.wallet(viewer).catch(() => null) : null;
    const proceeds =
      d.status === "closed"
        ? await chain
            .proceedsOf(d.business_account, d.seller_account)
            .then((p) => this.payments.cents(p))
            .catch(() => null)
        : null;
    const items = this.db
      .prepare(
        "SELECT key, name, status, detail, note, updated_at FROM transfer_items WHERE deal_id = ? ORDER BY key",
      )
      .all(dealId);
    return {
      deal: {
        id: dealId,
        status: expired ? ("expired" as const) : d.status,
        version: current.version,
        price_cents: current.price_cents,
        expires_at: current.expires_at,
        digest: current.digest,
        terms_hash: current.terms_hash,
        business: {
          id: d.business_id,
          name: business.name,
          slug: business.slug,
          account: d.business_account,
          url: `${chain.explorer}/address/${d.business_account}`,
        },
        seller: { name: this.store.person(d.seller_id).display_name, account: d.seller_account },
        buyer: {
          id: d.buyer_id,
          team: buyer.name,
          representative: this.store.person(d.representative_id).display_name,
          account: d.buyer_account,
        },
        closed_at: d.closed_at,
        generation_after: d.generation_after,
        close_tx_url: d.close_tx ? `${chain.explorer}/txns/${d.close_tx}` : null,
      },
      you: who,
      terms,
      changes: previous ? changes(JSON.parse(previous.terms) as Terms, terms) : [],
      previous_version: previous?.version ?? null,
      chain: onChain && {
        status: onChain.deal.status,
        version: onChain.deal.version,
        held_cents: this.payments.cents(onChain.deal.held),
        funded: onChain.deal.held === onChain.deal.price,
        seller_accepted: onChain.deal.seller_accepted === onChain.digest,
        buyer_accepted: onChain.deal.buyer_accepted === onChain.digest,
        digest: onChain.digest,
        matches_terms:
          onChain.deal.terms_hash === current.terms_hash && onChain.digest === current.digest,
      },
      wallet,
      proceeds:
        d.status === "closed"
          ? {
              held_cents: proceeds,
              claimed_at: d.claimed_at,
              claim_tx_url: d.claim_tx ? `${chain.explorer}/txns/${d.claim_tx}` : null,
              error: d.claim_error,
            }
          : null,
      steps,
      items,
      first_shift: d.status === "closed" && who !== "seller" ? await this.firstShift(d) : null,
    };
  }

  /** Every deal the viewer is part of: as seller, or on the buying team. */
  mine(viewer: Person) {
    const teams = this.db
      .prepare(
        "SELECT id FROM buyers WHERE owner_id = ? UNION SELECT buyer_id FROM buyer_members WHERE person_id = ?",
      )
      .all(viewer.id, viewer.id) as { id: string }[];
    const ids = teams.map((t) => t.id);
    const rows = (
      this.db.prepare("SELECT * FROM deals ORDER BY updated_at DESC").all() as unknown as DealRow[]
    ).filter((d) => d.seller_id === viewer.id || ids.includes(d.buyer_id));
    return rows.map((d) => {
      const v = this.versions(d.id).at(-1) as VersionRow;
      const business = this.db
        .prepare("SELECT name FROM businesses WHERE id = ?")
        .get(d.business_id) as { name: string };
      const buyer = this.db.prepare("SELECT name FROM buyers WHERE id = ?").get(d.buyer_id) as {
        name: string;
      };
      return {
        id: d.id,
        business_id: d.business_id,
        business: business.name,
        buyer_id: d.buyer_id,
        buyer: buyer.name,
        role: d.seller_id === viewer.id ? "seller" : "buyer",
        status:
          d.status === "open" && Date.parse(v.expires_at) <= Date.now() ? "expired" : d.status,
        version: d.version,
        price_cents: v.price_cents,
        updated_at: d.created_at,
      };
    });
  }
}
