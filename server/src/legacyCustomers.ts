// Job 003u2: the older "customers" evidence scope (payments and bookings of a legacy business),
// protected as a WHOLE summary. Astra reproduced through the granted room and export: 4 paid
// orders, 3 delivered, refunded "Fewer than 3" leaves exactly 1 refund, because each cell was
// hidden on its own while totals and differences stayed published.
//
// Threat model (docs/design/LEGACY_CUSTOMER_EVIDENCE.md): an authorized buyer reads the complete
// summary (room and export are the same projection). Within one summary, its listed counts and
// defined group differences must not disclose exactly 1 or 2 members. This does not cover every
// possible subgroup or differences between reports at different times. Rule: compute each listed
// count and every difference that is itself a group; if any is 1 or 2, withhold EVERY count in
// the summary together. A withheld value claims no size: withheld fields are all-or-nothing, so
// they never say which field was small or whether a given field is small or large. Zero is shown
// as zero. It does not promise anonymity against outside knowledge or against other granted
// evidence (exact monthly money can imply order counts).

export const WITHHELD = "Withheld" as const;

/** What the summary could publish, from stored records. */
export interface LegacyCounts {
  /** People with at least one order in the counted statuses. */
  customers: number;
  /** Orders paid, delivered, kept or refunded. */
  orders: number;
  delivered: number;
  refunded: number;
  /** Customers with 2 or more orders. */
  repeat: number;
  /** Booking records. */
  bookings: number;
}

const small = (n: number) => n === 1 || n === 2 || n === -1 || n === -2;

/** Every published count, and every difference of published counts that is itself a group. */
export function legacyGroups(c: LegacyCounts): number[] {
  return [
    c.customers,
    c.orders,
    c.delivered,
    c.refunded,
    c.repeat,
    c.bookings,
    c.orders - c.delivered - c.refunded, // orders paid or kept (neither delivered nor refunded)
    c.customers - c.repeat, // customers with exactly one order
    c.orders - c.customers, // orders beyond each customer's first (implied by repeat; kept)
    c.orders - c.customers - c.repeat, // orders beyond the second, for repeat customers
    c.bookings - c.orders, // bookings without an order, or orders without a booking
  ];
}

export interface LegacyDisclosed {
  withheld: boolean;
  customers: string;
  orders: string;
  delivered: string;
  refunded: string;
  repeat: string;
  bookings: string;
}

/** The whole-summary rule (pure). */
export function discloseLegacy(c: LegacyCounts): LegacyDisclosed {
  if (legacyGroups(c).some(small))
    return {
      withheld: true,
      customers: WITHHELD,
      orders: WITHHELD,
      delivered: WITHHELD,
      refunded: WITHHELD,
      repeat: WITHHELD,
      bookings: WITHHELD,
    };
  return {
    withheld: false,
    customers: String(c.customers),
    orders: String(c.orders),
    delivered: String(c.delivered),
    refunded: String(c.refunded),
    repeat: String(c.repeat),
    bookings: String(c.bookings),
  };
}

export const LEGACY_NOTE =
  'The customer, order and booking counts here, plus selected differences between them, are checked for groups of 1 or 2. If found, all these counts are withheld together. "Withheld" does not identify the size of any particular count. Otherwise, zero is shown as zero.';

export const LEGACY_LIMITS = [
  "Being withheld itself tells you some group here is small, not which one.",
  "This checks one summary at a time and only its listed counts and documented group differences. It does not protect every possible subgroup.",
  "Comparing reports from different times can reveal small changes, even when each report shows only larger counts.",
  "This doesn't make anyone anonymous against what you already know from elsewhere.",
  "Other evidence you may also be granted, such as monthly money in and out, can show exact amounts from which order counts follow; this summary can't prevent that.",
];

/** What the stored records establish, without claiming a chain re-read or a live connection. */
export function legacySource(orders: number, bookings: number): string {
  if (!orders && !bookings)
    return "No customer records through Everstreet yet. Seeded history has revenue totals only.";
  return "Orders: payment records Everstreet stored for this business's checkout; they aren't re-read from the chain for this summary. Bookings: booking records Everstreet stored when the booking service confirmed a place; whether that service is connected now isn't shown here.";
}
