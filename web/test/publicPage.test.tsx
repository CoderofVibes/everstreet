// Job 003q1: a published page that offers a released digital product must not also say that
// nothing is offered. Rendered to static markup, with no effects run and no network.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicBusiness } from "../src/api.ts";
import { StorefrontView } from "../src/pages/PublicPage.tsx";
import { SessionProvider } from "../src/session.tsx";

const page = {
  slug: "ledger-lantern",
  name: "Ledger Lantern",
  tagline: "Invoice fields, read for you",
  about: "A fictional digital product business.",
  family: "software",
  stage: "open",
  published_at: "2026-11-01T00:00:00.000Z",
  founder: { display_name: "Rae Fictional", headline: "Founder", bio: "" },
  idea: null,
  offer: null,
  unknown: [],
  action: { kind: "interest", label: "Tell me when it opens" },
  interested: 0,
} as unknown as PublicBusiness;

const html = (digitalOffers?: number) =>
  renderToStaticMarkup(
    <SessionProvider>
      <StorefrontView page={page} digitalOffers={digitalOffers} />
    </SessionProvider>,
  );

describe("003q1 the public page agrees with its digital offers", () => {
  it("with a released digital offer, it never says no offer is published", () => {
    const out = html(1);
    expect(out).not.toContain("No offer published yet");
    expect(out).toContain("Its digital product is offered above");
    expect(html(2)).toContain("Its digital products are offered above");
  });

  it("with no digital offer and no service offer, it still says so plainly", () => {
    expect(html()).toContain("No offer published yet");
    expect(html(0)).toContain("No offer published yet");
  });
});
