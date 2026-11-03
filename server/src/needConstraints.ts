// Job 005a1: the one definition of a published request's constraints. New requests are parsed
// strictly; stored ones (including rows written before this boundary existed) are projected onto
// the same allowed fields, so nothing extra (a contact, a payload) can reach a public view or a
// project's source snapshot, and nothing malformed can crash one.
//
// Allowed fields, all optional:
// - family: "class" | "service" | "product" | "software"
// - max_price_cents: a whole number of cents, 0 to MAX_PRICE_CENTS. It is the requester's stated
//   limit, never a product price, a budget or income.
// - online, confirmed_only: true or false
//
// A stored value that doesn't fit is not used: it is dropped and its field named in `unreadable`
// (unrecognized keys appear once, as "other"). An unreadable limit is never treated as satisfied
// or as zero; the views say a limit was stated but can't be read.

import { HttpError } from "./store.ts";

export interface Constraints {
  family?: "class" | "service" | "product" | "software";
  max_price_cents?: number;
  online?: boolean;
  confirmed_only?: boolean;
}

export const FAMILIES = ["class", "service", "product", "software"] as const;
/** $1,000,000: far above any request here, well inside safe integers. */
export const MAX_PRICE_CENTS = 100_000_000;
const KEYS = ["family", "max_price_cents", "online", "confirmed_only"] as const;
type Key = (typeof KEYS)[number];

const okFamily = (v: unknown): v is NonNullable<Constraints["family"]> =>
  typeof v === "string" && (FAMILIES as readonly string[]).includes(v);
const okPrice = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_PRICE_CENTS;
const okBool = (v: unknown): v is boolean => typeof v === "boolean";

/** Strict, for new writes: anything unexpected is a 400 that says what to fix. */
export function parseNeedConstraints(input: unknown): Constraints {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Constraints must be an object", "invalid_constraints");
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(KEYS as readonly string[]).includes(k))
      throw new HttpError(
        400,
        `Unknown constraint "${k.slice(0, 40)}". Allowed: ${KEYS.join(", ")}`,
        "invalid_constraints",
      );
  const out: Constraints = {};
  if (o.family !== undefined) {
    if (!okFamily(o.family))
      throw new HttpError(
        400,
        `family must be one of ${FAMILIES.join(", ")}`,
        "invalid_constraints",
      );
    out.family = o.family;
  }
  if (o.max_price_cents !== undefined) {
    if (!okPrice(o.max_price_cents))
      throw new HttpError(
        400,
        `max_price_cents must be a whole number of cents from 0 to ${MAX_PRICE_CENTS}`,
        "invalid_constraints",
      );
    out.max_price_cents = o.max_price_cents;
  }
  for (const k of ["online", "confirmed_only"] as const)
    if (o[k] !== undefined) {
      if (!okBool(o[k]))
        throw new HttpError(400, `${k} must be true or false`, "invalid_constraints");
      if (o[k] === true) out[k] = true;
    }
  return out;
}

/** Lenient, for stored rows: only allowed, valid fields survive; the rest are named, not shown. */
export function projectNeedConstraints(stored: string): {
  constraints: Constraints;
  unreadable: (Key | "other")[];
} {
  let o: unknown;
  try {
    o = stored.length > 64 * 1024 ? null : JSON.parse(stored);
  } catch {
    o = null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) {
    // Unparseable, or not an object: nothing is usable. "{}" (no constraints) is fine.
    return { constraints: {}, unreadable: stored.trim() === "{}" ? [] : ["other"] };
  }
  const r = o as Record<string, unknown>;
  const constraints: Constraints = {};
  const unreadable: (Key | "other")[] = [];
  if (r.family !== undefined) {
    if (okFamily(r.family)) constraints.family = r.family;
    else unreadable.push("family");
  }
  if (r.max_price_cents !== undefined) {
    if (okPrice(r.max_price_cents)) constraints.max_price_cents = r.max_price_cents;
    else unreadable.push("max_price_cents");
  }
  for (const k of ["online", "confirmed_only"] as const)
    if (r[k] !== undefined) {
      if (!okBool(r[k])) unreadable.push(k);
      else if (r[k] === true) constraints[k] = true;
    }
  if (Object.keys(r).some((k) => !(KEYS as readonly string[]).includes(k)))
    unreadable.push("other");
  return { constraints, unreadable };
}
