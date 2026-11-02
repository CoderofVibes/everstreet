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
  limits: BuildLimits;
  /** The only artifact the platform accepts in this version. */
  outputSchema: "extraction_spec/1";
}

/** What a provider may report. Everything else (state, success, cost) the platform decides. */
export type BuildEvent =
  | { type: "progress"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "output"; artifact: unknown };

/**
 * Provider contract:
 * - `pricing()` returns declared prices or null; an unpriced provider is refused.
 * - Before sending anything, count input tokens and refuse (throw) above `maxInputTokens`.
 * - Cap generation at `maxOutputTokens` in the request to the model.
 * - Report every call's token usage as a `usage` event, including on failure if known.
 * - Stop promptly when the signal aborts. Never run tools, code or URLs from model output.
 * - Throw on failure; the platform redacts and records the message.
 */
export interface BuildProvider {
  readonly id: string;
  availability(): BuildAvailability;
  pricing(): BuildPricing | null;
  start(request: BuildRequest, signal: AbortSignal): AsyncIterable<BuildEvent>;
}

export const NO_BUILD_PROVIDER: BuildAvailability = {
  available: false,
  provider: null,
  reason:
    "Generated builds are not connected in this environment. Nothing is generated, run or tested by AI here yet; shape the brief and prototype by hand and every saved revision is kept.",
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
  return a;
}

/** Worst-case cost in cents for the limits, rounded up. */
export function worstCaseCents(pricing: BuildPricing, limits: BuildLimits): number {
  return Math.ceil(
    (limits.maxInputTokens * pricing.inputCentsPerMillionTokens +
      limits.maxOutputTokens * pricing.outputCentsPerMillionTokens) /
      1_000_000,
  );
}

export function costCents(pricing: BuildPricing, inputTokens: number, outputTokens: number) {
  return worstCaseCents(pricing, {
    maxInputTokens: inputTokens,
    maxOutputTokens: outputTokens,
    maxSeconds: 0,
  });
}
