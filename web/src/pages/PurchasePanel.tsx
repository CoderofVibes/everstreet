// Job 003web (§10.5): "Buy uses". For a customer arriving with nothing: create the registration
// (the exact, refundable storage deposit), register with the token if needed, then buy a chosen
// number of uses. Each step is an exact reviewed request for the customer's own wallet. The panel
// leads with the product, the quantity, the TOKEN amount (validated decimals and symbol), the
// separate storage deposit, the account and the outcome; the exact base units, method, arguments,
// deposit and gas are in readable details. No fiat value is shown or invented. An open purchase is
// recovered before any other is offered; asking the wallet again is its own reviewed consent.
// One controller per offer and account; a change of either retires it (late answers dropped).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type FlowState,
  nearAmount,
  PurchaseFlow,
  type PurchaseSetup,
  purchaseHttp,
  RESEND_CONSENT,
  tokenAmount,
} from "../purchase.ts";
import { useSession } from "../session.tsx";
import type { WalletFunctionCall } from "../wallet.ts";

const EMPTY: FlowState = {
  status: "loading",
  setup: null,
  units: 10,
  review: null,
  busy: null,
  notice: null,
  resolution: null,
};

const tgas = (gas: string) => `${(Number(BigInt(gas) / 1_000_000_000n) / 1000).toString()} Tgas`;

/** A token amount in readable form, with its exact base units (no fiat). */
export function TokenAmount({ base, setup }: { base: string; setup: PurchaseSetup }) {
  return (
    <span>
      <strong>
        {tokenAmount(base, setup.token.decimals)} {setup.token.symbol}
      </strong>{" "}
      <span className="muted mono">({base} base units)</span>
    </span>
  );
}

/** The exact wallet request, in readable terms first; the raw call in details. */
export function PurchaseRequest({
  call,
  setup,
  account,
  lead,
}: {
  call: WalletFunctionCall;
  setup: PurchaseSetup;
  account: string;
  lead: React.ReactNode;
}) {
  return (
    <>
      <p>{lead}</p>
      <dl className="use-terms">
        <dt>Your account (approves and pays)</dt>
        <dd className="mono">{account}</dd>
        <dt>Network</dt>
        <dd className="mono">{setup.network}</dd>
        <dt>Sent to</dt>
        <dd className="mono">{call.receiverId}</dd>
        <dt>Attached NEAR</dt>
        <dd className="mono">
          {nearAmount(call.deposit)} NEAR ({call.deposit} yoctoNEAR)
        </dd>
        <dt>Gas</dt>
        <dd className="mono">up to {tgas(call.gas)}</dd>
      </dl>
      <details>
        <summary>The exact request</summary>
        <p className="mono">
          {call.methodName} {JSON.stringify(call.args)}
        </p>
      </details>
    </>
  );
}

export function PurchasePanel({
  offerId,
  onChanged,
}: {
  offerId: string;
  /** Called when the contract shows something new (a registration or confirmed units). */
  onChanged: () => void;
}) {
  const { account, walletBoundary, wallet } = useSession();
  const [flow, setFlow] = useState<PurchaseFlow | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  // biome-ignore lint/correctness/useExhaustiveDependencies: one controller per offer and account
  useEffect(() => {
    if (!account) return;
    const f = new PurchaseFlow(purchaseHttp, walletBoundary, { offerId, account });
    setFlow(f);
    void f.load();
    return () => {
      f.retire();
      setFlow((cur) => (cur === f ? null : cur));
    };
  }, [offerId, account]);
  const s = useSyncExternalStore(
    (fn) => (flow ? flow.subscribe(fn) : () => {}),
    () => (flow ? flow.getState() : EMPTY),
    () => EMPTY,
  );
  const lastConfirmed = useRef<string | null>(null);
  const shellNeeded = s.setup?.shell.needed;
  const prevShell = useRef(shellNeeded);
  useEffect(() => {
    if (prevShell.current && shellNeeded === false) changed.current();
    prevShell.current = shellNeeded;
    const key = s.resolution?.kind === "confirmed" ? JSON.stringify(s.resolution) : null;
    if (key && key !== lastConfirmed.current) {
      lastConfirmed.current = key;
      changed.current();
    }
  }, [shellNeeded, s.resolution]);

  if (!account || !wallet || !flow) return null;
  const setup = s.setup;
  const busy = s.busy !== null;
  const status =
    s.busy === "wallet"
      ? "Waiting for your wallet… approve or close it there."
      : s.busy === "processing"
        ? "Storing the purchase you reviewed…"
        : s.busy === "checking"
          ? "Checking the contract…"
          : null;
  return (
    <section className="card use-device" aria-labelledby="buy-title">
      <h3 id="buy-title">Buy uses</h3>
      {s.status === "loading" && <p aria-live="polite">Checking the contract and the token…</p>}
      {s.status === "error" && !setup && <p className="error-text">{s.notice?.text}</p>}
      {setup && (
        <>
          {setup.steps.includes("contract_upgrade") ? (
            <p>
              This business's contract doesn't state its purchase terms, so buying isn't available
              here until its owner upgrades it. Nothing can be sent.
            </p>
          ) : (
            <>
              <p className="muted">
                Each use costs <TokenAmount base={setup.plan.unit_price} setup={setup} />. You hold{" "}
                <TokenAmount base={setup.token.balance} setup={setup} /> in this account
                {setup.entitlement
                  ? `, and ${setup.entitlement.free} uses are ready for you.`
                  : ". You have no uses for this product yet."}
              </p>
              {!setup.token.business_registered && (
                <p className="error-text">
                  The business can't receive its token yet (its owner must register it). Buying
                  isn't possible until then.
                </p>
              )}
            </>
          )}
          <p aria-live="polite" className={s.notice?.tone === "warn" ? "error-text" : "muted"}>
            {status ?? s.notice?.text ?? ""}
          </p>

          {setup.open ? (
            <OpenPurchase flow={flow} s={s} setup={setup} account={account} busy={busy} />
          ) : s.review ? (
            <section className="use-consent" aria-labelledby="buy-review-title">
              <h4 id="buy-review-title">
                {s.review.kind === "shell"
                  ? "Review: create your registration"
                  : s.review.kind === "token_storage"
                    ? "Review: register with the token"
                    : "Review: buy uses"}
              </h4>
              {s.review.kind === "shell" && setup.shell.quote && (
                <PurchaseRequest
                  call={s.review.call}
                  setup={setup}
                  account={account}
                  lead={
                    <>
                      A one-time, refundable storage deposit of{" "}
                      <strong>{nearAmount(setup.shell.quote.deposit)} NEAR</strong> keeps your
                      record of uses with this business ({setup.shell.quote.bytes} bytes; exact, as
                      the contract states it: {setup.shell.quote.basis}).
                    </>
                  }
                />
              )}
              {s.review.kind === "token_storage" && (
                <PurchaseRequest
                  call={s.review.call}
                  setup={setup}
                  account={account}
                  lead={
                    <>
                      Registers your account with {setup.token.name} so it can hold and send{" "}
                      {setup.token.symbol}. You still need your own {setup.token.symbol}: nothing
                      here provides tokens.
                    </>
                  }
                />
              )}
              {s.review.kind === "purchase" && (
                <PurchaseRequest
                  call={s.review.preview.call}
                  setup={setup}
                  account={account}
                  lead={
                    <>
                      <strong>{s.review.preview.units} uses</strong> for{" "}
                      <TokenAmount base={s.review.preview.amount} setup={setup} />, paid from your
                      account to this business (registration {s.review.preview.reg_id}, purchase{" "}
                      {s.review.preview.purchase_seq}). If anything doesn't match when it arrives,
                      the contract returns the whole amount.
                    </>
                  }
                />
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    s.review?.kind === "purchase" ? flow.confirmPurchase() : flow.confirmSetupStep()
                  }
                >
                  Ask my wallet to approve exactly this
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => flow.setUnits(s.units)}
                >
                  Not now
                </button>
              </div>
            </section>
          ) : setup.steps.includes("contract_upgrade") ? null : setup.shell.needed ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => flow.review("shell")}
            >
              Review: create your registration
            </button>
          ) : setup.token_storage.needed ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => flow.review("token_storage")}
            >
              Review: register with the token
            </button>
          ) : (
            <>
              <label className="field">
                <span>How many uses (1 to {setup.plan.max_units_per_purchase})</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={setup.plan.max_units_per_purchase}
                  value={s.units}
                  disabled={busy}
                  onChange={(e) => flow.setUnits(Number(e.target.value))}
                />
              </label>
              {Number.isInteger(s.units) && s.units > 0 && (
                <p className="muted">
                  Total:{" "}
                  <TokenAmount
                    base={(BigInt(s.units) * BigInt(setup.plan.unit_price)).toString()}
                    setup={setup}
                  />
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => flow.review("purchase")}
              >
                Review this purchase
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => flow.load()}
          >
            Check the contract again
          </button>
        </>
      )}
    </section>
  );
}

const STATE_WORDS: Record<string, string> = {
  prepared: "stored; your wallet hasn't been asked yet",
  requested: "your wallet was asked; waiting for its outcome",
  unknown: "the outcome isn't known yet",
};

function OpenPurchase({
  flow,
  s,
  setup,
  account,
  busy,
}: {
  flow: PurchaseFlow;
  s: FlowState;
  setup: PurchaseSetup;
  account: string;
  busy: boolean;
}) {
  const p = setup.open;
  if (!p) return null;
  return (
    <section className="use-consent" aria-labelledby="buy-open-title">
      <h4 id="buy-open-title">A purchase is waiting for its outcome</h4>
      <p>
        <strong>{p.units} uses</strong> for <TokenAmount base={p.amount} setup={setup} /> (purchase{" "}
        {p.purchase_seq}): {STATE_WORDS[p.state] ?? p.state}. Nothing else can be bought until it's
        settled, so you can't pay twice.
      </p>
      {s.review?.kind === "resend" ? (
        <>
          <p>{RESEND_CONSENT}</p>
          <PurchaseRequest
            call={p.call}
            setup={setup}
            account={account}
            lead={<>The same request, again:</>}
          />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => flow.confirmResend()}
            >
              Ask my wallet again for exactly this
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => flow.setUnits(s.units)}
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => flow.checkOpen(p.id)}
          >
            Check its outcome
          </button>
          {p.state === "prepared" ? (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => flow.setAside(p.id)}
            >
              Set it aside (your wallet was never asked)
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => flow.review("resend")}
            >
              Review asking my wallet again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
