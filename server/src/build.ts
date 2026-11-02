// The boundary between the product studio and whatever turns a revision into a working build.
// M1 ships the interface and the honest "not connected" answer; no provider runs here yet.
// Design for the implementation that follows: docs/design/BUILD_RUNTIME.md.

export interface BuildAvailability {
  available: boolean;
  /** Provider id when one is configured, e.g. "anthropic"; null when none is. */
  provider: string | null;
  /** Plain words for the founder: what is connected, or what is missing. */
  reason: string;
}

/** One build of one immutable revision. The key makes a retried request the same build. */
export interface BuildRequest {
  projectId: string;
  businessId: string;
  revision: number;
  contentHash: string;
  idempotencyKey: string;
  budget: { maxCostCents: number; maxSeconds: number };
}

export type BuildEvent =
  | { type: "queued" | "started"; at: string }
  | { type: "progress"; at: string; message: string }
  | { type: "usage"; at: string; inputTokens: number; outputTokens: number; costCents: number }
  | { type: "artifact"; at: string; digest: string; bytes: number }
  | { type: "failed"; at: string; reason: string; retryable: boolean }
  | { type: "cancelled"; at: string }
  | { type: "succeeded"; at: string; digest: string };

/**
 * What a build provider implements. `start` streams events for one request and stops when the
 * signal aborts. A provider's text is never itself a successful build: success needs an
 * artifact digest that the platform has validated and checked.
 */
export interface BuildProvider {
  readonly id: string;
  availability(): BuildAvailability;
  start(request: BuildRequest, signal: AbortSignal): AsyncIterable<BuildEvent>;
}

export const NO_BUILD_PROVIDER: BuildAvailability = {
  available: false,
  provider: null,
  reason:
    "Generated builds are not connected in this environment. Nothing is generated, run or tested by AI here yet; shape the brief and prototype by hand and every saved revision is kept.",
};

export function buildAvailability(provider: BuildProvider | null | undefined): BuildAvailability {
  return provider ? provider.availability() : NO_BUILD_PROVIDER;
}
