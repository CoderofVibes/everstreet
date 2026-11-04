// Job 002e: `web_app_bundle/1`, a small generated browser app as an explicit file list (never
// an archive). The platform parses it, rebuilds it from checked parts, refuses anything
// ambiguous or outside the bundle, canonicalizes and hashes it. Nothing here executes the
// bundle's code: the static reference checks are an early refusal, not the boundary (the
// isolated worker and the preview's CSP are). Design: docs/design/EXECUTABLE_PRODUCTS.md §2.

import { createHash } from "node:crypto";
import { canonicalJson } from "./artifacts.ts";

export const APP_SCHEMA = "web_app_bundle/1" as const;
export const APP_RECIPE = "web_app_checks/1" as const;
export const MAX_FILES = 24;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024;
export const MAX_BUNDLE_BYTES = 320 * 1024;
export const MAX_CHECKS = 20;
const MAX_VALUE_BYTES = 4 * 1024;

/** Lowercase segments, at most three deep, one of four extensions: no traversal, no collisions. */
const PATH = /^[a-z0-9][a-z0-9_-]{0,39}(\/[a-z0-9][a-z0-9_-]{0,39}){0,2}\.(html|js|css|json)$/;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const CHECK_ID = /^[a-z][a-z0-9_-]{0,39}$/;

export const MEDIA_TYPE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export interface BundleFile {
  path: string;
  text: string;
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export interface BundleCheck {
  id: string;
  label: string;
  module: string;
  export: string;
  input: JsonValue;
  expect: JsonValue;
}
export interface WebAppBundle {
  kind: "web_app_bundle";
  schema_version: 1;
  name: string;
  description: string;
  files: BundleFile[];
  checks: BundleCheck[];
}

export type BundleResult =
  | {
      ok: true;
      bundle: WebAppBundle;
      canonical: string;
      digest: string;
      bytes: number;
      checks: { id: string; label: string; passed: boolean; detail: string }[];
    }
  | { ok: false; reason: string };

class Invalid extends Error {}
const fail = (m: string): never => {
  throw new Invalid(m);
};

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/** Well-formed, NFC, no BOM, no NUL or C0 controls except tab, LF and CR. */
function cleanText(s: unknown, what: string, maxBytes: number): string {
  if (typeof s !== "string") return fail(`${what} must be text`);
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s))
    fail(`${what} has invalid characters (a lone surrogate)`);
  if (s.normalize("NFC") !== s) fail(`${what} isn't in a single normal form (NFC)`);
  if (s.startsWith("﻿")) fail(`${what} starts with a byte-order mark`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the check is about control characters
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s))
    fail(`${what} contains control characters`);
  if (utf8(s) > maxBytes) fail(`${what} is larger than ${Math.round(maxBytes / 1024)} KB`);
  return s;
}

function shortText(v: unknown, max: number, what: string, required = true): string {
  if (v === undefined && !required) return "";
  if (typeof v !== "string") return fail(`${what} must be text`);
  const s = cleanText(v, what, max * 4).trim();
  if (required && !s) fail(`${what} is empty`);
  if (s.length > max) fail(`${what} is longer than ${max} characters`);
  if (/[\r\n]/.test(s)) fail(`${what} must be one line`);
  return s;
}

/** A plain JSON value, bounded; rebuilt so nothing but data survives. */
function jsonValue(v: unknown, what: string, depth = 0): JsonValue {
  if (depth > 8) fail(`${what} is nested too deeply`);
  if (v === null || typeof v === "boolean" || typeof v === "string") return v as JsonValue;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail(`${what} must be a finite number`);
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => jsonValue(x, `${what}[${i}]`, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      out[k] = jsonValue(x, `${what}.${k}`, depth + 1);
    return out;
  }
  return fail(`${what} must be plain data`);
}

/** Every local reference must name a bundle file: no scheme, no `//`, no absolute path. */
export function resolveRef(from: string, ref: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/") || ref.startsWith("\\")) return null;
  if (ref.includes("\\") || ref.includes("?") || ref.includes("#")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  const path = parts.join("/");
  return PATH.test(path) ? path : null;
}

function staticProblems(files: BundleFile[]): string[] {
  const names = new Set(files.map((f) => f.path));
  const problems: string[] = [];
  const need = (from: string, ref: string, what: string) => {
    const r = resolveRef(from, ref);
    if (!r) problems.push(`${from}: ${what} "${ref.slice(0, 80)}" leaves the bundle`);
    else if (!names.has(r))
      problems.push(`${from}: ${what} "${ref.slice(0, 80)}" isn't in the bundle`);
  };
  for (const f of files) {
    if (f.path.endsWith(".html")) {
      for (const m of f.text.matchAll(
        /\s(src|href|action|srcset|poster|data)\s*=\s*["']?([^"'\s>]*)/gi,
      ))
        need(f.path, m[2] ?? "", m[1]?.toLowerCase() ?? "reference");
      if (/\son[a-z]+\s*=/i.test(f.text))
        problems.push(`${f.path}: inline event handlers (on…=) aren't allowed; use a script file`);
      if (/javascript:/i.test(f.text)) problems.push(`${f.path}: javascript: URLs aren't allowed`);
      if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(f.text))
        problems.push(`${f.path}: inline scripts aren't allowed; use a script file`);
      if (/<style[\s>]|\sstyle\s*=/i.test(f.text))
        problems.push(`${f.path}: inline styles aren't allowed; use a CSS file`);
      if (/<(iframe|object|embed|base|meta\s+http-equiv)/i.test(f.text))
        problems.push(`${f.path}: iframe, object, embed, base and meta refresh aren't allowed`);
    }
    if (f.path.endsWith(".js")) {
      for (const m of f.text.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']*)["']/g))
        need(f.path, m[1] ?? "", "import");
      for (const m of f.text.matchAll(/\bimport\s*["']([^"']*)["']/g))
        need(f.path, m[1] ?? "", "import");
      if (/\bimport\s*\(/.test(f.text))
        problems.push(`${f.path}: dynamic import() isn't allowed; import modules statically`);
    }
    if (f.path.endsWith(".css"))
      for (const m of f.text.matchAll(
        /url\(\s*["']?([^"')]*)["']?\s*\)|@import\s+["']([^"']*)["']/g,
      )) {
        const ref = m[1] ?? m[2] ?? "";
        if (!ref.startsWith("data:")) need(f.path, ref, "url");
      }
  }
  if (!names.has("index.html")) problems.push("index.html is missing");
  return problems;
}

function parse(raw: unknown): WebAppBundle {
  let value = raw;
  if (typeof raw === "string") {
    if (utf8(raw) > MAX_BUNDLE_BYTES) fail("The bundle is larger than 320 KB");
    try {
      value = JSON.parse(raw);
    } catch {
      fail("The output is text, not a structured bundle; model text is not a build");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("The bundle must be an object");
  const o = value as Record<string, unknown>;
  if (o.kind !== "web_app_bundle" || o.schema_version !== 1)
    fail(`Unsupported artifact: this request accepts only ${APP_SCHEMA}`);
  if (!Array.isArray(o.files) || o.files.length < 1 || o.files.length > MAX_FILES)
    fail(`files must list 1 to ${MAX_FILES} files`);
  const seen = new Set<string>();
  let total = 0;
  const files = (o.files as unknown[]).map((x, i) => {
    if (!x || typeof x !== "object") return fail(`files[${i}] must be an object`);
    const f = x as Record<string, unknown>;
    if (typeof f.path !== "string" || !PATH.test(f.path))
      fail(
        `files[${i}].path must be a short lowercase relative path ending .html, .js, .css or .json`,
      );
    const path = f.path as string;
    if (seen.has(path)) fail(`Two files share the path "${path}"`);
    seen.add(path);
    const text = cleanText(f.text, `files[${i}] (${path})`, MAX_FILE_BYTES);
    total += utf8(text);
    if (total > MAX_TOTAL_BYTES) fail("The files are larger than 256 KB together");
    if (path.endsWith(".json"))
      try {
        JSON.parse(text);
      } catch {
        fail(`${path} isn't valid JSON`);
      }
    return { path, text };
  });
  if (!Array.isArray(o.checks) || o.checks.length < 1 || o.checks.length > MAX_CHECKS)
    fail(`checks must list 1 to ${MAX_CHECKS} cases`);
  const ids = new Set<string>();
  const checks = (o.checks as unknown[]).map((x, i) => {
    if (!x || typeof x !== "object") return fail(`checks[${i}] must be an object`);
    const c = x as Record<string, unknown>;
    if (typeof c.id !== "string" || !CHECK_ID.test(c.id))
      fail(`checks[${i}].id must be a short lowercase id`);
    if (ids.has(c.id as string)) fail(`Two checks share the id "${c.id}"`);
    ids.add(c.id as string);
    if (typeof c.module !== "string" || !c.module.endsWith(".js") || !seen.has(c.module))
      fail(`checks[${i}].module must be a .js file in the bundle`);
    if (typeof c.export !== "string" || !IDENT.test(c.export))
      fail(`checks[${i}].export must be an exported function's name`);
    const input = jsonValue(c.input ?? null, `checks[${i}].input`);
    const expect = jsonValue(c.expect ?? null, `checks[${i}].expect`);
    if (
      utf8(canonicalJson(input)) > MAX_VALUE_BYTES ||
      utf8(canonicalJson(expect)) > MAX_VALUE_BYTES
    )
      fail(`checks[${i}] input and expected value must each be at most 4 KB`);
    return {
      id: c.id as string,
      label: shortText(c.label, 120, `checks[${i}].label`),
      module: c.module as string,
      export: c.export as string,
      input,
      expect,
    };
  });
  return {
    kind: "web_app_bundle",
    schema_version: 1,
    name: shortText(o.name, 80, "name"),
    description: shortText(o.description, 300, "description", false),
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
    checks,
  };
}

/** Parse, rebuild, statically check and hash a bundle. */
export function validateBundle(raw: unknown): BundleResult {
  let bundle: WebAppBundle;
  try {
    bundle = parse(raw);
  } catch (e) {
    return { ok: false, reason: e instanceof Invalid ? e.message : "The bundle could not be read" };
  }
  const problems = staticProblems(bundle.files);
  const checks = [
    {
      id: "references_stay_in_bundle",
      label: "Every script, style, link and import names a file in the bundle; nothing external",
      passed: problems.length === 0,
      detail: problems.slice(0, 5).join("; "),
    },
  ];
  if (problems.length)
    return { ok: false, reason: `Static checks failed: ${problems.slice(0, 3).join("; ")}` };
  const canonical = canonicalJson(bundle);
  const bytes = utf8(canonical);
  if (bytes > MAX_BUNDLE_BYTES) return { ok: false, reason: "The bundle is larger than 320 KB" };
  return {
    ok: true,
    bundle,
    canonical,
    digest: createHash("sha256").update(canonical).digest("hex"),
    bytes,
    checks,
  };
}

/** Reads a stored canonical bundle back (it was validated when stored). */
export function storedBundle(canonical: string): WebAppBundle {
  return JSON.parse(canonical) as WebAppBundle;
}
