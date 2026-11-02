// Signed operator commands. An operator (person or worker) signs one command per action with a
// key on its NEAR account; OpenSeat verifies the signature, that the key belongs to the account,
// and that the business contract authorizes the account for the capability in the generation
// the command names (docs/AUTHORITY.md, "Authority generation").

import { publicKeyOf, signBytes, verifyBytes } from "./keys.ts";

export const CAPABILITIES = ["fulfillment", "support", "release"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Which capability each operator action needs. */
export const ACTION_CAPABILITY = {
  promote_waitlist: "fulfillment",
  set_capacity: "support",
  publish_release: "release",
} as const satisfies Record<string, Capability>;
export type OperatorAction = keyof typeof ACTION_CAPABILITY;

export interface OperatorCommand {
  /** The business contract account the command is for (domain binding). */
  business: string;
  account_id: string;
  public_key: string;
  action: OperatorAction;
  args: Record<string, unknown>;
  /** Unique per command; a replay returns the first outcome and runs nothing. */
  op_id: string;
  /** The authority generation the signer believes is current. */
  generation: number;
  /** UTC instant, ISO 8601. */
  expires_at: string;
}

export interface SignedCommand {
  command: OperatorCommand;
  signature: string;
}

const DOMAIN = "openseat-operator/v1\n";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function commandBytes(command: OperatorCommand): Uint8Array {
  return new TextEncoder().encode(DOMAIN + stable(command));
}

export interface OperatorIdentity {
  accountId: string;
  secretKey: string;
}

export function signCommand(
  identity: OperatorIdentity,
  fields: Omit<OperatorCommand, "account_id" | "public_key" | "expires_at"> & {
    expires_at?: string;
  },
): SignedCommand {
  const command: OperatorCommand = {
    ...fields,
    account_id: identity.accountId,
    public_key: publicKeyOf(identity.secretKey),
    expires_at: fields.expires_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  return { command, signature: signBytes(identity.secretKey, commandBytes(command)) };
}

export function signatureValid(signed: SignedCommand): boolean {
  return verifyBytes(signed.command.public_key, commandBytes(signed.command), signed.signature);
}
