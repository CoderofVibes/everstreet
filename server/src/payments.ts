// Real testnet payments for paid class sessions (Phase 3).
//
// A seat is held in OpenSeat first, then the customer's own testnet account pays the business's
// account in test dollars with a unique order id. The business contract records the order once
// (a repeated order id returns the money), keeps it as the customer's until delivered, and
// refunds it by the rule fixed when the business was activated. Every payment is persisted
// before it is sent, so a dropped connection is reconciled from the chain, never paid twice.

import { randomUUID } from "node:crypto";
import type { Bookings } from "./bookings.ts";
import { unitsToCents } from "./books.ts";
import type { Chain, ChainOrder } from "./chain.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

type Status = "submitted" | "unknown" | "paid" | "failed" | "delivered" | "refunded" | "kept";

interface PaymentRow {
  order_id: string;
  person_id: string;
  business_id: string;
  session_id: string;
  booking_id: string | null;
  amount_cents: number;
  status: Status;
  tx: string | null;
  refund_tx: string | null;
  deliver_tx: string | null;
  error: string | null;
  cancel_before: string;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();
const HOUR = 3_600_000;

export class Payments {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly bookings: Bookings,
    private readonly chain: Chain | null,
  ) {}

  info() {
    return this.chain
      ? {
          enabled: true,
          network: this.chain.network,
          token: this.chain.token,
          explorer: this.chain.explorer,
        }
      : { enabled: false, network: null, token: null, explorer: null };
  }

  private need() {
    if (!this.chain)
      throw new HttpError(409, "Payments on NEAR are not connected on this computer");
    return this.chain;
  }

  units(cents: number) {
    return (BigInt(cents) * 10n ** BigInt(this.need().decimals - 2)).toString();
  }

  cents(units: string) {
    return Number(BigInt(units) / 10n ** BigInt(this.need().decimals - 2));
  }

  // ---------- accounts ----------

  private account(kind: "person" | "business", id: string) {
    return this.db
      .prepare("SELECT * FROM chain_accounts WHERE owner_kind = ? AND owner_id = ?")
      .get(kind, id) as
      | { account_id: string; secret: string | null; rules: string; tx: string; created_at: string }
      | undefined;
  }

  /** The person's testnet account, created (with 200 test dollars) the first time it is needed. */
  async wallet(person: Person) {
    const chain = this.need();
    let a = this.account("person", person.id);
    if (!a) {
      const made = await chain.createPersonAccount(person.display_name);
      this.db
        .prepare(
          "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, ?, ?, ?)",
        )
        .run(person.id, made.account_id, made.secret, made.tx, now());
      a = this.account("person", person.id);
    }
    const account = a as NonNullable<typeof a>;
    const balance = await chain.tokenBalance(account.account_id).catch(() => null);
    return {
      account_id: account.account_id,
      created_tx: account.tx,
      balance_cents: balance === null ? null : this.cents(balance),
      explorer: `${chain.explorer}/address/${account.account_id}`,
      custody: "local-preview",
    };
  }

  /** The person's own testnet account and key (local-preview custody), created if needed. */
  async signer(person: Person) {
    await this.wallet(person);
    const a = this.account("person", person.id);
    if (!a?.secret) throw new HttpError(409, "This person's testnet key isn't on this computer");
    return { account_id: a.account_id, secret: a.secret };
  }

  existingWallet(person: Person) {
    const a = this.account("person", person.id);
    return a ? { account_id: a.account_id } : null;
  }

  async topUp(person: Person) {
    const chain = this.need();
    const w = await this.wallet(person);
    const r = await chain.faucet(w.account_id, this.units(10_000));
    if (!r.ok) throw new HttpError(409, "The test-dollar faucet could not send right now");
    return this.wallet(person);
  }

  businessPayments(businessId: string) {
    const a = this.account("business", businessId);
    if (!a || !this.chain) return null;
    const rules = JSON.parse(a.rules) as { refund_hours: number; reserve_cents: number };
    return {
      account_id: a.account_id,
      refund_hours: rules.refund_hours,
      reserve_cents: rules.reserve_cents,
      explorer: `${this.chain.explorer}/address/${a.account_id}`,
      activated_tx: a.tx,
    };
  }

  /**
   * The founder turns on payments: the business gets its own testnet account running the v2
   * contract, owned by the founder's account, with the promises they chose fixed for good.
   */
  async activate(
    founder: Person,
    businessId: string,
    input: { refund_hours?: number; reserve_cents?: number },
  ) {
    const chain = this.need();
    const desk = this.store.business(founder, businessId);
    if (this.account("business", businessId))
      throw new HttpError(409, "Payments are already on for this business");
    if (!desk.business.published_at) throw new HttpError(409, "Publish your page first");
    const refundHours = Math.max(
      0,
      Math.min(24 * 14, Math.round(Number(input.refund_hours ?? 24))),
    );
    const reserveCents = Math.max(0, Math.round(Number(input.reserve_cents ?? 0)));
    const owner = await this.wallet(founder);
    const made = await chain.createBusinessAccount({
      label: desk.business.slug,
      name: desk.business.slug,
      owner: owner.account_id,
      rules: {
        customer_cancel_refund: refundHours > 0,
        credit_refundable: true,
        min_reserve: this.units(reserveCents),
      },
    });
    this.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, rules, tx, created_at) VALUES ('business', ?, ?, NULL, ?, ?, ?)",
      )
      .run(
        businessId,
        made.account_id,
        JSON.stringify({ refund_hours: refundHours, reserve_cents: reserveCents }),
        made.tx,
        now(),
      );
    this.db
      .prepare(
        "INSERT INTO events (type, subject, actor, payload, at) VALUES ('payments_activated', ?, ?, ?, ?)",
      )
      .run(businessId, founder.id, JSON.stringify({ account: made.account_id }), now());
    return this.businessPayments(businessId);
  }

  // ---------- paying ----------

  private row(orderId: string) {
    return this.db.prepare("SELECT * FROM payments WHERE order_id = ?").get(orderId) as
      | PaymentRow
      | undefined;
  }

  private set(orderId: string, fields: Partial<PaymentRow>) {
    const keys = Object.keys(fields);
    this.db
      .prepare(
        `UPDATE payments SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE order_id = ?`,
      )
      .run(...(Object.values(fields) as (string | number | null)[]), now(), orderId);
  }

  private orderMatches(o: ChainOrder | null, r: PaymentRow, customer: string) {
    return Boolean(o && o.customer === customer && o.amount === this.units(r.amount_cents));
  }

  /** Holds a seat in OpenSeat, then pays for it from the customer's own testnet account. */
  async payAndBook(person: Person, sessionId: string, source: string) {
    this.need();
    const s = this.db.prepare("SELECT * FROM sessions_offered WHERE id = ?").get(sessionId) as
      | { id: string; business_id: string; starts_at: string }
      | undefined;
    if (!s) throw new HttpError(404, "No such session");
    const business = this.businessPayments(s.business_id);
    if (!business)
      throw new HttpError(409, "This business does not take payments on Everstreet yet");
    const offer = this.store.offerOf(s.business_id);
    if (offer.first_free || !offer.price_cents)
      throw new HttpError(409, "This session is free; book it without paying");
    const live = (await this.bookings.publicSessions(s.business_id)).find(
      (x) => x.id === sessionId,
    );
    if (!live?.available)
      throw new HttpError(409, "Availability can't be checked right now; try again in a moment");
    if ((live.seats_left ?? 0) < 1)
      throw new HttpError(409, "This session is full. Paid sessions don't have a waitlist yet");
    const wallet = await this.wallet(person);
    if ((wallet.balance_cents ?? 0) < offer.price_cents)
      throw new HttpError(409, "Not enough test dollars in your wallet; top it up first");

    const booking = await this.bookings.book(person, sessionId, source);
    if (booking.status !== "confirmed") {
      await this.bookings.cancel(person, booking.id);
      throw new HttpError(409, "Someone took the last place a moment ago. You were not charged");
    }
    const orderId = `ord-${randomUUID()}`;
    const cancelBefore = new Date(
      Date.parse(s.starts_at) - business.refund_hours * HOUR,
    ).toISOString();
    this.db
      .prepare(
        "INSERT INTO payments (order_id, person_id, business_id, session_id, booking_id, amount_cents, status, cancel_before, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)",
      )
      .run(
        orderId,
        person.id,
        s.business_id,
        sessionId,
        booking.id,
        offer.price_cents,
        cancelBefore,
        now(),
        now(),
      );
    return this.send(person, orderId);
  }

  /** Sends (or safely re-sends) a payment and decides its outcome from the chain itself. */
  private async send(person: Person, orderId: string) {
    const chain = this.need();
    const r = this.row(orderId) as PaymentRow;
    const wallet = this.account("person", person.id);
    const business = this.businessPayments(r.business_id);
    if (!wallet?.secret || !business) throw new HttpError(409, "Missing account for this payment");
    try {
      const tx = await chain.payOrder({
        payer: wallet.account_id,
        secret: wallet.secret,
        business: business.account_id,
        orderId,
        amount: this.units(r.amount_cents),
        offer: r.session_id,
        cancelBeforeMs: business.refund_hours > 0 ? Date.parse(r.cancel_before) : 0,
      });
      this.set(orderId, { tx: r.tx ?? tx.hash });
    } catch (error) {
      // Refused before it was sent (no NEAR for the network fee): nothing moved; release the seat.
      if (/Not enough balance/i.test(String(error))) {
        if (r.booking_id) await this.bookings.cancel(person, r.booking_id).catch(() => {});
        this.set(orderId, {
          status: "failed",
          error: "Your testnet account needs more NEAR for the network fee; nothing was charged",
        });
        return this.receipt(person, orderId);
      }
      // We don't know whether it went through: keep the seat and check the chain later.
      this.set(orderId, { status: "unknown", error: (error as Error).message.slice(0, 300) });
      return this.receipt(person, orderId);
    }
    return this.reconcile(person, orderId);
  }

  /** Asks the business contract what really happened to this order. */
  async reconcile(person: Person, orderId: string) {
    const r = this.row(orderId);
    if (!r || r.person_id !== person.id) throw new HttpError(404, "No such payment");
    if (r.status !== "submitted" && r.status !== "unknown") return this.receipt(person, orderId);
    const business = this.businessPayments(r.business_id);
    const wallet = this.account("person", person.id);
    const order = business
      ? await this.need()
          .getOrder(business.account_id, orderId)
          .catch(() => undefined)
      : undefined;
    if (order === undefined) {
      this.set(orderId, {
        status: "unknown",
        error: "NEAR testnet could not be reached to check this payment",
      });
    } else if (this.orderMatches(order, r, wallet?.account_id ?? "")) {
      this.set(orderId, { status: "paid", error: null });
    } else if (Date.now() - Date.parse(r.created_at) > 2 * 60_000 || r.status === "submitted") {
      // The chain has no such order: the money did not move. Release the seat.
      if (r.booking_id) await this.bookings.cancel(person, r.booking_id).catch(() => {});
      this.set(orderId, {
        status: "failed",
        error:
          "The payment did not reach the business; your place was released and nothing was charged",
      });
    }
    return this.receipt(person, orderId);
  }

  /** Re-sends an unconfirmed payment with the same order id. The contract takes it at most once. */
  async retry(person: Person, orderId: string) {
    const r = this.row(orderId);
    if (!r || r.person_id !== person.id) throw new HttpError(404, "No such payment");
    if (r.status !== "unknown") return this.reconcile(person, orderId);
    return this.send(person, orderId);
  }

  receipt(person: Person, orderId: string) {
    const r = this.row(orderId);
    if (!r || r.person_id !== person.id) throw new HttpError(404, "No such payment");
    return this.view(r);
  }

  private view(r: PaymentRow) {
    const business = this.businessPayments(r.business_id);
    const explorer = this.chain?.explorer;
    return {
      order_id: r.order_id,
      booking_id: r.booking_id,
      status: r.status,
      amount_cents: r.amount_cents,
      token: this.chain?.token ?? null,
      business_account: business?.account_id ?? null,
      cancel_before: r.cancel_before,
      refundable_now: business
        ? business.refund_hours > 0 &&
          Date.now() < Date.parse(r.cancel_before) &&
          r.status === "paid"
        : false,
      tx: r.tx,
      tx_url: r.tx && explorer ? `${explorer}/txns/${r.tx}` : null,
      refund_tx_url: r.refund_tx && explorer ? `${explorer}/txns/${r.refund_tx}` : null,
      deliver_tx_url: r.deliver_tx && explorer ? `${explorer}/txns/${r.deliver_tx}` : null,
      error: r.error,
      created_at: r.created_at,
    };
  }

  forBooking(bookingId: string) {
    const r = this.db
      .prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at DESC")
      .get(bookingId) as PaymentRow | undefined;
    return r ? this.view(r) : null;
  }

  /** Cancels a paid place: a full refund on chain inside the window, otherwise the money stays. */
  async cancelPaid(person: Person, bookingId: string) {
    const r = this.db
      .prepare("SELECT * FROM payments WHERE booking_id = ? AND person_id = ?")
      .get(bookingId, person.id) as PaymentRow | undefined;
    if (!r) return null;
    if (r.status !== "paid") throw new HttpError(409, `This payment is ${r.status}`);
    const business = this.businessPayments(r.business_id);
    const wallet = this.account("person", person.id);
    if (
      business &&
      wallet?.secret &&
      business.refund_hours > 0 &&
      Date.now() < Date.parse(r.cancel_before)
    ) {
      const tx = await this.need().cancelOrder({
        customer: wallet.account_id,
        secret: wallet.secret,
        business: business.account_id,
        orderId: r.order_id,
      });
      const order = await this.need()
        .getOrder(business.account_id, r.order_id)
        .catch(() => null);
      if (!tx.ok || order?.status !== "Refunded")
        throw new HttpError(
          409,
          `The refund did not go through: ${tx.error ?? order?.status ?? "unknown"}. Your place is kept.`,
        );
      this.set(r.order_id, { status: "refunded", refund_tx: tx.hash });
    } else {
      this.set(r.order_id, {
        status: "kept",
        error: "Cancelled after the refund window; the business keeps the payment",
      });
    }
    await this.bookings.cancel(person, bookingId);
    return this.view(this.row(r.order_id) as PaymentRow);
  }

  // ---------- the founder's money ----------

  private owner(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const b = this.businessPayments(businessId);
    const w = this.account("person", founder.id);
    if (!b || !w?.secret) throw new HttpError(409, "Payments are not on for this business");
    return { business: b, wallet: w as { account_id: string; secret: string } };
  }

  /**
   * The order was delivered: the customer's money becomes the business's revenue, on chain.
   * The owner or an appointed helper signs it with their own account; the contract decides.
   */
  async deliver(actor: Person, orderId: string) {
    const r = this.row(orderId);
    if (!r) throw new HttpError(404, "No such order");
    const owns = this.store.isOwnerOf(actor, r.business_id);
    const helps = !owns && this.teamRow(r.business_id, actor.id);
    if (!owns && !helps) throw new HttpError(404, "No such order");
    const business = this.businessPayments(r.business_id);
    const wallet = this.account("person", actor.id);
    if (!business || !wallet?.secret)
      throw new HttpError(409, "Payments are not on for this business");
    if (r.status !== "paid") throw new HttpError(409, `This order is ${r.status}`);
    const tx = await this.need().deliver({
      owner: wallet.account_id,
      secret: wallet.secret,
      business: business.account_id,
      orderId,
    });
    if (!tx.ok) {
      const refused = /E_NOT_AUTHORIZED/.test(tx.error ?? "");
      throw new HttpError(
        refused ? 403 : 409,
        refused
          ? `The business's contract refused: ${tx.error?.replace(/^.*E_NOT_AUTHORIZED: /, "")}`
          : `Not recorded: ${tx.error}`,
      );
    }
    this.set(orderId, { status: "delivered", deliver_tx: tx.hash });
    return owns ? this.money(actor, r.business_id) : this.helperDesk(actor, r.business_id);
  }

  // ---------- helpers: one scoped delegation, enforced by the contract ----------

  private teamRow(businessId: string, personId: string) {
    return this.db
      .prepare("SELECT * FROM team WHERE business_id = ? AND person_id = ? AND revoked_at IS NULL")
      .get(businessId, personId) as
      | { capabilities: string; appointed_tx: string | null; created_at: string }
      | undefined;
  }

  team(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const explorer = this.chain?.explorer;
    return (
      this.db
        .prepare(
          "SELECT t.*, p.display_name FROM team t JOIN people p ON p.id = t.person_id WHERE t.business_id = ? ORDER BY t.created_at DESC",
        )
        .all(businessId) as {
        person_id: string;
        display_name: string;
        capabilities: string;
        appointed_tx: string | null;
        revoked_at: string | null;
        revoke_tx: string | null;
        created_at: string;
      }[]
    ).map((t) => ({
      person_id: t.person_id,
      name: t.display_name,
      account_id: this.account("person", t.person_id)?.account_id ?? null,
      capabilities: JSON.parse(t.capabilities) as string[],
      active: !t.revoked_at,
      appointed_url: t.appointed_tx && explorer ? `${explorer}/txns/${t.appointed_tx}` : null,
      revoked_url: t.revoke_tx && explorer ? `${explorer}/txns/${t.revoke_tx}` : null,
      since: t.created_at,
    }));
  }

  /** The owner appoints a helper on the business's contract: answer customers and mark orders delivered. */
  async addHelper(founder: Person, businessId: string, personId: string) {
    const { business, wallet } = this.owner(founder, businessId);
    if (personId === founder.id) throw new HttpError(400, "You already run this business");
    const helper = this.store.person(personId);
    if (this.teamRow(businessId, personId))
      throw new HttpError(409, `${helper.display_name} already helps`);
    const hw = await this.wallet(helper);
    const capabilities = ["support", "fulfillment"];
    const tx = await this.need().appointOperator({
      owner: wallet.account_id,
      secret: wallet.secret,
      business: business.account_id,
      operator: hw.account_id,
      capabilities,
    });
    if (!tx.ok) throw new HttpError(409, `Not appointed: ${tx.error}`);
    this.db
      .prepare(
        "INSERT INTO team (business_id, person_id, capabilities, appointed_tx, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(business_id, person_id) DO UPDATE SET capabilities = excluded.capabilities, appointed_tx = excluded.appointed_tx, revoked_at = NULL, revoke_tx = NULL, created_at = excluded.created_at",
      )
      .run(businessId, personId, JSON.stringify(capabilities), tx.hash, now());
    return this.team(founder, businessId);
  }

  async removeHelper(founder: Person, businessId: string, personId: string) {
    const { business, wallet } = this.owner(founder, businessId);
    const hw = this.account("person", personId);
    if (!this.teamRow(businessId, personId) || !hw) throw new HttpError(404, "Not a helper");
    const tx = await this.need().revokeOperator({
      owner: wallet.account_id,
      secret: wallet.secret,
      business: business.account_id,
      operator: hw.account_id,
    });
    if (!tx.ok) throw new HttpError(409, `Not revoked: ${tx.error}`);
    this.db
      .prepare(
        "UPDATE team SET revoked_at = ?, revoke_tx = ? WHERE business_id = ? AND person_id = ?",
      )
      .run(now(), tx.hash, businessId, personId);
    return this.team(founder, businessId);
  }

  /** Asks the business's contract, not Everstreet's own records, whether this person may act. */
  async helperCheck(person: Person, businessId: string, capability: string) {
    const business = this.businessPayments(businessId);
    const w = this.account("person", person.id);
    if (!business || !w) return { authorized: false, reason: "not a helper" };
    const c = await this.need().operatorCheck(business.account_id, w.account_id, capability);
    return { authorized: c.authorized, reason: c.reason };
  }

  /** Businesses this person helps (by Everstreet's record; every action is still checked on chain). */
  helping(person: Person) {
    return this.db
      .prepare(
        "SELECT b.id AS business_id, b.name, b.slug, t.capabilities FROM team t JOIN businesses b ON b.id = t.business_id WHERE t.person_id = ? AND t.revoked_at IS NULL",
      )
      .all(person.id) as {
      business_id: string;
      name: string;
      slug: string;
      capabilities: string;
    }[];
  }

  /** What a helper sees: messages to answer and paid orders to mark delivered. */
  async helperDesk(person: Person, businessId: string) {
    const row = this.teamRow(businessId, person.id);
    const ever = this.db
      .prepare("SELECT 1 FROM team WHERE business_id = ? AND person_id = ?")
      .get(businessId, person.id);
    if (!ever) throw new HttpError(404, "No such business");
    const b = this.db.prepare("SELECT name, slug FROM businesses WHERE id = ?").get(businessId) as {
      name: string;
      slug: string;
    };
    const check = await this.helperCheck(person, businessId, "fulfillment").catch((e) => ({
      authorized: false,
      reason: `NEAR testnet not reachable: ${(e as Error).message}`,
    }));
    const orders = (
      this.db
        .prepare(
          "SELECT * FROM payments WHERE business_id = ? AND status IN ('paid','delivered') ORDER BY created_at DESC LIMIT 30",
        )
        .all(businessId) as unknown as PaymentRow[]
    ).map((r) => {
      const s = this.db
        .prepare("SELECT starts_at FROM sessions_offered WHERE id = ?")
        .get(r.session_id) as { starts_at: string } | undefined;
      const who = this.db
        .prepare("SELECT display_name FROM people WHERE id = ?")
        .get(r.person_id) as { display_name: string } | undefined;
      return {
        ...this.view(r),
        session_starts_at: s?.starts_at ?? null,
        customer: who?.display_name ?? "Someone",
      };
    });
    return {
      business: { id: businessId, ...b },
      active_in_everstreet: Boolean(row),
      chain_check: check,
      business_account: this.businessPayments(businessId)?.account_id ?? null,
      inquiries: this.store.inquiriesFor(businessId),
      orders,
    };
  }

  async withdraw(founder: Person, businessId: string, cents: number) {
    const { business, wallet } = this.owner(founder, businessId);
    if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, "How much?");
    const tx = await this.need().withdrawProfit({
      owner: wallet.account_id,
      secret: wallet.secret,
      business: business.account_id,
      amount: this.units(cents),
    });
    if (!tx.ok)
      throw new HttpError(
        409,
        tx.error?.includes("E_RESERVED")
          ? tx.error.replace(/^.*E_RESERVED: /, "Not allowed: ")
          : `Not sent: ${tx.error}`,
      );
    return { ...(await this.money(founder, businessId)), last_tx: tx.hash };
  }

  /** The founder's money view, read from the business contract itself. */
  async money(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const b = this.businessPayments(businessId);
    if (!b) return { enabled: Boolean(this.chain), active: false as const };
    const chain = this.need();
    const ym = new Date();
    const yyyymm = ym.getUTCFullYear() * 100 + ym.getUTCMonth() + 1;
    const [t, p, wallet] = await Promise.all([
      chain.treasury(b.account_id).catch(() => null),
      chain.period(b.account_id, yyyymm).catch(() => null),
      this.wallet(founder).catch(() => null),
    ]);
    // Exact conversion (job 003f); null, never 0, for anything not read or not representable.
    const c = (u: string | undefined) =>
      u === undefined ? null : (unitsToCents(BigInt(u), chain.decimals)?.cents ?? null);
    const orders = (
      this.db
        .prepare("SELECT * FROM payments WHERE business_id = ? ORDER BY created_at DESC LIMIT 50")
        .all(businessId) as unknown as PaymentRow[]
    ).map((r) => {
      const s = this.db
        .prepare("SELECT starts_at FROM sessions_offered WHERE id = ?")
        .get(r.session_id) as { starts_at: string } | undefined;
      const who = this.db
        .prepare("SELECT display_name FROM people WHERE id = ?")
        .get(r.person_id) as { display_name: string } | undefined;
      return {
        ...this.view(r),
        session_starts_at: s?.starts_at ?? null,
        customer: who?.display_name ?? "Someone",
      };
    });
    return {
      enabled: true,
      active: true as const,
      business: b,
      owner_wallet: wallet,
      source: "Read from the business's contract on NEAR testnet just now",
      treasury: t && {
        /** Everything the contract holds, including buyer escrow: not the business's money. */
        held: c(t.held),
        customer_money: c(t.unearned_orders),
        customer_credit: c(t.customer_credit),
        available: c(t.available),
        withdrawable: c(t.withdrawable),
        pending: c(t.pending_payouts),
        /** A buyer's funded deal price, held for the deal: not business money. */
        buyer_escrow: c(t.deal_holds),
        /** A former owner's unclaimed sale proceeds: not business money. */
        seller_proceeds: c(t.seller_proceeds),
      },
      treasury_state: t ? "observed" : "unavailable",
      month: p && {
        yyyymm,
        orders_in: c(p.orders_in),
        prepaid_in: c(p.prepaid_in),
        earned: c(p.earned),
        credit_used: c(p.credit_used),
        refunds: c(p.refunds),
        credit_withdrawn: c(p.credit_withdrawn),
        owner_withdrawals: c(p.owner_withdrawals),
        sale_proceeds: c(p.sale_proceeds),
      },
      month_state: p ? "observed" : "unavailable",
      orders,
    };
  }
}
