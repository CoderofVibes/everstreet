// Job 003wf4 (docs/design/OWNER_PLAN_SETUP.md §2, §9): "Set up customer access" in Studio's
// Service workspace. Three steps in order (pricing plan, service permissions, customer offer),
// each with its state in words, its evidence and one next action. Wallet requests go through the
// existing SaleFlow (exact preview verified here, one claimed ask, checked by its own transaction);
// an unresolved request is shown apart from the draft. Readable summaries first, identifiers under
// details.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type AccessState,
  type AccessStep,
  accessHttp,
  CustomerAccessFlow,
  type PlanDraft,
  planFromDraft,
  type StepState,
} from "../customerAccess.ts";
import type { SaleAction } from "../saleApi.ts";
import { saleHttp } from "../saleApi.ts";
import { STATE_LABEL, tokenAmount } from "../saleCalls.ts";
import { SaleFlow, type SaleFlowState } from "../saleFlow.ts";
import { useSession } from "../session.tsx";

const STATE_WORDS: Record<StepState, { label: string; tone: string }> = {
  needs_input: { label: "Needs your input", tone: "" },
  reviewed: { label: "Reviewed, not yet asked", tone: "info" },
  asked: { label: "Asked: waiting for its transaction", tone: "info" },
  unknown: { label: "Not known yet: recover by its own ID", tone: "warn" },
  refused: { label: "Refused by the contract", tone: "warn" },
  confirmed: { label: "Done", tone: "ok" },
  unavailable: { label: "Unavailable here", tone: "warn" },
  blocked: { label: "Waiting for an earlier step", tone: "" },
};

const EMPTY_ACCESS: AccessState = {
  status: "loading",
  view: null,
  draft: null,
  keepSupport: true,
  notice: null,
  busy: false,
};
const EMPTY_SALE: SaleFlowState = {
  status: "loading",
  setup: null,
  review: null,
  busy: null,
  notice: null,
  answers: {},
  drafts: {},
  focus: null,
};

const minutes = (ms: number | string) => `${Math.round(Number(ms) / 60_000)} min`;

/** The request a step waits on, shown apart from the draft, with its recovery actions. */
function OpenRequest({
  a,
  flow,
  busy,
}: {
  a: SaleAction;
  flow: CustomerAccessFlow;
  busy: boolean;
}) {
  const [tx, setTx] = useState("");
  return (
    <fieldset className="notice info" aria-label="Unresolved request">
      <strong>Your earlier request: {STATE_LABEL[a.state]}.</strong>{" "}
      {a.state === "prepared"
        ? "It was reviewed and stored, but your wallet hasn't been asked."
        : "Nothing is sent again from here. Its outcome is shown only by its own transaction."}
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        {a.state === "prepared" ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void flow.continuePrepared(a.id)}
            >
              Ask my wallet now
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void flow.setAside(a.id)}
            >
              Set it aside
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void flow.check(a.id)}
            >
              Check it
            </button>
            <label className="field" style={{ minWidth: 260 }}>
              <span>Its transaction ID, from your wallet's activity</span>
              <input
                className="input mono"
                value={tx}
                onChange={(e) => setTx(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || tx.trim() === ""}
              onClick={() => void flow.check(a.id, tx)}
            >
              Check with this ID
            </button>
          </>
        )}
      </div>
      <details className="advanced">
        <summary>Technical details</summary>
        <p className="mono" style={{ fontSize: 12 }}>
          request {a.id} · {a.identity}
          {a.tx_hash ? ` · transaction ${a.tx_hash}` : ""}
        </p>
      </details>
    </fieldset>
  );
}

/** The exact request under review: what it does, what it attaches, and the two choices. */
function Review({
  sale,
  flow,
  busy,
}: {
  sale: SaleFlowState;
  flow: CustomerAccessFlow;
  busy: boolean;
}) {
  const p = sale.review?.preview;
  if (!p) return null;
  const v = p.review as Record<string, unknown>;
  return (
    <section className="card review" aria-labelledby="access-review-title">
      <h4 id="access-review-title">
        {p.kind === "create_plan" ? "Review the plan" : "Review the permission"}
      </h4>
      <ul>
        {(v.effects as string[]).map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>
        {(v.conditions as string[]).join(" ")}
      </p>
      <p style={{ fontSize: 13 }}>
        Your wallet signs as <span className="mono">{p.account}</span> on {p.network}.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void flow.confirm()}
        >
          {sale.busy === "wallet" ? "Waiting for your wallet…" : "Ask my wallet"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => flow.cancel()}
        >
          Not now
        </button>
      </div>
      <details className="advanced">
        <summary>Technical details</summary>
        <pre className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(p.call, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function PlanForm({
  st,
  flow,
  busy,
  decimals,
  symbol,
}: {
  st: AccessState;
  flow: CustomerAccessFlow;
  busy: boolean;
  decimals: number | null;
  symbol: string;
}) {
  const d = st.draft as PlanDraft;
  const v = st.view;
  if (!v || !d) return null;
  const g = v.guided;
  const field = (k: keyof PlanDraft, label: string, help: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        inputMode={k === "price" ? "decimal" : "numeric"}
        value={d[k]}
        onChange={(e) => flow.setDraft({ [k]: e.target.value })}
        aria-describedby={`plan-${k}-help`}
      />
      <small id={`plan-${k}-help`}>{help}</small>
    </label>
  );
  const parsed = decimals === null ? null : planFromDraft(d, decimals);
  const why =
    decimals === null
      ? "The business's token couldn't be read, so a price can't be checked."
      : parsed && "problem" in parsed
        ? parsed.problem
        : null;
  return (
    <div>
      <div className="row offer-form" style={{ flexWrap: "wrap" }}>
        {field("price", `Price per use (${symbol})`, "Charged only for a delivered result.")}
        {field("perPurchase", "Units per purchase", "The most a customer buys at once.")}
        {field("outstanding", "Units a customer may hold", "At least the units per purchase.")}
        {field("perHold", "Uses per hold", `1 to ${g.rules?.max_hold_units ?? 10}.`)}
        {field(
          "holdMinutes",
          "Hold length (minutes)",
          `How long a customer has to sign and run one use. At least ${minutes(v.timing.min_hold_ms)} here; ${minutes(v.timing.guided_hold_ms)} is suggested.`,
        )}
        {field(
          "graceMinutes",
          "Settlement time (minutes)",
          `At least ${minutes(v.timing.min_grace_ms)}, so a result delivered at the last moment is still paid.`,
        )}
      </div>
      {g.quote && (
        <p className="muted" style={{ fontSize: 13 }}>
          Creating it attaches {g.quote.deposit} yoctoNEAR for {g.quote.plan_bytes} bytes of
          contract storage; any excess is refunded. A plan is permanent: a new price is a new plan.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        data-focus="plan-review"
        disabled={busy || why !== null}
        aria-describedby={why ? "plan-review-why" : undefined}
        onClick={() => void flow.reviewPlan()}
      >
        Review this plan
      </button>
      {why && (
        <p id="plan-review-why" className="muted" style={{ fontSize: 13 }}>
          {why}
        </p>
      )}
    </div>
  );
}

function StepBody({
  step,
  st,
  sale,
  flow,
  busy,
  onOffer,
}: {
  step: AccessStep;
  st: AccessState;
  sale: SaleFlowState;
  flow: CustomerAccessFlow;
  busy: boolean;
  onOffer?: (planId: number) => void;
}) {
  const v = st.view;
  if (!v) return null;
  const reviewing = sale.review?.preview.kind;
  const meta = sale.setup?.token.meta ?? null;
  if (step.key === "plan") {
    if (step.action && step.action.state === "no_longer_possible" && reviewing !== "create_plan")
      return (
        <>
          <OpenRequest a={step.action} flow={flow} busy={busy} />
          <details className="advanced">
            <summary>It never landed? Review a new plan instead</summary>
            <p className="notice" style={{ fontSize: 13 }}>
              If your earlier request did take effect, a new one creates another plan, and a plan is
              permanent. Check its ID first if your wallet's activity lists it.
            </p>
            <PlanForm
              st={st}
              flow={flow}
              busy={busy}
              decimals={meta?.decimals ?? null}
              symbol={meta?.symbol ?? "token"}
            />
          </details>
        </>
      );
    if (step.action && reviewing !== "create_plan")
      return <OpenRequest a={step.action} flow={flow} busy={busy} />;
    if (step.state === "confirmed") {
      const p = v.plans[0];
      return p ? (
        <p style={{ fontSize: 14 }}>
          Plan {p.plan_id}:{" "}
          {meta
            ? `${tokenAmount(String(p.plan.unit_price), meta.decimals)} ${meta.symbol}`
            : String(p.plan.unit_price)}{" "}
          per use, holds of {minutes(String(p.plan.hold_ttl_ms))}, read back from the contract.
        </p>
      ) : null;
    }
    if (step.state === "unavailable") return null;
    return reviewing === "create_plan" ? (
      <Review sale={sale} flow={flow} busy={busy} />
    ) : (
      <PlanForm
        st={st}
        flow={flow}
        busy={busy}
        decimals={meta?.decimals ?? null}
        symbol={meta?.symbol ?? "token"}
      />
    );
  }
  if (step.key === "permissions") {
    if (step.action) return <OpenRequest a={step.action} flow={flow} busy={busy} />;
    const o = v.operator;
    if (step.state !== "needs_input" || !o) return null;
    if (reviewing === "appoint") return <Review sale={sale} flow={flow} busy={busy} />;
    return (
      <div>
        <p style={{ fontSize: 14 }}>
          {o.current
            ? `${o.account} now holds ${o.current.caps === 3 ? "metering and support" : o.current.caps === 2 ? "support" : "metering"} (generation ${o.current.generation}).`
            : `${o.account} has no permission on this business yet.`}{" "}
          {st.keepSupport || !o.without_support ? o.change : o.without_support}
        </p>
        {o.without_support && (
          <label className="row" style={{ gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={st.keepSupport}
              onChange={(e) => flow.setKeepSupport(e.target.checked)}
            />
            Keep its support permission
          </label>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          This is a permission only. Whether customers can actually be served is the readiness
          below.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          data-focus="permission-review"
          disabled={busy}
          onClick={() => void flow.reviewPermission()}
        >
          Review this permission
        </button>
      </div>
    );
  }
  // The offer: the existing inspection and review below, pre-filled with the confirmed plan.
  if (step.state === "needs_input") {
    const planId = v.plans[0]?.plan_id;
    return (
      <div>
        <p style={{ fontSize: 14 }}>
          {v.service.eligible
            ? "Service checks pass here now."
            : `Service checks not yet passing: ${v.service.reasons.join(", ")}.`}{" "}
          <span className="muted">{v.service.note}</span>
        </p>
        {planId !== undefined && onOffer && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onOffer(planId)}
          >
            Review the offer for plan {planId}
          </button>
        )}
      </div>
    );
  }
  return null;
}

export function CustomerAccess({
  businessId,
  projectId,
  onOffer,
}: {
  businessId: string;
  projectId: string;
  /** Hands the confirmed plan to the offer review below (it is never skipped). */
  onOffer?: (planId: number) => void;
}) {
  const { account, walletBoundary } = useSession();
  const [flow, setFlow] = useState<CustomerAccessFlow | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one controller per business, product and account
  useEffect(() => {
    if (!account) return;
    const sale = new SaleFlow(saleHttp, walletBoundary, { businessId, account });
    const f = new CustomerAccessFlow(accessHttp, sale, {
      businessId,
      projectId,
      account,
      storage: typeof sessionStorage === "undefined" ? null : sessionStorage,
    });
    setFlow(f);
    void f.load();
    return () => {
      f.retire();
      sale.retire();
      setFlow((cur) => (cur === f ? null : cur));
    };
  }, [businessId, projectId, account]);
  const st = useSyncExternalStore(
    (fn) => (flow ? flow.subscribe(fn) : () => {}),
    () => (flow ? flow.getState() : EMPTY_ACCESS),
    () => EMPTY_ACCESS,
  );
  const sale = useSyncExternalStore(
    (fn) => (flow ? flow.sale.subscribe(fn) : () => {}),
    () => (flow ? flow.sale.getState() : EMPTY_SALE),
    () => EMPTY_SALE,
  );
  // After a review is set aside, focus returns to the control it was opened from.
  useEffect(() => {
    if (!flow || !sale.focus || sale.review) return;
    const el = document.querySelector<HTMLElement>(`[data-focus="${sale.focus}"]`);
    if (el) {
      el.focus();
      flow.sale.focused();
    }
  });

  if (!account)
    return (
      <section className="card" aria-labelledby="access-title">
        <h2 id="access-title">Set up customer access</h2>
        <p className="muted">Sign in with your NEAR account to set up customer access.</p>
      </section>
    );
  const busy = st.busy || sale.busy !== null;
  const v = st.view;
  const notice = sale.notice ?? st.notice;
  return (
    <section className="card customer-access" aria-labelledby="access-title">
      <h2 id="access-title">Set up customer access</h2>
      {v?.release ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          For <strong>{v.release.product.name}</strong>
          {v.release.product.revision !== null && `, revision ${v.release.product.revision}`}. Each
          step shows what the contract and this server show now.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Release a tested version first; then set up its plan, permission and offer here.
        </p>
      )}
      {st.status === "loading" && (
        <p className="muted" role="status">
          Reading the contract…
        </p>
      )}
      {st.status === "error" && (
        <div role="alert">
          <p className="notice error">{st.notice?.text ?? "This couldn't be read."}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void flow?.load()}
          >
            Try again
          </button>
        </div>
      )}
      {v && flow && (
        <ol className="access-steps">
          {v.steps.map((step, i) => (
            <li key={step.key} aria-current={v.next === step.key ? "step" : undefined}>
              <h3 style={{ fontSize: 15 }}>
                {i + 1}. {step.title}{" "}
                <span className={`pill ${STATE_WORDS[step.state].tone}`}>
                  {STATE_WORDS[step.state].label}
                </span>
              </h3>
              <p style={{ fontSize: 14 }}>{step.detail}</p>
              <StepBody step={step} st={st} sale={sale} flow={flow} busy={busy} onOffer={onOffer} />
            </li>
          ))}
        </ol>
      )}
      {v && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void flow?.load()}
        >
          {busy ? "Reading…" : "Read again"}
        </button>
      )}
      <div role="status" aria-live="polite">
        {notice && (
          <p
            className={`notice ${notice.tone === "warn" ? "error" : notice.tone === "ok" ? "ok" : ""}`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
}
