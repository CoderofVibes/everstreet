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

/**
 * A token amount in readable form (validated decimals and symbol; no fiat). The exact base units
 * belong in a request's details (Astra's PurchaseBrowserReview 3), not every price line.
 */
export function TokenAmount({ base, setup }: { base: string; setup: PurchaseSetup }) {
  return (
    <strong>
      {tokenAmount(base, setup.token.decimals)} {setup.token.symbol}
    </strong>
  );
}

/**
 * The exact wallet request: what it does and who approves and pays first; the exact units,
 * method and arguments in one disclosure (still exactly what the wallet is asked for).
 */
export function PurchaseRequest({
  call,
  setup,
  account,
  lead,
  details,
}: {
  call: WalletFunctionCall;
  setup: PurchaseSetup;
  account: string;
  lead: React.ReactNode;
  /** Exact figures behind the lead (bytes, base units, numbers), shown with the request. */
  details?: React.ReactNode;
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
        <dd className="mono">{nearAmount(call.deposit)} NEAR</dd>
        <dt>Gas</dt>
        <dd className="mono">up to {tgas(call.gas)}</dd>
      </dl>
      <details>
        <summary>Exact details</summary>
        <dl className="use-terms">
          {details}
          <dt>Attached, exactly</dt>
          <dd className="mono">{call.deposit} yoctoNEAR</dd>
          <dt>Request</dt>
          <dd className="mono">
            {call.methodName} {JSON.stringify(call.args)}
          </dd>
        </dl>
      </details>
    </>
  );
}

export function PurchasePanel({
  offerId,
  onChanged,
  onToken,
  unitKey = null,
}: {
  offerId: string;
  /**
   * Job 003wf3 (Astra 03:05): the page's current use and its unit state. When it changes, the
   * reading here is taken again (later, if a purchase is being reviewed or sent).
   */
  unitKey?: string | null;
  /** Called when the contract shows something new (a registration or confirmed units). */
  onChanged: () => void;
  /** The token's validated symbol and decimals, once read (for the page's own price line). */
  onToken?: (t: { symbol: string; decimals: number } | null) => void;
}) {
  const { account, walletBoundary, wallet } = useSession();
  const [flow, setFlow] = useState<PurchaseFlow | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const tokenOut = useRef(onToken);
  tokenOut.current = onToken;
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
  const symbol = s.setup?.token.symbol;
  const decimals = s.setup?.token.decimals;
  useEffect(() => {
    tokenOut.current?.(
      symbol !== undefined && decimals !== undefined ? { symbol, decimals } : null,
    );
  }, [symbol, decimals]);
  // Astra's PurchaseBrowserReview 1: whenever a FRESH read of THIS flow (this offer and account)
  // shows the registration or its units changed, the page's dependent views (the device panel)
  // re-read the contract themselves. That covers a confirmed purchase, a new registration and a
  // purchase whose outcome is unknown but whose units the contract now shows. It is the current
  // entitlement, not proof of which payment produced it. The first reading of a flow only sets
  // the baseline (the dependent views read for themselves when they start), and a re-read that
  // finds nothing new notifies nothing, so there is no refresh loop.
  const e = s.setup?.entitlement;
  const entKey = s.setup
    ? JSON.stringify(e ? [e.reg_id, e.active, e.purchase_seq, e.free, e.held] : null)
    : null;
  const seen = useRef<{ flow: PurchaseFlow | null; key: string | null }>({ flow: null, key: null });
  useEffect(() => {
    if (entKey === null) return;
    const before = seen.current;
    seen.current = { flow, key: entKey };
    if (before.flow === flow && before.key !== null && before.key !== entKey) changed.current();
  }, [flow, entKey]);

  // Job 003wf3: a changed unit on this page re-reads the contract here; a re-read that has to
  // wait for a purchase in progress is done once that purchase is set aside or finished.
  const lastUnit = useRef<string | null>(unitKey);
  const [owed, setOwed] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  // Anything started on this panel keeps it open (its notices and reviews stay in view).
  const [acted, setActed] = useState(false);
  useEffect(() => {
    if (s.busy !== null || s.review !== null) setActed(true);
  }, [s.busy, s.review]);
  useEffect(() => {
    if (unitKey === lastUnit.current) return;
    lastUnit.current = unitKey;
    setOwed(true);
  }, [unitKey]);
  const idle = s.busy === null && s.review === null;
  useEffect(() => {
    if (!owed || !flow || !idle) return;
    setOwed(false);
    void flow.reread();
  }, [owed, flow, idle]);

  if (!account || !wallet || !flow) return null;
  const setup = s.setup;
  const readAt = s.readAtMs ? new Date(s.readAtMs).toLocaleTimeString() : null;
  // Second first-use pass (Nov 7, findings 51 and 54): with uses already prepaid, the purchase
  // form waits behind one button.
  const hasUses = Boolean(setup?.entitlement && Number(setup.entitlement.free) > 0);
  if (
    hasUses &&
    !buyOpen &&
    !acted &&
    s.busy === null &&
    s.review === null &&
    s.notice === null &&
    !setup?.open &&
    (setup?.unresolved ?? []).length === 0
  )
    return (
      <section className="card use-device" aria-labelledby="buy-title">
        <h3 id="buy-title">Your uses</h3>
        <p className="muted">
          {setup?.entitlement?.free} uses ready for you
          {readAt ? ` (read ${readAt})` : ""}. Each costs{" "}
          {setup && <TokenAmount base={setup.plan.unit_price} setup={setup} />}.
        </p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setBuyOpen(true)}>
          Buy more uses
        </button>
      </section>
    );
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
                  ? s.rereadFailed || owed
                    ? `. When last read${readAt ? ` (${readAt})` : ""}, the contract showed ${setup.entitlement.free} uses ready for you.`
                    : `, and the contract shows ${setup.entitlement.free} uses ready for you${readAt ? ` (read ${readAt})` : ""}.`
                  : ". You have no uses for this product yet."}
              </p>
              {s.rereadFailed && (
                <p className="muted" role="status">
                  It couldn't be read again just now, so this is the earlier reading. Your unit
                  below is this use's own record.
                </p>
              )}
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

          {(setup.unresolved ?? []).length > 0 && (
            <Unresolved flow={flow} setup={setup} busy={busy} />
          )}
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
                      A one-time storage deposit of{" "}
                      <strong>{nearAmount(setup.shell.quote.deposit)} NEAR</strong> keeps your
                      record of uses with this business. It comes back to you if you later remove
                      that record once it holds no uses.
                    </>
                  }
                  details={
                    <>
                      <dt>Storage</dt>
                      <dd className="mono">
                        {setup.shell.quote.bytes} bytes at {setup.shell.quote.byte_cost} yoctoNEAR
                        each
                      </dd>
                      <dt>Where the amount comes from</dt>
                      <dd>
                        {setup.shell.quote.basis}{" "}
                        {setup.terms && (
                          <span className="mono">(purchase terms v{setup.terms.version})</span>
                        )}
                      </dd>
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
                      account to this business. If anything doesn't match when it arrives, the
                      business's contract refuses it and the token sends the amount back; this page
                      says it came back only once the token's own records show that.
                    </>
                  }
                  details={
                    <>
                      <dt>Amount</dt>
                      <dd className="mono">
                        {s.review.preview.amount} base units of {setup.asset}
                      </dd>
                      <dt>Registration and purchase number</dt>
                      <dd className="mono">
                        {s.review.preview.reg_id} · {s.review.preview.purchase_seq}
                      </dd>
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
        </>
      )}
    </section>
  );
}

/**
 * Checking with the ORIGINAL transaction's ID from the wallet's history (Astra's
 * PurchaseBrowserReview 2), for when the wallet's answer never carried it. Nothing is sent to the
 * wallet; the server's strict resolver decides, and an unrelated ID changes nothing.
 */
function TransactionCheck({
  flow,
  purchaseId,
  busy,
}: {
  flow: PurchaseFlow;
  purchaseId: string;
  busy: boolean;
}) {
  const [txId, setTxId] = useState("");
  const field = `buy-tx-${purchaseId}`;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        void flow.checkWithTransaction(purchaseId, txId);
      }}
    >
      <label className="field" htmlFor={field}>
        <span>Transaction ID from your wallet's activity</span>
        <input
          id={field}
          className="input mono"
          value={txId}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setTxId(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-secondary" disabled={busy || !txId.trim()}>
        Check this transaction
      </button>
    </form>
  );
}

const STATE_WORDS: Record<string, string> = {
  prepared: "stored; your wallet hasn't been asked yet",
  requested: "your wallet was asked; waiting for its outcome",
  unknown: "the outcome isn't known yet",
  legacy_abandoned:
    "set aside by an earlier version after your wallet was asked; it may still have gone through",
  not_accepted: "an earlier version recorded it as not accepted, which wasn't proof",
};

/**
 * Earlier purchases that no longer block a payment (their registration was replaced, so the
 * contract can't accept them now) but whose outcome is still unknown: each can still be checked
 * by its own transaction.
 */
function Unresolved({
  flow,
  setup,
  busy,
}: {
  flow: PurchaseFlow;
  setup: PurchaseSetup;
  busy: boolean;
}) {
  return (
    <section className="use-consent" aria-labelledby="buy-unresolved-title">
      <h4 id="buy-unresolved-title">Earlier purchases with an unknown outcome</h4>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {(setup.unresolved ?? []).map((p) => (
          <li key={p.id}>
            <p>
              <strong>{p.units} uses</strong> for <TokenAmount base={p.amount} setup={setup} />{" "}
              (purchase {p.purchase_seq}). The registration it was for was removed or replaced, so
              the contract can't accept this request now; whether it was accepted before isn't
              known. Its own transaction can still show it.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => flow.checkOpen(p.id)}
              >
                Check its outcome
              </button>
            </div>
            <TransactionCheck flow={flow} purchaseId={p.id} busy={busy} />
          </li>
        ))}
      </ul>
    </section>
  );
}

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
        {p.purchase_seq}): {STATE_WORDS[p.state] ?? p.state}. A new purchase isn't offered while
        this one might still go through. The uses shown above are what the contract holds for you
        now; they don't show whether this purchase is among them.
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
        <>
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
          {p.state !== "prepared" && (
            <TransactionCheck key={p.id} flow={flow} purchaseId={p.id} busy={busy} />
          )}
        </>
      )}
    </section>
  );
}
