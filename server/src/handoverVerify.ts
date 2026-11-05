// Job 003x: the portable handover record's format and its OFFLINE verifier (pure: no network, no
// database, no scripts, no URLs fetched). Used by the server route and by
// scripts/verify-handover-record.ts on any computer.
//
// What verification can establish: these bytes are exactly what the record's digests describe,
// the identities inside are mutually consistent, and every mandatory section is present. What it
// can't: who produced the file (it isn't signed), that the business is still controlled as it
// was then, or any legal title. Live claims are listed as needing a fresh observation.

import { createHash } from "node:crypto";

export const RECORD_FORMAT = "everstreet-handover-record";
export const RECORD_VERSION = 1;
export const RECORD_MAX_BYTES = 1_048_576;
export const SECTIONS = [
  "business",
  "control",
  "receipt",
  "releases",
  "offers",
  "obligations",
  "external_transfers",
  "omissions",
] as const;
export type Section = (typeof SECTIONS)[number];

/** Canonical JSON: sorted keys, no whitespace; arrays keep their order. */
export const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function digestsFor(body: Record<Section, unknown>) {
  const sections = Object.fromEntries(
    SECTIONS.map((s) => [s, sha256(canonical(body[s]))]),
  ) as Record<Section, string>;
  return { sections, record: sha256(canonical(SECTIONS.map((s) => [s, sections[s]]))) };
}

export interface Verification {
  ok: boolean;
  format: { supported: boolean; detail: string };
  matched: string[];
  mismatched: string[];
  missing: string[];
  inconsistent: string[];
  needs_fresh_observation: string[];
  cannot_establish: string[];
}

const CANNOT = [
  "Who produced this file: it isn't signed, so the digests show the bytes are unchanged, not their origin.",
  "That control is still as recorded: read the contract now.",
  "Legal title to code, accounts or intellectual property.",
  "That any product is free of errors.",
];

export function verifyRecord(text: string): Verification {
  const v: Verification = {
    ok: false,
    format: { supported: false, detail: "" },
    matched: [],
    mismatched: [],
    missing: [],
    inconsistent: [],
    needs_fresh_observation: [],
    cannot_establish: CANNOT,
  };
  if (Buffer.byteLength(text, "utf8") > RECORD_MAX_BYTES) {
    v.format.detail = `Larger than ${RECORD_MAX_BYTES} bytes: not read.`;
    return v;
  }
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text) as Record<string, unknown>;
  } catch {
    v.format.detail = "Not valid JSON.";
    return v;
  }
  if (!r || typeof r !== "object" || Array.isArray(r) || r.format !== RECORD_FORMAT) {
    v.format.detail = "Not an Everstreet handover record.";
    return v;
  }
  if (r.version !== RECORD_VERSION) {
    v.format.detail = `Version ${String(r.version)} isn't supported (this verifier reads version ${RECORD_VERSION}).`;
    return v;
  }
  v.format = { supported: true, detail: `Format ${RECORD_FORMAT}, version ${RECORD_VERSION}.` };
  const body = (r.body ?? {}) as Record<string, unknown>;
  const claimed = (r.digests ?? {}) as { sections?: Record<string, string>; record?: string };
  for (const s of SECTIONS) {
    if (!(s in body)) {
      v.missing.push(`Mandatory section "${s}" is missing.`);
      continue;
    }
    const got = sha256(canonical(body[s]));
    if (claimed.sections?.[s] === got) v.matched.push(`Section "${s}" matches its digest.`);
    else
      v.mismatched.push(
        `Section "${s}" doesn't match its digest: these bytes were changed or the digest is wrong.`,
      );
  }
  if (v.missing.length === 0) {
    const rec = digestsFor(body as Record<Section, unknown>).record;
    if (claimed.record === rec) v.matched.push("The record digest matches the section digests.");
    else v.mismatched.push("The record digest doesn't match the sections.");
  }
  // Identity consistency inside the record.
  const business = body.business as
    | { id?: string; contract?: string | null; network?: string }
    | undefined;
  const control = body.control as
    | {
        business_id?: string;
        observed?: {
          account?: string;
          owner?: string;
          generation?: number;
          observed_at?: string;
        } | null;
      }
    | undefined;
  const releases = (body.releases ?? []) as { id?: string }[];
  const offers = (body.offers ?? []) as { release_id?: string; id?: string }[];
  if (business?.id && control?.business_id && business.id !== control.business_id)
    v.inconsistent.push("The control section names another business.");
  if (control?.observed && business?.contract && control.observed.account !== business.contract)
    v.inconsistent.push("The observed contract account isn't the business's contract.");
  const releaseIds = new Set(releases.map((x) => x.id));
  for (const o of offers)
    if (o.release_id && !releaseIds.has(o.release_id))
      v.inconsistent.push(`Offer ${o.id} names a release that isn't in this record.`);
  // Live claims: true when observed, possibly not now.
  if (control?.observed)
    v.needs_fresh_observation.push(
      `Control: ${control.observed.owner} at generation ${control.observed.generation}, observed ${control.observed.observed_at}. Read the contract now to rely on it.`,
    );
  else
    v.needs_fresh_observation.push(
      "Control: no contract observation is included; read the contract.",
    );
  if (offers.length)
    v.needs_fresh_observation.push(
      "Customer offers and obligations: as of the record's time; current entitlements are on the contract.",
    );
  v.ok = v.mismatched.length === 0 && v.missing.length === 0 && v.inconsistent.length === 0;
  return v;
}
