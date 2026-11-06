// The boundary between the platform and a build provider (the AI that drafts a product).
// The platform owns jobs, budgets, fencing, validation and success; a provider only turns one
// validated revision snapshot into a proposed artifact and reports token usage. Nothing a
// provider says is a successful build by itself. Design: docs/design/BUILD_RUNTIME.md.

import type { Brief, Foundation, Prototype } from "./products.ts";

export interface BuildAvailability {
  available: boolean;
  /** Provider id when one is configured, e.g. "anthropic"; null when none is. */
  provider: string | null;
  /** Plain words for the founder: what is connected, or what is missing. */
  reason: string;
}

/**
 * Declared prices in US cents per million tokens. With the limits in the request these bound
 * the worst-case cost, but only if the provider honours its side of the contract below.
 */
export interface BuildPricing {
  inputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
}

export interface BuildLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxSeconds: number;
}

/** One attempt at building one immutable revision. */
export interface BuildRequest {
  jobId: string;
  attempt: number;
  /** Stable across nothing but this attempt; a provider may use it to deduplicate its own calls. */
  dispatchKey: string;
  projectId: string;
  businessId: string;
  revision: number;
  contentHash: string;
  /** The validated revision snapshot: the provider works from content, not ids. */
  content: { foundation: Foundation; brief: Brief; prototype: Prototype };
  /**
   * `build` drafts a service specification; `propose` drafts a revised brief and screens; `app`
   * (job 002e) drafts a small browser web app as a `web_app_bundle/1` file list.
   */
  intent: "build" | "propose" | "app";
  /**
   * For `app`: the founder's instructions (data, never platform instructions) and, for a change,
   * the version it changes (its validated canonical bundle).
   */
  app?: { instructions: string; base: { job: string; digest: string; bundle: unknown } | null };
  /**
   * For `propose`: the business's product work log, oldest first, bounded. The founder's words
   * are data to answer, never instructions to the platform.
   */
  conversation: { role: "founder" | "assistant"; text: string }[];
  limits: BuildLimits;
  /** The only artifact the platform accepts for this intent. */
  outputSchema: "extraction_spec/1" | "product_proposal/1" | "web_app_bundle/1";
}

/** What a provider may report. Everything else (state, success, cost) the platform decides. */
export type BuildEvent =
  | { type: "progress"; message: string }
  /** Provisional: tokens used since the previous usage event. Never proof of the full bill. */
  | { type: "usage"; inputTokens: number; outputTokens: number }
  /** The complete receipt: total tokens billed for this attempt. Only this settles usage. */
  | { type: "usage_final"; inputTokens: number; outputTokens: number }
  | { type: "output"; artifact: unknown };

/**
 * Non-secret identity of the configured provider. A job is pinned to the identity and prices
 * it was requested under; a worker configured differently refuses to dispatch it.
 */
export interface BuildIdentity {
  id: string;
  model: string;
  version: string;
}

/**
 * Provider contract:
 * - `identity()` names the provider, model and configuration version; never a secret.
 * - `pricing()` returns declared prices or null; an unpriced provider is refused.
 * - Before sending anything, count input tokens and refuse (throw) above `maxInputTokens`.
 * - Cap generation at `maxOutputTokens` in the request to the model.
 * - Report token use as `usage` deltas while running and one `usage_final` receipt with the
 *   attempt's billed totals. Without the receipt, usage is incomplete and stays reserved.
 *   Report `usage_final` of 0/0 only when nothing billable was sent (e.g. a free preflight
 *   refused the request), and only `usage` when the bill may fall outside declared prices.
 * - Stop promptly when the signal aborts. Never run tools, code or URLs from model output.
 * - Throw on failure; the platform redacts and records the message.
 */
export interface BuildProvider {
  readonly id: string;
  identity(): BuildIdentity;
  availability(): BuildAvailability;
  pricing(): BuildPricing | null;
  start(request: BuildRequest, signal: AbortSignal): AsyncIterable<BuildEvent>;
}

/** Largest accepted price, in cents per million tokens ($100,000 per million). */
export const MAX_PRICE = 10_000_000;

/** Prices must be whole, non-negative cents per million tokens, so costs stay exact. */
export function validPricing(p: BuildPricing | null | undefined): p is BuildPricing {
  const ok = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= MAX_PRICE;
  return Boolean(p && ok(p.inputCentsPerMillionTokens) && ok(p.outputCentsPerMillionTokens));
}

export const NO_BUILD_PROVIDER: BuildAvailability = {
  available: false,
  provider: null,
  reason: "AI builds are not connected here.",
};

export function buildAvailability(provider: BuildProvider | null | undefined): BuildAvailability {
  if (!provider) return NO_BUILD_PROVIDER;
  const a = provider.availability();
  if (a.available && !provider.pricing())
    return {
      available: false,
      provider: provider.id,
      reason: "The build provider has no declared prices, so no budget can be reserved for it.",
    };
  if (a.available && !validPricing(provider.pricing()))
    return {
      available: false,
      provider: provider.id,
      reason: "The build provider's declared prices are not valid whole cents per million tokens.",
    };
  return a;
}

/**
 * Exact cost in millionths of a cent: tokens × whole cents per million tokens. Integers
 * throughout (at the limits, at most 2.3e12), so no rounding until it is shown.
 */
export function costMicroCents(pricing: BuildPricing, inputTokens: number, outputTokens: number) {
  return (
    inputTokens * pricing.inputCentsPerMillionTokens +
    outputTokens * pricing.outputCentsPerMillionTokens
  );
}

/** Cents rounded up: conservative for reservations, not a provider's invoice. */
export const ceilCents = (microCents: number) => Math.ceil(microCents / 1_000_000);

/** Worst-case cost in cents for the limits, rounded up. */
export function worstCaseCents(pricing: BuildPricing, limits: BuildLimits): number {
  return ceilCents(costMicroCents(pricing, limits.maxInputTokens, limits.maxOutputTokens));
}
