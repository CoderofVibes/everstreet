// Job 001d: the public profile editor's rules. Only a saved, reviewed draft can be published;
// unsaved edits are recognised as such; text is cleaned for saving; labels never imply a product
// is usable when no offer is open.

import { describe, expect, it } from "vitest";
import type { DigitalPublic } from "../src/api.ts";
import { ApiError } from "../src/api.ts";
import {
  AVAILABILITY_LABEL,
  afterSave,
  cleanDraft,
  isDirty,
  PRODUCT_PUBLIC_STATUS,
  type ProfileDraft,
  type ProfileView,
  publishBlocked,
  savedMessage,
  unpublishOutcome,
} from "../src/publication.ts";

const draft: ProfileDraft = {
  headline: "Clean rows from invoices",
  summary: "Upload a fictional invoice and get clean rows.",
  audience: "Bookkeepers",
  capabilities: ["Reads totals"],
  products: ["p1"],
};
const preview: DigitalPublic = {
  headline: draft.headline,
  summary: draft.summary,
  audience: draft.audience,
  capabilities: draft.capabilities,
  products: [
    { name: "Invoice Reader", family_label: "AI API", status: "available", use_offer_id: "o1" },
  ],
  availability: "available",
  published_at: null,
};
const view = (o: Partial<ProfileView> = {}): ProfileView => ({
  draft,
  draft_rev: 2,
  draft_updated_at: "2026-11-04T10:00:00.000Z",
  live_rev: 1,
  live_published_at: "2026-11-04T09:00:00.000Z",
  page_published: true,
  live: preview,
  live_outdated: false,
  preview,
  review: "a".repeat(64),
  eligibility: { ok: true, reasons: [] },
  choices: [],
  limits: {
    headline: 120,
    summary: 400,
    audience: 200,
    capability: 120,
    capabilities: 6,
    products: 6,
  },
  ...o,
});

describe("001d1 editor recovery", () => {
  it("text typed while a save was in flight is kept, and said to be unsaved", () => {
    const sent = cleanDraft(draft);
    const saved = { ...sent };
    // Nothing typed meanwhile: the saved draft replaces the local copy.
    expect(afterSave(draft, sent, saved)).toEqual({ local: saved, typedAhead: false });
    // Typed ahead: the newer local text stays (the old editor overwrote it with the saved draft).
    const typed = { ...draft, headline: "Clean rows from invoices, faster" };
    expect(afterSave(typed, sent, saved)).toEqual({ local: typed, typedAhead: true });
  });

  it("the saved message never says nothing is public while a version is live", () => {
    expect(savedMessage(view({ draft_rev: 2, live_rev: 1 }), false)).toBe(
      "Saved as version 2. Review its preview. The public page still shows version 1 until you publish this one.",
    );
    expect(savedMessage(view({ live: null, live_rev: null, page_published: false }), true)).toBe(
      "Saved as version 2. Review its preview. Nothing is public until you publish. Your newer edits aren't saved yet.",
    );
  });

  it("taking the page down: success, refusal and an unconfirmed answer are all told apart", () => {
    expect(unpublishOutcome(null).tone).toBe("ok");
    expect(unpublishOutcome(new ApiError(404, "No such business"))).toEqual({
      tone: "error",
      text: "No such business",
    });
    expect(unpublishOutcome(new ApiError(503, "Busy")).tone).toBe("uncertain");
    expect(unpublishOutcome(new TypeError("Failed to fetch")).tone).toBe("uncertain");
    expect(unpublishOutcome(new TypeError("Failed to fetch")).text).not.toMatch(
      /^The page is taken down/,
    );
  });

  it("after a release change the same revision can be published again", () => {
    expect(publishBlocked(view({ live_rev: 2, live_outdated: true }), false)).toBeNull();
  });
});

describe("001d publishing only what was reviewed", () => {
  it("a dirty draft must be saved (and its preview reviewed) first", () => {
    expect(publishBlocked(view(), true)).toMatch(/Save your changes first/);
    expect(publishBlocked(view(), false)).toBeNull();
  });

  it("an ineligible draft says why; the live version can't be republished as new", () => {
    expect(
      publishBlocked(view({ eligibility: { ok: false, reasons: ["Write a headline."] } }), false),
    ).toBe("Write a headline.");
    expect(publishBlocked(view({ live_rev: 2 }), false)).toBe("This version is already live.");
    // Taken down: the same version can be published again.
    expect(publishBlocked(view({ live_rev: 2, page_published: false }), false)).toBeNull();
  });

  it("unsaved edits are recognised; saving trims text and drops blank lines", () => {
    expect(isDirty(draft, draft)).toBe(false);
    expect(isDirty({ ...draft, headline: "Other" }, draft)).toBe(true);
    expect(
      cleanDraft({ ...draft, headline: "  Spaced  ", capabilities: ["  a ", "", "  "] }),
    ).toEqual({ ...draft, headline: "Spaced", capabilities: ["a"] });
  });

  it("labels: nothing is called usable without an open offer", () => {
    expect(AVAILABILITY_LABEL.coming_soon).toBe("Not open for use yet");
    expect(PRODUCT_PUBLIC_STATUS.not_open).toMatch(/not open/i);
    expect(PRODUCT_PUBLIC_STATUS.in_development).toBe("In development");
  });
});
