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
  preview: DigitalPublic;
  eligibility: { ok: boolean; reasons: string[] };
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
  publish: (id: string, draft_rev: number) =>
    call<ProfileView>(`/api/businesses/${id}/public-profile/publish`, "POST", { draft_rev }),
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
  if (v.live_rev === v.draft_rev && v.page_published) return "This version is already live.";
  return null;
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
