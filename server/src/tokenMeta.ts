// Review evidence and presentation (Astra, Nov 5): readable token amounts. A token's symbol and
// decimals are known only from its own `ft_metadata` view, read and validated on the chain
// (customer purchase setup, the sale room). Each valid read is recorded here with the block it
// was read at, so lists can show "0.15 TUSD" without reading the chain on every page. No guess:
// an asset never read has no metadata, and the page shows exact base units and says so. A later
// read never replaces a newer one; a read that disagrees with what was recorded is kept as the
// newest and flagged, never silently merged.
//
// Amount provenance (Astra, Nov 5): a disagreement makes the scale DISPUTED for good, with its
// reason; pages then show exact base units, never a new scale applied to older records. Two reads
// at the same block that disagree are a conflict: the first stays, and the reason says so.

import type { Db } from "./db.ts";

export const TOKEN_META_SCHEMA = `
CREATE TABLE IF NOT EXISTS token_metadata (
  network TEXT NOT NULL, asset TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 38),
  block_height TEXT NOT NULL, observed_at TEXT NOT NULL, changed INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  PRIMARY KEY (network, asset)
) STRICT;
`;

export interface TokenMetaView {
  symbol: string;
  name: string;
  decimals: number;
  /** When it was read on the chain (the server's clock), and at which block. */
  observed_at: string;
  block_height: string;
  /** Reads disagreed (later, or at the same block): the scale is disputed; pages show base units. */
  changed: boolean;
  /** Why the scale is disputed, in plain words, or null. */
  reason: string | null;
}

const ready = new WeakSet<Db>();
function schema(db: Db) {
  if (ready.has(db)) return;
  db.exec(TOKEN_META_SCHEMA);
  const cols = new Set(
    (db.prepare("PRAGMA table_info(token_metadata)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!cols.has("reason")) db.exec("ALTER TABLE token_metadata ADD COLUMN reason TEXT");
  ready.add(db);
}

/** Records one validated `ft_metadata` read. Older blocks never replace newer ones. */
export function recordTokenMeta(
  db: Db,
  network: string,
  asset: string,
  meta: { symbol: string; name: string; decimals: number },
  blockHeight: string | number,
) {
  schema(db);
  const height = String(blockHeight);
  if (!/^\d{1,20}$/.test(height)) return;
  const prior = db
    .prepare(
      "SELECT symbol, name, decimals, block_height FROM token_metadata WHERE network = ? AND asset = ?",
    )
    .get(network, asset) as
    | { symbol: string; name: string; decimals: number; block_height: string }
    | undefined;
  if (prior && BigInt(prior.block_height) > BigInt(height)) return;
  const differs =
    !!prior &&
    (prior.symbol !== meta.symbol || prior.name !== meta.name || prior.decimals !== meta.decimals);
  const said = (m: { symbol: string; decimals: number }) => `${m.symbol}, ${m.decimals} decimals`;
  if (prior && differs && prior.block_height === height) {
    // The same finalized block can't have two answers: a conflict. The first read stays.
    db.prepare(
      "UPDATE token_metadata SET changed = 1, reason = ? WHERE network = ? AND asset = ?",
    ).run(
      `Two reads at block ${height} disagreed (${said(prior)}; then ${said(meta)})`,
      network,
      asset,
    );
    return;
  }
  const reason =
    prior && differs
      ? `This token's details changed between reads: ${prior.decimals} decimals at block ${prior.block_height}, ${meta.decimals} at block ${height}${prior.symbol === meta.symbol ? "" : ` (symbol ${prior.symbol}, then ${meta.symbol})`}`
      : null;
  db.prepare(
    `INSERT INTO token_metadata (network, asset, symbol, name, decimals, block_height, observed_at, changed, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (network, asset) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
       decimals = excluded.decimals, block_height = excluded.block_height,
       observed_at = excluded.observed_at, changed = MAX(token_metadata.changed, excluded.changed),
       reason = COALESCE(excluded.reason, token_metadata.reason)`,
  ).run(
    network,
    asset,
    meta.symbol,
    meta.name,
    meta.decimals,
    height,
    new Date().toISOString(),
    differs ? 1 : 0,
    reason,
  );
}

/** What was last read for this asset on this network, or null (never read: no guess). */
export function tokenMetaOf(db: Db, network: string, asset: string): TokenMetaView | null {
  schema(db);
  const r = db
    .prepare(
      "SELECT symbol, name, decimals, block_height, observed_at, changed, reason FROM token_metadata WHERE network = ? AND asset = ?",
    )
    .get(network, asset) as
    | {
        symbol: string;
        name: string;
        decimals: number;
        block_height: string;
        observed_at: string;
        changed: number;
        reason: string | null;
      }
    | undefined;
  if (!r) return null;
  return {
    ...r,
    changed: r.changed === 1,
    reason: r.changed === 1 ? (r.reason ?? "This token's details changed between reads") : null,
  };
}

/** Exact, no floating point: base units as a decimal string with the token's decimals. */
export function readableAmount(base: string, decimals: number): string | null {
  if (!/^\d{1,40}$/.test(base) || !Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    return null;
  const v = BigInt(base);
  if (decimals === 0) return v.toString();
  const scale = 10n ** BigInt(decimals);
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / scale}.${frac}` : (v / scale).toString();
}
