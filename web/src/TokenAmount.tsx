// Review evidence and presentation (Astra, Nov 5): one way to show a token amount. With the
// token's metadata as read on the chain (server/src/tokenMeta.ts), the readable amount leads
// ("0.15 TUSD") and the exact base units follow as a quiet detail. Without it, the exact base
// units and the asset are shown and the page says the token's details haven't been read: never a
// guessed scale. Integer arithmetic only; no conversion to any other currency.

export interface TokenInfo {
  symbol: string;
  decimals: number;
  /**
   * Amount provenance (Astra, Nov 5): set when reads of the token disagreed, with the reason. Its
   * scale is then not used anywhere: pages show exact base units, the asset and this reason.
   */
  disputed?: string;
}

const U = /^\d{1,40}$/;
const SYMBOL = /^[A-Za-z0-9.$_-]{1,16}$/;

/**
 * A token's metadata from an answer, or null: only a well-formed symbol and 0-38 decimals. A
 * disagreement the server recorded (`changed`, with its `reason`) is kept as `disputed`.
 */
export function parseToken(raw: unknown): TokenInfo | null {
  const t = raw as {
    symbol?: unknown;
    decimals?: unknown;
    changed?: unknown;
    reason?: unknown;
    disputed?: unknown;
  } | null;
  if (!t || typeof t !== "object") return null;
  if (typeof t.symbol !== "string" || !SYMBOL.test(t.symbol)) return null;
  if (!Number.isInteger(t.decimals) || (t.decimals as number) < 0 || (t.decimals as number) > 38)
    return null;
  const out: TokenInfo = { symbol: t.symbol, decimals: t.decimals as number };
  if (t.changed === true || typeof t.disputed === "string")
    out.disputed = (
      typeof t.disputed === "string"
        ? t.disputed
        : typeof t.reason === "string" && t.reason
          ? t.reason
          : "This token's details changed between reads"
    ).slice(0, 300);
  return out;
}

/** The scale to show amounts in, or null when unknown or disputed (show exact base units). */
export function usableScale(raw: unknown): TokenInfo | null {
  const t = parseToken(raw);
  return t && !t.disputed ? t : null;
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
  /** The token's metadata as given (parsed here, so a recorded dispute is never lost). */
  token: unknown;
  /** Show the exact base units beside the readable amount (default yes). */
  exact?: boolean;
}) {
  if (base === null) return <span className="muted">unknown</span>;
  const parsed = parseToken(token);
  const scale = parsed && !parsed.disputed ? parsed : null;
  const r = scale ? readable(base, scale.decimals) : null;
  if (scale && r !== null)
    return (
      <span className="token-amount">
        <span className="token-readable">
          {r} {scale.symbol}
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
      <span className="token-exact small muted">
        {parsed?.disputed
          ? ` (${parsed.disputed.replace(/\.$/, "")}, so the exact amount is shown)`
          : " (this token's details haven't been read yet)"}
      </span>
    </span>
  );
}
