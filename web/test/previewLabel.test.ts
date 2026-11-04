// Job 003s1: the shell's preview label reads only a well-formed, bounded declaration, and the app
// never declares one itself.

import { afterEach, describe, expect, it } from "vitest";
import { previewLabel } from "../src/previewLabel.ts";

const g = globalThis as { __everstreetPreview?: unknown };

describe("003s1 preview label", () => {
  afterEach(() => {
    delete g.__everstreetPreview;
  });

  it("is absent unless a preview declares it", () => {
    expect(previewLabel()).toBeNull();
  });

  it("shows a declared label; ignores malformed or oversized ones", () => {
    g.__everstreetPreview = { label: "Preview only: synthetic", detail: "Not testnet proof." };
    expect(previewLabel()).toEqual({
      label: "Preview only: synthetic",
      detail: "Not testnet proof.",
    });
    for (const bad of ["text", { label: 5 }, { label: "" }, { label: "x".repeat(161) }]) {
      g.__everstreetPreview = bad;
      expect(previewLabel()).toBeNull();
    }
    g.__everstreetPreview = { label: "Preview only", detail: "x".repeat(601) };
    expect(previewLabel()).toEqual({ label: "Preview only", detail: "" });
  });
});
