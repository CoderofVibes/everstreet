// Job 003w-a: the application's one configuration object (docs/design/APPLICATION_COMPOSITION.md
// §2–3), validated before anything is opened or written. A mode is explicit; testnet is the only
// network; mainnet is refused wherever a network, endpoint or account could name it. The config
// names FILES and ENVIRONMENT VARIABLE NAMES for secrets; it never holds a secret, and nothing in
// it is echoed in status. Example (placeholders only): config/everstreet.example.json.

import { isAbsolute } from "node:path";
import { isAccountId } from "./v3read.ts";
import { validateRpcConfig } from "./v3rpc.ts";

export type AppMode = "preview" | "configured";

export interface AppConfig {
  config_version: 1;
  mode: AppMode;
  network: "testnet";
  listen: { host: string; port: number };
  /** An absolute path to the records database (":memory:" only in preview). */
  database: string;
  /** The built web app to serve, if any (relative to the working directory or absolute). */
  web_dist?: string;
  /** Where previews are served from and the platform's own origin (both, or neither). */
  origins?: { platform: string; preview: string };
  /** Verified sign-in (configured mode: required). */
  sign_in?: { recipient: string; session_hours?: number; return_origin?: string };
  /** A testnet JSON-RPC endpoint (required by sign-in, v3 and customer reads). */
  rpc?: { endpoint: string };
  /** Business-v3 bindings the operator vouches for. */
  v3?: { bindings: { business_id: string; account: string }[] };
  /** Customer use: the platform's metering account. */
  /**
   * Customer use: the platform's metering account; optionally (003w-d) the writer, from an operator
   * key file the config names (NEAR form: account_id, public_key, private_key). Never echoed.
   */
  customer?: { operator_account: string; writer?: { key_file: string } };
  /** Protected customer storage (003v): its root and the file holding its keys. */
  protected_storage?: { root: string; active_key_id: string; keys_file: string };
  /** Model build/runtime: the AI config file and the NAME of the variable holding the key. */
  model?: { ai_config_file: string; api_key_env: string };
  /** Job 003wf1 (§12.1): background customer maintenance, explicit and bounded. */
  maintenance?: MaintenanceConfig;
  /** Job 003wf3 (MANAGED_HANDOVER.md §7, §16.3): managed Gated handovers, off unless enabled. */
  handover?: HandoverConfig;
  /**
   * Job 003wf slice 3 (WRITER_HISTORY.md): the verified accounts of this installation's operators,
   * who may see unresolved writer history and read an attempt's own final status. Configured only.
   */
  operators?: { accounts: string[] };
  /**
   * Job 004b: read-only source connections for import workspaces (GitHub REST, GET only). Each
   * names the repositories it may read; a repository-scoped one names the VARIABLE holding its
   * read-only token (never the token). Unset: connecting a source is unavailable.
   */
  source?: {
    github: {
      origin: string;
      connections: {
        id: string;
        label: string;
        kind: "public" | "repository_scoped";
        repositories: string[];
        credential_env?: string;
      }[];
    };
  };
}

export interface HandoverConfig {
  /** The closer account the Gated contracts name, and one function-call key per binding (Q3). */
  closer: { account: string; keys: { business_id: string; key_file: string }[] };
  interval_ms: number;
  batch: number;
  pass_budget_ms: number;
  op_deadline_ms: number;
  dispatch_margin_ms: number;
  max_orders: number;
  stop_timeout_ms: number;
  /** A function-call key's allowance must be unlimited or at least this many yoctoNEAR. */
  min_allowance_yocto: string;
}

export interface MaintenanceConfig {
  interval_ms: number;
  batch: number;
  pass_budget_ms: number;
  op_deadline_ms: number;
  stop_timeout_ms: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BUSINESS_ID = /^[A-Za-z0-9_-]{1,80}$/;

const bad = (why: string): never => {
  throw new Error(`config: ${why}`);
};

function testnetAccount(v: unknown, what: string): string {
  if (typeof v !== "string" || !isAccountId(v)) return bad(`${what} is not an account id`);
  if (!v.endsWith(".testnet")) return bad(`${what} must be a testnet account (ending .testnet)`);
  return v;
}

function origin(v: unknown, what: string): string {
  let u: URL;
  try {
    u = new URL(String(v));
  } catch {
    return bad(`${what} is not a URL`);
  }
  if (u.origin !== String(v)) return bad(`${what} must be a bare origin`);
  return u.origin;
}

/** Validates an untrusted, parsed config; throws `config: …` with no secret in it. */
export function validateConfig(raw: unknown): AppConfig {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return bad("an object is required");
  if (c.config_version !== 1) bad("config_version must be 1");
  if (c.mode !== "preview" && c.mode !== "configured")
    bad('mode must be "preview" or "configured"');
  if (c.network !== "testnet") bad('network must be "testnet" (mainnet is refused)');
  const mode = c.mode as AppMode;
  const known = new Set([
    "config_version",
    "mode",
    "network",
    "listen",
    "database",
    "web_dist",
    "origins",
    "sign_in",
    "rpc",
    "v3",
    "customer",
    "protected_storage",
    "model",
    "maintenance",
    "handover",
    "operators",
    "source",
  ]);
  for (const k of Object.keys(c)) if (!known.has(k)) bad(`unknown field ${k}`);

  const listen = c.listen as { host?: unknown; port?: unknown } | undefined;
  if (!listen || typeof listen.host !== "string") return bad("listen.host is required");
  if (
    !Number.isSafeInteger(listen.port) ||
    (listen.port as number) < 1 ||
    (listen.port as number) > 65535
  )
    bad("listen.port must be 1 to 65535");
  if (mode === "preview" && !LOOPBACK.has(listen.host))
    bad("preview listens on loopback only (127.0.0.1, ::1 or localhost)");

  if (typeof c.database !== "string" || !c.database) return bad("database is required");
  if (c.database === ":memory:") {
    if (mode !== "preview") bad("a configured application needs a durable database file");
  } else if (!isAbsolute(c.database)) bad("database must be an absolute path");

  if (c.web_dist !== undefined && typeof c.web_dist !== "string") bad("web_dist must be a path");
  let origins: AppConfig["origins"];
  if (c.origins !== undefined) {
    const o = c.origins as { platform?: unknown; preview?: unknown };
    origins = {
      platform: origin(o?.platform, "origins.platform"),
      preview: origin(o?.preview, "origins.preview"),
    };
    if (origins.platform === origins.preview)
      bad("origins.preview must be another site than the platform");
  }

  let rpc: AppConfig["rpc"];
  if (c.rpc !== undefined) {
    const endpoint = (c.rpc as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string") return bad("rpc.endpoint is required");
    try {
      validateRpcConfig({ network: "testnet", endpoint });
    } catch (e) {
      bad((e as Error).message.replace(/^v3 rpc: /, "rpc: "));
    }
    rpc = { endpoint };
  }

  let sign_in: AppConfig["sign_in"];
  if (c.sign_in !== undefined) {
    const s = c.sign_in as {
      recipient?: unknown;
      session_hours?: unknown;
      return_origin?: unknown;
    };
    if (typeof s?.recipient !== "string" || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(s.recipient))
      bad("sign_in.recipient must be a short lowercase application name");
    if (
      s.session_hours !== undefined &&
      (!Number.isSafeInteger(s.session_hours) ||
        (s.session_hours as number) < 1 ||
        (s.session_hours as number) > 168)
    )
      bad("sign_in.session_hours must be 1 to 168");
    if (!rpc) bad("sign_in needs rpc (the account's key is read on NEAR)");
    sign_in = {
      recipient: s.recipient as string,
      session_hours: s.session_hours as number | undefined,
      // Job 003w-e1: where a wallet returns; the callback is <origin>/signin/return exactly.
      ...(s.return_origin !== undefined
        ? { return_origin: origin(s.return_origin, "sign_in.return_origin") }
        : {}),
    };
  }
  if (mode === "configured" && !sign_in)
    bad("a configured application needs sign_in (verified accounts only)");
  if (mode === "preview" && sign_in) bad("preview uses preview sessions; remove sign_in");

  let v3: AppConfig["v3"];
  if (c.v3 !== undefined) {
    const b = (c.v3 as { bindings?: unknown })?.bindings;
    if (!Array.isArray(b) || b.length === 0 || b.length > 100)
      return bad("v3.bindings must list 1 to 100 businesses");
    if (!rpc) bad("v3 needs rpc");
    v3 = {
      bindings: b.map((x, i) => {
        const r = x as { business_id?: unknown; account?: unknown };
        if (typeof r?.business_id !== "string" || !BUSINESS_ID.test(r.business_id))
          bad(`v3.bindings[${i}].business_id is invalid`);
        return {
          business_id: r.business_id as string,
          account: testnetAccount(r.account, `v3.bindings[${i}].account`),
        };
      }),
    };
  }

  let protected_storage: AppConfig["protected_storage"];
  if (c.protected_storage !== undefined) {
    const p = c.protected_storage as {
      root?: unknown;
      active_key_id?: unknown;
      keys_file?: unknown;
    };
    if (typeof p?.root !== "string" || !isAbsolute(p.root))
      bad("protected_storage.root must be absolute");
    if (typeof p?.keys_file !== "string" || !isAbsolute(p.keys_file))
      bad("protected_storage.keys_file must be absolute");
    if (typeof p?.active_key_id !== "string" || !KEY_ID.test(p.active_key_id))
      bad("protected_storage.active_key_id is invalid");
    protected_storage = {
      root: p.root as string,
      active_key_id: p.active_key_id as string,
      keys_file: p.keys_file as string,
    };
  }

  let customer: AppConfig["customer"];
  if (c.customer !== undefined) {
    const cu = c.customer as { operator_account?: unknown; writer?: { key_file?: unknown } };
    customer = {
      operator_account: testnetAccount(cu?.operator_account, "customer.operator_account"),
    };
    if (cu?.writer !== undefined) {
      if (mode !== "configured") bad("the customer writer signs, so it needs configured mode");
      if (typeof cu.writer?.key_file !== "string" || !isAbsolute(cu.writer.key_file))
        bad("customer.writer.key_file must be absolute");
      customer.writer = { key_file: cu.writer.key_file as string };
    }
    if (!rpc) bad("customer use needs rpc");
    if (!protected_storage) bad("customer use needs protected_storage (no plaintext fallback)");
  }

  let model: AppConfig["model"];
  if (c.model !== undefined) {
    const m = c.model as { ai_config_file?: unknown; api_key_env?: unknown };
    if (typeof m?.ai_config_file !== "string" || !isAbsolute(m.ai_config_file))
      bad("model.ai_config_file must be absolute");
    if (typeof m?.api_key_env !== "string" || !ENV_NAME.test(m.api_key_env))
      bad("model.api_key_env must be an environment variable NAME");
    model = { ai_config_file: m.ai_config_file as string, api_key_env: m.api_key_env as string };
  }

  // Job 003wf1 (§12.1): every field explicit and bounded; off unless enabled.
  let maintenance: MaintenanceConfig | undefined;
  if (c.maintenance !== undefined) {
    const m = c.maintenance as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || Array.isArray(m)) bad("maintenance must be an object");
    const mk = m as Record<string, unknown>;
    const fields = [
      "enabled",
      "interval_ms",
      "batch",
      "pass_budget_ms",
      "op_deadline_ms",
      "stop_timeout_ms",
    ];
    for (const k of Object.keys(mk)) if (!fields.includes(k)) bad(`unknown field maintenance.${k}`);
    if (typeof mk.enabled !== "boolean") bad("maintenance.enabled must be true or false");
    const int = (k: string, min: number, max: number) => {
      const v = mk[k];
      if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max)
        bad(`maintenance.${k} must be a whole number from ${min} to ${max}`);
      return v as number;
    };
    if (mk.enabled) {
      maintenance = {
        interval_ms: int("interval_ms", 1_000, 3_600_000),
        batch: int("batch", 1, 25),
        pass_budget_ms: int("pass_budget_ms", 100, 120_000),
        op_deadline_ms: int("op_deadline_ms", 100, 120_000),
        stop_timeout_ms: int("stop_timeout_ms", 100, 120_000),
      };
      if (maintenance.op_deadline_ms > maintenance.pass_budget_ms)
        bad("maintenance.op_deadline_ms can't exceed maintenance.pass_budget_ms");
      if (!customer) bad("maintenance needs customer use (customer, rpc and protected_storage)");
    }
  }

  // Job 003wf3: every field explicit and bounded; off unless enabled. It signs (close_sale with
  // a function-call key), so configured mode only.
  let handover: HandoverConfig | undefined;
  if (c.handover !== undefined) {
    const h = c.handover as Record<string, unknown> | null;
    if (!h || typeof h !== "object" || Array.isArray(h)) bad("handover must be an object");
    const hk = h as Record<string, unknown>;
    const fields = [
      "enabled",
      "closer",
      "interval_ms",
      "batch",
      "pass_budget_ms",
      "op_deadline_ms",
      "dispatch_margin_ms",
      "max_orders",
      "stop_timeout_ms",
      "min_allowance_yocto",
    ];
    for (const k of Object.keys(hk)) if (!fields.includes(k)) bad(`unknown field handover.${k}`);
    if (typeof hk.enabled !== "boolean") bad("handover.enabled must be true or false");
    const int = (k: string, min: number, max: number) => {
      const v = hk[k];
      if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max)
        bad(`handover.${k} must be a whole number from ${min} to ${max}`);
      return v as number;
    };
    if (hk.enabled) {
      if (mode !== "configured") bad("the closer signs, so handover needs configured mode");
      if (!rpc || !v3 || !customer)
        bad("handover needs rpc, v3 bindings and customer use (customer, protected_storage)");
      const cl = hk.closer as { account?: unknown; keys?: unknown } | null;
      const account = testnetAccount(cl?.account, "handover.closer.account");
      if (!Array.isArray(cl?.keys) || cl.keys.length < 1 || cl.keys.length > 32)
        bad("handover.closer.keys lists 1 to 32 bindings");
      const bound = new Set((v3?.bindings ?? []).map((b) => b.business_id));
      const listed = (cl as { keys: { business_id?: unknown; key_file?: unknown }[] }).keys;
      const keys = listed.map((k) => {
        if (typeof k?.business_id !== "string" || !bound.has(k.business_id))
          bad("each handover.closer.keys entry names a bound business_id");
        if (typeof k.key_file !== "string" || !isAbsolute(k.key_file))
          bad("each handover.closer.keys entry has an absolute key_file");
        return { business_id: k.business_id as string, key_file: k.key_file as string };
      });
      if (new Set(keys.map((k) => k.business_id)).size !== keys.length)
        bad("each business has at most one closer key");
      const min = hk.min_allowance_yocto;
      if (typeof min !== "string" || !/^(0|[1-9][0-9]{0,38})$/.test(min))
        bad("handover.min_allowance_yocto is a decimal string of yoctoNEAR");
      handover = {
        closer: { account, keys },
        interval_ms: int("interval_ms", 1_000, 3_600_000),
        batch: int("batch", 1, 25),
        pass_budget_ms: int("pass_budget_ms", 100, 120_000),
        op_deadline_ms: int("op_deadline_ms", 100, 120_000),
        dispatch_margin_ms: int("dispatch_margin_ms", 60_000, 1_200_000),
        max_orders: int("max_orders", 1, 8),
        stop_timeout_ms: int("stop_timeout_ms", 100, 120_000),
        min_allowance_yocto: min as string,
      };
      if (handover.op_deadline_ms > handover.pass_budget_ms)
        bad("handover.op_deadline_ms can't exceed handover.pass_budget_ms");
    }
  }

  let operators: AppConfig["operators"];
  if (c.operators !== undefined) {
    const o = c.operators as { accounts?: unknown } | null;
    if (!o || typeof o !== "object" || Array.isArray(o)) bad("operators must be an object");
    for (const k of Object.keys(o as object))
      if (k !== "accounts") bad(`unknown field operators.${k}`);
    const list = (o as { accounts?: unknown }).accounts;
    if (!Array.isArray(list) || list.length < 1 || list.length > 16)
      bad("operators.accounts lists 1 to 16 accounts");
    for (const a of list as unknown[])
      if (typeof a !== "string" || !isAccountId(a))
        bad("operators.accounts has an invalid account id");
    if (new Set(list as string[]).size !== (list as string[]).length)
      bad("operators.accounts lists an account twice");
    if (mode !== "configured") bad("operators need configured mode (verified sign-in)");
    if (!c.sign_in) bad("operators need sign_in (verified identity)");
    operators = { accounts: [...(list as string[])] };
  }

  let source: AppConfig["source"];
  if (c.source !== undefined) {
    const g = (c.source as { github?: Record<string, unknown> } | null)?.github;
    if (!g || typeof g !== "object") bad("source.github is required");
    const gh = g as Record<string, unknown>;
    if (gh.origin !== "https://api.github.com")
      bad('source.github.origin must be "https://api.github.com"');
    const list = gh.connections;
    if (!Array.isArray(list) || list.length < 1 || list.length > 8)
      bad("source.github.connections lists 1 to 8");
    const ids = new Set<string>();
    const connections = (list as Record<string, unknown>[]).map((x) => {
      if (typeof x.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(x.id) || ids.has(x.id))
        bad("each source connection needs a unique id (a-z, 0-9, -)");
      ids.add(x.id as string);
      if (typeof x.label !== "string" || !x.label.trim() || x.label.length > 80)
        bad("each source connection needs a label");
      if (x.kind !== "public" && x.kind !== "repository_scoped")
        bad("a source connection is public or repository_scoped");
      const repos = x.repositories;
      if (
        !Array.isArray(repos) ||
        repos.length < 1 ||
        repos.length > 50 ||
        !repos.every(
          (r) => typeof r === "string" && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r),
        )
      )
        bad("a source connection lists 1 to 50 repositories as owner/name");
      if (
        x.kind === "repository_scoped" &&
        (typeof x.credential_env !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(x.credential_env))
      )
        bad(
          "a repository_scoped connection names its credential_env (an environment variable NAME)",
        );
      if (x.kind === "public" && x.credential_env !== undefined)
        bad("a public connection has no credential");
      return {
        id: x.id as string,
        label: (x.label as string).trim(),
        kind: x.kind as "public" | "repository_scoped",
        repositories: [...(repos as string[])],
        ...(x.kind === "repository_scoped" ? { credential_env: x.credential_env as string } : {}),
      };
    });
    source = { github: { origin: "https://api.github.com", connections } };
  }

  return {
    config_version: 1,
    mode,
    network: "testnet",
    listen: { host: listen.host, port: listen.port as number },
    database: c.database as string,
    ...(c.web_dist !== undefined ? { web_dist: c.web_dist as string } : {}),
    ...(origins ? { origins } : {}),
    ...(sign_in ? { sign_in } : {}),
    ...(rpc ? { rpc } : {}),
    ...(v3 ? { v3 } : {}),
    ...(customer ? { customer } : {}),
    ...(protected_storage ? { protected_storage } : {}),
    ...(model ? { model } : {}),
    ...(maintenance ? { maintenance } : {}),
    ...(handover ? { handover } : {}),
    ...(operators ? { operators } : {}),
    ...(source ? { source } : {}),
  };
}
