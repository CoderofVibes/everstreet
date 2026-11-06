// Typed calls to Everstreet's API. Errors carry the server's plain-language message.

export interface Person {
  id: string;
  display_name: string;
  headline: string;
  bio: string;
}

export interface Offer {
  id: string;
  title: string;
  outcome: string;
  audience: string;
  not_for: string;
  deliverable: string;
  includes: string;
  price_cents: number | null;
  price_unit: string;
  first_free: number;
  when_text: string;
  where_text: string;
  capacity: number | null;
  confirmed: number;
  published_at: string | null;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  about: string;
  family: "class" | "service" | "product" | "software" | "undecided";
  stage: "shape" | "test" | "launch" | "grow";
  published_at: string | null;
}

export interface Idea {
  problem: string;
  why_me: string;
  ask: string;
  evidence: string;
  published_at: string | null;
}

export interface Direction {
  kind: string;
  family: string;
  title: string;
  customer: string;
  offer: string;
  experiment: string;
  effort: string;
  why: string;
}

export interface Action {
  kind: "interest" | "question";
  label: string;
}

export interface Project {
  id: string;
  route: "idea" | "find" | "started";
  step: string;
  explore: Record<string, unknown>;
  directions: Direction[];
  answers: Record<string, string | boolean | undefined>;
  business: Business;
  offer: Offer;
  idea: Idea;
  owner: Person;
  missing: string[];
  action: Action;
  plan: { title: string; detail: string }[];
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  source: string;
  done_at: string | null;
}

export interface Inquiry {
  id: string;
  kind: "interest" | "question";
  message: string;
  share_contact: number;
  reply: string | null;
  from_name: string;
  created_at: string;
  replied_at: string | null;
  business_name?: string;
  business_id?: string;
  slug?: string;
}

export interface Desk {
  business: Business;
  offer: Offer;
  idea: Idea;
  project_id: string | null;
  missing: string[];
  action: Action;
  tasks: Task[];
  inquiries: Inquiry[];
}

/** Job 001d: a published digital profile (the live snapshot), as customers see it. */
export interface DigitalPublic {
  headline: string;
  summary: string;
  audience: string;
  capabilities: string[];
  products: {
    name: string;
    family_label: string;
    status: "available" | "not_open" | "in_development";
    use_offer_id: string | null;
  }[];
  /** Job 001e: an owner-written illustrative example (never a live run), or null. */
  example: {
    product_name: string;
    input: string;
    outputs: { label: string; value: string }[];
    label: string;
  } | null;
  availability: "available" | "coming_soon";
  published_at: string | null;
}

export interface PublicBusiness {
  /** Job 001d: present only for a published digital profile. */
  digital?: DigitalPublic | null;
  slug: string;
  name: string;
  tagline: string;
  about: string;
  family: Business["family"];
  stage: Business["stage"];
  published_at: string;
  founder: { id?: string; display_name: string; headline: string; bio: string };
  history?: {
    at: string;
    from: string;
    to: string;
    team: string | null;
    generation: number | null;
    tx_url: string | null;
  }[];
  idea: Omit<Idea, "published_at"> | null;
  offer: Omit<Offer, "id" | "published_at"> | null;
  unknown: string[];
  action: Action;
  interested: number;
  viewer_is_owner?: boolean;
  matched?: string[];
  met?: string[];
  unknown_constraints?: string[];
  new_here?: boolean;
  /** Job 001f1: Explore only. Which tab and why (server community.ts exploreClass). */
  explore?: {
    tab: "open" | "starting";
    reason: "digital_available" | "legacy_open" | "digital_coming_soon" | "legacy_interest";
  };
  sessions?: PublicSession[];
  bookings_connected?: boolean;
  payments?: BusinessPayments | null;
  numbers?: {
    month: {
      label: string;
      revenue_cents: number;
      direct_cents: number;
      overhead_cents: number;
      profit_cents: number;
      revenue_sources: string[];
      cost_sources: string[];
    } | null;
    value: {
      low_cents: number | null;
      high_cents: number | null;
      label: string;
      stage: string;
      missing: string[];
    };
  } | null;
  updates?: Update[];
  followers?: number;
  following?: boolean;
}

export interface PublicSession {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  seats_left: number | null;
  waitlisted: number | null;
  available: boolean;
  checked_at: string;
}

export interface Update {
  id: string;
  body: string;
  created_at: string;
  business_name?: string;
  slug?: string;
}

export interface Constraints {
  family?: "class" | "service" | "product" | "software";
  max_price_cents?: number;
  online?: boolean;
  confirmed_only?: boolean;
}

export interface SearchResult {
  words: string[];
  constraints: Constraints;
  matches: PublicBusiness[];
  ask_to_confirm: PublicBusiness[];
  blocked_by: Record<string, number>;
  relevant_without_constraints: number;
}

export interface Need {
  id: string;
  text: string;
  constraints: Constraints;
  allow_replies: boolean;
  expires_at: string;
  created_at: string;
  responses: number;
  matched?: string[];
  answered?: boolean;
}

export interface MyNeed {
  id: string;
  text: string;
  status: "open" | "closed";
  expired: boolean;
  expires_at: string;
  created_at: string;
  allow_replies: number;
  responses: {
    id: string;
    message: string;
    reply: string | null;
    created_at: string;
    business_name: string;
    slug: string;
  }[];
}

export interface MyBooking {
  id: string;
  business: { name: string; slug: string };
  title: string;
  where: string;
  starts_at: string;
  ends_at: string;
  reference: string;
  status: "confirmed" | "waitlisted" | "cancelled" | "unknown";
  position: number | null;
  promoted_by: string | null;
  promoted_generation: number | null;
  booked_at: string;
  payment?: Receipt | null;
}

export interface Receipt {
  order_id: string;
  booking_id: string | null;
  status: "submitted" | "unknown" | "paid" | "failed" | "delivered" | "refunded" | "kept";
  amount_cents: number;
  token: string | null;
  business_account: string | null;
  cancel_before: string;
  refundable_now: boolean;
  tx: string | null;
  tx_url: string | null;
  refund_tx_url: string | null;
  deliver_tx_url: string | null;
  error: string | null;
  created_at: string;
}

export interface Wallet {
  account_id: string;
  created_tx: string;
  balance_cents: number | null;
  explorer: string;
  custody: string;
}

export interface BusinessPayments {
  account_id: string;
  refund_hours: number;
  reserve_cents: number;
  explorer: string;
  activated_tx: string;
}

export interface Money {
  enabled: boolean;
  active: boolean;
  business?: BusinessPayments;
  owner_wallet?: Wallet | null;
  source?: string;
  treasury?: {
    held: number | null;
    customer_money: number | null;
    customer_credit: number | null;
    available: number | null;
    withdrawable: number | null;
    pending: number | null;
    /** Held for a buyer's deal, or a former owner's proceeds: not the business's money. */
    buyer_escrow: number | null;
    seller_proceeds: number | null;
  } | null;
  treasury_state?: "observed" | "unavailable";
  month?: {
    yyyymm: number;
    orders_in: number | null;
    prepaid_in: number | null;
    earned: number | null;
    credit_used: number | null;
    refunds: number | null;
    credit_withdrawn: number | null;
    owner_withdrawals: number | null;
    sale_proceeds: number | null;
  } | null;
  month_state?: "observed" | "unavailable";
  orders?: (Receipt & { session_starts_at: string | null; customer: string })[];
  last_tx?: string;
}

export interface OwnerSession {
  id: string;
  starts_at: string;
  ends_at: string;
  class: { capacity: number; seats_left: number; waitlisted: number } | null;
  attendees: {
    attendee: string;
    status: string;
    booked_at: string;
    promoted_by: string | null;
    promoted_generation: number | null;
  }[];
  available: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's stable reason, when it gives one. */
    readonly code?: string,
    /** 003r1: bounded facts to act on the refusal (e.g. a deadline), when the server gives them. */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

export const api = {
  env: () =>
    call<{
      environment: string;
      localPreview: boolean;
      identity?: "preview" | "verified";
      /** Job 003w-e1: the wallet controller's configuration (verified identity only). */
      wallet?: { network: "testnet"; available: boolean; harness: string | null } | null;
    }>("/api/env"),
  /** Job 003w-e1: a verified session also names its proven account. */
  me: () => call<{ person: Person | null; account?: string | null }>("/api/me"),
  join: (name: string) => call<{ person: Person }>("/api/session", "POST", { name }),
  signOut: () => call<{ person: null }>("/api/session", "DELETE"),
  signInChallenge: () =>
    call<{
      challenge: {
        message: string;
        nonce: string;
        recipient: string;
        callback_url: string | null;
        expires_at: string;
      };
    }>("/api/session/challenge", "POST"),
  cancelSignIn: () => call<{ cancelled: true }>("/api/session/challenge", "DELETE"),
  signInVerify: (b: { account_id: string; public_key: string; signature: string; nonce: string }) =>
    call<{ person: Person }>("/api/session/verify", "POST", b),
  people: () => call<{ people: { id: string; display_name: string }[] }>("/api/people"),
  actAs: (id: string) => call<{ person: Person }>(`/api/session/as/${id}`, "POST"),
  updateMe: (fields: Partial<Person>) => call<{ person: Person }>("/api/me", "PATCH", fields),

  projects: () =>
    call<{
      projects: {
        id: string;
        step: string;
        business_id: string;
        name: string;
        slug: string;
        stage: string;
        published_at: string | null;
        /** Review #18: a product-studio business (its own studio, not the offer wizard). */
        product_studio?: boolean;
        inquiries: number;
      }[];
    }>("/api/projects"),
  startProject: (route: Project["route"], name?: string) =>
    call<Project>("/api/projects", "POST", { route, name }),
  project: (id: string) => call<Project>(`/api/projects/${id}`),
  explore: (id: string, answers: Record<string, unknown>) =>
    call<Project>(`/api/projects/${id}/explore`, "POST", answers),
  choose: (id: string, index: number) =>
    call<Project>(`/api/projects/${id}/choose`, "POST", { index }),
  answer: (id: string, patch: Record<string, unknown>) =>
    call<Project>(`/api/projects/${id}/answers`, "PATCH", patch),
  step: (id: string, step: string) => call<Project>(`/api/projects/${id}/step`, "POST", { step }),

  desk: (businessId: string) => call<Desk>(`/api/businesses/${businessId}`),
  updateBusiness: (businessId: string, fields: Partial<Business>) =>
    call<Desk>(`/api/businesses/${businessId}`, "PATCH", fields),
  editOffer: (businessId: string, fields: Record<string, unknown>) =>
    call<Desk>(`/api/businesses/${businessId}/offer`, "PATCH", fields),
  editIdea: (businessId: string, fields: Partial<Idea>) =>
    call<Desk>(`/api/businesses/${businessId}/idea`, "PATCH", fields),
  publish: (businessId: string) => call<Desk>(`/api/businesses/${businessId}/publish`, "POST"),
  unpublish: (businessId: string) => call<Desk>(`/api/businesses/${businessId}/unpublish`, "POST"),
  setTask: (taskId: string, done: boolean) =>
    call<{ tasks: Task[] }>(`/api/tasks/${taskId}`, "PATCH", { done }),

  inbox: () => call<{ received: Inquiry[]; sent: Inquiry[] }>("/api/inbox"),
  reply: (id: string, text: string) =>
    call<{ received: Inquiry[]; sent: Inquiry[] }>(`/api/inquiries/${id}/reply`, "POST", { text }),

  discover: (q = "") =>
    call<{ businesses: PublicBusiness[] }>(`/api/public/discover?q=${encodeURIComponent(q)}`),
  page: (slug: string) => call<PublicBusiness>(`/api/public/businesses/${slug}`),
  inquire: (
    slug: string,
    kind: Action["kind"],
    message: string,
    share_contact: boolean,
    source = "unknown",
  ) =>
    call<{ id: string }>(`/api/public/businesses/${slug}/inquiries`, "POST", {
      kind,
      message,
      share_contact,
      source,
    }),
  follow: (slug: string, on: boolean) =>
    call<{ following: boolean; followers: number }>(
      `/api/public/businesses/${slug}/follow`,
      "POST",
      { on },
    ),
  book: (sessionId: string, source: string) =>
    call<MyBooking>(`/api/public/sessions/${sessionId}/book`, "POST", { source }),
  ownerSessions: (businessId: string) =>
    call<{ sessions: OwnerSession[] }>(`/api/businesses/${businessId}/sessions`),
  openSession: (
    businessId: string,
    fields: { starts_at: string; duration_minutes: number; capacity: number },
  ) => call<{ sessions: OwnerSession[] }>(`/api/businesses/${businessId}/sessions`, "POST", fields),
  activity: () =>
    call<{
      bookings: MyBooking[];
      wallet: { account_id: string } | null;
      needs: MyNeed[];
      sent: Inquiry[];
      following: { name: string; slug: string }[];
      feed: Update[];
    }>("/api/activity"),
  cancelBooking: (id: string) => call<MyBooking>(`/api/activity/bookings/${id}/cancel`, "POST"),
  search: (q: string, params: Record<string, string> = {}) =>
    call<SearchResult>(`/api/public/search?${new URLSearchParams({ q, ...params }).toString()}`),
  needs: () => call<{ needs: Need[] }>("/api/public/needs"),
  postNeed: (fields: {
    text: string;
    constraints?: Constraints;
    allow_replies: boolean;
    days: number;
  }) => call<{ needs: MyNeed[] }>("/api/needs", "POST", fields),
  closeNeed: (id: string) => call<{ needs: MyNeed[] }>(`/api/needs/${id}/close`, "POST"),
  respondToNeed: (id: string, business_id: string, message: string) =>
    call<{ ok: boolean }>(`/api/needs/${id}/respond`, "POST", { business_id, message }),
  replyToResponse: (id: string, text: string) =>
    call<{ needs: MyNeed[] }>(`/api/need-responses/${id}/reply`, "POST", { text }),
  extras: (businessId: string) =>
    call<{
      updates: Update[];
      needs: Need[];
      sources: {
        responses: Record<string, number>;
        bookings: Record<string, number>;
        followers: number;
      };
      need_replies: {
        id: string;
        message: string;
        reply: string | null;
        need_text: string;
        business_name: string;
        created_at: string;
      }[];
    }>(`/api/businesses/${businessId}/extras`),
  postUpdate: (businessId: string, body: string) =>
    call<{ updates: Update[] }>(`/api/businesses/${businessId}/updates`, "POST", { body }),
  exploreFeed: () =>
    call<{ starting: PublicBusiness[]; open: PublicBusiness[]; needs: Need[] }>(
      "/api/public/explore",
    ),
  person: (id: string) =>
    call<{
      id: string;
      display_name: string;
      headline: string;
      bio: string;
      member_since: string;
      businesses: PublicBusiness[];
      updates: Update[];
    }>(`/api/public/people/${id}`),
  report: (kind: "business" | "need", subject: string, reason: string) =>
    call<{ ok: boolean }>("/api/public/reports", "POST", { kind, subject, reason }),
  paymentsInfo: () =>
    call<{ enabled: boolean; network?: string; token?: string; explorer?: string }>(
      "/api/payments/info",
    ),
  wallet: () => call<{ wallet: Wallet | null; info: { enabled: boolean } }>("/api/wallet"),
  createWallet: () => call<{ wallet: Wallet }>("/api/wallet", "POST"),
  topUp: () => call<{ wallet: Wallet }>("/api/wallet/top-up", "POST"),
  activatePayments: (businessId: string, refund_hours: number, reserve_cents: number) =>
    call<BusinessPayments>(`/api/businesses/${businessId}/payments/activate`, "POST", {
      refund_hours,
      reserve_cents,
    }),
  money: (businessId: string) => call<Money>(`/api/businesses/${businessId}/money`),
  withdraw: (businessId: string, cents: number) =>
    call<Money>(`/api/businesses/${businessId}/withdraw`, "POST", { cents }),
  deliver: (orderId: string) => call<Money>(`/api/payments/${orderId}/deliver`, "POST"),
  pay: (sessionId: string, source: string) =>
    call<Receipt>(`/api/public/sessions/${sessionId}/pay`, "POST", { source }),
  reconcile: (orderId: string) => call<Receipt>(`/api/payments/${orderId}/reconcile`, "POST"),
  retryPayment: (orderId: string) => call<Receipt>(`/api/payments/${orderId}/retry`, "POST"),
  system: () =>
    call<{
      bookings: {
        provider: string;
        waitlist: {
          business: string;
          worker: string;
          worker_key_present: boolean;
          authorized: boolean;
          generation: number | null;
          reason: string;
          last_checked: string | null;
          promotions: number;
        };
      };
    }>("/api/system"),
};
