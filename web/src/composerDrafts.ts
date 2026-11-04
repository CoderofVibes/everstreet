// Job 001k1: the Studio composers' UNSENT text, kept in this browser tab (session storage) so it
// survives leaving the Studio and coming back (Build → the same project card) and a reload.
// - One entry per composer KIND (the web app's, the brief companion's) and SCOPE (person,
//   project, owner epoch: studioScope.ts). Another person, project or owner never reads it.
// - Versioned and bounded: an entry of another version, an unreadable one, an over-long one or
//   one older than a week is ignored and removed. Writing never throws: denied storage leaves
//   the in-memory draft working exactly as before.
// - Only unsent text. Requests in flight keep their own envelopes (appGenerate.ts, the brief
//   outbox below), and nothing here is ever sent anywhere.

import type { Outbox } from "./outbox.ts";

export interface DraftStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  /** Optional enumeration (Web Storage has it), used only to clear a project's entries. */
  readonly length?: number;
  key?(i: number): string | null;
}

export type DraftKind = "app" | "brief" | "brief-outbox";
const VERSION = 1;
/** Both composers allow at most 2000 characters (their textarea maxLength). */
export const DRAFT_MAX = 2000;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_RAW = 4 * DRAFT_MAX + 512;
const PREFIX = `everstreet.draft.v${VERSION}.`;
const OUTBOX_KEY = /^[A-Za-z0-9_-]{8,80}$/;

const keyOf = (kind: DraftKind, scope: string) => `${PREFIX}${kind}.${scope}`;

function drop(storage: DraftStorage | null, k: string) {
  try {
    storage?.removeItem(k);
  } catch {
    // denied: nothing to do
  }
}

/** The stored record for a kind and scope, or null (anything invalid is removed). */
function read(
  storage: DraftStorage | null,
  kind: DraftKind,
  scope: string,
  now: number,
): Record<string, unknown> | null {
  const k = keyOf(kind, scope);
  let raw: string | null = null;
  try {
    raw = storage?.getItem(k) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    if (raw.length > MAX_RAW) throw new Error("over limit");
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      !v ||
      typeof v !== "object" ||
      v.v !== VERSION ||
      v.scope !== scope ||
      typeof v.at !== "number" ||
      !Number.isFinite(v.at) ||
      now - v.at > MAX_AGE_MS ||
      v.at - now > 60_000
    )
      throw new Error("invalid");
    return v;
  } catch {
    drop(storage, k);
    return null;
  }
}

function write(
  storage: DraftStorage | null,
  kind: DraftKind,
  scope: string,
  value: Record<string, unknown> | null,
  now: number,
) {
  const k = keyOf(kind, scope);
  if (!value) return drop(storage, k);
  try {
    storage?.setItem(k, JSON.stringify({ v: VERSION, scope, at: now, ...value }));
  } catch {
    // denied or full: the in-memory value still works this session
  }
}

/** The unsent text for a composer in a scope ("" when none or invalid). */
export function readDraft(
  storage: DraftStorage | null,
  kind: "app" | "brief",
  scope: string,
  now = Date.now(),
): string {
  const v = read(storage, kind, scope, now);
  const text = v?.text;
  if (typeof text !== "string" || text.length > DRAFT_MAX) {
    if (v) drop(storage, keyOf(kind, scope));
    return "";
  }
  return text;
}

/** Keeps (or, when empty, removes) the unsent text. Over-long text isn't kept. */
export function writeDraft(
  storage: DraftStorage | null,
  kind: "app" | "brief",
  scope: string,
  text: string,
  now = Date.now(),
) {
  write(storage, kind, scope, text && text.length <= DRAFT_MAX ? { text } : null, now);
}

/**
 * The brief companion's unresolved message (text and its exact request key). A message that
 * was still sending when the page went away is recalled as "unknown": no answer was seen, so
 * "Send again" reuses the same key and the server never takes it twice.
 */
export function readOutbox(
  storage: DraftStorage | null,
  scope: string,
  now = Date.now(),
): Outbox | null {
  const v = read(storage, "brief-outbox", scope, now);
  if (!v) return null;
  const ok =
    typeof v.text === "string" &&
    v.text.length > 0 &&
    v.text.length <= DRAFT_MAX &&
    typeof v.key === "string" &&
    OUTBOX_KEY.test(v.key) &&
    (v.state === "sending" || v.state === "unknown" || v.state === "refused") &&
    (v.reason === null || typeof v.reason === "string");
  if (!ok) {
    drop(storage, keyOf("brief-outbox", scope));
    return null;
  }
  const state = v.state === "sending" ? "unknown" : (v.state as Outbox["state"]);
  return {
    text: v.text as string,
    key: v.key as string,
    state,
    reason:
      v.state === "sending"
        ? "No clear answer arrived, so it may or may not have been sent."
        : ((v.reason as string | null) ?? null),
  };
}

export function writeOutbox(
  storage: DraftStorage | null,
  scope: string,
  outbox: Outbox | null,
  now = Date.now(),
) {
  write(
    storage,
    "brief-outbox",
    scope,
    outbox
      ? { text: outbox.text, key: outbox.key, state: outbox.state, reason: outbox.reason }
      : null,
    now,
  );
}

/** Removes every kind for one scope (access to it definitely ended). */
export function clearScope(storage: DraftStorage | null, scope: string) {
  for (const kind of ["app", "brief", "brief-outbox"] as const) drop(storage, keyOf(kind, scope));
}

/**
 * Removes every composer entry for this person and project, whatever the owner epoch (the
 * project definitely isn't theirs any more). Bounded by the storage's own length.
 */
export function clearProject(storage: DraftStorage | null, personId: string, projectId: string) {
  if (!storage || typeof storage.key !== "function" || typeof storage.length !== "number") return;
  const head = JSON.stringify([personId, projectId]).slice(0, -1); // `["person","project"`
  const doomed: string[] = [];
  try {
    for (let i = 0; i < Math.min(storage.length, 10_000); i++) {
      const k = storage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const scope = k.slice(k.indexOf(".", PREFIX.length) + 1);
      if (scope.startsWith(`${head},`)) doomed.push(k);
    }
  } catch {
    return;
  }
  for (const k of doomed) drop(storage, k);
}
