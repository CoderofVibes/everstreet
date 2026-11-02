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
  /**
   * Format 1 ("everstreet-deal/1", before job 003p) always embedded these figures. Those terms
   * are stored and hashed exactly as written and never rewritten. Format 2 includes figures
   * only when the seller chose to and the team had financials access at the time.
   */
  evidence: EvidenceV1 | EvidenceV2;
  /** Format 2: what the buyer takes on whatever the evidence choice. */
  obligations?: { customer_money: string };
}

interface EvidenceV1 {
  estimate: string;
  basis: string;
  months: string[];
  revenue_month: string;
  profit_month: string;
  customer_money: string;
  snapshot_at: string;
}

type EvidenceV2 =
  | { included: false; note: string }
  | {
      included: true;
      estimate: string;
      basis: string;
      months: string[];
      revenue_month: string;
      profit_month: string;
      snapshot_at: string;
      audience: string;
      retention: string;
    };

const SNAPSHOT_AUDIENCE = "The seller and the buying team named in these terms";
const SNAPSHOT_RETENTION =
  "Part of the terms both sides accept: each keeps a copy. Ending evidence access later stops new reads; it does not recall these terms.";
const NO_SNAPSHOT =
  "No financial figures are part of these terms. What the team saw came through its evidence access, which the seller can end.";

/** The estimate in a version's evidence, for comparisons; null when no figures were included. */
const estimateOf = (e: Terms["evidence"]) =>
  "included" in e ? (e.included ? e.estimate : null) : e.estimate;

/** Customer money recorded in the terms, in either format. */
export const customerMoneyOf = (t: Terms) =>
  t.obligations?.customer_money ??
  ("customer_money" in t.evidence ? t.evidence.customer_money : "unknown");

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
  const [ea, eb] = [estimateOf(a.evidence), estimateOf(b.evidence)];
  if (ea !== null && eb === null) out.push("Financial snapshot removed from the terms");
  else if (ea === null && eb !== null) out.push(`Financial snapshot added: estimate ${eb}`);
  else if (ea !== eb) out.push(`Evidence snapshot: estimate ${ea} → ${eb}`);
  return out;
}

/** What reconciling a close did: applied now, already applied, or why nothing changed. */
export interface ReconcileOutcome {
  state: "applied" | "already" | "pending" | "unknown" | "needed";
  detail: string;
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

  /** Where the bounded reconciliation pass resumes (in memory; restarts begin from the start). */
  private reconcileCursor = "";

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
    input: {
      price_cents: number;
      expires_at: string;
      handover: string;
      conditions: string;
      snapshot: boolean;
    },
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
    // Checked after the reads above, so access that ended meanwhile doesn't put figures in.
    if (input.snapshot && !this.financialsGranted(businessId, buyerId))
      throw new HttpError(
        409,
        "Financial figures can go into the terms only while this team has financials access. Leave them out, or grant access first.",
      );
    return {
      format: "everstreet-deal/2",
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
      evidence: input.snapshot
        ? {
            included: true,
            ...this.figures(f),
            audience: SNAPSHOT_AUDIENCE,
            retention: SNAPSHOT_RETENTION,
          }
        : { included: false, note: NO_SNAPSHOT },
      obligations: { customer_money: ops.treasury?.customer_money ?? "unknown" },
    };
  }

  /** The optional financial figures a seller may choose to put in the terms. */
  private figures(f: Awaited<ReturnType<Acquisitions["facts"]>>) {
    const e = f.estimate;
    return {
      estimate: e.low_cents === null ? "no range" : `${usd(e.low_cents)}–${usd(e.high_cents ?? 0)}`,
      basis: e.label,
      months: f.used.map((m) => m.label),
      revenue_month: f.revenue === null ? "unknown" : usd(f.revenue),
      profit_month: f.profit === null ? "unknown" : usd(f.profit),
      snapshot_at: now(),
    };
  }

  /** Whether this team holds a current grant that includes financials for this business. */
  private financialsGranted(businessId: string, buyerId: string) {
    const rows = this.db
      .prepare(
        "SELECT r.granted, r.expires_at FROM access_requests r JOIN listings l ON l.id = r.listing_id WHERE l.business_id = ? AND r.buyer_id = ? AND r.status = 'granted'",
      )
      .all(businessId, buyerId) as { granted: string | null; expires_at: string | null }[];
    return rows.some(
      (r) =>
        (!r.expires_at || r.expires_at > now()) &&
        (JSON.parse(r.granted ?? "[]") as string[]).includes("financials"),
    );
  }

  /** The seller previews exactly what a financial snapshot in the terms would show, and to whom. */
  async snapshotPreview(seller: Person, businessId: string, buyerId: string) {
    this.store.business(seller, businessId);
    const allowed = this.financialsGranted(businessId, buyerId);
    return {
      allowed,
      reason: allowed
        ? null
        : "This team doesn't have financials access now, so figures can't go into the terms.",
      figures: allowed ? this.figures(await this.acquire.facts(businessId)) : null,
      audience: SNAPSHOT_AUDIENCE,
      retention: SNAPSHOT_RETENTION,
      without: NO_SNAPSHOT,
    };
  }

  private clean(input: {
    price_cents?: number;
    days?: number;
    handover?: string;
    conditions?: string;
    snapshot?: boolean;
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
      // Off unless the seller explicitly chose it.
      snapshot: input.snapshot === true,
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
      snapshot?: boolean;
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
    input: {
      price_cents?: number;
      days?: number;
      handover?: string;
      conditions?: string;
      snapshot?: boolean;
    },
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
    const kind = who === "seller" ? "seller_accepted" : "buyer_accepted";
    const mine = (deal: ChainDeal | null) =>
      who === "seller" ? deal?.deal.seller_accepted : deal?.deal.buyer_accepted;

    // A retry first checks the contract: if this exact deal already closed, reconcile; if this
    // acceptance is already recorded, there is nothing to send again.
    const before = await chain.getDeal(d.business_account, dealId).catch(() => null);
    if (before?.deal.status === "Closed") {
      await this.reconcile(d, null);
      return this.view(viewer, dealId);
    }
    if (before && before.digest === String(digest) && mine(before) === String(digest))
      return this.view(viewer, dealId);

    const key = await this.payments.signer(viewer);
    let tx: Awaited<ReturnType<Chain["acceptSale"]>>;
    try {
      tx = await chain.acceptSale({
        party: key.account_id,
        secret: key.secret,
        business: d.business_account,
        dealId,
        digest: String(digest),
      });
    } catch {
      // The acceptance was sent but no answer came back. That is not a failure: read the
      // contract. A sale that closed is reconciled; one we can't read stays "unconfirmed".
      this.step(
        dealId,
        "accept_unconfirmed",
        viewer,
        d.version,
        false,
        null,
        "Sent, but no answer came back; checking the contract",
      );
      const outcome = await this.reconcile(d, null);
      if (outcome.state === "applied" || outcome.state === "already")
        return this.view(viewer, dealId);
      const readback = await chain.getDeal(d.business_account, dealId).catch(() => null);
      // Still unreadable: the view derives "unknown" from the recorded step and its own final
      // read, so a close it observes and reconciles is reported as closed, not as uncertain.
      if (!readback) return this.view(viewer, dealId);
      if (readback.digest === String(digest) && mine(readback) === String(digest)) {
        this.step(
          dealId,
          kind,
          viewer,
          readback.deal.version,
          true,
          null,
          "Confirmed by reading the contract",
        );
        return this.view(viewer, dealId);
      }
      throw new HttpError(
        409,
        "The contract shows your acceptance wasn't recorded, so nothing changed. You can accept again.",
      );
    }
    const after = await chain.getDeal(d.business_account, dealId).catch(() => null);
    this.step(
      dealId,
      kind,
      viewer,
      after?.deal.version ?? null,
      tx.ok,
      tx.hash,
      tx.ok ? "" : (tx.error ?? ""),
    );
    if (!tx.ok) {
      // Refused because it already closed (e.g. an earlier attempt landed): reconcile instead.
      if (after?.deal.status === "Closed") {
        await this.reconcile(d, null);
        return this.view(viewer, dealId);
      }
      throw new HttpError(409, refusal(tx.error));
    }
    if (after?.deal.status === "Closed") await this.reconcile(d, tx.hash);
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

  /** Records why a close was not applied, once per distinct reason. */
  private needs(d: DealRow, detail: string): ReconcileOutcome {
    const last = this.db
      .prepare("SELECT kind, detail FROM deal_steps WHERE deal_id = ? ORDER BY id DESC LIMIT 1")
      .get(d.id) as { kind: string; detail: string } | undefined;
    if (last?.kind !== "reconcile_needed" || last.detail !== detail)
      this.step(d.id, "reconcile_needed", null, d.version, false, null, detail);
    return { state: "needed", detail };
  }

  /**
   * Everstreet follows the contract, at most once. A close is applied only if the contract
   * shows *this* deal closed with *these* terms (version, digest, buyer, seller), control is
   * exactly one generation past the terms with the buyer as owner, and locally the seller still
   * owns the business with no newer generation recorded. The decision and every write commit
   * together in one transaction (a compare-and-set on the deal), so concurrent tabs, retries
   * and restarts converge on one ownership entry and one business-sold event. Anything else is
   * "pending", "unknown" or "reconciliation needed" and changes nothing. This is observed
   * finality: a chain read followed by a database write, not an atomic cross-system close.
   */
  async reconcile(d: DealRow, closeTx: string | null): Promise<ReconcileOutcome> {
    const chain = this.need();
    let onChain: ChainDeal | null;
    let control: Awaited<ReturnType<Chain["control"]>>;
    try {
      onChain = await chain.getDeal(d.business_account, d.id);
      control = await chain.control(d.business_account);
    } catch {
      return { state: "unknown", detail: "NEAR could not be read; nothing was changed" };
    }
    if (onChain?.deal.status !== "Closed")
      return { state: "pending", detail: "The contract doesn't show this sale closed" };
    const version = this.versions(d.id).find((v) => v.version === onChain.deal.version);
    const fresh = this.row(d.id);
    if (
      !version ||
      version.digest !== onChain.digest ||
      onChain.deal.version !== fresh.version ||
      onChain.deal.buyer !== d.buyer_account ||
      onChain.deal.seller !== d.seller_account
    )
      return fresh.status === "closed"
        ? { state: "already", detail: "" }
        : this.needs(
            d,
            "The contract shows a close that doesn't match these recorded terms; it was not applied automatically.",
          );
    const target = onChain.deal.expected_generation + 1;
    if (control.generation < target)
      return { state: "pending", detail: "Waiting for the contract's final state" };
    if (control.generation > target || control.owner !== d.buyer_account)
      return fresh.status === "closed"
        ? { state: "already", detail: "" }
        : this.needs(
            d,
            "Control changed again on the contract after this sale; the history needs reconciling before Everstreet records an owner.",
          );

    const at = now();
    const listing = this.db
      .prepare("SELECT id FROM listings WHERE business_id = ?")
      .get(d.business_id) as { id: string } | undefined;
    let stale = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // The decision, inside the transaction: only one caller moves the deal to closed.
      const won = this.db
        .prepare(
          "UPDATE deals SET status = 'closed', closed_at = ?, generation_after = ?, close_tx = COALESCE(?, close_tx), updated_at = ? WHERE id = ? AND status <> 'closed'",
        )
        .run(at, target, closeTx, at, d.id);
      if (won.changes === 0) {
        this.db.exec("ROLLBACK");
        return { state: "already", detail: "" };
      }
      // Monotonic: never replace a newer local owner with an older observation.
      const owner = (
        this.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(d.business_id) as {
          owner_id: string;
        }
      ).owner_id;
      const newest = (
        this.db
          .prepare("SELECT MAX(generation) AS g FROM ownership WHERE business_id = ?")
          .get(d.business_id) as { g: number | null }
      ).g;
      if (owner !== d.seller_id || (newest !== null && newest >= target)) {
        stale = true;
        throw new Error("stale");
      }
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
          target,
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
            "UPDATE access_requests SET status = 'revoked', revoked_at = ?, access_version = access_version + 1 WHERE listing_id = ? AND status = 'granted'",
          )
          .run(at, listing.id);
        this.db
          .prepare(
            "UPDATE access_requests SET status = 'withdrawn', access_version = access_version + 1 WHERE listing_id = ? AND status = 'pending'",
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
          JSON.stringify({ deal: d.id, to: d.representative_id, generation: target }),
          at,
        );
      this.step(
        d.id,
        "closed",
        null,
        onChain.deal.version,
        true,
        closeTx,
        "Control changed on the business's contract; Everstreet's records followed",
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (stale)
        return this.needs(
          d,
          "Everstreet already records a newer owner for this business; this older close was not applied.",
        );
      throw e;
    }
    return { state: "applied", detail: "" };
  }

  /**
   * A bounded, read-only pass over open deals awaiting an outcome (an unconfirmed acceptance,
   * or both acceptances recorded). Uses chain reads only: no signer, no transaction.
   */
  async reconcileOpen(limit = 10) {
    const n = Math.max(1, Math.min(50, limit));
    // Round-robin from where the last pass stopped, wrapping around, so deals that stay pending
    // or unreadable can't hold every pass and starve the next eligible one.
    const candidates = (after: string, cap: number) =>
      this.db
        .prepare(
          `SELECT * FROM deals WHERE status = 'open' AND id > ? AND id IN (
             SELECT deal_id FROM deal_steps WHERE kind IN ('accept_unconfirmed','seller_accepted','buyer_accepted'))
           ORDER BY id LIMIT ?`,
        )
        .all(after, cap) as unknown as DealRow[];
    const rows = candidates(this.reconcileCursor, n);
    if (rows.length < n)
      for (const r of candidates("", n - rows.length))
        if (r.id <= this.reconcileCursor && !rows.some((x) => x.id === r.id)) rows.push(r);
    this.reconcileCursor = rows.at(-1)?.id ?? "";
    const out: { deal: string; outcome: ReconcileOutcome }[] = [];
    for (const d of rows) out.push({ deal: d.id, outcome: await this.reconcile(d, null) });
    return out;
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
        in_terms: v1 ? customerMoneyOf(JSON.parse(v1.terms) as Terms) : "unknown",
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
    let reconciliation: ReconcileOutcome | null = null;
    if (onChain) {
      const s = CHAIN_STATUS[onChain.deal.status];
      if (s === "closed" && d.status !== "closed") reconciliation = await this.reconcile(d, null);
      else if (s !== "closed" && s !== d.status && d.status !== "closed")
        this.db
          .prepare("UPDATE deals SET status = ?, updated_at = ? WHERE id = ?")
          .run(s, now(), dealId);
      d = this.row(dealId);
    }
    // Durable evidence of an acceptance whose result is still unknown: this person's latest
    // acceptance attempt for the current version went unanswered, the deal is still open here
    // and the contract can't be read now. Survives reloads; never prompts another funding.
    const lastAttempt = this.db
      .prepare(
        "SELECT kind FROM deal_steps WHERE deal_id = ? AND person_id = ? AND version = ? AND kind IN ('accept_unconfirmed','seller_accepted','buyer_accepted') ORDER BY id DESC LIMIT 1",
      )
      .get(dealId, viewer.id, d.version) as { kind: string } | undefined;
    const confirmation =
      !onChain && d.status === "open" && lastAttempt?.kind === "accept_unconfirmed"
        ? {
            state: "unknown" as const,
            detail:
              "Your acceptance was sent but its result couldn't be confirmed yet. Nothing else is needed from you; check again shortly. Don't fund again.",
          }
        : null;
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
      /** Set while an acceptance this person sent has no confirmed result (see above). */
      confirmation,
      /** Set when the contract shows this sale closed but Everstreet could not follow yet. */
      reconciliation:
        reconciliation && reconciliation.state !== "applied" && reconciliation.state !== "already"
          ? reconciliation
          : null,
      /** Older data with more than one ownership entry for this deal; reported, never deleted. */
      history_conflict:
        (
          this.db.prepare("SELECT COUNT(*) AS n FROM ownership WHERE deal_id = ?").get(dealId) as {
            n: number;
          }
        ).n > 1,
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
