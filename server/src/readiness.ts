// Readiness evidence for a Gated close (Closing Ledger): a deterministic, versioned checklist
// bound to one deal version, its digest, the generation it closes from, the inputs it was
// computed from, and an expiry, signed with this server's readiness key. The buyer sees it
// before accepting. It is Everstreet's statement about its own state, not a chain fact; the
// signature shows it wasn't changed after issue and which key issued it, nothing more.

import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";
import { canonicalJson } from "./artifacts.ts";
import { base58Encode } from "./customerWriter.ts";

export interface ReadinessItem {
  key: "runtime" | "seller_admin" | "queued_work";
  label: string;
  ok: boolean;
  value: string;
}

export interface ReadinessInput {
  deal: { seq: string; version: number; digest: string };
  generation: number;
  control_seq: string;
  runtime: { eligible: boolean; reasons: string[] };
  seller_open_requests: number;
  inventory: Record<string, number>;
  now_ms: number;
}

export interface SignedReadiness {
  format: "everstreet.readiness";
  version: 1;
  deal: { seq: string; version: number; digest: string };
  generation: number;
  items: ReadinessItem[];
  input_digest: string;
  issued_at_ms: string;
  valid_until_ms: string;
  signer: string;
  signature: string;
}

const VALID_MS = 15 * 60_000;

export class ReadinessSigner {
  private readonly key: KeyObject;
  readonly publicKey: string;
  constructor(key?: { privateKey: KeyObject; publicKey: KeyObject }) {
    const k = key ?? generateKeyPairSync("ed25519");
    this.key = k.privateKey;
    const raw = k.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    this.publicKey = `ed25519:${base58Encode(raw)}`;
  }

  /** The checklist for this exact deal state; deterministic for the same inputs and time. */
  issue(input: ReadinessInput): SignedReadiness {
    const inv = input.inventory;
    const queuedOpen =
      (inv.reservations_pending ?? 0) + (inv.unresolved ?? 0) + (inv.settlements_pending ?? 0);
    const items: ReadinessItem[] = [
      {
        key: "runtime",
        label: "Runtime",
        ok: input.runtime.eligible,
        value: input.runtime.eligible ? "Healthy" : input.runtime.reasons.join("; ") || "Not ready",
      },
      {
        key: "seller_admin",
        label: "Seller administration",
        ok: input.seller_open_requests === 0,
        value:
          input.seller_open_requests === 0
            ? "Frozen"
            : `${input.seller_open_requests} open seller ${input.seller_open_requests === 1 ? "request" : "requests"}`,
      },
      {
        key: "queued_work",
        label: "Queued work",
        ok: queuedOpen === 0,
        value: queuedOpen === 0 ? "Safe to replay" : `${queuedOpen} not yet decided`,
      },
    ];
    const input_digest = createHash("sha256")
      .update(
        canonicalJson({
          control_seq: input.control_seq,
          inventory: inv,
          runtime: input.runtime,
          seller_open_requests: input.seller_open_requests,
        }),
      )
      .digest("hex");
    const body = {
      format: "everstreet.readiness" as const,
      version: 1 as const,
      deal: input.deal,
      generation: input.generation,
      items,
      input_digest,
      issued_at_ms: String(input.now_ms),
      valid_until_ms: String(input.now_ms + VALID_MS),
      signer: this.publicKey,
    };
    const signature = sign(null, Buffer.from(canonicalJson(body)), this.key).toString("base64");
    return { ...body, signature };
  }
}

/** Checks a checklist's signature against the key it names (who issued it, unchanged since). */
export function readinessSignatureOk(r: SignedReadiness, publicKey: KeyObject): boolean {
  const { signature, ...body } = r;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(body)),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** Whether it still applies: the same deal version and digest, the same generation, unexpired. */
export function readinessApplies(
  r: SignedReadiness,
  deal: { seq: string; version: number; digest: string },
  generation: number,
  nowMs: number,
): boolean {
  return (
    r.deal.seq === deal.seq &&
    r.deal.version === deal.version &&
    r.deal.digest === deal.digest &&
    r.generation === generation &&
    BigInt(r.valid_until_ms) > BigInt(nowMs)
  );
}
