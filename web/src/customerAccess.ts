// Job 003wf4 (docs/design/OWNER_PLAN_SETUP.md §2, §9): "Set up customer access" in the browser.
// One controller per business, product and signed-in account. The server's picture
// (GET /api/businesses/:id/customer-access) says what each of the three steps is; the wallet
// requests (a guided plan, the reviewed appointment) go through the existing SaleFlow: an exact
// preview verified here, stored, one claimed wallet ask, its own transaction checked. The plan
// draft (what the founder typed) is kept apart from any request, in session storage for this
// business and account: "Not now", a closed wallet or a reload never discards it, and it never
// changes a request already asked.

import type { SaleAction } from "./saleApi.ts";
import { SaleError } from "./saleApi.ts";
import { toBaseUnits } from "./saleCalls.ts";
import type { SaleFlow, SaleNotice } from "./saleFlow.ts";

export type StepState =
  | "needs_input"
  | "reviewed"
  | "asked"
  | "unknown"
  | "refused"
  | "confirmed"
  | "unavailable"
  | "blocked";

export interface AccessStep {
  key: "plan" | "permissions" | "offer";
  title: string;
  state: StepState;
  detail: string;
  action: SaleAction | null;
}

export interface CustomerAccessView {
  business_id: string;
  block: { height: string; hash: string; timestamp_ms: string };
  release: { id: string; product: { name: string; revision: number | null } } | null;
  owner_generation: number;
  timing: {
    min_hold_ms: number;
    min_grace_ms: number;
    min_sign_ms: number;
    serve_window_ms: number;
    guided_hold_ms: number;
  };
  guided: {
    available: boolean;
    reason: string | null;
    defaults: { hold_ttl_ms: string; settle_grace_ms: string } | null;
    quote: { deposit: string; plan_bytes: string; storage_byte_cost: string } | null;
    next_plan_id: number | null;
    rules: {
      max_hold_units: number;
      min_hold_ttl_ms: string;
      max_hold_ttl_ms: string;
      max_settle_grace_ms: string;
    } | null;
  };
  plans: { plan_id: number; plan: Record<string, unknown>; action_id: string }[];
  operator: {
    account: string;
    current: { caps: number; generation: number } | null;
    already: boolean;
    change: string | null;
    support: string;
    generation: number;
    without_support: string | null;
  } | null;
  offers: { id: string; plan_id: number; release_id: string }[];
  service: { eligible: boolean; reasons: string[]; note: string };
  steps: AccessStep[];
  next: "plan" | "permissions" | "offer" | null;
  /** Job 003wf4 (S-7): the viewer's requests from earlier owner generations (history only). */
  history?: {
    id: string;
    kind: string;
    state: string;
    generation: number;
    tx_hash: string | null;
  }[];
}

export interface AccessPort {
  access(businessId: string, projectId: string): Promise<CustomerAccessView>;
}

export const accessHttp: AccessPort = {
  async access(businessId, projectId) {
    const res = await fetch(
      `/api/businesses/${encodeURIComponent(businessId)}/customer-access?project=${encodeURIComponent(projectId)}`,
      { credentials: "same-origin" },
    );
    const data = (await res.json().catch(() => null)) as
      | (CustomerAccessView & { error?: string; code?: string; detail?: unknown })
      | null;
    if (!res.ok || data === null)
      throw new SaleError(
        data?.error ?? `Request failed (${res.status})`,
        res.status,
        data?.code,
        data?.detail,
      );
    return data;
  },
};

/** The founder's plan as typed: plain text fields, converted only when reviewed. */
export interface PlanDraft {
  price: string;
  perPurchase: string;
  outstanding: string;
  perHold: string;
  holdMinutes: string;
  graceMinutes: string;
}

export interface AccessState {
  status: "loading" | "ready" | "error";
  view: CustomerAccessView | null;
  draft: PlanDraft | null;
  /** The appointment's support choice: kept unless the founder removes it. */
  keepSupport: boolean;
  notice: SaleNotice | null;
  busy: boolean;
}

interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const INT = /^[1-9][0-9]{0,8}$/;

/** The draft as the plan the contract takes, or the plain reason it can't be one yet. */
export function planFromDraft(
  d: PlanDraft,
  decimals: number,
): { plan: Record<string, unknown> } | { problem: string } {
  const price = toBaseUnits(d.price, decimals);
  if (!price || price === "0") return { problem: "Enter a price per use above 0." };
  for (const [v, name] of [
    [d.perPurchase, "Units per purchase"],
    [d.outstanding, "Units a customer may hold"],
    [d.perHold, "Uses per hold"],
    [d.holdMinutes, "Hold length"],
  ] as const)
    if (!INT.test(v.trim())) return { problem: `${name} is a whole number above 0.` };
  if (!/^(0|[1-9][0-9]{0,8})$/.test(d.graceMinutes.trim()))
    return { problem: "Settlement time is a whole number of minutes." };
  return {
    plan: {
      unit_price: price,
      max_units_per_purchase: Number(d.perPurchase),
      max_units_outstanding: Number(d.outstanding),
      max_hold_units: Number(d.perHold),
      hold_ttl_ms: String(Number(d.holdMinutes) * 60_000),
      settle_grace_ms: String(Number(d.graceMinutes) * 60_000),
    },
  };
}

export class CustomerAccessFlow {
  private state: AccessState = {
    status: "loading",
    view: null,
    draft: null,
    keepSupport: true,
    notice: null,
    busy: false,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private reads = 0;

  constructor(
    private readonly port: AccessPort,
    readonly sale: SaleFlow,
    private readonly opts: {
      businessId: string;
      projectId: string;
      account: string;
      storage: Storage | null;
    },
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  retire() {
    this.alive = false;
    this.listeners.clear();
  }
  private set(patch: Partial<AccessState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private get draftKey() {
    return `es-customer-access:${this.opts.account}:${this.opts.businessId}:${this.opts.projectId}`;
  }

  /** The server's picture and the sale reading, fresh; only the newest answer is applied. */
  async load() {
    const mine = ++this.reads;
    this.set({ busy: true });
    try {
      const [view] = await Promise.all([
        this.port.access(this.opts.businessId, this.opts.projectId),
        this.sale.load(),
      ]);
      if (!this.alive || mine !== this.reads) return;
      this.set({ status: "ready", view, draft: this.state.draft ?? this.initialDraft(view) });
    } catch (e) {
      if (!this.alive || mine !== this.reads) return;
      this.set({
        status: this.state.view ? "ready" : "error",
        notice: { tone: "warn", text: (e as Error).message },
      });
    } finally {
      if (this.alive && mine === this.reads) this.set({ busy: false });
    }
  }

  private initialDraft(v: CustomerAccessView): PlanDraft {
    const kept = this.opts.storage?.getItem(this.draftKey);
    if (kept) {
      try {
        const d = JSON.parse(kept) as PlanDraft;
        if (typeof d.price === "string" && typeof d.holdMinutes === "string") return d;
      } catch {
        // an unreadable draft is replaced by the defaults
      }
    }
    const hold = Number(v.guided.defaults?.hold_ttl_ms ?? v.timing.guided_hold_ms);
    const grace = Number(v.guided.defaults?.settle_grace_ms ?? v.timing.min_grace_ms);
    return {
      price: "",
      perPurchase: "20",
      outstanding: "100",
      perHold: "1",
      holdMinutes: String(Math.ceil(hold / 60_000)),
      graceMinutes: String(Math.ceil(grace / 60_000)),
    };
  }

  setDraft(patch: Partial<PlanDraft>) {
    const d = { ...(this.state.draft as PlanDraft), ...patch };
    this.opts.storage?.setItem(this.draftKey, JSON.stringify(d));
    this.set({ draft: d });
  }
  setKeepSupport(keep: boolean) {
    this.set({ keepSupport: keep });
  }

  /** The exact plan request for review; nothing is stored or sent. The draft stays as typed. */
  async reviewPlan() {
    const d = this.state.draft;
    const decimals = this.sale.getState().setup?.token.meta?.decimals;
    if (!d || decimals === undefined) return;
    const p = planFromDraft(d, decimals);
    if ("problem" in p) return this.set({ notice: { tone: "warn", text: p.problem } });
    this.set({ notice: null });
    await this.sale.review("create_plan", p, null, "plan-review");
  }

  /** The exact appointment for review, with the support choice made here. */
  async reviewPermission() {
    this.set({ notice: null });
    await this.sale.review(
      "appoint",
      { keep_support: this.state.keepSupport },
      null,
      "permission-review",
    );
  }

  /** Ask the wallet for the reviewed request (SaleFlow: store, claim, send, check), then re-read. */
  async confirm() {
    const kind = this.sale.getState().review?.preview.kind;
    await this.sale.confirm();
    if (!this.alive) return;
    await this.load();
    // A plan created by its own transaction has used its draft.
    if (kind === "create_plan" && this.state.view?.plans.length) {
      this.opts.storage?.removeItem(this.draftKey);
      const v = this.state.view;
      this.set({ draft: v ? this.initialDraft(v) : null });
    }
  }

  /** "Not now": the review is set aside; the draft stays. */
  cancel() {
    this.sale.cancelReview();
  }

  async check(id: string, txId?: string) {
    if (txId) await this.sale.checkWithTransaction(id, txId);
    else await this.sale.checkOpen(id);
    await this.load();
  }
  async continuePrepared(id: string) {
    await this.sale.continuePrepared(id);
    await this.load();
  }
  async setAside(id: string) {
    await this.sale.setAside(id);
    await this.load();
  }
}
