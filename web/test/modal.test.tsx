// Job 003w-d first correction (Astra's CompositionFirstSliceReview): in the actual configured
// sign-in dialog, focus stayed on the background "Sign in or join" button, Tab reached the page's
// Home link and Escape didn't close it. These are the modal's key rules (web/src/modal.ts), which
// `useModalFocus` applies on the real DOM, plus the dialog's rendered focus target. (No DOM test
// environment is installed; the browser repeat is Astra's.)

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { modalKey, wrapTarget } from "../src/modal.ts";
import { VerifiedSignInNotice } from "../src/ui.tsx";

describe("003w-d modal keyboard rules", () => {
  it("the reproduced case: focus on a background control, Tab, comes back into the dialog", () => {
    const notNow = { name: "Not now" };
    const background = { name: "Home" };
    expect(modalKey("Tab", false, [notNow], background)).toEqual({ kind: "focus", target: notNow });
    expect(modalKey("Tab", true, [notNow], background)).toEqual({ kind: "focus", target: notNow });
  });

  it("with one control, Tab and Shift+Tab stay on it; Escape closes", () => {
    const only = { name: "Not now" };
    expect(modalKey("Tab", false, [only], only)).toEqual({ kind: "focus", target: only });
    expect(modalKey("Tab", true, [only], only)).toEqual({ kind: "focus", target: only });
    expect(modalKey("Escape", false, [only], only)).toEqual({ kind: "close" });
    expect(modalKey("Enter", false, [only], only)).toEqual({ kind: "none" });
  });

  it("with several, Tab wraps only at the edges; inside, the browser's own move is kept", () => {
    const [a, b, c] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const all = [a, b, c];
    expect(wrapTarget(all, c, false)).toBe(a); // past the last: back to the first
    expect(wrapTarget(all, a, true)).toBe(c); // before the first: to the last
    expect(wrapTarget(all, a, false)).toBeNull();
    expect(wrapTarget(all, b, true)).toBeNull();
    expect(wrapTarget([], a, false)).toBeNull();
  });

  it("the verified notice is a labelled modal whose initial focus is its own control", () => {
    const html = renderToStaticMarkup(
      <VerifiedSignInNotice reason="Sign in." onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="signin-title"');
    expect(html).toMatch(/<button[^>]*data-autofocus[^>]*>Not now<\/button>/);
  });
});
