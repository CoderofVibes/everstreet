// Job 003wf4 (docs/design/OWNER_PLAN_SETUP.md §2, §8, §9): the founder's "Set up customer
// access" picture for one business and product: pricing plan, service permissions, customer
// offer, each with its state and evidence. Composed from durable rows and ONE fresh contract
// reading (SaleActions.ownerReading); nothing here writes, signs or sends.

import type { CustomerUses } from "./customerUse.ts";
import { appointmentFor, type SaleActions, type SaleActionView } from "./saleActions.ts";
import { MIN_SIGN_MS } from "./servePolicy.ts";
import type { Person } from "./store.ts";

/** The guided hold when the rules and this server allow it (Astra Q2). */
export const GUIDED_HOLD_MS = 600_000;

type StepState =
  | "needs_input"
  | "reviewed"
  | "asked"
  | "unknown"
  | "refused"
  | "confirmed"
  | "unavailable"
  | "blocked";

interface Step {
  key: "plan" | "permissions" | "offer";
  title: string;
  state: StepState;
  detail: string;
  /** The request this step is waiting on, if any (the viewer's own row). */
  action: SaleActionView | null;
}

const ACTION_STATE: Record<string, StepState> = {
  prepared: "reviewed",
  requested: "asked",
  unknown: "unknown",
  no_longer_possible: "unknown",
  refused: "refused",
  confirmed: "confirmed",
};

const ceilMinute = (ms: number) => Math.ceil(ms / 60_000) * 60_000;

export async function customerAccess(
  sales: SaleActions,
  uses: CustomerUses,
  viewer: Person,
  businessId: string,
  projectId: string | undefined,
) {
  // Local facts first (owner only, 404 otherwise), then the one contract reading.
  const { readiness } = uses.offerReadiness(viewer, businessId, projectId);
  const r = await sales.ownerReading(viewer, businessId);
  const { reading: s, actions } = r;
  const offers = uses
    .listOffers(viewer, businessId)
    .offers.filter((o) => (projectId ? o.project_id === projectId : true));
  const active = offers.filter((o) => o.state === "active");
  const deal = s.control.live_deal;
  const timing = uses.timing;
  const usable = (hold: number, grace: number) =>
    uses.planUsability({ hold_ttl_ms: String(hold), settle_grace_ms: String(grace) });
  const probe = usable(GUIDED_HOLD_MS, 0);

  // ---------- 1. pricing plan ----------
  const pt = s.plan_terms ?? null;
  const planRows = actions.filter((a) => a.kind === "create_plan");
  // The NEWEST plan request decides while it is unresolved: asked or unknown, or one that can no
  // longer take effect but whose outcome only its own transaction shows (a lost answer after it
  // landed). It is recovered by its own ID, never by offering a new plan as if nothing happened.
  const UNRESOLVED = ["prepared", "requested", "unknown", "no_longer_possible"];
  const openPlan = planRows[0] && UNRESOLVED.includes(planRows[0].state) ? planRows[0] : undefined;
  const created = planRows
    .filter((a) => a.state === "confirmed" && a.effects && "plan" in a.effects)
    .map((a) => {
      const v = (a.effects as { plan: { plan_id: number; plan: Record<string, unknown> } }).plan;
      return {
        plan_id: v.plan_id,
        plan: v.plan,
        action_id: a.id,
        usable: uses.planUsability(v.plan as { hold_ttl_ms: string; settle_grace_ms: string }),
      };
    });
  let guided: {
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
  if (!pt)
    guided = {
      available: false,
      reason:
        "This business's contract predates guided plans. Plans created elsewhere can still be inspected and offered (Use an existing plan).",
      defaults: null,
      quote: null,
      next_plan_id: null,
      rules: null,
    };
  else {
    const maxHold = Number(pt.rules.max_hold_ttl_ms);
    const maxGrace = Number(pt.rules.max_settle_grace_ms);
    const hold = Math.min(GUIDED_HOLD_MS, maxHold);
    const grace = ceilMinute(probe.min_grace_ms);
    const fits = usable(hold, grace);
    const reason = deal
      ? "A plan can't be created while a sale is in progress."
      : pt.plan_count >= pt.max_plans
        ? `This contract already has the most plans allowed (${pt.max_plans}).`
        : !fits.usable
          ? `This business's rules allow holds of at most ${maxHold / 1000} s, and this server needs at least ${Math.ceil(fits.min_hold_ms / 1000)} s (its execution, submission and clock margins). The margins aren't reduced to fit.`
          : grace > maxGrace
            ? `This server needs a settlement grace of at least ${grace / 1000} s so a late result is paid, and this business's rules allow at most ${maxGrace / 1000} s.`
            : null;
    guided = {
      available: reason === null,
      reason,
      defaults: { hold_ttl_ms: String(hold), settle_grace_ms: String(grace) },
      quote: {
        deposit: (BigInt(pt.plan_bytes) * BigInt(pt.storage_byte_cost)).toString(),
        plan_bytes: pt.plan_bytes,
        storage_byte_cost: pt.storage_byte_cost,
      },
      next_plan_id: pt.next_plan_id,
      rules: {
        max_hold_units: pt.rules.rules.max_hold_units,
        min_hold_ttl_ms: pt.rules.min_hold_ttl_ms,
        max_hold_ttl_ms: pt.rules.max_hold_ttl_ms,
        max_settle_grace_ms: pt.rules.max_settle_grace_ms,
      },
    };
  }
  const offeredPlan = active[0]?.plan_id ?? null;
  const planStep: Step = openPlan
    ? {
        key: "plan",
        title: "Pricing plan",
        state: ACTION_STATE[openPlan.state] ?? "unknown",
        detail:
          openPlan.state === "prepared"
            ? "Reviewed; your wallet hasn't been asked yet."
            : openPlan.state === "no_longer_possible"
              ? "This request can no longer take effect. Whether it already did is shown only by its own transaction: enter its ID from your wallet's activity."
              : "Your wallet was asked; the plan is created only when its own transaction shows it.",
        action: openPlan,
      }
    : created.length > 0
      ? {
          key: "plan",
          title: "Pricing plan",
          state: "confirmed",
          detail: `Plan ${created[0]?.plan_id} was created by its own transaction and read back as reviewed.`,
          action: null,
        }
      : offeredPlan !== null
        ? {
            key: "plan",
            title: "Pricing plan",
            state: "confirmed",
            detail: `Plan ${offeredPlan} is already offered to customers.`,
            action: null,
          }
        : {
            key: "plan",
            title: "Pricing plan",
            state: guided.available ? "needs_input" : "unavailable",
            detail: guided.available
              ? "Create a plan: its price and limits are permanent on the contract."
              : (guided.reason as string),
            action: null,
          };

  // ---------- 2. service permissions ----------
  const platform = r.platform;
  const appointRows = actions.filter((a) => a.kind === "appoint");
  const openAppoint =
    appointRows[0] && UNRESOLVED.includes(appointRows[0].state) ? appointRows[0] : undefined;
  const slot = platform ? appointmentFor(s.control, platform, true) : null;
  const permStep: Step = !platform
    ? {
        key: "permissions",
        title: "Service permissions",
        state: "unavailable",
        detail: "This server has no platform metering account configured.",
        action: null,
      }
    : slot?.already
      ? {
          key: "permissions",
          title: "Service permissions",
          state: "confirmed",
          detail: `${platform} holds metering for this owner (generation ${s.control.generation}), as the contract shows now.`,
          action: null,
        }
      : openAppoint
        ? {
            key: "permissions",
            title: "Service permissions",
            state: ACTION_STATE[openAppoint.state] ?? "unknown",
            detail:
              openAppoint.state === "prepared"
                ? "Reviewed; your wallet hasn't been asked yet."
                : openAppoint.state === "no_longer_possible"
                  ? "This request can no longer take effect. Whether it already did is shown only by its own transaction: enter its ID from your wallet's activity."
                  : "Your wallet was asked; the permission is shown only by its own transaction.",
            action: openAppoint,
          }
        : deal
          ? {
              key: "permissions",
              title: "Service permissions",
              state: "blocked",
              detail: "Operators can't change while a sale is in progress.",
              action: null,
            }
          : {
              key: "permissions",
              title: "Service permissions",
              state: "needs_input",
              detail: slot?.change ?? "Adds metering.",
              action: null,
            };

  // ---------- 3. customer offer ----------
  const service = uses.serviceReadiness(businessId, s.control);
  const offerStep: Step =
    active.length > 0
      ? {
          key: "offer",
          title: "Customer offer",
          state: "confirmed",
          detail: `Offered with plan ${active[0]?.plan_id}. Only a customer's completed use shows it working.`,
          action: null,
        }
      : !readiness.release
        ? {
            key: "offer",
            title: "Customer offer",
            state: "blocked",
            detail: "Release a tested version first.",
            action: null,
          }
        : planStep.state !== "confirmed"
          ? {
              key: "offer",
              title: "Customer offer",
              state: "blocked",
              detail: "After the pricing plan.",
              action: null,
            }
          : {
              key: "offer",
              title: "Customer offer",
              state: "needs_input",
              detail: "Review the offer's plan, release and retention, then create it.",
              action: null,
            };
  const steps = [planStep, permStep, offerStep];
  return {
    business_id: businessId,
    block: s.block,
    release: readiness.release,
    owner_generation: s.control.generation,
    timing: {
      min_hold_ms: probe.min_hold_ms,
      min_grace_ms: probe.min_grace_ms,
      min_sign_ms: MIN_SIGN_MS,
      serve_window_ms: timing.serveWindowMs,
      guided_hold_ms: GUIDED_HOLD_MS,
    },
    guided,
    plans: created,
    operator: platform
      ? {
          account: platform,
          current: slot?.current ?? null,
          already: slot?.already ?? false,
          change: slot?.change ?? null,
          support: slot?.support ?? "none",
          generation: s.control.generation,
          // The explicit alternative, when support would otherwise be kept.
          without_support:
            slot && (slot.current?.caps ?? 0) & 2 && !slot.already
              ? appointmentFor(s.control, platform, false).change
              : null,
        }
      : null,
    offers: active.map((o) => ({ id: o.id, plan_id: o.plan_id, release_id: o.release_id })),
    service,
    steps,
    next: steps.find((x) => x.state !== "confirmed")?.key ?? null,
  };
}
