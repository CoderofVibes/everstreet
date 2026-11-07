// The buyer's escrow funding from another token, through NEAR's intents verifier (design: the
// Closing Ledger's escrow card). Each step is the buyer's own wallet: register the signing key,
// deposit, sign the swap (NEP-413), withdraw the tUSD to their own account. Everstreet quotes and
// fills as the solver, labelled so. Escrow counts as funded only when the business contract shows
// it, by the existing fund request.

import { useCallback, useEffect, useState } from "react";
import {
  type IntentsFundingView,
  type IntentsPanelView,
  type IntentsStage,
  intentsHttp,
  SaleError,
  type SaleSetup,
} from "../saleApi.ts";
import { tokenAmount } from "../saleCalls.ts";
import { useSession } from "../session.tsx";
import type { WalletFunctionCall } from "../wallet.ts";

const STAGE: Record<IntentsStage, string> = {
  quoted: "Quoted",
  deposited: "Deposited",
  swapped: "Swapped",
  delivered: "Delivered",
  funded: "Funded",
  expired: "Quote expired",
  refused: "Refused · nothing moved",
  refunded: "Refunded",
  unknown: "Checking the verifier",
};
const ORDER: IntentsStage[] = ["quoted", "deposited", "swapped", "delivered", "funded"];
const GAS = "100000000000000";

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className={done ? "ledger-ok" : "ledger-open"}>
      <span aria-hidden="true">{done ? "✓" : "○"}</span>
      <span className="intents-step">
        <span className="sr-only">{done ? "Done: " : "Not yet: "}</span>
        {children}
      </span>
    </li>
  );
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function IntentsFunding({ s, onChange }: { s: SaleSetup; onChange: () => void }) {
  const { walletBoundary } = useSession();
  const businessId = s.business.id;
  const d = s.control.live_deal;
  const [v, setV] = useState<IntentsPanelView | null>(null);
  const [f, setF] = useState<IntentsFundingView | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState<string | null>(null);
  const [signed, setSigned] = useState<{
    public_key: string;
    signature: string;
    callback_url: string | null;
  } | null>(null);
  const [reviewing, setReviewing] = useState<"deposit" | null>(null);

  const load = useCallback(() => {
    intentsHttp
      .view(businessId)
      .then((x) => {
        setV(x);
        setF(x.funding);
        setToken((t) => t || x.offers[0]?.token || "");
      })
      .catch(() => setV(null));
  }, [businessId]);
  // Read again whenever the business contract's escrow changes (funded by the sale's request).
  const escrow = d?.escrow ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on escrow change
  useEffect(load, [load, escrow]);

  if (!v || !d || v.account !== d.buyer) return null;
  const sym = s.token.meta?.symbol ?? "tokens";
  const dec = s.token.meta?.decimals ?? 0;
  const give = (base: string) =>
    `${tokenAmount(base, f?.give.decimals ?? 0)} ${f?.give.symbol ?? ""}`.trim();
  const fundedHere = d.escrow !== "0";
  // First-use review (Nov 7, finding 75): say why the route is closed instead of hiding it.
  if (fundedHere && f?.stage !== "funded")
    return (
      <p className="muted small intents-funding" style={{ margin: "8px 0 0" }}>
        Fund from another token (NEAR Intents): only while the escrow is unfunded.
      </p>
    );

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      // An unregistered key is the next step, not an error.
      if (e instanceof SaleError && e.code === "key_not_registered") setNeedsKey("register");
      else setError(e instanceof Error ? e.message : "It didn't complete.");
    } finally {
      setBusy(null);
    }
  };
  const refresh = async (id: string) => {
    const x = await intentsHttp.status(id);
    setF(x);
    if (x.stage === "funded") onChange();
    return x;
  };
  const wallet = async () => {
    const w = await walletBoundary?.();
    if (!w) throw new Error("No wallet is available here.");
    return w;
  };
  const send = async (call: WalletFunctionCall) => {
    const out = await (await wallet()).send(call);
    if (!out) throw new Error("The wallet didn't send it.");
    if (f) await refresh(f.id);
  };
  const submit = async (sig: NonNullable<typeof signed>) => {
    if (!f) return;
    const x = await intentsHttp.sign(f.id, sig);
    setF(x);
    setNeedsKey(null);
  };

  const quote = () =>
    run("quote", async () => {
      setSigned(null);
      setNeedsKey(null);
      setF(await intentsHttp.quote(businessId, token));
    });
  const deposit = () =>
    run("deposit", () =>
      send({
        receiverId: f?.give.token as string,
        methodName: "ft_transfer_call",
        args: { receiver_id: v.verifier, amount: f?.give.amount, msg: "" },
        gas: GAS,
        deposit: "1",
      }),
    );
  const sign = () =>
    run("sign", async () => {
      if (!f?.sign) throw new Error("The quote is no longer open.");
      const callbackUrl = window.location.href;
      const answer = await (await wallet()).signMessage({
        message: f.sign.message,
        recipient: f.sign.recipient,
        nonce: Uint8Array.from(atob(f.sign.nonce), (c) => c.charCodeAt(0)),
        callbackUrl,
        state: f.id,
      });
      if (!answer) throw new Error("The wallet didn't return a signature here.");
      if (answer.accountId !== v.account) throw new Error("The wallet signed as another account.");
      const sig = {
        public_key: answer.publicKey,
        signature: answer.signature,
        callback_url: callbackUrl,
      };
      setSigned(sig);
      await submit(sig);
    });
  const register = () =>
    run("register", async () => {
      if (!signed) throw new Error("Sign first.");
      await send({
        receiverId: v.verifier,
        methodName: "add_public_key",
        args: { public_key: signed.public_key },
        gas: GAS,
        deposit: "1",
      });
      await submit(signed);
    });
  const withdraw = (tokenAccount: string, amount: string) =>
    run("withdraw", () =>
      send({
        receiverId: v.verifier,
        methodName: "ft_withdraw",
        args: { token: tokenAccount, receiver_id: v.account, amount },
        gas: GAS,
        deposit: "1",
      }),
    );

  const stage = f?.stage ?? null;
  const at = stage ? ORDER.indexOf(stage) : -1;
  const failed = stage === "expired" || stage === "refused" || stage === "refunded";
  const offer = v.offers.find((o) => o.token === token) ?? v.offers[0];
  const btn = (label: string, key: string, onClick: () => void, primary = false) => (
    <button
      type="button"
      className={`btn ${primary ? "btn-primary" : "btn-secondary"} btn-sm`}
      disabled={busy !== null}
      onClick={onClick}
    >
      {busy === key ? "Waiting…" : label}
    </button>
  );

  return (
    <details className="ledger-terms intents-funding" open={Boolean(f) && stage !== "funded"}>
      <summary>Fund from another token · NEAR Intents</summary>
      <dl className="proof-rows">
        <div className="proof-row">
          <dt>Solver</dt>
          <dd>
            <span className="proof-value">
              Everstreet · <span className="mono wrap">{v.solver?.account ?? "not connected"}</span>
            </span>
            {v.solver?.source === "synthetic" && <span className="pill">Synthetic</span>}
          </dd>
        </div>
        <div className="proof-row">
          <dt>Verifier</dt>
          <dd>
            <span className="proof-value mono wrap">{v.verifier}</span>
          </dd>
        </div>
        {f && (
          <div className="proof-row">
            <dt>Quote</dt>
            <dd>
              <span className="proof-value">
                {give(f.give.amount)} → {tokenAmount(f.get.amount, dec)} {sym} · until{" "}
                {clock(f.deadline_ms)}
                {offer && (
                  <span className="muted small">
                    {" "}
                    · {Number(offer.rate_num) / Number(offer.rate_den)} {offer.symbol} per {sym},
                    the solver's fixed rate; the difference is its margin
                  </span>
                )}
              </span>
              <span
                className={
                  failed
                    ? "pill caution"
                    : stage === "funded"
                      ? "pill success"
                      : "pill caution proof-pending"
                }
              >
                {stage ? STAGE[stage] : ""}
              </span>
            </dd>
          </div>
        )}
      </dl>

      {(!f || failed) && (
        <div className="row">
          {v.offers.length > 1 && (
            <label className="field">
              <span>Pay with</span>
              <select className="input" value={token} onChange={(e) => setToken(e.target.value)}>
                {v.offers.map((o) => (
                  <option key={o.token} value={o.token}>
                    {o.symbol}
                  </option>
                ))}
              </select>
            </label>
          )}
          {btn(
            f ? "New quote" : `Quote in ${offer?.symbol ?? "another token"}`,
            "quote",
            quote,
            !f,
          )}
        </div>
      )}

      {f && (
        <ol className="intents-steps">
          <Step done={at >= 1}>
            Deposit {give(f.give.amount)} into the verifier{" "}
            {stage === "quoted" &&
              reviewing !== "deposit" &&
              btn("Review the deposit", "deposit", () => setReviewing("deposit"), true)}
            {/* First-use review (Nov 7, finding 79): the deposit moves money, so it is reviewed
                like every other wallet request. */}
            {stage === "quoted" && reviewing === "deposit" && (
              // biome-ignore lint/a11y/useSemanticElements: phrasing context (inside a list item's sentence); a fieldset isn't allowed here
              <span className="companion-review" role="group" aria-label="Review: deposit">
                <dl className="facts">
                  <div className="companion-effect">
                    <dt>Token contract</dt>
                    <dd className="mono wrap">{f.give.token}</dd>
                  </div>
                  <div className="companion-effect">
                    <dt>Method</dt>
                    <dd className="mono">ft_transfer_call</dd>
                  </div>
                  <div className="companion-effect">
                    <dt>Amount</dt>
                    <dd>{give(f.give.amount)}</dd>
                  </div>
                  <div className="companion-effect">
                    <dt>To</dt>
                    <dd className="mono wrap">{v.verifier} (credited to your account inside it)</dd>
                  </div>
                  <div className="companion-effect">
                    <dt>Attached</dt>
                    <dd>1 yoctoNEAR (a confirmation, not a payment)</dd>
                  </div>
                </dl>
                {btn("Ask my wallet for exactly this", "deposit", deposit, true)}
              </span>
            )}
          </Step>
          {/* First-use review (Nov 7, finding 78): registering the key is its own step. */}
          <Step done={at >= 2 || (stage === "deposited" && !needsKey && signed !== null)}>
            Register my signing key with the verifier (first time only){" "}
            {stage === "deposited" &&
              needsKey &&
              btn("Register my signing key", "register", register, true)}
          </Step>
          <Step done={at >= 2}>
            Sign the swap with my wallet{" "}
            {stage === "deposited" && !needsKey && btn("Sign with my wallet", "sign", sign, true)}
          </Step>
          <Step done={at >= 3}>
            Withdraw {tokenAmount(f.get.amount, dec)} {sym} to my account{" "}
            {stage === "swapped" &&
              btn("Withdraw", "withdraw", () => withdraw(f.get.token, f.get.inside), true)}
          </Step>
          <Step done={at >= 4}>
            Fund escrow with the {sym}: the <strong>Fund escrow</strong> button at the top of this
            page · confirmed by the business contract
          </Step>
        </ol>
      )}

      {f && (stage === "expired" || stage === "refused") && BigInt(f.give.inside) > 0n && (
        <div className="row">
          {btn(`Withdraw ${give(f.give.inside)} back`, "withdraw", () =>
            withdraw(f.give.token, f.give.inside),
          )}
        </div>
      )}
      {stage === "unknown" && f && (
        <div className="row">
          {btn(
            "Check again",
            "check",
            () => void run("check", async () => void (await refresh(f.id))),
          )}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
