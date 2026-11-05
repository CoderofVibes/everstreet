// Job 003w-b: in verified mode the sign-in dialog never offers a name-only form; it says plainly
// that signing in needs a wallet connection this version doesn't have yet.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifiedSignInNotice } from "../src/ui.tsx";

describe("003w-b verified sign-in notice", () => {
  it("offers no name field and no fictional people, only an honest explanation", () => {
    const html = renderToStaticMarkup(
      <VerifiedSignInNotice reason="Sign in to open your product project." onClose={() => {}} />,
    );
    expect(html).toContain("Sign in with your NEAR account");
    expect(html).toContain("A name alone isn&#x27;t an account");
    expect(html).toContain("doesn&#x27;t connect a wallet yet");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("continue as someone already here");
  });
});
