// Review evidence and presentation (Astra, Nov 5): one way to show a token amount. With the
// token's metadata as read on the chain (server/src/tokenMeta.ts), the readable amount leads
// ("0.15 TUSD") and the exact base units follow as a quiet detail. Without it, the exact base
// units and the asset are shown and the page says the token's details haven't been read: never a
// guessed scale. Integer arithmetic only; no conversion to any other currency.

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

const U = /^\d{1,40}$/;
const SYMBOL = /^[A-Za-z0-9.$_-]{1,16}$/;

/** A token's metadata from an answer, or null: only a well-formed symbol and 0-38 decimals. */
export function parseToken(raw: unknown): TokenInfo | null {
  const t = raw as { symbol?: unknown; decimals?: unknown } | null;
  if (!t || typeof t !== "object") return null;
  if (typeof t.symbol !== "string" || !SYMBOL.test(t.symbol)) return null;
  if (!Number.isInteger(t.decimals) || (t.decimals as number) < 0 || (t.decimals as number) > 38)
    return null;
  return { symbol: t.symbol, decimals: t.decimals as number };
}

/** Groups digits for reading (no rounding, no decimals added). */
export const groupDigits = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Exact readable amount, or null when the input isn't a base-unit integer. */
export function readable(base: string, decimals: number): string | null {
  if (!U.test(base) || !Number.isInteger(decimals) || decimals < 0 || decimals > 38) return null;
  const v = BigInt(base);
  if (decimals === 0) return groupDigits(v.toString());
  const scale = 10n ** BigInt(decimals);
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const whole = groupDigits((v / scale).toString());
  return frac ? `${whole}.${frac}` : whole;
}

export function TokenAmount({
  base,
  asset,
  token,
  exact = true,
}: {
  /** The amount in the asset's base units (a decimal integer string). */
  base: string | null;
  asset: string;
  token: TokenInfo | null | undefined;
  /** Show the exact base units beside the readable amount (default yes). */
  exact?: boolean;
}) {
  if (base === null) return <span className="muted">unknown</span>;
  const r = token ? readable(base, token.decimals) : null;
  if (token && r !== null)
    return (
      <span className="token-amount">
        <span className="token-readable">
          {r} {token.symbol}
        </span>
        {exact && (
          <span className="token-exact small muted">
            {" "}
            (exact: <span className="mono">{groupDigits(base)}</span> base units of{" "}
            <span className="mono">{asset}</span>)
          </span>
        )}
      </span>
    );
  return (
    <span className="token-amount">
      <span className="mono">{U.test(base) ? groupDigits(base) : base}</span> base units of{" "}
      <span className="mono token-asset">{asset}</span>
      <span className="token-exact small muted"> (this token's details haven't been read yet)</span>
    </span>
  );
}
