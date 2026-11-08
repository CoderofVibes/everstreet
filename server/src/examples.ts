// Showcase stage A (docs/design/SHOWCASE_SPEC.md §3): the public example's history is the VERIFIED
// NEAR testnet run of the Direct example (data/evidence/v3-direct-testnet.json, committed). One
// public read builds a NEW object from named fields only (an allowlist, never a filtered copy),
// tags every figure with its own source, and derives the headline figures in code. It never reads
// the database, so no owner's private record can reach it, and it serves nothing from a record
// whose digests don't verify.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyLightClientProof } from "./lightClient.ts";
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
      unit: "TUSD base units (6 decimals)",
      source: "rehearsal_app_record",
    },
    prepaid: {
      value: mul(bought, price),
      unit: "TUSD base units",
      derived_from: "free at bought_100 (near_testnet_final) × unit price (rehearsal_app_record)",
    },
    earned_by_end: {
      value: mul(end?.consumed, price),
      unit: "TUSD base units",
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
    light_client: lightClientOfClose(str(r.header.contract?.account, ACCOUNT)),
    handovers: handoversOf(str(r.header.contract?.account, ACCOUNT)),
  };
}

/** The verified records of every recorded sale of the example business, in order. */
export const DEFAULT_SALE_RECORDS = [
  DEFAULT_LEDGERLINE_RECORD,
  join("data", "evidence", "v3-ext-testnet.json"),
  join("data", "evidence", "v3-s4-testnet.json"),
];
/** A read-only snapshot after all of them (scripts/ledgerline-after-sales.ts). */
export const DEFAULT_AFTER_SALES = join("data", "evidence", "ledgerline-after-sales-testnet.json");

function verifiedRecord(path: string): Json | null {
  try {
    const raw = readFileSync(path, "utf8");
    if (!verifyRehearsal(raw).ok) return null;
    const r = JSON.parse(raw) as Json;
    return r.header?.network === "testnet" && r.outcome?.completed === true ? r : null;
  } catch {
    return null;
  }
}

/** Records that verify, are complete testnet runs and are about this contract. */
function saleRecords(contract: string | null, paths: string[]) {
  return paths
    .map((path) => ({ path: path.replaceAll("\\", "/"), r: verifiedRecord(path) }))
    .filter(
      (x): x is { path: string; r: Json } => !!x.r && x.r.header.contract?.account === contract,
    );
}

/** The business contract's `sale_finalized` event in a closing transaction's receipts. */
function saleFinalized(s: Json, contract: string | null) {
  for (const rc of (s.chain?.receipts ?? []) as Json[]) {
    if (rc.executor !== contract) continue;
    for (const log of (rc.logs ?? []) as string[]) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(log.slice("EVENT_JSON:".length)) as Json;
        const d = e.event === "sale_finalized" ? (e.data as Json[])?.[0] : null;
        if (d) return { buyer: str(d.buyer, ACCOUNT), generation: int(d.generation) };
      } catch {
        // not an event
      }
    }
  }
  return null;
}

/**
 * Each recorded sale of the business, at the moment control changed: the closing transaction, the
 * first read of the new owner after it (that read's block, not the close's), the former owner's
 * first refused call after the close (searched in that record and the later ones: which contract
 * refused, and whether as the call's answer or as a failed transaction), and the customer's unused
 * units at the close when the record read them. Then the snapshot after the last sale. Only
 * records whose digests verify, for this contract; every value comes from a named field.
 */
export function handoversOf(
  contract: string | null,
  paths = DEFAULT_SALE_RECORDS,
  afterPath = DEFAULT_AFTER_SALES,
) {
  const snap = verifiedRecord(afterPath);
  return handoversFrom(
    contract,
    saleRecords(contract, paths),
    snap?.header.contract?.account === contract
      ? { path: afterPath.replaceAll("\\", "/"), r: snap as Json }
      : null,
  );
}

/** The strip from parsed records (handoversOf reads and verifies them first). */
export function handoversFrom(
  contract: string | null,
  records: { path: string; r: Json }[],
  snap: { path: string; r: Json } | null,
) {
  // Every step in recorded order across the records.
  const all = records.flatMap(({ path, r }) => (r.steps as Json[]).map((s) => ({ path, r, s })));
  const txOf = (s: Json) => {
    const hash = str(s.chain?.hash, HASH);
    return { hash, explorer: hash ? `${EXPLORER}${hash}` : null };
  };
  const seenClose = new Set<string>();
  const sales = all.flatMap(({ path, r, s }, i) => {
    if (s.kind !== "transaction" || s.app?.resolution?.result !== "closed") return [];
    if (s.call?.receiver !== contract) return [];
    // One row per close, should two records carry the same closing transaction.
    const closeHash = str(s.chain?.hash, HASH);
    if (closeHash) {
      if (seenClose.has(closeHash)) return [];
      seenClose.add(closeHash);
    }
    const seller = str(s.signer?.account, ACCOUNT);
    const cps = (r.checkpoints as Json[]).filter((c) => c.views?.control);
    // The contract's own event names the buyer and the new generation; the first checkpoint read
    // at that generation is the read after this close (a record may hold several sales).
    const ev = saleFinalized(s, contract);
    const closedAt =
      ev?.generation !== null && ev?.generation !== undefined
        ? cps.findIndex((c) => c.views.control.generation === ev.generation)
        : -1;
    const closed = closedAt >= 0 ? cps[closedAt] : null;
    const before = cps
      .slice(0, Math.max(closedAt, 0))
      .reverse()
      .find((c) => c.views.control.owner === seller);
    const refused = all
      .slice(i + 1)
      .find(
        (x) =>
          x.s.kind === "transaction" &&
          x.s.signer?.account === seller &&
          /E_NOT_OWNER/.test(
            `${x.s.chain?.error ?? ""} ${JSON.stringify(x.s.app?.resolution ?? {})}`,
          ),
      );
    const free = closed?.views?.entitlement ? str(closed.views.entitlement.free, DIGITS) : null;
    return [
      {
        from: { account: seller, generation: int(before?.views?.control?.generation) },
        to: {
          account: ev?.buyer ?? str(closed?.views?.control?.owner, ACCOUNT),
          generation: ev?.generation ?? int(closed?.views?.control?.generation),
        },
        closed: txOf(s),
        // The first final read of the new owner after the close, and its block.
        read_after: closed
          ? {
              owner: str(closed.views.control.owner, ACCOUNT),
              block: str(closed.views.block?.height, DIGITS),
            }
          : null,
        former_owner_refused: refused
          ? {
              method: str(refused.s.call?.method, /^[a-z_]{1,40}$/),
              receiver: str(refused.s.call?.receiver, ACCOUNT),
              code: "E_NOT_OWNER",
              // Refused as the call's answer (the transaction itself succeeded) or as a failure.
              how: refused.s.chain?.succeeded === true ? ("answer" as const) : ("failed" as const),
              // Whether the refusing contract asked this business during that call.
              asked_business: ((refused.s.chain?.receipts ?? []) as Json[]).some(
                (rc) => rc.executor === contract && rc.executor !== refused.s.call?.receiver,
              ),
              ...txOf(refused.s),
              record: refused.path,
            }
          : null,
        customer_unused_at_close: free,
        record: path,
      },
    ];
  });
  const view = (snap?.r.checkpoints as Json[] | undefined)?.at(-1)?.views;
  const after =
    snap && view
      ? {
          block: str(view.block?.height, DIGITS),
          owner: str(view.control?.owner, ACCOUNT),
          generation: int(view.control?.generation),
          customer: {
            account: str(snap.r.header.accounts?.customer, ACCOUNT),
            unused: str(view.entitlement?.free, DIGITS),
            used: str(view.entitlement?.consumed, DIGITS),
            bought: str(view.entitlement?.purchased, DIGITS),
          },
          record: snap.path,
        }
      : null;
  return { sales, after };
}

/** The committed light-client proof of the recorded close (scripts/verify-light-client.ts). */
export const DEFAULT_LIGHT_CLIENT = "data/evidence/light-client-close.json";

/**
 * The recorded close's light-client proof, checked now: both the closing transaction and the
 * business contract's closing receipt prove against the stored head, and the receipt is this
 * contract returning "closed". Null when absent or when it doesn't check (never shown as proved).
 */
export function lightClientOfClose(contract: string | null, path = DEFAULT_LIGHT_CLIENT) {
  let ev: Json;
  try {
    ev = JSON.parse(readFileSync(path, "utf8")) as Json;
  } catch {
    return null;
  }
  if (ev.format !== "everstreet.light-client-close" || ev.contract !== contract) return null;
  try {
    const a = verifyLightClientProof(ev.transaction.proof, ev.head);
    const b = verifyLightClientProof(ev.receipt.proof, ev.head);
    const o = ev.receipt.proof.outcome_proof.outcome;
    const closed =
      o.executor_id === contract &&
      o.status?.SuccessValue === Buffer.from('"closed"').toString("base64") &&
      (o.logs as string[]).some((l) => l.includes('"event":"sale_finalized"'));
    if (!a.ok || !b.ok || !closed) return null;
    return {
      transaction: String(ev.transaction.hash),
      receipt: String(ev.receipt.id),
      block: b.block,
      head: { hash: String(ev.head.hash), height: Number(ev.head.height) },
      reproduce: `npx tsx scripts/verify-light-client.ts ${path} --live`,
      source: "light_client_proof" as const,
    };
  } catch {
    return null;
  }
}

/** The Case Docket: the committed attack-suite results (scripts/attack-suite.ts), public. */
export const DEFAULT_ATTACK_SUITE = "data/evidence/attack-suite.json";
/** The cases that also ran on NEAR testnet (scripts/attack-pairs.ts), when that file is here. */
export const DEFAULT_ATTACK_PAIRS = "data/evidence/attack-pairs-testnet.json";
export function attackSuite(path = DEFAULT_ATTACK_SUITE, pairsPath = DEFAULT_ATTACK_PAIRS) {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new HttpError(404, "The attack suite's results aren't on this server", "suite_missing");
  }
  const r = JSON.parse(raw) as { format?: string; version?: number };
  if (r.format !== "everstreet.attack-suite" || r.version !== 1)
    throw new HttpError(503, "The attack suite's results aren't in a known format", "suite_format");
  let pairs: Json[] = [];
  try {
    const t = JSON.parse(readFileSync(pairsPath, "utf8")) as Json;
    if (t.format === "everstreet.attack-pairs-testnet" && Array.isArray(t.pairs)) pairs = t.pairs;
  } catch {}
  const cases = ((r as Json).cases as Json[]).map((c) => {
    const p = pairs.find((x) => x.case === c.name);
    if (!p) return c;
    const link = p.attack.tx?.explorer;
    return {
      ...c,
      testnet: {
        refusal: String(p.attack.refusal),
        what: String(p.attack.what),
        explorer:
          typeof link === "string" && link.startsWith("https://testnet.nearblocks.io/txns/")
            ? link
            : null,
        clean_explorer:
          typeof p.clean.tx?.explorer === "string" &&
          p.clean.tx.explorer.startsWith("https://testnet.nearblocks.io/txns/")
            ? p.clean.tx.explorer
            : null,
      },
    };
  });
  return { ...r, cases };
}
