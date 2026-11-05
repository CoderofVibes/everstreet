// Job 003w-e2 (§9.4–9.6), corrected by 003wea: "Use this product on this device", the second of the
// three separate acts. Both enrolling AND revoking go through review: the exact wallet request
// (acting account, contract, plan, slot, deposit, gas) with plain consequences first, then an
// explicit "ask my wallet" for exactly that request; a request that changed meanwhile is shown
// again, never sent. Readiness comes only from a fresh contract readback. Nothing private leaves
// this browser.
//
// Lifetime (Astra's DeviceKeyReview / 003wea): each offer view owns one controller and one store
// connection (deviceView); an offer, account or unmount change disposes it (closing a connection
// that opens late), clears any request under review, busy and error state, and withdraws the
// authorizer. Late answers to a disposed view are dropped.

import { useEffect, useRef, useState } from "react";
import type { CustomerAuthorizer } from "../customerAuthorizer.ts";
import {
  DeviceKeyError,
  type DeviceKeyRecord,
  type DeviceKeys,
  deviceView,
  type Readiness,
  type RevokeObservation,
  type RevokeReview,
  readKeys,
} from "../deviceKey.ts";
import { useSession } from "../session.tsx";
import type { WalletFunctionCall } from "../wallet.ts";

const tgas = (gas: string) => `${(Number(BigInt(gas) / 1_000_000_000n) / 1000).toString()} Tgas`;

/** The exact request, in readable terms first; the raw call underneath. */
export function RequestFields({
  call,
  account,
}: {
  call: WalletFunctionCall;
  account?: string | null;
}) {
  const a = call.args;
  const install = call.methodName === "install_key";
  return (
    <>
      <dl className="use-terms">
        {account && (
          <>
            <dt>Your account (approves and pays)</dt>
            <dd className="mono">{account}</dd>
          </>
        )}
        <dt>Business contract</dt>
        <dd className="mono">{call.receiverId}</dd>
        <dt>What it does</dt>
        <dd>
          {install
            ? `Enrolls this device's key in slot ${a.slot}`
            : call.methodName === "revoke_key_guarded"
              ? `Revokes the key in slot ${a.slot}, only if it is still the key below; if the slot holds another key by then, the contract refuses and nothing changes`
              : call.methodName === "revoke_key"
                ? `Revokes the key in slot ${a.slot}`
                : call.methodName}
        </dd>
        {call.methodName === "revoke_key_guarded" && (
          <>
            <dt>The key it revokes</dt>
            <dd className="mono">{String(a.pk)}</dd>
            <dt>Registration and key epoch</dt>
            <dd className="mono">
              {String(a.reg_id)} · {String(a.epoch)}
            </dd>
          </>
        )}
        {a.plan_id !== undefined && (
          <>
            <dt>Plan</dt>
            <dd className="mono">{String(a.plan_id)}</dd>
          </>
        )}
        {a.slot !== undefined && (
          <>
            <dt>Key slot</dt>
            <dd className="mono">{String(a.slot)}</dd>
          </>
        )}
        {install && (
          <>
            <dt>This device's public key</dt>
            <dd className="mono">{String(a.pk)}</dd>
            <dt>Limits</dt>
            <dd>
              Holds of at most {String(a.max_hold_units)} use; at most {String(a.max_units_per_day)}{" "}
              uses a day
            </dd>
          </>
        )}
        <dt>Deposit</dt>
        <dd className="mono">{call.deposit} yoctoNEAR (the contract requires exactly 1)</dd>
        <dt>Gas</dt>
        <dd className="mono">up to {tgas(call.gas)}</dd>
      </dl>
      <details>
        <summary>The exact request</summary>
        <p className="mono">
          {call.methodName} {JSON.stringify(call.args)}
        </p>
        <dl className="use-terms">
          {Object.entries(call.args).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt className="mono">{k}</dt>
              <dd className="mono">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

const WORDS: Record<Readiness["kind"], string> = {
  ready: "Ready: the contract shows this device's key enrolled. You still approve each use.",
  pending:
    "This device has a key waiting to be enrolled. The contract doesn't show it yet; you can ask your wallet again with the same key.",
  revoked: "This device's key was revoked.",
  elsewhere:
    "This device has no key for this product. Other keys are enrolled for your account (another device, or this browser's storage was cleared).",
  none: "This device has no key for this product yet.",
  no_entitlement:
    "You have no units for this product yet, so there is nothing to enroll a device for. Buying units comes first.",
};

/** What revoking means, in plain words (lib.rs revoke_key_guarded, the same effect as revoke_key). */
export const REVOKE_CONSEQUENCE =
  "The key stops authorizing new requests at once, and a reservation it opened stops serving now. Uses you already signed can still be settled until their settlement deadline, so nothing you approved is lost.";

type Outcome = {
  kind: string;
  message?: string;
  call?: WalletFunctionCall;
  observed?: RevokeObservation;
  thisDevice?: boolean;
  review?: RevokeReview;
};

type Review =
  | { kind: "enroll"; call: WalletFunctionCall }
  | {
      kind: "revoke";
      call: WalletFunctionCall;
      slot: number;
      thisDevice: boolean;
      observed?: RevokeObservation;
      /** The immutable review this confirmation is for (call + observed key). */
      rr: RevokeReview;
    };

export function DeviceKeyPanel({
  offerId,
  onAuthorizer,
  refresh = 0,
  onReadiness,
}: {
  offerId: string;
  onAuthorizer: (a: CustomerAuthorizer | null) => void;
  /**
   * Changes when another part of the page freshly read a change in this customer's registration
   * or units (Astra's PurchaseBrowserReview 1): the panel re-reads the contract itself, keeping
   * any review in progress (it never trusts the other reading).
   */
  refresh?: number;
  /** What the contract last showed about this device (null while unknown or on a failed read). */
  onReadiness?: (r: Readiness | null) => void;
}) {
  const { account, walletBoundary, wallet } = useSession();
  const keys = useRef<DeviceKeys | null>(null);
  const report = useRef(onAuthorizer);
  report.current = onAuthorizer;
  const told = useRef(onReadiness);
  told.current = onReadiness;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [record, setRecord] = useState<DeviceKeyRecord | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [perDay, setPerDay] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Only the newest reading is applied: an older one answering late never overwrites it.
  const reading = useRef(0);
  const check = async (k: DeviceKeys | null = keys.current) => {
    if (!k || k.retired) return;
    const mine = ++reading.current;
    setProblem(null);
    try {
      const s = await k.status(offerId);
      if (k.retired || mine !== reading.current) return; // a view that moved on, or a newer read
      setRecord(s.record);
      setReadiness(s.readiness);
      told.current?.(s.readiness);
      report.current(s.readiness.kind === "ready" ? k.authorizer(offerId, s.readiness) : null);
    } catch (e) {
      if (k.retired || mine !== reading.current) return;
      setProblem((e as Error).message);
      told.current?.(null);
      report.current(null);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read only when the signal changes
  useEffect(() => {
    if (refresh > 0) void check();
  }, [refresh]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one view per offer and account
  useEffect(() => {
    // A new view: nothing from the previous offer or account is presented or busy.
    setReadiness(null);
    setRecord(null);
    setReview(null);
    setBusy(false);
    setNote(null);
    setProblem(null);
    if (!account) return;
    const view = deviceView({ read: readKeys, wallet: walletBoundary, account });
    keys.current = view.keys;
    void check(view.keys);
    return () => {
      view.dispose();
      if (keys.current === view.keys) keys.current = null;
      told.current?.(null);
      report.current(null);
    };
  }, [offerId, account]);

  const act = async (
    f: (k: DeviceKeys) => Promise<Outcome>,
    next: (out: Outcome) => Review | null = () => null,
  ) => {
    const k = keys.current;
    if (!k) return;
    setBusy(true);
    setNote(null);
    setProblem(null);
    try {
      const out = await f(k);
      if (k.retired || out.kind === "stale") return;
      setReview(next(out));
      if (out.message) setNote(out.message);
      await check(k);
    } catch (e) {
      if (k.retired) return;
      setProblem(
        e instanceof DeviceKeyError ? e.message : ((e as Error).message ?? "That didn't work."),
      );
    } finally {
      if (!k.retired) setBusy(false);
    }
  };
  const reviewRevoke = (slot: number) =>
    act(
      (k) => k.prepareRevoke(offerId, slot),
      (out) =>
        out.kind === "request" && out.call
          ? {
              kind: "revoke",
              call: out.call,
              slot,
              thisDevice: Boolean(out.thisDevice),
              observed: out.observed,
              rr: out as unknown as RevokeReview,
            }
          : null,
    );

  if (!account || !wallet) return null;
  const canEnroll = readiness && readiness.kind !== "ready" && readiness.kind !== "no_entitlement";
  return (
    <section className="card use-device" aria-labelledby="device-title">
      <h3 id="device-title">Use this product on this device</h3>
      <p className="muted">
        This is separate from signing in and from approving a use. Your wallet enrolls a key made on
        this device, so this browser can sign one exact request at a time within the limits below.
        The key's private half can't be copied out of this browser, and it is never sent anywhere.
      </p>
      <p aria-live="polite">{readiness ? WORDS[readiness.kind] : "Checking the contract…"}</p>
      {problem && <p className="error-text">{problem}</p>}
      {note && <p className="muted">{note}</p>}

      {review ? (
        <section className="use-consent" aria-labelledby="device-review-title">
          <h4 id="device-review-title">
            {review.kind === "enroll"
              ? "Review: enroll this device"
              : review.thisDevice
                ? `Review: revoke this device's key (slot ${review.slot})`
                : `Review: revoke the key in slot ${review.slot} (not this device's)`}
          </h4>
          {review.kind === "revoke" && (
            <>
              <p>{REVOKE_CONSEQUENCE}</p>
              {review.observed && (
                <p>
                  The key being revoked: <span className="mono">{review.observed.public_key}</span>{" "}
                  (epoch {review.observed.epoch}). If the key in this slot changes before you
                  approve, this review is shown again and nothing is sent.
                </p>
              )}
            </>
          )}
          <p>Your wallet will ask you to approve exactly this:</p>
          <RequestFields call={review.call} account={account} />
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                review.kind === "enroll"
                  ? act(
                      (k) =>
                        k.enroll(offerId, Number(review.call.args.max_units_per_day), review.call),
                      (out) =>
                        out.kind === "changed" && out.call
                          ? { kind: "enroll", call: out.call }
                          : null,
                    )
                  : act(
                      (k) => k.revoke(offerId, review.slot, review.rr),
                      (out) =>
                        out.kind === "changed" && out.review
                          ? {
                              ...review,
                              call: out.review.call,
                              observed: out.review.observed,
                              thisDevice: out.review.thisDevice,
                              rr: out.review,
                            }
                          : null,
                    )
              }
            >
              {review.kind === "enroll"
                ? "Ask my wallet to enroll exactly this"
                : "Ask my wallet to revoke exactly this"}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Not now
            </button>
          </div>
        </section>
      ) : (
        <>
          {canEnroll && (
            <>
              <label className="field">
                <span>Most uses a day this device may authorize</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={record?.max_units_per_day ?? perDay}
                  disabled={Boolean(record) || busy}
                  onChange={(e) => setPerDay(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  act(
                    (k) => k.prepareEnrollment(offerId, record?.max_units_per_day ?? perDay),
                    (out) =>
                      out.kind === "request" && out.call
                        ? { kind: "enroll", call: out.call }
                        : null,
                  )
                }
              >
                {record ? "Review the request for this device's key" : "Make this device's key"}
              </button>
            </>
          )}
          {readiness?.kind === "ready" && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => reviewRevoke(readiness.slot)}
            >
              Review revoking this device's key (slot {readiness.slot})
            </button>
          )}
          {readiness?.kind === "elsewhere" &&
            readiness.slots.map((slot) => (
              <button
                key={slot}
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => reviewRevoke(slot)}
              >
                Review revoking the key in slot {slot} (for a lost device)
              </button>
            ))}
          {record && readiness?.kind !== "ready" && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() =>
                act(async (k) => {
                  await k.forget(offerId);
                  return { kind: "done" };
                })
              }
            >
              Forget this device's key here (if it was enrolled, its slot stays active until
              revoked)
            </button>
          )}
        </>
      )}
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void check()}>
        Check the contract again
      </button>
    </section>
  );
}
