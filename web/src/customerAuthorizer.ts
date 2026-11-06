// Job 003q: who authorizes a customer's use. The app ships NO signing code and NO key: in
// production this is unavailable until a real wallet integration is separately authorized. A
// page may provide an authorizer on `window.__everstreetAuthorizer` (the disposable local
// preview injects one that is unmistakably synthetic). Whatever it is, the workspace checks the
// envelope itself first (customerEnvelope.ts) and only then asks it to sign the two digests.

export interface CustomerAuthorizer {
  /** Plain words for the customer: who is signing, e.g. "Preview only: synthetic test key". */
  readonly label: string;
  /** True when this is a test/preview authorizer (shown prominently). */
  readonly synthetic: boolean;
  /** Job 003w-e2: the contract key slot this authorizer's key is enrolled in (default 0). */
  readonly slot?: number;
  /** This authorizer's public key (hex), so the page can check the envelope names it. */
  publicKey(): Promise<string | null>;
  sign(input: {
    hold_message_hex: string;
    use_message_hex: string;
  }): Promise<{ hold_signature: string; use_signature: string }>;
}

const HEX64 = /^[0-9a-f]{128}$/;

/** The page's authorizer if it provides a well-formed one; otherwise null (unavailable). */
export function pageAuthorizer(): CustomerAuthorizer | null {
  const a = (globalThis as { __everstreetAuthorizer?: unknown }).__everstreetAuthorizer as
    | Partial<CustomerAuthorizer>
    | undefined;
  if (
    !a ||
    typeof a.label !== "string" ||
    typeof a.synthetic !== "boolean" ||
    typeof a.publicKey !== "function" ||
    typeof a.sign !== "function"
  )
    return null;
  const signer = a as CustomerAuthorizer;
  return {
    label: signer.label,
    synthetic: signer.synthetic,
    // Review #65: the slot travels with the key, so a request names the key that will sign it.
    ...(Number.isInteger(signer.slot) ? { slot: signer.slot } : {}),
    publicKey: () => signer.publicKey(),
    // Signatures are checked for form before they are sent; the server verifies them exactly.
    sign: async (input) => {
      const s = await signer.sign(input);
      if (!HEX64.test(s?.hold_signature ?? "") || !HEX64.test(s?.use_signature ?? ""))
        throw new Error("The authorizer's answer wasn't a pair of signatures.");
      return { hold_signature: s.hold_signature, use_signature: s.use_signature };
    },
  };
}

export const AUTHORIZATION_UNAVAILABLE =
  "Authorizing uses isn't connected on this server yet: there is no wallet here, and nothing is signed for you. You can still review exactly what a use would be.";
