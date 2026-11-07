// One owner request to a companion contract (external asset, supplier allowance): Everstreet
// prepares the exact call, this browser re-derives it from what the companions showed before the
// wallet sees it, the person's own wallet sends it, and its own transaction decides the result.
// A move of the external role stays "pending" until final on the other chain.

import { useState } from "react";
import {
  type CompanionAction,
  type CompanionKind,
  type CompanionPrepared,
  type CompanionView,
  companionHttp,
  SaleError,
} from "../saleApi.ts";
import { useSession } from "../session.tsx";

/** What this browser expects the call to be, from the companions' own view; null if it doesn't match. */
export function expectedCompanionCall(
  p: CompanionPrepared,
  v: CompanionView,
  input: Record<string, unknown>,
): string | null {
  const c = p.call;
  const args = c.args as Record<string, unknown>;
  if (p.kind === "feed_move") {
    const a = v.asset;
    if (!a) return "no external asset";
    if (c.receiverId !== a.account || c.methodName !== "request" || c.deposit !== "1")
      return "not the companion's request";
    const action = args.action as { kind?: string; to?: string; from_generation?: number };
    const to = a.addresses.find((x) => x.generation === v.control.generation)?.address;
    if (action?.kind !== "set_controller") return "not a controller move";
    // The companion derives the destination itself; the review must name your own address.
    if (action.to !== undefined) return "it names a destination";
    const reviewed = (p.review as { to_address?: string }).to_address;
    if (!to || reviewed?.toLowerCase() !== to.toLowerCase()) return "not to your address";
    if (action.from_generation !== a.controller_generation)
      return "not from the current controller";
    return null;
  }
  const al = v.allowance;
  if (!al) return "no allowance";
  if (c.receiverId !== al.account || c.deposit !== "0") return "not the allowance's request";
  if (p.kind === "allowance_grant") {
    const g = al.grant;
    if (c.methodName !== "grant" || !g) return "not a grant";
    for (const k of ["agent", "per_payment", "per_period", "period_ms", "review_above"] as const)
      if (String(args[k]) !== String(g[k])) return `the ${k} changed`;
    if (JSON.stringify(args.suppliers) !== JSON.stringify(g.suppliers))
      return "the suppliers changed";
    return null;
  }
  const method = p.kind === "allowance_reject" ? "reject" : "approve";
  if (c.methodName !== method || args.invoice !== input.invoice) return "not this invoice";
  return null;
}

const STATE_WORD: Record<CompanionAction["state"], string> = {
  prepared: "Prepared",
  refused: "Refused",
  confirmed: "Done",
  external_pending: "Pending",
  external_final: "Final",
  external_failed: "Failed on the other chain",
  unknown: "Not shown yet",
};

export function CompanionRequest({
  businessId,
  view,
  kind,
  label,
  input = {},
  onDone,
}: {
  businessId: string;
  view: CompanionView;
  kind: CompanionKind;
  label: string;
  input?: Record<string, unknown>;
  onDone: () => void;
}) {
  const { walletBoundary } = useSession();
  const [p, setP] = useState<CompanionPrepared | null>(null);
  const [busy, setBusy] = useState<"preparing" | "wallet" | "checking" | null>(null);
  const [result, setResult] = useState<CompanionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prepare = async () => {
    setError(null);
    setBusy("preparing");
    try {
      const x = await companionHttp.prepare(businessId, kind, input);
      const problem = expectedCompanionCall(x, view, input);
      if (problem) throw new Error(`This request doesn't match what you were shown (${problem}).`);
      setP(x);
    } catch (e) {
      setError(
        e instanceof SaleError || e instanceof Error ? e.message : "It couldn't be prepared.",
      );
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    if (!p) return;
    setError(null);
    setBusy("wallet");
    try {
      const wallet = await walletBoundary?.();
      if (!wallet) throw new Error("No wallet is available here.");
      const out = await wallet.send(p.call);
      if (!out?.txHash) throw new Error("The wallet didn't return a transaction.");
      setBusy("checking");
      const r = await companionHttp.sent(p.id, out.txHash);
      setResult(r);
      setP(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet request didn't complete.");
    } finally {
      setBusy(null);
    }
  };
  if (result)
    return (
      <span
        className={
          result.state === "refused" || result.state === "external_failed"
            ? "pill caution"
            : result.state === "external_pending"
              ? "pill caution proof-pending"
              : "pill success"
        }
      >
        {STATE_WORD[result.state]}
        {result.state === "refused" && result.result?.code ? ` · ${result.result.code}` : ""}
      </span>
    );
  return (
    <span className="companion-request">
      {!p && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy !== null}
          onClick={() => void prepare()}
        >
          {busy === "preparing" ? "Preparing…" : label}
        </button>
      )}
      {p && (
        // biome-ignore lint/a11y/useSemanticElements: phrasing context (inside a list item's sentence); a fieldset isn't allowed here
        <span className="companion-review" role="group" aria-label={`Review: ${label}`}>
          <dl className="facts">
            <div className="companion-effect">
              <dt>Contract</dt>
              <dd className="mono wrap">{p.call.receiverId}</dd>
            </div>
            <div className="companion-effect">
              <dt>Method</dt>
              <dd className="mono">{p.call.methodName}</dd>
            </div>
            {Array.isArray(p.review.effects) &&
              (p.review.effects as string[]).map((e) => (
                <div key={e} className="companion-effect">
                  <dt>Effect</dt>
                  <dd>{e}</dd>
                </div>
              ))}
          </dl>
          <details>
            <summary>Exact arguments</summary>
            <pre className="mono wrap companion-args">{JSON.stringify(p.call.args, null, 2)}</pre>
          </details>
          <span className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void send()}
            >
              {busy === "wallet"
                ? "Waiting for your wallet…"
                : busy === "checking"
                  ? "Checking its transaction…"
                  : "Ask my wallet for exactly this"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() => setP(null)}
            >
              Not now
            </button>
          </span>
        </span>
      )}
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}
