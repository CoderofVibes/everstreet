// Showcase stage A (docs/design/SHOWCASE_SPEC.md §3): the public example's history is the VERIFIED
// NEAR testnet run of the Direct example (data/evidence/v3-direct-testnet.json, committed). One
// public read builds a NEW object from named fields only (an allowlist, never a filtered copy),
// tags every figure with its own source, and derives the headline figures in code. It never reads
// the database, so no owner's private record can reach it, and it serves nothing from a record
// whose digests don't verify.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyRehearsal } from "./rehearsalRecord.ts";
import { HttpError } from "./store.ts";

// biome-ignore lint/suspicious/noExplicitAny: a verified record, read field by field
type Json = Record<string, any>;

export const DEFAULT_LEDGERLINE_RECORD = join("data", "evidence", "v3-direct-testnet.json");
const EXPLORER = "https://testnet.nearblocks.io/txns/";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const DIGITS = /^\d{1,40}$/;

const str = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);
const int = (v: unknown) => (Number.isSafeInteger(v) ? (v as number) : null);

/**
 * The test token's identity and decimals, from the committed deployment config (the token
 * deployed for the testnet runs; its ft_metadata reads tUSD, 6 decimals). Null if absent: amounts
 * are then shown in exact base units only.
 */
function tokenOfRecord() {
  try {
    const c = JSON.parse(readFileSync(join("config", "testnet.json"), "utf8")) as Json;
    const decimals = int(c.tokenDecimals);
    const symbol = str(c.tokenSymbol, /^[A-Za-z0-9.$_-]{1,16}$/);
    const account = str(c.token, ACCOUNT);
    return decimals !== null && symbol && account
      ? { account, symbol, decimals, source: "config/testnet.json (the deployed test token)" }
      : null;
  } catch {
    return null;
  }
}

/** The public projection of the verified Ledgerline record, or an error if it can't be served. */
export function ledgerlineExample(path = DEFAULT_LEDGERLINE_RECORD) {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new HttpError(404, "The example's record isn't on this server", "example_missing");
  }
  const check = verifyRehearsal(raw);
  if (!check.ok)
    throw new HttpError(
      503,
      "The example's record didn't verify, so it isn't shown",
      "example_unverified",
    );
  const r = JSON.parse(raw) as Json;
  if (r.header?.network !== "testnet" || r.outcome?.completed !== true)
    throw new HttpError(
      503,
      "The example's record isn't a completed testnet run",
      "example_incomplete",
    );
  const accounts = (r.header.accounts ?? {}) as Record<string, unknown>;
  const roleOf = (account: unknown) => {
    for (const [role, a] of Object.entries(accounts))
      if (a === account && ["founder", "buyer", "customer", "operator"].includes(role)) return role;
    return null;
  };
  // Checkpoints: chain views at final finality. A resumed run re-reads some names later, after
  // more has happened; the first of each name is the one taken when its step completed.
  const byName = new Map<string, Json>();
  for (const c of r.checkpoints as Json[])
    if (!byName.has(String(c.name))) byName.set(String(c.name), c);
  const checkpoints = [...byName.values()].map((c) => {
    const e = (c.views?.entitlement ?? null) as Json | null;
    const ctl = (c.views?.control ?? null) as Json | null;
    return {
      name: String(c.name).slice(0, 40),
      at: typeof c.at === "string" ? c.at : null,
      block: str(c.views?.block?.height, DIGITS),
      free: e ? str(e.free, DIGITS) : null,
      consumed: e ? str(e.consumed, DIGITS) : null,
      owner: ctl ? str(ctl.owner, ACCOUNT) : null,
      owner_role: ctl ? roleOf(ctl.owner) : null,
      generation: ctl ? int(ctl.generation) : null,
      source: "near_testnet_final" as const,
    };
  });
  const transactions = (r.steps as Json[])
    .filter((s) => s.kind === "transaction" && s.chain?.hash)
    .map((s) => ({
      step: String(s.step).slice(0, 60),
      role: ["founder", "buyer", "customer"].includes(s.signer?.role) ? s.signer.role : null,
      method: str(s.call?.method, /^[a-z_]{1,40}$/),
      receiver: str(s.call?.receiver, ACCOUNT),
      hash: str(s.chain.hash, HASH),
      explorer: str(s.chain.hash, HASH) ? `${EXPLORER}${s.chain.hash}` : null,
      succeeded: s.chain.succeeded === true,
      source: "near_testnet_tx" as const,
    }));
  const fact = (step: string) => (r.steps as Json[]).filter((s) => s.step === step).at(-1)?.facts;
  const refusals = ["old_owner_denied", "old_owner_write_denied"]
    .map((step) => ({ step, status: int(fact(step)?.status) }))
    .filter((x) => x.status !== null)
    .map((x) => ({ ...x, source: "rehearsal_app_record" as const }));
  const releases = ["release_1", "release_2"]
    .map((step) => ({ step, by: step === "release_2" ? "buyer" : "founder", found: !!fact(step) }))
    .filter((x) => x.found)
    .map(({ step, by }) => ({ step, by, source: "rehearsal_app_record" as const }));
  // Derived headline figures (spec §3.4), each with its inputs and their sources.
  const at = (name: string) => checkpoints.find((c) => c.name === name) ?? null;
  const price = str(fact("offer_1")?.unit_price, DIGITS);
  const bought = at("bought_100")?.free;
  const end = at("after_update");
  const closed = at("closed");
  const start = at("start");
  const mul = (a: string | null | undefined, b: string | null) =>
    a && b ? (BigInt(a) * BigInt(b)).toString() : null;
  const figures = {
    unit_price: {
      value: price,
      unit: "tUSD base units (6 decimals)",
      source: "rehearsal_app_record",
    },
    prepaid: {
      value: mul(bought, price),
      unit: "tUSD base units",
      derived_from: "free at bought_100 (near_testnet_final) × unit price (rehearsal_app_record)",
    },
    earned_by_end: {
      value: mul(end?.consumed, price),
      unit: "tUSD base units",
      derived_from: "consumed at after_update (near_testnet_final) × unit price",
    },
    owed_at_close: { value: closed?.free ?? null, unit: "uses", source: "near_testnet_final" },
    after_next_use: {
      value: at("next_use_under_buyer")?.free ?? null,
      unit: "uses",
      source: "near_testnet_final",
    },
    after_update: { value: end?.free ?? null, unit: "uses", source: "near_testnet_final" },
    control_before: {
      role: start?.owner_role ?? null,
      generation: start?.generation ?? null,
      source: "near_testnet_final",
    },
    control_after: {
      role: closed?.owner_role ?? null,
      generation: closed?.generation ?? null,
      source: "near_testnet_final",
    },
  };
  return {
    example: "ledgerline",
    label: "Example business · its history is a verified NEAR testnet run",
    record: {
      format: String(r.format),
      digest: str(r.digests?.record, /^[0-9a-f]{64}$/),
      commit: str(r.header.commit, /^[0-9a-f]{7,40}$/),
      verified_offline: true,
      reproduce: "npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json",
    },
    network: "testnet",
    token: tokenOfRecord(),
    contract: {
      account: str(r.header.contract?.account, ACCOUNT),
      code_hash: str(r.header.contract?.code_hash_expected, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
    },
    model: {
      source: "stand_in_model",
      note: "AI results in this run came from a labelled stand-in, not an AI provider.",
    },
    figures,
    checkpoints,
    transactions,
    refusals,
    releases,
  };
}

/** The Case Docket: the committed attack-suite results (scripts/attack-suite.ts), public. */
export const DEFAULT_ATTACK_SUITE = "data/evidence/attack-suite.json";
export function attackSuite(path = DEFAULT_ATTACK_SUITE) {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new HttpError(404, "The attack suite's results aren't on this server", "suite_missing");
  }
  const r = JSON.parse(raw) as { format?: string; version?: number };
  if (r.format !== "everstreet.attack-suite" || r.version !== 1)
    throw new HttpError(503, "The attack suite's results aren't in a known format", "suite_format");
  return r;
}
