// Job 004a: bring an existing digital product. A private import workspace belongs to a business
// (so it moves with the business if it is sold). The founder supplies a package.json file or its
// text; an inspector reads only explicit metadata fields and declared dependencies from it. Code
// is never fetched, installed or run, scripts are never stored, and anything that looks like a
// credential is refused before anything is saved. Each inspection is an immutable snapshot with
// its own readiness report; the founder's own statements about the product's accounts are kept
// apart from what the manifest shows, and nothing here is ever "verified": that needs connected
// accounts, which are a later step.

import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

// ---------- limits ----------

export const IMPORT_LIMITS = {
  manifestBytes: 64 * 1024,
  depth: 8,
  keys: 4000,
  depsPerGroup: 300,
  depsTotal: 600,
  name: 214,
  ref: 80,
  text: 200,
  description: 1000,
  note: 300,
  productName: 80,
  businessName: 80,
  key: 100,
} as const;

const bad = (message: string, status: 400 | 409 | 413 = 400): never => {
  throw new HttpError(status, message);
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function text(value: unknown, max: number, what: string, multiline = false): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return bad(`${what} must be text`);
  let s = value.replace(CONTROL, "");
  if (!multiline) s = s.replace(/[\r\n\t]+/g, " ");
  s = s.trim();
  if (s.length > max) bad(`${what} is too long (at most ${max} characters)`);
  return s;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();

// ---------- what the inventory tracks ----------

export const CATEGORIES = [
  "source_ownership",
  "hosting",
  "database",
  "model_provider",
  "authentication",
  "payments",
  "domain",
  "customer_promises",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** How each item moves to a new owner, what breaks if it doesn't, and who has to act. */
export const TRANSFER: Record<
  Category,
  {
    label: string;
    mechanism: string;
    risk: "high" | "medium";
    risk_text: string;
    who: string;
    ask: string;
  }
> = {
  source_ownership: {
    label: "Source code and its ownership",
    mechanism:
      "The repository moves to the new owner's account, or they are made its administrator; the licence of everything in it is confirmed.",
    risk: "high",
    risk_text: "Without the code nobody can fix or change the product.",
    who: "The current owner, with the buyer",
    ask: "Say where the code lives and who controls that account.",
  },
  hosting: {
    label: "Where the product runs",
    mechanism:
      "The hosting project or account is transferred, or the new owner redeploys on their own account before the old one is shut down.",
    risk: "high",
    risk_text: "The product goes offline if hosting lapses during the handover.",
    who: "The current owner",
    ask: "Say where the product is hosted, or that it isn't hosted yet.",
  },
  database: {
    label: "Customer data storage",
    mechanism:
      "Ownership of the database moves, or its data is exported and imported, with customers told where their data now lives.",
    risk: "high",
    risk_text: "Customer records and what they were promised live here.",
    who: "The current owner, then the buyer",
    ask: "Say which database holds customer data, or that there isn't one.",
  },
  model_provider: {
    label: "AI model provider",
    mechanism:
      "The new owner opens their own provider account and sets new keys. Keys are never handed over through Everstreet.",
    risk: "medium",
    risk_text: "AI requests fail until the new owner's keys are in place.",
    who: "The buyer",
    ask: "Say which AI model provider the product uses, or that it uses none.",
  },
  authentication: {
    label: "Customer sign-in",
    mechanism:
      "The sign-in provider's project moves with customer accounts intact, or customers are asked to verify again.",
    risk: "high",
    risk_text: "Customers could be locked out of what they paid for.",
    who: "The current owner, with the buyer",
    ask: "Say how customers sign in, or that they don't.",
  },
  payments: {
    label: "Customer payments",
    mechanism:
      "Payment accounts belong to a person or company: the new owner sets up their own, and subscriptions may need customers to agree again.",
    risk: "high",
    risk_text: "Billing can stop, and customers must not be charged without consent.",
    who: "The buyer, with the current owner",
    ask: "Say how customers pay, or that the product is free.",
  },
  domain: {
    label: "Domain name",
    mechanism: "The domain registration is transferred at its registrar.",
    risk: "medium",
    risk_text: "Links, sign-in pages and email break if it lapses.",
    who: "The current owner",
    ask: "Say which domain the product uses, or that it has none.",
  },
  customer_promises: {
    label: "What customers were promised",
    mechanism:
      "Prepaid access, plans, support and data commitments are listed so the new owner honours them.",
    risk: "high",
    risk_text: "These are obligations to real customers.",
    who: "The current owner, then the buyer",
    ask: "List what customers have paid for or been promised, or say there are no customers yet.",
  },
};

export const PRODUCT_KINDS = [
  "saas",
  "api",
  "ai_tool",
  "agent",
  "website",
  "online_service",
  "near_app",
  "other",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

// ---------- the inspector seam ----------

export type SourceKind = "package_json";

export interface InspectionInput {
  kind: SourceKind;
  file_name: string | null;
  content: string;
}

export const GROUPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
export type Group = (typeof GROUPS)[number];

export type RefKind =
  | "registry_range"
  | "tag"
  | "workspace"
  | "alias"
  | "git"
  | "url"
  | "file"
  | "other";

export interface DependencyFact {
  name: string;
  group: Group;
  ref_kind: RefKind;
  /** The version range or tag; null for git, URL and file references (not kept). */
  ref: string | null;
}

export interface Detection {
  /** An inventory category, or "framework"/"tooling" for what the product is built with. */
  category: Category | "framework" | "tooling";
  label: string;
  packages: string[];
  /** Every matching package is only a development dependency. */
  dev_only: boolean;
}

export interface InspectionFacts {
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
    license: string | null;
    private: boolean | null;
    module_type: string | null;
    node_engine: string | null;
    package_manager: string | null;
    /** Scripts are never stored; only how many there were. */
    scripts_count: number;
    /** A repository field was present. It is not evidence of who owns the code. */
    repository_field: boolean;
  };
  dependencies: DependencyFact[];
  counts: {
    total: number;
    by_group: Record<Group, number>;
    by_ref_kind: Partial<Record<RefKind, number>>;
  };
  detections: Detection[];
  shape: { guess: "web_app" | "api_service" | "unknown"; basis: string };
  skipped: { invalid_names: number };
}

/**
 * Reads supplied source material into normalized facts. Implementations must not execute,
 * install or fetch anything. Later slices add authorized repository or deployment providers
 * behind this same seam.
 */
export interface ImportInspector {
  id: string;
  version: string;
  kind: SourceKind;
  inspect(input: InspectionInput): Promise<InspectionFacts>;
}

// ---------- package.json inspection ----------

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CREDENTIAL_KEY =
  /^(_?auth|_?authtoken|_?password|passwd|secret|client_?secret|token|access_?token|refresh_?token|api_?key|apikey|private_?key|access_?key(_?id)?|secret_?access_?key|npm_?token|github_?token|credentials?)$/i;
const SECRET_VALUE: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\b[rs]k_live_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
];
/** A URL carrying a password, or a user name other than the conventional "git". */
const URL_CREDENTIAL = /[a-z][a-z0-9+.-]*:\/\/([^/\s@]+)@/i;

function urlHasCredential(s: string): boolean {
  const m = URL_CREDENTIAL.exec(s);
  if (!m) return false;
  const userinfo = m[1] ?? "";
  return userinfo.includes(":") || userinfo.toLowerCase() !== "git";
}

/** Walks the parsed JSON once, refusing dangerous keys, credentials and excessive structure. */
function screen(value: unknown) {
  let keys = 0;
  const walk = (v: unknown, depth: number, path: string) => {
    if (depth > IMPORT_LIMITS.depth)
      bad("This file is nested too deeply to be a package manifest.");
    if (typeof v === "string") {
      if (SECRET_VALUE.some((r) => r.test(v)))
        bad(
          `The value at ${path} looks like a secret key or token. Remove it from the file and try again; nothing was saved.`,
        );
      if (urlHasCredential(v))
        bad(
          `The value at ${path} is a URL with a user name or password in it. Remove the credentials and try again; nothing was saved.`,
        );
      return;
    }
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, depth + 1, `${path}[${i}]`);
      return;
    }
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        keys++;
        if (keys > IMPORT_LIMITS.keys)
          bad("This file has too many entries to be a package manifest.");
        const shown = k.replace(/[^\w@./:-]/g, "?").slice(0, 40);
        if (FORBIDDEN_KEYS.has(k))
          bad(`The file contains a key named "${shown}", which isn't allowed.`);
        if (CREDENTIAL_KEY.test(k))
          bad(
            `The file has a "${shown}" field, which holds credentials. Remove it and try again; nothing was saved.`,
          );
        walk((v as Record<string, unknown>)[k], depth + 1, `${path}.${shown}`);
      }
    }
  };
  walk(value, 0, "the top");
}

const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

function packageName(raw: string): string | null {
  const n = raw.trim().toLowerCase();
  return n.length > 0 && n.length <= IMPORT_LIMITS.name && NAME.test(n) ? n : null;
}

const TAGS = /^[a-z][a-z0-9-]*$/i;
const RANGE = /^[\s0-9a-zA-Z^~<>=*.|+-]+$/;

export function classifyRef(spec: string): { kind: RefKind; ref: string | null } {
  const s = spec.trim();
  const keep = (kind: RefKind) => ({ kind, ref: s.slice(0, IMPORT_LIMITS.ref) });
  if (s.length > 256) return { kind: "other", ref: null };
  if (/^workspace:/.test(s)) return keep("workspace");
  if (/^npm:/.test(s))
    return /[:/]{2}/.test(s.slice(4)) ? { kind: "other", ref: null } : keep("alias");
  if (/^(file:|link:|\.{1,2}\/|~\/|\/)/.test(s)) return { kind: "file", ref: null };
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|gist:)/.test(s)) return { kind: "git", ref: null };
  if (/^https?:\/\//i.test(s)) return { kind: "url", ref: null };
  if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(s)) return { kind: "git", ref: null }; // user/repo shorthand
  if (s === "" || s === "*" || s === "x" || s === "X") return keep("registry_range");
  if (TAGS.test(s) && !/^v?\d/.test(s)) return keep("tag");
  if (RANGE.test(s) && /[\d*xX]/.test(s)) return keep("registry_range");
  return { kind: "other", ref: null };
}

/** Bounded name-based heuristics: what a manifest declares, never proof of how it is built. */
const DETECTORS: {
  category: Detection["category"];
  label: string;
  match: (n: string) => boolean;
}[] = [
  { category: "framework", label: "Next.js", match: (n) => n === "next" },
  { category: "framework", label: "React", match: (n) => n === "react" || n === "react-dom" },
  { category: "framework", label: "Vue", match: (n) => n === "vue" || n === "nuxt" },
  { category: "framework", label: "Svelte", match: (n) => n === "svelte" || n === "@sveltejs/kit" },
  { category: "framework", label: "Remix", match: (n) => n.startsWith("@remix-run/") },
  { category: "framework", label: "Astro", match: (n) => n === "astro" },
  { category: "framework", label: "Angular", match: (n) => n === "@angular/core" },
  { category: "framework", label: "Express", match: (n) => n === "express" },
  { category: "framework", label: "Fastify", match: (n) => n === "fastify" },
  { category: "framework", label: "Hono", match: (n) => n === "hono" },
  { category: "framework", label: "NestJS", match: (n) => n === "@nestjs/core" },
  { category: "framework", label: "Koa", match: (n) => n === "koa" },
  { category: "tooling", label: "TypeScript", match: (n) => n === "typescript" },
  { category: "tooling", label: "Vite", match: (n) => n === "vite" },
  { category: "tooling", label: "Webpack", match: (n) => n === "webpack" },
  { category: "tooling", label: "Tailwind CSS", match: (n) => n === "tailwindcss" },
  {
    category: "tooling",
    label: "Test runner",
    match: (n) => ["vitest", "jest", "mocha", "@playwright/test"].includes(n),
  },
  {
    category: "hosting",
    label: "Vercel",
    match: (n) => n === "vercel" || n.startsWith("@vercel/"),
  },
  {
    category: "hosting",
    label: "Netlify",
    match: (n) => n === "netlify-cli" || n.startsWith("@netlify/"),
  },
  {
    category: "hosting",
    label: "Cloudflare",
    match: (n) => n === "wrangler" || n.startsWith("@cloudflare/"),
  },
  {
    category: "hosting",
    label: "AWS",
    match: (n) => n === "aws-cdk-lib" || n.startsWith("@aws-sdk/") || n === "serverless",
  },
  {
    category: "hosting",
    label: "Firebase hosting/functions",
    match: (n) => n === "firebase-functions" || n === "firebase-tools",
  },
  {
    category: "database",
    label: "PostgreSQL",
    match: (n) => ["pg", "postgres", "@neondatabase/serverless", "@vercel/postgres"].includes(n),
  },
  {
    category: "database",
    label: "MySQL",
    match: (n) => n === "mysql2" || n === "mysql" || n === "@planetscale/database",
  },
  { category: "database", label: "MongoDB", match: (n) => n === "mongodb" || n === "mongoose" },
  {
    category: "database",
    label: "SQLite",
    match: (n) => n === "better-sqlite3" || n === "sqlite3" || n === "@libsql/client",
  },
  {
    category: "database",
    label: "Redis",
    match: (n) => n === "redis" || n === "ioredis" || n === "@upstash/redis",
  },
  { category: "database", label: "Supabase", match: (n) => n === "@supabase/supabase-js" },
  {
    category: "database",
    label: "Prisma (ORM)",
    match: (n) => n === "prisma" || n === "@prisma/client",
  },
  { category: "database", label: "Drizzle (ORM)", match: (n) => n === "drizzle-orm" },
  { category: "database", label: "Firebase database", match: (n) => n === "firebase-admin" },
  {
    category: "model_provider",
    label: "OpenAI",
    match: (n) => n === "openai" || n === "@ai-sdk/openai",
  },
  {
    category: "model_provider",
    label: "Anthropic",
    match: (n) => n === "@anthropic-ai/sdk" || n === "@ai-sdk/anthropic",
  },
  {
    category: "model_provider",
    label: "Google AI",
    match: (n) => ["@google/generative-ai", "@google/genai", "@ai-sdk/google"].includes(n),
  },
  { category: "model_provider", label: "Mistral", match: (n) => n === "@mistralai/mistralai" },
  { category: "model_provider", label: "Cohere", match: (n) => n === "cohere-ai" },
  { category: "model_provider", label: "Groq", match: (n) => n === "groq-sdk" },
  { category: "model_provider", label: "Replicate", match: (n) => n === "replicate" },
  {
    category: "model_provider",
    label: "AI SDK or framework (provider not named)",
    match: (n) => n === "ai" || n === "langchain" || n.startsWith("@langchain/"),
  },
  {
    category: "authentication",
    label: "Auth.js / NextAuth",
    match: (n) => n === "next-auth" || n === "@auth/core",
  },
  { category: "authentication", label: "Clerk", match: (n) => n.startsWith("@clerk/") },
  {
    category: "authentication",
    label: "Auth0",
    match: (n) => n === "auth0" || n.startsWith("@auth0/"),
  },
  { category: "authentication", label: "Passport", match: (n) => n === "passport" },
  { category: "authentication", label: "Lucia", match: (n) => n === "lucia" },
  { category: "authentication", label: "Better Auth", match: (n) => n === "better-auth" },
  {
    category: "authentication",
    label: "Supabase Auth",
    match: (n) => n.startsWith("@supabase/auth") || n === "@supabase/ssr",
  },
  { category: "authentication", label: "Firebase Auth", match: (n) => n === "firebase" },
  {
    category: "payments",
    label: "Stripe",
    match: (n) => n === "stripe" || n.startsWith("@stripe/"),
  },
  { category: "payments", label: "Paddle", match: (n) => n.startsWith("@paddle/") },
  { category: "payments", label: "Lemon Squeezy", match: (n) => n.startsWith("@lemonsqueezy/") },
  { category: "payments", label: "PayPal", match: (n) => n.startsWith("@paypal/") },
  {
    category: "payments",
    label: "NEAR libraries (payments or on-chain logic)",
    match: (n) =>
      n === "near-api-js" ||
      n.startsWith("@near-js/") ||
      n.startsWith("@near-wallet-selector/") ||
      n === "near-sdk-js",
  },
];

const FRONTEND = new Set(["Next.js", "React", "Vue", "Svelte", "Remix", "Astro", "Angular"]);
const SERVER = new Set(["Express", "Fastify", "Hono", "NestJS", "Koa"]);

function opt(o: Record<string, unknown>, k: string, max: number): string | null {
  const v = o[k];
  if (typeof v !== "string") return null;
  const s = v
    .replace(CONTROL, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return s ? s.slice(0, max) : null;
}

export function inspectPackageJson(content: string): InspectionFacts {
  if (Buffer.byteLength(content, "utf8") > IMPORT_LIMITS.manifestBytes)
    bad("The file is larger than 64 KiB. Supply only the package.json file.", 413);
  if (content.includes("\u0000")) bad("This looks like a binary file, not a package.json file.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return bad(
      "This isn't valid JSON. Supply the package.json file exactly as it is in your project.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    bad("A package.json file is a JSON object with fields like name and dependencies.");
  screen(parsed);
  const o = parsed as Record<string, unknown>;
  const engines =
    o.engines && typeof o.engines === "object" && !Array.isArray(o.engines)
      ? (o.engines as Record<string, unknown>)
      : {};
  const scripts =
    o.scripts && typeof o.scripts === "object" && !Array.isArray(o.scripts)
      ? Object.keys(o.scripts).length
      : 0;
  const deps: DependencyFact[] = [];
  let invalid = 0;
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const group of GROUPS) {
    const g = o[group];
    if (g === undefined) continue;
    if (!g || typeof g !== "object" || Array.isArray(g))
      bad(`"${group}" must be an object of package names and versions.`);
    const entries = Object.entries(g as Record<string, unknown>);
    if (entries.length > IMPORT_LIMITS.depsPerGroup)
      bad(`"${group}" lists more than ${IMPORT_LIMITS.depsPerGroup} packages.`);
    for (const [rawName, spec] of entries) {
      const name = packageName(rawName);
      if (!name || typeof spec !== "string") {
        invalid++;
        continue;
      }
      const { kind, ref } = classifyRef(spec);
      deps.push({ name, group, ref_kind: kind, ref });
      byGroup[group]++;
    }
  }
  if (deps.length > IMPORT_LIMITS.depsTotal)
    bad(`The file lists more than ${IMPORT_LIMITS.depsTotal} packages in total.`);
  const byKind: Partial<Record<RefKind, number>> = {};
  for (const d of deps) byKind[d.ref_kind] = (byKind[d.ref_kind] ?? 0) + 1;
  const detections: Detection[] = [];
  for (const det of DETECTORS) {
    const hits = deps.filter((d) => det.match(d.name));
    if (!hits.length) continue;
    const packages = [...new Set(hits.map((h) => h.name))].sort();
    detections.push({
      category: det.category,
      label: det.label,
      packages,
      dev_only: hits.every((h) => h.group === "devDependencies"),
    });
  }
  const runtime = detections
    .filter((d) => d.category === "framework" && !d.dev_only)
    .map((d) => d.label);
  const front = runtime.filter((l) => FRONTEND.has(l));
  const server = runtime.filter((l) => SERVER.has(l));
  const shape: InspectionFacts["shape"] = front.length
    ? { guess: "web_app", basis: `Declares ${front.join(", ")}` }
    : server.length
      ? { guess: "api_service", basis: `Declares ${server.join(", ")} and no front-end framework` }
      : { guess: "unknown", basis: "No framework this inspector recognizes is declared" };
  const name = typeof o.name === "string" ? packageName(o.name) : null;
  return {
    package: {
      name,
      version: opt(o, "version", 64),
      description: opt(o, "description", IMPORT_LIMITS.text),
      license: opt(o, "license", 64),
      private: typeof o.private === "boolean" ? o.private : null,
      module_type: o.type === "module" || o.type === "commonjs" ? o.type : null,
      node_engine: opt(engines, "node", 64),
      package_manager: opt(o, "packageManager", 64),
      scripts_count: scripts,
      repository_field: o.repository !== undefined,
    },
    dependencies: deps,
    counts: { total: deps.length, by_group: byGroup, by_ref_kind: byKind },
    detections,
    shape,
    skipped: { invalid_names: invalid },
  };
}

export const packageManifestInspector: ImportInspector = {
  id: "package-json",
  version: "1",
  kind: "package_json",
  inspect: async (input) => inspectPackageJson(input.content),
};

/** Checks the supplied file's name and size before anything else reads it. */
export function supplied(raw: unknown): InspectionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return bad("Supply the package.json file or paste its text.");
  const m = raw as Record<string, unknown>;
  if (typeof m.content !== "string" || !m.content.trim())
    bad("Supply the package.json file or paste its text.");
  const content = m.content as string;
  if (Buffer.byteLength(content, "utf8") > IMPORT_LIMITS.manifestBytes)
    bad("The file is larger than 64 KiB. Supply only the package.json file.", 413);
  let fileName: string | null = null;
  if (m.file_name !== undefined && m.file_name !== null && m.file_name !== "") {
    if (typeof m.file_name !== "string") bad("The file name must be text.");
    const f = m.file_name as string;
    if (f.includes("/") || f.includes("\\") || f.includes("..") || f.includes("\u0000"))
      bad("Supply the file itself; paths aren't accepted.");
    if (f !== "package.json")
      bad("Only a file named package.json can be inspected in this step. Other files aren't read.");
    fileName = f;
  }
  return { kind: "package_json", file_name: fileName, content };
}

// ---------- readiness ----------

export type ItemStatus = "verified" | "detected" | "declared" | "unknown";

export interface Assertion {
  uses: boolean;
  note: string;
  by: string;
  at: string;
}

export interface ReportItem {
  category: Category;
  label: string;
  status: ItemStatus;
  evidence: { kind: "detected" | "declared" | "verified"; text: string }[];
  mechanism: string;
  risk: "high" | "medium";
  risk_text: string;
  who: string;
  next_step: string;
}

export interface Report {
  headline: string;
  counts: Record<ItemStatus, number>;
  next_action: { category: Category | null; text: string };
  items: ReportItem[];
  inspection_number: number | null;
  basis: string;
}

const ORDER: Category[] = [
  "source_ownership",
  "hosting",
  "database",
  "payments",
  "authentication",
  "customer_promises",
  "model_provider",
  "domain",
];

/** A pure function of the latest facts and the founder's statements. Never "ready". */
export function readiness(
  facts: InspectionFacts | null,
  inspection: number | null,
  assertions: Partial<Record<Category, Assertion | null>>,
): Report {
  const items: ReportItem[] = CATEGORIES.map((category) => {
    const t = TRANSFER[category];
    const found = (facts?.detections ?? []).filter((d) => d.category === category);
    const a = assertions[category] ?? null;
    const evidence: ReportItem["evidence"] = [];
    for (const d of found)
      evidence.push({
        kind: "detected",
        text: `Detected in manifest: ${d.label} (${d.packages.join(", ")}${d.dev_only ? ", development only" : ""})`,
      });
    if (a)
      evidence.push({
        kind: "declared",
        text: a.uses
          ? `You said: ${a.note || "used"}`
          : `You said it isn't used${a.note ? `: ${a.note}` : ""}`,
      });
    const status: ItemStatus = found.length ? "detected" : a ? "declared" : "unknown";
    const next_step =
      !found.length && !a
        ? t.ask
        : found.length && !a
          ? "Confirm which account this is and who controls it."
          : "Recorded. Verifying it needs a connected account, which comes in a later step.";
    return {
      category,
      label: t.label,
      status,
      evidence,
      mechanism: t.mechanism,
      risk: t.risk,
      risk_text: t.risk_text,
      who: t.who,
      next_step,
    };
  });
  const counts: Record<ItemStatus, number> = { verified: 0, detected: 0, declared: 0, unknown: 0 };
  for (const i of items) counts[i.status]++;
  const byOrder = ORDER.map((c) => items.find((i) => i.category === c) as ReportItem);
  const first =
    byOrder.find((i) => i.status === "unknown") ??
    byOrder.find((i) => i.status === "detected" && !i.evidence.some((e) => e.kind === "declared"));
  return {
    headline:
      "Not ready to transfer: nothing here is verified yet. Connecting accounts to verify them comes in a later step.",
    counts,
    next_action: first
      ? { category: first.category, text: `${first.label}: ${first.next_step}` }
      : {
          category: null,
          text: "Everything is recorded. Nothing more can be checked here until accounts can be connected.",
        },
    items,
    inspection_number: inspection,
    basis:
      inspection === null
        ? "No manifest inspected yet; only what you have said."
        : `Inspection ${inspection} of the supplied package.json, and what you have said.`,
  };
}

// ---------- the workspace ----------

interface WorkspaceRow {
  id: string;
  business_id: string;
  name: string;
  description: string;
  product_kind: ProductKind;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface InspectionRow {
  workspace_id: string;
  number: number;
  inspector: string;
  inspector_version: string;
  input_digest: string;
  input_bytes: number;
  facts: string;
  idempotency_key: string;
  requested_by: string;
  created_at: string;
}

interface DependencyRow {
  workspace_id: string;
  category: Category;
  uses: number | null;
  note: string;
  asserted_by: string | null;
  asserted_at: string | null;
  version: number;
}

const SCOPE_NOTE =
  "What is inspected: the package.json file you supply, and only its package metadata (name, version, description, licence, engines) and its declared dependencies. Your code isn't fetched, installed or run. Scripts are ignored and not stored. Anything that looks like a credential is refused before anything is saved.";

export class Imports {
  private readonly inspectors: Map<SourceKind, ImportInspector>;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    inspectors: ImportInspector[] = [packageManifestInspector],
  ) {
    this.inspectors = new Map(inspectors.map((i) => [i.kind, i]));
  }

  private event(type: string, subject: string, actor: string, payload: object) {
    this.db
      .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
      .run(type, subject, actor, JSON.stringify(payload), now());
  }

  /** The workspace if the viewer owns its business right now; the same 404 otherwise. */
  private owned(viewer: Person, id: string): WorkspaceRow {
    const row = this.db
      .prepare(
        "SELECT w.* FROM import_workspaces w JOIN businesses b ON b.id = w.business_id WHERE w.id = ? AND b.owner_id = ?",
      )
      .get(String(id), viewer.id) as unknown as WorkspaceRow | undefined;
    if (!row) throw new HttpError(404, "No such import");
    return row;
  }

  private inspector(): ImportInspector {
    const i = this.inspectors.get("package_json");
    if (!i) throw new HttpError(409, "No inspector for package.json files is available here");
    return i;
  }

  private assertions(id: string): Partial<Record<Category, Assertion | null>> {
    const rows = this.db
      .prepare("SELECT * FROM import_dependencies WHERE workspace_id = ?")
      .all(id) as unknown as DependencyRow[];
    const out: Partial<Record<Category, Assertion | null>> = {};
    for (const r of rows)
      out[r.category] =
        r.uses === null
          ? null
          : {
              uses: r.uses === 1,
              note: r.note,
              by: this.name(r.asserted_by),
              at: r.asserted_at ?? "",
            };
    return out;
  }

  private name(personId: string | null) {
    if (!personId) return "";
    const p = this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(personId) as
      | { display_name: string }
      | undefined;
    return p?.display_name ?? "";
  }

  private latest(id: string): InspectionRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM import_inspections WHERE workspace_id = ? ORDER BY number DESC LIMIT 1",
      )
      .get(id) as unknown as InspectionRow | undefined;
  }

  private parseKind(v: unknown): ProductKind {
    if (v === undefined || v === null || v === "") return "other";
    if (!PRODUCT_KINDS.includes(v as ProductKind)) bad("Choose what kind of product it is");
    return v as ProductKind;
  }

  /** Every workspace across the viewer's businesses, or one business's. */
  list(viewer: Person, businessId?: string) {
    if (businessId) this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare(
        `SELECT w.*, b.name AS business_name FROM import_workspaces w JOIN businesses b ON b.id = w.business_id
         WHERE b.owner_id = ? ${businessId ? "AND b.id = ?" : ""} ORDER BY w.updated_at DESC`,
      )
      .all(...(businessId ? [viewer.id, businessId] : [viewer.id])) as unknown as (WorkspaceRow & {
      business_name: string;
    })[];
    return rows.map((w) => {
      const last = this.latest(w.id);
      const report = readiness(
        last ? (JSON.parse(last.facts) as InspectionFacts) : null,
        last?.number ?? null,
        this.assertions(w.id),
      );
      return {
        id: w.id,
        business_id: w.business_id,
        business_name: w.business_name,
        name: w.name,
        product_kind: w.product_kind,
        inspections: last?.number ?? 0,
        counts: report.counts,
        unresolved: report.counts.unknown + report.counts.detected + report.counts.declared,
        updated_at: w.updated_at,
      };
    });
  }

  view(viewer: Person, id: string) {
    const w = this.owned(viewer, id);
    const business = this.store.ownedBusiness(viewer, w.business_id);
    const generation = this.store.controlEpoch(viewer, w.business_id).generation;
    const inspections = this.db
      .prepare(
        "SELECT number, inspector, inspector_version, input_digest, input_bytes, facts, created_at, requested_by FROM import_inspections WHERE workspace_id = ? ORDER BY number DESC",
      )
      .all(w.id) as unknown as InspectionRow[];
    const head = inspections[0];
    const facts = head ? (JSON.parse(head.facts) as InspectionFacts) : null;
    const assertions = this.assertions(w.id);
    const versions = Object.fromEntries(
      (
        this.db
          .prepare("SELECT category, version FROM import_dependencies WHERE workspace_id = ?")
          .all(w.id) as unknown as {
          category: Category;
          version: number;
        }[]
      ).map((r) => [r.category, r.version]),
    ) as Record<Category, number>;
    const reports = this.db
      .prepare(
        "SELECT number, inspection_number, report, created_at FROM import_reports WHERE workspace_id = ? ORDER BY number DESC",
      )
      .all(w.id) as unknown as {
      number: number;
      inspection_number: number;
      report: string;
      created_at: string;
    }[];
    return {
      workspace: {
        id: w.id,
        name: w.name,
        description: w.description,
        product_kind: w.product_kind,
        version: w.version,
        private: true,
        created_at: w.created_at,
        updated_at: w.updated_at,
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          published: Boolean(business.published_at),
        },
        /** Changes when the business changes hands; the browser scopes its state to it. */
        owner_epoch: `${business.owner_id}:${generation}`,
      },
      scope: SCOPE_NOTE,
      source: {
        latest: head
          ? {
              number: head.number,
              inspector: head.inspector,
              inspector_version: head.inspector_version,
              input_digest: head.input_digest,
              input_bytes: head.input_bytes,
              created_at: head.created_at,
              facts,
            }
          : null,
        history: inspections.map((i) => ({
          number: i.number,
          inspector: i.inspector,
          inspector_version: i.inspector_version,
          input_digest: i.input_digest,
          input_bytes: i.input_bytes,
          dependency_count: (JSON.parse(i.facts) as InspectionFacts).counts.total,
          by: this.name(i.requested_by),
          created_at: i.created_at,
        })),
      },
      inventory: CATEGORIES.map((c) => ({
        category: c,
        label: TRANSFER[c].label,
        assertion: assertions[c] ?? null,
        version: versions[c] ?? 0,
      })),
      report: {
        live: readiness(facts, head?.number ?? null, assertions),
        history: reports.map((r) => {
          const rep = JSON.parse(r.report) as Report;
          return {
            number: r.number,
            inspection_number: r.inspection_number,
            counts: rep.counts,
            created_at: r.created_at,
          };
        }),
      },
    };
  }

  inspection(viewer: Person, id: string, n: number) {
    const w = this.owned(viewer, id);
    const r = this.db
      .prepare("SELECT * FROM import_inspections WHERE workspace_id = ? AND number = ?")
      .get(w.id, n) as unknown as InspectionRow | undefined;
    if (!r) throw new HttpError(404, "No such inspection");
    return {
      number: r.number,
      inspector: r.inspector,
      inspector_version: r.inspector_version,
      input_digest: r.input_digest,
      input_bytes: r.input_bytes,
      created_at: r.created_at,
      facts: JSON.parse(r.facts) as InspectionFacts,
    };
  }

  report(viewer: Person, id: string, n: number) {
    const w = this.owned(viewer, id);
    const r = this.db
      .prepare("SELECT * FROM import_reports WHERE workspace_id = ? AND number = ?")
      .get(w.id, n) as unknown as
      | { number: number; inspection_number: number; report: string; created_at: string }
      | undefined;
    if (!r) throw new HttpError(404, "No such report");
    return {
      number: r.number,
      inspection_number: r.inspection_number,
      created_at: r.created_at,
      report: JSON.parse(r.report) as Report,
    };
  }

  /**
   * Creates a workspace (and, if named, a new private business) with an optional first
   * inspection, all in one transaction. The same idempotency key with the same request returns
   * the same workspace; with a different request it is refused.
   */
  async create(viewer: Person, input: Record<string, unknown>) {
    const key = text(input.idempotency_key, IMPORT_LIMITS.key, "The request key");
    if (!key) bad("A request key is required (idempotency_key)");
    const name = text(input.name, IMPORT_LIMITS.productName, "The product name");
    if (!name) bad("Name the product you are bringing");
    const description = text(input.description, IMPORT_LIMITS.description, "The description", true);
    const kind = this.parseKind(input.product_kind);
    const businessId = input.business_id ? String(input.business_id) : null;
    const newBusiness = text(
      input.new_business_name,
      IMPORT_LIMITS.businessName,
      "The business name",
    );
    if (Boolean(businessId) === Boolean(newBusiness))
      bad("Choose one of your businesses, or name a new private business for it");
    const manifest =
      input.manifest === undefined || input.manifest === null ? null : supplied(input.manifest);
    const digest = manifest ? sha256(manifest.content) : null;
    const requestHash = sha256(
      JSON.stringify({ businessId, newBusiness, name, description, kind, digest }),
    );

    const replay = () => {
      const r = this.db
        .prepare(
          "SELECT request_hash, workspace_id FROM import_requests WHERE person_id = ? AND idempotency_key = ?",
        )
        .get(viewer.id, key) as { request_hash: string; workspace_id: string } | undefined;
      if (!r) return null;
      if (r.request_hash !== requestHash)
        bad("This request key was already used for a different import. Nothing was changed.", 409);
      return r.workspace_id;
    };
    const earlier = replay();
    if (earlier) return { created: false, view: this.view(viewer, earlier) };

    const epoch = businessId ? this.store.controlEpoch(viewer, businessId) : null;
    const inspector = manifest ? this.inspector() : null;
    const facts = manifest && inspector ? await inspector.inspect(manifest) : null;
    // Ownership may have changed while the inspector ran.
    if (epoch) this.store.stillControls(viewer, epoch);

    const id = randomUUID();
    const workspaceId = this.store.tx(() => {
      const again = replay();
      if (again) return again;
      if (epoch) this.store.stillControls(viewer, epoch);
      const bid =
        businessId ??
        this.store.insertBusiness(viewer, "started", newBusiness, "software").businessId;
      const t = now();
      this.db
        .prepare(
          "INSERT INTO import_workspaces (id, business_id, name, description, product_kind, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
        )
        .run(id, bid, name, description, kind, viewer.id, t, t);
      for (const c of CATEGORIES)
        this.db
          .prepare(
            "INSERT INTO import_dependencies (workspace_id, category, uses, note, version) VALUES (?, ?, NULL, '', 0)",
          )
          .run(id, c);
      this.db
        .prepare(
          "INSERT INTO import_requests (person_id, idempotency_key, request_hash, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(viewer.id, key, requestHash, id, t);
      this.event("import.created", bid, viewer.id, {
        workspace: id,
        new_business: !businessId,
        kind,
      });
      if (manifest && facts && inspector && digest)
        this.record(viewer, id, bid, inspector, manifest, digest, facts, `create:${key}`);
      return id;
    });
    return { created: workspaceId === id, view: this.view(viewer, workspaceId) };
  }

  /** Inserts an inspection, its report and the audit event (inside the caller's transaction). */
  private record(
    viewer: Person,
    workspaceId: string,
    businessId: string,
    inspector: ImportInspector,
    manifest: InspectionInput,
    digest: string,
    facts: InspectionFacts,
    idempotencyKey: string,
  ) {
    const n =
      ((
        this.db
          .prepare("SELECT MAX(number) AS n FROM import_inspections WHERE workspace_id = ?")
          .get(workspaceId) as { n: number | null }
      ).n ?? 0) + 1;
    const t = now();
    this.db
      .prepare(
        "INSERT INTO import_inspections (workspace_id, number, inspector, inspector_version, input_digest, input_bytes, facts, idempotency_key, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        workspaceId,
        n,
        inspector.id,
        inspector.version,
        digest,
        Buffer.byteLength(manifest.content, "utf8"),
        JSON.stringify(facts),
        idempotencyKey,
        viewer.id,
        t,
      );
    const report = readiness(facts, n, this.assertions(workspaceId));
    this.db
      .prepare(
        "INSERT INTO import_reports (workspace_id, number, inspection_number, report, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(workspaceId, n, n, JSON.stringify(report), t);
    this.db.prepare("UPDATE import_workspaces SET updated_at = ? WHERE id = ?").run(t, workspaceId);
    this.event("import.inspected", businessId, viewer.id, {
      workspace: workspaceId,
      inspection: n,
      inspector: `${inspector.id}@${inspector.version}`,
      digest,
      dependencies: facts.counts.total,
    });
    return n;
  }

  /** A new inspection of a supplied manifest; the same key with the same file is a replay. */
  async inspect(viewer: Person, id: string, input: Record<string, unknown>) {
    const w = this.owned(viewer, id);
    const key = text(input.idempotency_key, IMPORT_LIMITS.key, "The request key");
    if (!key) bad("A request key is required (idempotency_key)");
    const manifest = supplied(input);
    const digest = sha256(manifest.content);
    const replay = () => {
      const r = this.db
        .prepare(
          "SELECT number, input_digest FROM import_inspections WHERE workspace_id = ? AND idempotency_key = ?",
        )
        .get(w.id, key) as { number: number; input_digest: string } | undefined;
      if (r && r.input_digest !== digest)
        bad("This request key was already used for a different file. Nothing was changed.", 409);
      return r?.number ?? null;
    };
    if (replay() !== null) return { created: false, view: this.view(viewer, w.id) };
    const epoch = this.store.controlEpoch(viewer, w.business_id);
    const inspector = this.inspector();
    const facts = await inspector.inspect(manifest);
    this.store.stillControls(viewer, epoch);
    let created = false;
    this.store.tx(() => {
      if (replay() !== null) return;
      this.store.stillControls(viewer, epoch);
      this.owned(viewer, w.id);
      this.record(viewer, w.id, w.business_id, inspector, manifest, digest, facts, key);
      created = true;
    });
    return { created, view: this.view(viewer, w.id) };
  }

  /** Corrects the product description; refused if someone saved after `version`. */
  update(viewer: Person, id: string, input: Record<string, unknown>) {
    const w = this.owned(viewer, id);
    const version = Number(input.version);
    if (!Number.isInteger(version)) bad("Say which version your changes start from (version)");
    const name =
      input.name === undefined
        ? w.name
        : text(input.name, IMPORT_LIMITS.productName, "The product name");
    if (!name) bad("The product needs a name");
    const description =
      input.description === undefined
        ? w.description
        : text(input.description, IMPORT_LIMITS.description, "The description", true);
    const kind =
      input.product_kind === undefined ? w.product_kind : this.parseKind(input.product_kind);
    this.store.tx(() => {
      // Job 003wf3 (S-21, found by the route inventory): an owner edit, refused in its own
      // transaction while this business is changing hands.
      this.store.requireNoHandover(w.business_id);
      const r = this.db
        .prepare(
          "UPDATE import_workspaces SET name = ?, description = ?, product_kind = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        )
        .run(name, description, kind, now(), w.id, version);
      if (r.changes !== 1)
        bad(
          "Someone saved this product's details after you opened them. Nothing was overwritten; reload and apply your change again.",
          409,
        );
      this.event("import.edited", w.business_id, viewer.id, {
        workspace: w.id,
        version: version + 1,
      });
    });
    return this.view(viewer, w.id);
  }

  /**
   * Records what the founder says about one dependency: used (with a note) or not used, or
   * cleared. This is a statement, shown as such; it never makes anything verified.
   */
  declare(viewer: Person, id: string, category: string, input: Record<string, unknown>) {
    const w = this.owned(viewer, id);
    if (!CATEGORIES.includes(category as Category)) throw new HttpError(404, "No such item");
    if ("status" in input || "verified" in input || "detected" in input)
      bad(
        "Only what you say can be recorded here; detection comes from inspections and verification needs a connected account.",
      );
    const version = Number(input.version);
    if (!Number.isInteger(version)) bad("Say which version your change starts from (version)");
    const uses = input.uses;
    if (uses !== true && uses !== false && uses !== null)
      bad("Say whether it is used (true or false), or null to clear it");
    const note = uses === null ? "" : text(input.note, IMPORT_LIMITS.note, "The note", true);
    if (uses === true && !note) bad("Say what is used and who controls the account");
    for (const r of SECRET_VALUE)
      if (r.test(note))
        bad(
          "That note looks like it contains a secret key. Never paste keys here; nothing was saved.",
        );
    if (urlHasCredential(note))
      bad("That note has a URL with credentials in it. Remove them; nothing was saved.");
    this.store.tx(() => {
      this.store.requireNoHandover(w.business_id); // job 003wf3 (S-21): as update
      const r = this.db
        .prepare(
          "UPDATE import_dependencies SET uses = ?, note = ?, asserted_by = ?, asserted_at = ?, version = version + 1 WHERE workspace_id = ? AND category = ? AND version = ?",
        )
        .run(
          uses === null ? null : uses ? 1 : 0,
          note,
          uses === null ? null : viewer.id,
          uses === null ? null : now(),
          w.id,
          category,
          version,
        );
      if (r.changes !== 1)
        bad(
          "This item was changed after you opened it. Nothing was overwritten; reload and apply your change again.",
          409,
        );
      this.db.prepare("UPDATE import_workspaces SET updated_at = ? WHERE id = ?").run(now(), w.id);
      this.event("import.declared", w.business_id, viewer.id, {
        workspace: w.id,
        category,
        uses,
        version: version + 1,
      });
    });
    return this.view(viewer, w.id);
  }
}
