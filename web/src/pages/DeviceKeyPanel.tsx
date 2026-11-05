// Job 003w-e2 (§9.4–9.6): "Use this product on this device", the second of the three separate
// acts. Plain words for what enrolling means; the EXACT wallet request (this device's real key and
// slot) shown before the customer asks the wallet, and re-checked when it is sent; readiness only
// from a fresh contract readback; honest recovery for an interrupted enrollment, lost storage and
// revocation. Nothing private leaves this browser.
//
// Astra's DeviceKeyReview corrections: one store connection per panel, closed on unmount; the
// readback runs on mount, on an explicit check and after an action, never as a render feedback loop;
// a retired panel (sign-out, another account or offer) applies no late answer.

import { useEffect, useRef, useState } from "react";
import type { CustomerAuthorizer } from "../customerAuthorizer.ts";
import {
  DeviceKeyError,
  type DeviceKeyRecord,
  type DeviceKeyStore,
  DeviceKeys,
  type KeysReadback,
  openDeviceKeyStore,
  type Readiness,
} from "../deviceKey.ts";
import { useSession } from "../session.tsx";
import type { WalletFunctionCall } from "../wallet.ts";

async function readKeys(offerId: string): Promise<KeysReadback> {
  const res = await fetch(`/api/customer/offers/${encodeURIComponent(offerId)}/keys`, {
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as KeysReadback & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Couldn't read your keys (${res.status})`);
  return body;
}

export function RequestFields({ call }: { call: WalletFunctionCall }) {
  return (
    <dl className="use-terms">
      <dt>Contract</dt>
      <dd className="mono">{call.receiverId}</dd>
      <dt>Method</dt>
      <dd className="mono">{call.methodName}</dd>
      {Object.entries(call.args).map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd className="mono">{String(v)}</dd>
        </div>
      ))}
      <dt>Deposit</dt>
      <dd className="mono">{call.deposit} yoctoNEAR (the contract requires exactly 1)</dd>
    </dl>
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

export function DeviceKeyPanel({
  offerId,
  onAuthorizer,
}: {
  offerId: string;
  onAuthorizer: (a: CustomerAuthorizer | null) => void;
}) {
  const { account, walletBoundary, wallet } = useSession();
  const keys = useRef<DeviceKeys | null>(null);
  const store = useRef<Promise<DeviceKeyStore> | null>(null);
  const report = useRef(onAuthorizer);
  report.current = onAuthorizer;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [record, setRecord] = useState<DeviceKeyRecord | null>(null);
  const [request, setRequest] = useState<WalletFunctionCall | null>(null);
  const [perDay, setPerDay] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const check = async (k: DeviceKeys | null = keys.current) => {
    if (!k) return;
    setProblem(null);
    try {
      const s = await k.status(offerId);
      if (k.retired) return; // a late answer for a page that has moved on
      setRecord(s.record);
      setReadiness(s.readiness);
      report.current(s.readiness.kind === "ready" ? k.authorizer(offerId, s.readiness) : null);
    } catch (e) {
      if (k.retired) return;
      setProblem((e as Error).message);
      report.current(null);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per offer; then on demand
  useEffect(() => {
    if (!account) return;
    // One controller and one store connection per offer view (closed on unmount or change).
    const k = new DeviceKeys({
      store: () => {
        store.current ??= openDeviceKeyStore();
        return store.current;
      },
      read: readKeys,
      wallet: walletBoundary,
      account,
    });
    keys.current = k;
    void check(k);
    return () => {
      k?.retire();
      report.current(null);
      void store.current?.then((s) => s.close?.()).catch(() => {});
      store.current = null;
    };
  }, [offerId, account]);

  const act = async (
    f: (k: DeviceKeys) => Promise<{ kind: string; message?: string; call?: WalletFunctionCall }>,
  ) => {
    const k = keys.current;
    if (!k) return;
    setBusy(true);
    setNote(null);
    setProblem(null);
    try {
      const out = await f(k);
      if (k.retired || out.kind === "stale") return;
      if (out.kind === "request" || out.kind === "changed") setRequest(out.call ?? null);
      else setRequest(null);
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
      {canEnroll && !request && (
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
              act((k) => k.prepareEnrollment(offerId, record?.max_units_per_day ?? perDay))
            }
          >
            {record ? "Review the request for this device's key" : "Make this device's key"}
          </button>
        </>
      )}
      {canEnroll && request && (
        <>
          <p>Your wallet will ask you to approve exactly this:</p>
          <RequestFields call={request} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              act((k) => k.enroll(offerId, Number(request.args.max_units_per_day), request))
            }
          >
            Ask my wallet to enroll exactly this
          </button>
        </>
      )}
      {readiness?.kind === "ready" && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => act((k) => k.revoke(offerId, readiness.slot))}
        >
          Revoke this device's key (slot {readiness.slot})
        </button>
      )}
      {readiness?.kind === "elsewhere" &&
        readiness.slots.map((slot) => (
          <button
            key={slot}
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => act((k) => k.revoke(offerId, slot))}
          >
            Revoke the key in slot {slot} (for a lost device)
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
          Forget this device's key here (if it was enrolled, its slot stays active until revoked)
        </button>
      )}
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void check()}>
        Check the contract again
      </button>
    </section>
  );
}
