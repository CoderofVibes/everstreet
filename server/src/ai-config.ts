// Server-side configuration for AI drafting. Everything a dispatch depends on is explicit and
// versioned: which model, at which prices, under which operator spending ceiling. Nothing here
// is chosen by a browser, a request or a model's output.
//
// How it is set (docs/design/BUILD_RUNTIME.md, "Configuration"):
//   EVERSTREET_AI_CONFIG  path to a JSON file kept outside the repository, no secrets in it:
//     { "config_version": "...", "provider": "anthropic", "model": "claude-sonnet-5-5",
//       "pricing_version": "2026-11-02", "operator_ceiling_cents": 2000 }
//   ANTHROPIC_API_KEY     the platform's own API key, set in the server's environment.
// Both are read only when the server starts; nothing searches for credentials elsewhere, and
// a personal Claude login is never used for customer requests.

import type { BuildPricing } from "./build.ts";

export interface SupportedModel {
  model: string;
  pricingVersion: string;
  pricing: BuildPricing;
  /**
   * Thinking is on by default for these models and its tokens are billed as output. The
   * lowest setting each accepts is pinned here (Sonnet 5.5: `between_tools`, which turns off
   * up-front thinking; Haiku 5.5: `disabled`), at an effort both accept with it.
   */
  thinking: { type: "between_tools" } | { type: "disabled" };
  effort: "low" | "medium" | "high";
  /**
   * Prompts above this many input tokens are refused: the declared prices apply only below it
   * (Haiku 5.5 charges more above 100,000), and refusing is safer than undercounting.
   */
  maxPromptTokens: number;
  maxOutputTokens: number;
}

/**
 * Models this platform can price exactly, from Anthropic's pricing and thinking pages as read
 * on 2026-11-02: base input and output only, global routing (no `inference_geo`), no prompt
 * caching, no batch, no tools, thinking at its lowest setting. Whole cents per million tokens.
 */
export const SUPPORTED_MODELS: Record<string, SupportedModel> = {
  "claude-sonnet-5-5": {
    model: "claude-sonnet-5-5",
    pricingVersion: "2026-11-02",
    pricing: { inputCentsPerMillionTokens: 200, outputCentsPerMillionTokens: 1000 },
    thinking: { type: "between_tools" },
    effort: "medium",
    maxPromptTokens: 200_000,
    maxOutputTokens: 16_000,
  },
  "claude-haiku-5-5": {
    model: "claude-haiku-5-5",
    pricingVersion: "2026-11-02",
    pricing: { inputCentsPerMillionTokens: 10, outputCentsPerMillionTokens: 50 },
    thinking: { type: "disabled" },
    effort: "medium",
    maxPromptTokens: 100_000,
    maxOutputTokens: 16_000,
  },
};

/** The largest operator ceiling accepted from configuration: $1,000. */
export const MAX_OPERATOR_CEILING_CENTS = 100_000;

export interface AiConfig {
  configVersion: string;
  provider: "anthropic";
  model: SupportedModel;
  operatorCeilingCents: number;
  /**
   * The operator's separate ceiling for running products (job 002c), across every business.
   * Optional: without it the managed runtime is unavailable. Never shared with the build
   * ceiling.
   */
  runtimeCeilingCents: number | null;
}

export type AiConfigResult =
  | { ok: true; config: AiConfig; apiKey: string }
  | { ok: false; reason: string };

const VERSION = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Validates the configuration file's contents and the presence of a key. Pure: the caller
 * reads the file and passes the environment. The key is returned only to build the transport
 * and never appears in a reason, log or event.
 */
export function parseAiConfig(fileText: string | null, apiKey: string | undefined): AiConfigResult {
  if (fileText === null)
    return { ok: false, reason: "AI drafting is not configured on this server." };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fileText) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "The AI configuration file is not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, reason: "The AI configuration file must be an object." };
  if (raw.provider !== "anthropic")
    return { ok: false, reason: "Only the Anthropic provider is supported." };
  if (typeof raw.config_version !== "string" || !VERSION.test(raw.config_version))
    return { ok: false, reason: "config_version must be a short version label." };
  const model = typeof raw.model === "string" ? SUPPORTED_MODELS[raw.model] : undefined;
  if (!model)
    return {
      ok: false,
      reason: `Unsupported model. Supported: ${Object.keys(SUPPORTED_MODELS).join(", ")}.`,
    };
  if (raw.pricing_version !== model.pricingVersion)
    return {
      ok: false,
      reason: `pricing_version must be ${model.pricingVersion} for ${model.model}; prices are not guessed.`,
    };
  const ceiling = raw.operator_ceiling_cents;
  if (
    typeof ceiling !== "number" ||
    !Number.isSafeInteger(ceiling) ||
    ceiling < 1 ||
    ceiling > MAX_OPERATOR_CEILING_CENTS
  )
    return {
      ok: false,
      reason: `operator_ceiling_cents must be a whole number from 1 to ${MAX_OPERATOR_CEILING_CENTS}.`,
    };
  const runtime = raw.runtime_operator_ceiling_cents;
  if (
    runtime !== undefined &&
    (typeof runtime !== "number" ||
      !Number.isSafeInteger(runtime) ||
      runtime < 1 ||
      runtime > MAX_OPERATOR_CEILING_CENTS)
  )
    return {
      ok: false,
      reason: `runtime_operator_ceiling_cents, if given, must be a whole number from 1 to ${MAX_OPERATOR_CEILING_CENTS}.`,
    };
  if (raw.api_key !== undefined || raw.key !== undefined)
    return { ok: false, reason: "Keep the API key out of the configuration file." };
  if (typeof apiKey !== "string" || apiKey.trim().length < 20)
    return { ok: false, reason: "The server has no AI provider key." };
  return {
    ok: true,
    config: {
      configVersion: raw.config_version,
      provider: "anthropic",
      model,
      operatorCeilingCents: ceiling,
      runtimeCeilingCents: typeof runtime === "number" ? runtime : null,
    },
    apiKey: apiKey.trim(),
  };
}
