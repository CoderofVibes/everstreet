// The business-v3 testnet rehearsal record format (scripts/lib/rehearsal/evidence.ts writes it)
// and its OFFLINE integrity check: the canonical digests match and no key or token material is
// present. Pure: no network, no database. Used by the offline verifier script and by the public
// example (examples.ts), which serves nothing from a record that fails this check.

import { canonical, sha256 } from "./handoverVerify.ts";

export const EVIDENCE_FORMAT = "everstreet-v3-rehearsal";
export const EVIDENCE_VERSION = 1;
export const SECRETISH = /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}|evs_agent_|"private_key"|"secret"/;

// biome-ignore lint/suspicious/noExplicitAny: a parsed record, read field by field
type Json = Record<string, any>;

/** Offline integrity check of a rehearsal record: digests and the absence of secret material. */
export function verifyRehearsal(raw: string) {
  const problems: string[] = [];
  let r: Json;
  try {
    r = JSON.parse(raw) as Json;
  } catch {
    return { ok: false, problems: ["not JSON"] };
  }
  if (r.format !== EVIDENCE_FORMAT || r.version !== EVIDENCE_VERSION)
    problems.push("unknown format");
  for (const k of ["header", "steps", "checkpoints", "outcome"]) {
    if (!(k in r)) problems.push(`missing ${k}`);
    else if (r.digests?.sections?.[k] !== sha256(canonical(r[k])))
      problems.push(`${k} digest differs`);
  }
  if (r.digests?.record !== sha256(canonical(r.digests?.sections ?? {})))
    problems.push("record digest differs");
  if (SECRETISH.test(raw)) problems.push("contains key or token material");
  return { ok: problems.length === 0, problems };
}
