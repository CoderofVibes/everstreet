// Job 003w-a: the composition root (docs/design/APPLICATION_COMPOSITION.md §3). It builds the
// application from a validated config and EXPLICIT dependencies, starts nothing (start() does),
// and stops everything it started (stop()). It never searches the filesystem for keys, never
// starts the legacy OpenSeat worker or the v2 signing chain, and never imports test fixtures.
// Every capability is either on (with its real adapter) or unavailable (with a fixed reason);
// a missing one never blocks the others. Status output carries no path, key or variable value.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Hono } from "hono";
import { parseAiConfig } from "./ai-config.ts";
import { AnthropicProvider, httpsTransport } from "./anthropic.ts";
import { everstreetApi } from "./app.ts";
import { AppChecks } from "./appChecks.ts";
import type { AppConfig } from "./appConfig.ts";
import type { BuildProvider } from "./build.ts";
import { Builds, startBuildWorker } from "./builds.ts";
import type { CustomerViewTransport } from "./customerRead.ts";
import type { CustomerChainWriter, CustomerUseOptions } from "./customerUse.ts";
import { OperatorKey, TestnetCustomerWriter, TestnetTxTransport } from "./customerWriter.ts";
import { openDb } from "./db.ts";
import { Evaluations } from "./evaluations.ts";
import { AccountSignIn } from "./identity.ts";
import { ManagedRuntime } from "./invocations.ts";
import { type ProtectedStore, protectedStoreFromConfig } from "./protectedStore.ts";
import { AnthropicRuntime, type RuntimeProvider } from "./runtime.ts";
import { Store } from "./store.ts";
import type { V3Options } from "./v3observe.ts";
import type { ViewTransport } from "./v3read.ts";
import {
  type AccessKeyReader,
  type FetchLike,
  TestnetAccessKeyReader,
  TestnetCustomerRpcTransport,
  TestnetRpcTransport,
} from "./v3rpc.ts";

export interface Capability {
  key: string;
  label: string;
  state: "on" | "unavailable";
  /** A fixed sentence: never a path, key, endpoint or variable value. */
  detail: string;
  /** Where the adapter's evidence comes from, e.g. "testnet RPC" or "synthetic (test)". */
  provenance: string | null;
}

/**
 * Explicit dependencies. In configured mode only `fetch` (labelled) may be injected, so tests
 * exercise the same composition with a synthetic network; real adapters are built from config.
 * In preview mode the caller may pass labelled synthetic adapters; nothing is discovered.
 */
export interface ComposeDeps {
  /** The network transport for every RPC adapter (default: global fetch, configured mode only). */
  fetch?: FetchLike;
  /** How `fetch` is described in the inventory, e.g. "synthetic RPC (test)". */
  fetchLabel?: string;
  /** Reads the files the config names (default: fs). */
  readFile?: (path: string) => string;
  /** Reads ONE named variable (default: process.env), only for model.api_key_env. */
  envVar?: (name: string) => string | undefined;
  now?: () => number;
  /**
   * Job 003w-e: the review harness only (scripts/wallet-harness.ts), never a config field. The
   * browser then accepts the harness's synthetic Wallet Selector module and shows that it is one.
   */
  walletHarness?: { label: string };
  /** Preview only: labelled synthetic adapters. */
  preview?: {
    label: string;
    v3Transport?: ViewTransport;
    customerTransport?: CustomerViewTransport;
    writer?: CustomerChainWriter;
    buildProvider?: BuildProvider;
    runtimeProvider?: RuntimeProvider;
  };
}

export interface Composed {
  readonly config: AppConfig;
  readonly store: Store;
  readonly app: Hono;
  capabilities(): Capability[];
  start(): void;
  /** Ends admission, drains or fences in-flight work, then closes every resource. */
  stop(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Closes what was opened, newest first, ignoring what is already closed. */
function closeAll(opened: { close(): void }[]) {
  for (const o of opened.splice(0).reverse()) {
    try {
      o.close();
    } catch {
      // already closed
    }
  }
}

export function composeApplication(config: AppConfig, deps: ComposeDeps = {}): Composed {
  // A failure part-way (an unreadable key file, a bad AI config) unwinds what was opened.
  const opened: { close(): void }[] = [];
  try {
    return composeInner(config, deps, opened);
  } catch (e) {
    closeAll(opened);
    throw e;
  }
}

function composeInner(config: AppConfig, deps: ComposeDeps, opened: { close(): void }[]): Composed {
  const configured = config.mode === "configured";
  if (configured && deps.preview)
    throw new Error("compose: synthetic preview adapters are refused in configured mode");
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const caps: Capability[] = [];
  const cap = (c: Capability) => caps.push(c);

  // Records first: everything else is built over them.
  const store = new Store(openDb(config.database));
  opened.push({ close: () => store.db.close() });
  cap({
    key: "records",
    label: "Records",
    state: "on",
    detail:
      config.database === ":memory:"
        ? "In memory: nothing survives a restart."
        : "A durable database file.",
    provenance: "local SQLite",
  });

  // The network adapters (read-only), when an endpoint is configured.
  const fetchImpl: FetchLike | null =
    deps.fetch ?? (configured ? (globalThis.fetch as unknown as FetchLike) : null);
  const rpcLabel = deps.fetch ? (deps.fetchLabel ?? "injected transport") : "testnet RPC";
  let v3Transport: ViewTransport | null = null;
  let customerTransport: CustomerViewTransport | null = null;
  let keyReader: AccessKeyReader | null = null;
  if (config.rpc && fetchImpl) {
    const rpc = { network: "testnet", endpoint: config.rpc.endpoint };
    v3Transport = new TestnetRpcTransport(rpc, fetchImpl);
    customerTransport = new TestnetCustomerRpcTransport(rpc, fetchImpl);
    keyReader = new TestnetAccessKeyReader(rpc, fetchImpl);
  }
  if (deps.preview?.v3Transport) v3Transport = deps.preview.v3Transport;
  if (deps.preview?.customerTransport) customerTransport = deps.preview.customerTransport;
  const previewLabel = deps.preview ? `synthetic: ${deps.preview.label}` : null;

  // Identity.
  let signIn: AccountSignIn | null = null;
  if (configured && config.sign_in && keyReader)
    signIn = new AccountSignIn(store, {
      recipient: config.sign_in.recipient,
      network: "testnet",
      reader: keyReader,
      sessionTtlMs: (config.sign_in.session_hours ?? 12) * 3_600_000,
      callbackUrl: config.sign_in.return_origin
        ? `${config.sign_in.return_origin}/signin/return`
        : null,
      now: deps.now,
    });
  cap(
    signIn
      ? {
          key: "sign_in",
          label: "Account sign-in",
          state: "on",
          detail: signIn.callbackUrl
            ? "Verified accounts only: a NEP-413 signed challenge (MyNearWallet in the browser) and a full-access key read on NEAR."
            : "Verified accounts only (a NEP-413 signed challenge and a full-access key read on NEAR). Wallet sign-in in the browser needs sign_in.return_origin, which isn't configured.",
          provenance: rpcLabel,
        }
      : {
          key: "sign_in",
          label: "Account sign-in",
          state: "unavailable",
          detail: "Preview sessions: fictional people for local review, never verified identity.",
          provenance: null,
        },
  );

  // Protected customer storage (003v): keys from the file the config names.
  let protection: ProtectedStore | null = null;
  if (config.protected_storage) {
    const keys = JSON.parse(readFile(config.protected_storage.keys_file)) as Record<string, string>;
    protection = protectedStoreFromConfig(
      {
        root: config.protected_storage.root,
        active_key_id: config.protected_storage.active_key_id,
        keys,
      },
      deps.now,
    );
    opened.push(protection);
  }
  cap(
    protection
      ? {
          key: "protection",
          label: "Protected customer storage",
          state: protection.readiness().ready ? "on" : "unavailable",
          detail: protection.readiness().ready
            ? "Encrypted at rest (aes-256-gcm/v1) in its own file."
            : "Its active key doesn't match the stored documents.",
          provenance: "local encrypted store",
        }
      : {
          key: "protection",
          label: "Protected customer storage",
          state: "unavailable",
          detail: "Not configured: no customer document can be kept or run.",
          provenance: null,
        },
  );

  // Model build/runtime: only with an AI config file, a named key variable and a budget.
  let buildProvider: BuildProvider | null = deps.preview?.buildProvider ?? null;
  let runtimeProvider: RuntimeProvider | null = deps.preview?.runtimeProvider ?? null;
  let operatorCeilingCents: number | null = null;
  let runtimeCeilingCents: number | null = null;
  let modelReason = "Not configured: building and running products is off.";
  if (config.model) {
    let text: string | null = null;
    try {
      text = readFile(config.model.ai_config_file);
    } catch {
      text = "";
    }
    const key = (deps.envVar ?? ((n: string) => process.env[n]))(config.model.api_key_env);
    const ai = parseAiConfig(text, key);
    if (ai.ok) {
      buildProvider = new AnthropicProvider(ai.config, httpsTransport(ai.apiKey));
      runtimeProvider = new AnthropicRuntime(ai.config, httpsTransport(ai.apiKey));
      operatorCeilingCents = ai.config.operatorCeilingCents;
      runtimeCeilingCents = ai.config.runtimeCeilingCents;
    } else modelReason = "Configured, but the AI configuration or its key isn't usable.";
  }
  cap(
    buildProvider
      ? {
          key: "model",
          label: "Building and running products",
          state: "on",
          detail: "A pinned model with a configured operator ceiling.",
          provenance: previewLabel ?? "model provider",
        }
      : {
          key: "model",
          label: "Building and running products",
          state: "unavailable",
          detail: modelReason,
          provenance: null,
        },
  );
  const builds = new Builds(store.db, store, buildProvider, { operatorCeilingCents });
  const runtime = new ManagedRuntime(store.db, store, runtimeProvider, {
    ceilingCents: runtimeCeilingCents ?? (runtimeProvider ? 1_000 : null),
  });

  // Isolated logic checks: the worker engine stays off (002f is partial; 002f1 is queued).
  const appChecks = new AppChecks(store.db, store);
  cap({
    key: "checks",
    label: "Isolated logic checks",
    state: "unavailable",
    detail: "The isolated worker hasn't passed its conformance gates, so no check runs here.",
    provenance: null,
  });

  // v3 observation (owner reads and sale reconciliation).
  const v3: V3Options | undefined =
    v3Transport && config.v3
      ? {
          transport: v3Transport,
          bindings: config.v3.bindings.map((b) => ({ ...b, network: "testnet" })),
          now: deps.now,
        }
      : undefined;
  cap(
    v3
      ? {
          key: "v3",
          label: "Business contract reads",
          state: "on",
          detail: "Read-only views of the bound businesses.",
          provenance: previewLabel ?? rpcLabel,
        }
      : {
          key: "v3",
          label: "Business contract reads",
          state: "unavailable",
          detail: "No contract endpoint or business binding is configured.",
          provenance: null,
        },
  );

  // Customer use: reads can be on without the writer. The writer (003w-d) only with an explicit
  // operator key file whose account IS the configured metering account and whose key matches its
  // public key; validated here, before any effect. Nothing about the key reaches status.
  let writer: CustomerChainWriter | null = deps.preview?.writer ?? null;
  if (config.customer?.writer && fetchImpl && config.rpc) {
    const k = JSON.parse(readFile(config.customer.writer.key_file)) as {
      account_id?: unknown;
      public_key?: unknown;
      private_key?: unknown;
    };
    if (k.account_id !== config.customer.operator_account)
      throw new Error(
        "compose: the writer key file is for another account than the metering account",
      );
    if (typeof k.public_key !== "string" || typeof k.private_key !== "string")
      throw new Error("compose: the writer key file is incomplete");
    writer = new TestnetCustomerWriter(store.db, {
      network: "testnet",
      signer: config.customer.operator_account,
      key: new OperatorKey(k.private_key, k.public_key),
      rpc: new TestnetTxTransport({ network: "testnet", endpoint: config.rpc.endpoint }, fetchImpl),
      now: deps.now,
    });
  }
  let customer: CustomerUseOptions | undefined;
  if (config.customer && customerTransport && protection)
    customer = {
      reader: customerTransport,
      writer,
      operatorAccount: config.customer.operator_account,
      protection,
      now: deps.now,
    };
  cap(
    customer
      ? {
          key: "customer_reads",
          label: "Customer plans and entitlements",
          state: "on",
          detail: "Read-only, at a pinned final block with its own timestamp.",
          provenance: previewLabel ?? rpcLabel,
        }
      : {
          key: "customer_reads",
          label: "Customer plans and entitlements",
          state: "unavailable",
          detail: "Customer use needs an endpoint, the metering account and protected storage.",
          provenance: null,
        },
  );
  cap(
    writer
      ? {
          key: "customer_writer",
          label: "Reserving and settling units",
          state: "on",
          detail:
            "Submits open_hold, settle_hold and the registration-guarded release as the metering account, one durable transaction per operation; only the contract's readback proves a charge.",
          provenance: previewLabel ?? rpcLabel,
        }
      : {
          key: "customer_writer",
          label: "Reserving and settling units",
          state: "unavailable",
          detail:
            "No operator key is configured for the metering account, so nothing can be reserved or charged.",
          provenance: null,
        },
  );
  cap({
    key: "customer_authorization",
    label: "Customer authorization",
    state: "unavailable",
    detail: "No wallet or device use-key connection is built yet (sub-job 003w-e).",
    provenance: null,
  });
  cap({
    key: "legacy_payments",
    label: "Bookings and v2 payments",
    state: "unavailable",
    detail: "The legacy preview's locally discovered keys are never used here.",
    provenance: null,
  });

  const api = everstreetApi(store, {
    localPreview: !configured,
    environment: configured
      ? "Configured (testnet)"
      : `Local preview${previewLabel ? ` (${previewLabel})` : ""}`,
    identity: signIn ? { mode: "verified", signIn } : { mode: "preview" },
    wallet: signIn
      ? {
          network: "testnet",
          available: signIn.callbackUrl !== null,
          harness: deps.walletHarness?.label ?? null,
        }
      : null,
    builds,
    buildProvider,
    operatorCeilingCents,
    runtime,
    appChecks,
    v3,
    customer,
    ...(config.origins
      ? { previewOrigin: config.origins.preview, platformOrigin: config.origins.platform }
      : {}),
  });

  const app = new Hono();
  app.get("/api/system/capabilities", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ mode: config.mode, network: config.network, capabilities: caps });
  });
  app.route("/", api);
  const dist = config.web_dist;
  if (dist)
    app.get("*", (c) => {
      if (!existsSync(dist)) return c.text("The web app isn't built here.", 503);
      const path = normalize(c.req.path).replace(/^([/\\])+/, "");
      const file = join(dist, path);
      if (path && !path.includes("..") && existsSync(file) && extname(file))
        return c.body(readFileSync(file), 200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        });
      return c.html(readFileSync(join(dist, "index.html"), "utf8"));
    });

  const stoppers: (() => Promise<unknown>)[] = [];
  let stopping: Promise<void> | null = null;
  let started = false;
  let stopped = false;
  return {
    config,
    store,
    app,
    capabilities: () => caps.map((c) => ({ ...c })),
    start() {
      if (started || stopped) return;
      started = true;
      // Restart recovery, through the existing state machines: unknown dispatch is marked
      // unknown, never re-sent as a fresh provider request.
      runtime.recover();
      new Evaluations(store.db, store, runtime).recover();
      if (buildProvider) stoppers.push(startBuildWorker(builds, buildProvider).stop);
    },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      // Workers first (admission ends, in-flight work drains or is fenced), resources last.
      stopping = (async () => {
        for (const s of stoppers.splice(0)) await s();
        closeAll(opened);
      })();
      return stopping;
    },
  };
}
