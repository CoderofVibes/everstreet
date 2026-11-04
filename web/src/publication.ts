// Job 001d: the digital public profile: owner API calls and pure rules. The editor keeps unsaved
// edits through reloads and conflicts, and publishes only the revision whose exact preview was
// shown (never a dirty draft).

import { ApiError, type DigitalPublic } from "./api.ts";

export interface ProfileDraft {
  headline: string;
  summary: string;
  audience: string;
  capabilities: string[];
  products: string[];
}

export interface ProfileView {
  draft: ProfileDraft;
  draft_rev: number;
  draft_updated_at: string | null;
  live_rev: number | null;
  live_published_at: string | null;
  page_published: boolean;
  live: DigitalPublic | null;
  /** Job 001d1: the live profile names a release that is no longer the product's active one. */
  live_outdated: boolean;
  preview: DigitalPublic;
  /** Job 001d1: the identity of this exact preview; publishing presents it. */
  review: string;
  eligibility: { ok: boolean; reasons: string[] };
  /** Job 001d1: the owner's products, by the name customers would see. */
  choices: {
    project_id: string;
    public_name: string;
    brief_name: string | null;
    state: "in_development" | "released" | "offered";
  }[];
  limits: {
    headline: number;
    summary: number;
    audience: number;
    capability: number;
    capabilities: number;
    products: number;
  };
  already?: boolean;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

export const publicationApi = {
  view: (id: string) => call<ProfileView>(`/api/businesses/${id}/public-profile`),
  save: (id: string, base_rev: number, draft: ProfileDraft) =>
    call<ProfileView>(`/api/businesses/${id}/public-profile/draft`, "PUT", { base_rev, draft }),
  /** 001d1: publishes the reviewed revision with its review identity (the preview shown). */
  publish: (id: string, draft_rev: number, review: string) =>
    call<ProfileView>(`/api/businesses/${id}/public-profile/publish`, "POST", {
      draft_rev,
      review,
    }),
  unpublish: (id: string) => call<unknown>(`/api/businesses/${id}/unpublish`, "POST"),
};

export const AVAILABILITY_LABEL: Record<DigitalPublic["availability"], string> = {
  available: "Available to use",
  coming_soon: "Not open for use yet",
};

export const PRODUCT_PUBLIC_STATUS: Record<DigitalPublic["products"][number]["status"], string> = {
  available: "Available to use",
  not_open: "Released, not open for use yet",
  in_development: "In development",
};

const same = (a: ProfileDraft, b: ProfileDraft) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the editor's draft differs from the saved one. */
export const isDirty = (local: ProfileDraft, saved: ProfileDraft) => !same(local, saved);

/**
 * Why Publish is unavailable, or null. The shown preview is the saved draft's, so a dirty draft
 * must be saved (and its preview reviewed) first.
 */
export function publishBlocked(v: ProfileView, dirty: boolean): string | null {
  if (dirty) return "Save your changes first, then review the preview below before publishing.";
  if (!v.eligibility.ok) return v.eligibility.reasons.join(" ");
  // 001d1: the same revision can show different content after a release change; then it can (and
  // should) be reviewed and published again.
  if (v.live_rev === v.draft_rev && v.page_published && !v.live_outdated)
    return "This version is already live.";
  return null;
}

/**
 * Job 001d1: what the editor holds after a save reply. Text typed while the save was in flight is
 * kept (it isn't saved yet); otherwise the saved draft replaces the local copy.
 */
export function afterSave(localNow: ProfileDraft, sent: ProfileDraft, saved: ProfileDraft) {
  const typedAhead = !same(cleanDraft(localNow), sent);
  return { local: typedAhead ? localNow : saved, typedAhead };
}

/** Job 001d1: what a save did, without claiming nothing is public when a version is live. */
export function savedMessage(v: ProfileView, typedAhead: boolean): string {
  const live =
    v.live && v.page_published
      ? ` The public page still shows version ${v.live_rev} until you publish this one.`
      : " Nothing is public until you publish.";
  const more = typedAhead ? " Your newer edits aren't saved yet." : "";
  return `Saved as version ${v.draft_rev}. Review its preview.${live}${more}`;
}

/**
 * Job 001d1: the outcome of taking the page down. A refusal is said plainly; an answer that never
 * came (network, server error) is uncertain, never reported as success or failure.
 */
export function unpublishOutcome(e: unknown): { tone: "ok" | "error" | "uncertain"; text: string } {
  if (e === null)
    return {
      tone: "ok",
      text: "The page is taken down. Customers keep their existing uses; your draft is unchanged.",
    };
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500)
    return { tone: "error", text: (e as Error).message };
  return {
    tone: "uncertain",
    text: "We couldn't confirm whether the page was taken down. Its status below is being checked again; try again only if it still shows as published.",
  };
}

/** Trims the editor's text for saving; blank capability lines are dropped. */
export function cleanDraft(d: ProfileDraft): ProfileDraft {
  return {
    headline: d.headline.trim(),
    summary: d.summary.trim(),
    audience: d.audience.trim(),
    capabilities: d.capabilities.map((c) => c.trim()).filter(Boolean),
    products: d.products,
  };
}
