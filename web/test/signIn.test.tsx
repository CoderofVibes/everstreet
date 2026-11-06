// Job 003w-b, updated by 003w-e1: in verified mode the sign-in dialog never offers a name-only form.
// Without a configured wallet it says plainly that signing in isn't available; with one it says
// what signing in is (account proof only) and offers the wallet, and a synthetic harness wallet is
// always labelled as one.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifiedSignInNotice } from "../src/ui.tsx";

describe("003w-b/e1 verified sign-in dialog", () => {
  it("unavailable: no name field, no fictional people, no wallet button, an honest explanation", () => {
    const html = renderToStaticMarkup(
      <VerifiedSignInNotice reason="Sign in to open your product project." onClose={() => {}} />,
    );
    expect(html).toContain("Sign in with your NEAR account");
    expect(html).toContain("isn&#x27;t set up on this server");
    expect(html).not.toContain("Continue with");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("continue as someone already here");
  });

  it("available: account proof only, separate from using a service, with the wallet step", () => {
    const html = renderToStaticMarkup(
      <VerifiedSignInNotice
        reason="Sign in to use this product."
        onClose={() => {}}
        available
        onSignIn={() => {}}
      />,
    );
    expect(html).toContain("Continue with MyNearWallet");
    expect(html).toContain("sends no transaction, spends nothing");
    expect(html).toContain("using a service on this device is a separate step");
    expect(html).not.toContain("synthetic");
    expect(html).toMatch(/<button[^>]*data-autofocus[^>]*>Continue with MyNearWallet<\/button>/);
  });

  it("the review harness's wallet is labelled synthetic; a waiting attempt says where to act", () => {
    const html = renderToStaticMarkup(
      <VerifiedSignInNotice
        reason="Sign in."
        onClose={() => {}}
        available
        synthetic
        walletLabel="Synthetic review wallet"
        busy
        onSignIn={() => {}}
      />,
    );
    expect(html).toContain("Review harness: Synthetic review wallet is synthetic");
    expect(html).toContain("Waiting for Synthetic review wallet");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue with/);
  });
});
