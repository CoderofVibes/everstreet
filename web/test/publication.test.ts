// Job 001d: the public profile editor's rules. Only a saved, reviewed draft can be published;
// unsaved edits are recognised as such; text is cleaned for saving; labels never imply a product
// is usable when no offer is open.

import { describe, expect, it } from "vitest";
import type { DigitalPublic } from "../src/api.ts";
import {
  AVAILABILITY_LABEL,
  cleanDraft,
  isDirty,
  PRODUCT_PUBLIC_STATUS,
  type ProfileDraft,
  type ProfileView,
  publishBlocked,
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
  preview,
  eligibility: { ok: true, reasons: [] },
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
